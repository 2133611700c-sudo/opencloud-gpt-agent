export class LeaseLostError extends Error {
  constructor(message = 'Lease lost during heartbeat renewal') {
    super(message);
    this.name = 'LeaseLostError';
    this.code = 'LEASE_LOST';
  }
}

export class HeartbeatRenewalError extends Error {
  constructor(message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'HeartbeatRenewalError';
    this.code = 'HEARTBEAT_RENEWAL_FAILED';
  }
}

const sleep = (ms, onTimer) => new Promise((resolve) => {
  const timer = setTimeout(() => {
    onTimer(null, null);
    resolve();
  }, ms);
  onTimer(timer, resolve);
});

export class LeaseHeartbeatManager {
  #renew;
  #intervalMs;
  #abortController;
  #running = false;
  #loopPromise = null;
  #sleepTimer = null;
  #sleepResolve = null;
  #failure = null;

  constructor({ renew, intervalMs = 10_000, abortController = new AbortController() }) {
    if (typeof renew !== 'function') throw new TypeError('renew must be a function');
    if (!Number.isInteger(intervalMs) || intervalMs < 1) {
      throw new RangeError('intervalMs must be a positive integer');
    }
    if (!(abortController instanceof AbortController)) {
      throw new TypeError('abortController must be an AbortController');
    }

    this.#renew = renew;
    this.#intervalMs = intervalMs;
    this.#abortController = abortController;
  }

  get signal() {
    return this.#abortController.signal;
  }

  get running() {
    return this.#running;
  }

  get failure() {
    return this.#failure;
  }

  start() {
    if (this.#running || this.#loopPromise) {
      throw new Error('heartbeat manager already started');
    }
    if (this.signal.aborted) {
      throw new Error('cannot start heartbeat manager with an already-aborted signal');
    }

    this.#running = true;
    this.#loopPromise = this.#loop();
    return this;
  }

  async #loop() {
    try {
      while (this.#running) {
        await sleep(this.#intervalMs, (timer, resolve) => {
          this.#sleepTimer = timer;
          this.#sleepResolve = resolve;
        });
        this.#sleepTimer = null;
        this.#sleepResolve = null;

        if (!this.#running) break;

        try {
          const renewed = await this.#renew();
          if (renewed !== true) {
            throw new LeaseLostError();
          }
        } catch (error) {
          const failure = error instanceof LeaseLostError
            ? error
            : new HeartbeatRenewalError('Heartbeat renewal failed', error);
          this.#failure = failure;
          this.#running = false;
          if (!this.signal.aborted) this.#abortController.abort(failure);
          break;
        }
      }
    } finally {
      this.#running = false;
      this.#sleepTimer = null;
      this.#sleepResolve = null;
    }
  }

  async stop() {
    this.#running = false;

    if (this.#sleepTimer !== null) {
      clearTimeout(this.#sleepTimer);
      this.#sleepTimer = null;
      const resolve = this.#sleepResolve;
      this.#sleepResolve = null;
      resolve?.();
    }

    if (this.#loopPromise) {
      await this.#loopPromise;
      this.#loopPromise = null;
    }
  }
}
