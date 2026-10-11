const MICRO_USD_PER_USD = 1_000_000n;
const TOKENS_PER_MILLION = 1_000_000n;

const requireNonNegativeInteger = (value, field) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a nonnegative safe integer`);
  }
  return value;
};

const requireRate = (value, field) => {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new TypeError(`${field} must be a nonnegative bigint micro-USD rate per 1M tokens`);
  }
  return value;
};

const ceilDiv = (numerator, denominator) => {
  if (numerator === 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
};

export function normalizeDeepSeekUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    throw new TypeError('usage must be an object');
  }

  const promptTokens = requireNonNegativeInteger(usage.prompt_tokens ?? 0, 'prompt_tokens');
  const completionTokens = requireNonNegativeInteger(usage.completion_tokens ?? 0, 'completion_tokens');
  const explicitHit = requireNonNegativeInteger(
    usage.prompt_cache_hit_tokens ?? 0,
    'prompt_cache_hit_tokens',
  );
  const explicitMiss = usage.prompt_cache_miss_tokens == null
    ? null
    : requireNonNegativeInteger(usage.prompt_cache_miss_tokens, 'prompt_cache_miss_tokens');

  if (explicitHit > promptTokens) {
    throw new RangeError('prompt_cache_hit_tokens cannot exceed prompt_tokens');
  }

  let cacheMissTokens;
  if (explicitMiss === null) {
    cacheMissTokens = promptTokens - explicitHit;
  } else {
    if (explicitHit + explicitMiss > promptTokens) {
      throw new RangeError('cache hit + miss tokens cannot exceed prompt_tokens');
    }
    // Any provider-reported prompt tokens not classified as hit/miss are billed conservatively as miss.
    cacheMissTokens = explicitMiss + (promptTokens - explicitHit - explicitMiss);
  }

  const computedTotal = promptTokens + completionTokens;
  if (usage.total_tokens != null) {
    const providerTotal = requireNonNegativeInteger(usage.total_tokens, 'total_tokens');
    if (providerTotal !== computedTotal) {
      throw new RangeError(`total_tokens mismatch: provider=${providerTotal}, computed=${computedTotal}`);
    }
  }

  return Object.freeze({
    promptTokens,
    promptCacheHitTokens: explicitHit,
    promptCacheMissTokens: cacheMissTokens,
    completionTokens,
    totalTokens: computedTotal,
  });
}

export function calculateModelUsageCost({ usage, pricing }) {
  if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) {
    throw new TypeError('pricing must be an object');
  }
  if (typeof pricing.version !== 'string' || pricing.version.trim() === '') {
    throw new TypeError('pricing.version is required');
  }

  const normalized = normalizeDeepSeekUsage(usage);
  const hitRate = requireRate(pricing.promptCacheHitMicroUsdPerMillion, 'promptCacheHitMicroUsdPerMillion');
  const missRate = requireRate(pricing.promptCacheMissMicroUsdPerMillion, 'promptCacheMissMicroUsdPerMillion');
  const outputRate = requireRate(pricing.completionMicroUsdPerMillion, 'completionMicroUsdPerMillion');

  const hitMicroUsd = ceilDiv(BigInt(normalized.promptCacheHitTokens) * hitRate, TOKENS_PER_MILLION);
  const missMicroUsd = ceilDiv(BigInt(normalized.promptCacheMissTokens) * missRate, TOKENS_PER_MILLION);
  const completionMicroUsd = ceilDiv(BigInt(normalized.completionTokens) * outputRate, TOKENS_PER_MILLION);
  const totalMicroUsd = hitMicroUsd + missMicroUsd + completionMicroUsd;

  return Object.freeze({
    pricingVersion: pricing.version,
    ...normalized,
    cost: Object.freeze({
      promptCacheHitMicroUsd: hitMicroUsd,
      promptCacheMissMicroUsd: missMicroUsd,
      completionMicroUsd,
      totalMicroUsd,
      totalUsdDecimal: microUsdToDecimal(totalMicroUsd),
      rounding: 'CEIL_EACH_COMPONENT_TO_MICRO_USD',
    }),
  });
}

export function microUsdToDecimal(microUsd) {
  if (typeof microUsd !== 'bigint' || microUsd < 0n) {
    throw new TypeError('microUsd must be a nonnegative bigint');
  }
  const whole = microUsd / MICRO_USD_PER_USD;
  const fraction = (microUsd % MICRO_USD_PER_USD).toString().padStart(6, '0');
  return `${whole}.${fraction}`;
}
