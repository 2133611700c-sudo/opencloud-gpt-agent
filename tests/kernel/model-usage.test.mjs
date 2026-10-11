import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDeepSeekUsage,
  calculateModelUsageCost,
  microUsdToDecimal,
} from '../../src/accounting/model-usage.mjs';

test('normalizes explicit DeepSeek cache hit/miss usage', () => {
  const usage = normalizeDeepSeekUsage({
    prompt_tokens: 1_000_000,
    prompt_cache_hit_tokens: 400_000,
    prompt_cache_miss_tokens: 600_000,
    completion_tokens: 100_000,
    total_tokens: 1_100_000,
  });

  assert.deepEqual(usage, {
    promptTokens: 1_000_000,
    promptCacheHitTokens: 400_000,
    promptCacheMissTokens: 600_000,
    completionTokens: 100_000,
    totalTokens: 1_100_000,
  });
});

test('classifies unreported prompt tokens conservatively as cache miss', () => {
  const usage = normalizeDeepSeekUsage({
    prompt_tokens: 1000,
    prompt_cache_hit_tokens: 200,
    prompt_cache_miss_tokens: 300,
    completion_tokens: 50,
    total_tokens: 1050,
  });

  assert.equal(usage.promptCacheHitTokens, 200);
  assert.equal(usage.promptCacheMissTokens, 800);
});

test('falls back to all non-hit prompt tokens as miss when miss field is absent', () => {
  const usage = normalizeDeepSeekUsage({
    prompt_tokens: 1000,
    prompt_cache_hit_tokens: 250,
    completion_tokens: 50,
    total_tokens: 1050,
  });

  assert.equal(usage.promptCacheHitTokens, 250);
  assert.equal(usage.promptCacheMissTokens, 750);
});

test('calculates cost from injected versioned rates without hardcoded provider pricing', () => {
  const result = calculateModelUsageCost({
    usage: {
      prompt_tokens: 1_000_000,
      prompt_cache_hit_tokens: 500_000,
      prompt_cache_miss_tokens: 500_000,
      completion_tokens: 100_000,
      total_tokens: 1_100_000,
    },
    pricing: {
      version: 'test-pricing-v1',
      promptCacheHitMicroUsdPerMillion: 100_000n,
      promptCacheMissMicroUsdPerMillion: 1_000_000n,
      completionMicroUsdPerMillion: 2_000_000n,
    },
  });

  assert.equal(result.pricingVersion, 'test-pricing-v1');
  assert.equal(result.cost.promptCacheHitMicroUsd, 50_000n);
  assert.equal(result.cost.promptCacheMissMicroUsd, 500_000n);
  assert.equal(result.cost.completionMicroUsd, 200_000n);
  assert.equal(result.cost.totalMicroUsd, 750_000n);
  assert.equal(result.cost.totalUsdDecimal, '0.750000');
});

test('rounds each nonzero component upward to one micro-USD for conservative budgeting', () => {
  const result = calculateModelUsageCost({
    usage: {
      prompt_tokens: 2,
      prompt_cache_hit_tokens: 1,
      prompt_cache_miss_tokens: 1,
      completion_tokens: 1,
      total_tokens: 3,
    },
    pricing: {
      version: 'tiny-test',
      promptCacheHitMicroUsdPerMillion: 1n,
      promptCacheMissMicroUsdPerMillion: 1n,
      completionMicroUsdPerMillion: 1n,
    },
  });

  assert.equal(result.cost.promptCacheHitMicroUsd, 1n);
  assert.equal(result.cost.promptCacheMissMicroUsd, 1n);
  assert.equal(result.cost.completionMicroUsd, 1n);
  assert.equal(result.cost.totalMicroUsd, 3n);
});

test('rejects inconsistent provider totals and impossible cache counts', () => {
  assert.throws(() => normalizeDeepSeekUsage({
    prompt_tokens: 10,
    completion_tokens: 2,
    total_tokens: 99,
  }), /total_tokens mismatch/);

  assert.throws(() => normalizeDeepSeekUsage({
    prompt_tokens: 10,
    prompt_cache_hit_tokens: 8,
    prompt_cache_miss_tokens: 5,
    completion_tokens: 0,
    total_tokens: 10,
  }), /cannot exceed prompt_tokens/);
});

test('rejects negative/fractional usage and invalid pricing contracts', () => {
  assert.throws(() => normalizeDeepSeekUsage({ prompt_tokens: -1 }), /nonnegative safe integer/);
  assert.throws(() => normalizeDeepSeekUsage({ prompt_tokens: 1.5 }), /nonnegative safe integer/);

  assert.throws(() => calculateModelUsageCost({
    usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
    pricing: {
      version: '',
      promptCacheHitMicroUsdPerMillion: 1n,
      promptCacheMissMicroUsdPerMillion: 1n,
      completionMicroUsdPerMillion: 1n,
    },
  }), /pricing.version is required/);

  assert.throws(() => calculateModelUsageCost({
    usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
    pricing: {
      version: 'bad-rate',
      promptCacheHitMicroUsdPerMillion: 1,
      promptCacheMissMicroUsdPerMillion: 1n,
      completionMicroUsdPerMillion: 1n,
    },
  }), /must be a nonnegative bigint/);
});

test('formats micro-USD exactly to six decimal USD', () => {
  assert.equal(microUsdToDecimal(0n), '0.000000');
  assert.equal(microUsdToDecimal(1n), '0.000001');
  assert.equal(microUsdToDecimal(1_234_567n), '1.234567');
});
