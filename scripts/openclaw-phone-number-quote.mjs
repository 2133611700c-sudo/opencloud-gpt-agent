#!/usr/bin/env node

const apiKey = String(process.env.CALL2ME_API_KEY || "").trim();
const country = String(process.env.CALL2ME_NUMBER_COUNTRY || "US").trim().toUpperCase();
const areaCode = String(process.env.CALL2ME_NUMBER_AREA_CODE || "").trim();
const locality = String(process.env.CALL2ME_NUMBER_LOCALITY || "").trim();
const numberType = String(process.env.CALL2ME_NUMBER_TYPE || "local").trim();
const limit = Math.min(20, Math.max(1, Number(process.env.CALL2ME_NUMBER_LIMIT || 5)));
const apiBase = "https://api.call2me.app/v1";

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

if (!apiKey) fail("BLOCKED_PRIVILEGE: CALL2ME_API_KEY is not configured", 20);
if (!/^[A-Z]{2}$/.test(country)) fail("CODE: invalid CALL2ME_NUMBER_COUNTRY", 21);
if (areaCode && !/^\d{2,6}$/.test(areaCode)) fail("CODE: invalid CALL2ME_NUMBER_AREA_CODE", 22);
if (!/^[A-Za-z0-9_-]{2,32}$/.test(numberType)) fail("CODE: invalid CALL2ME_NUMBER_TYPE", 23);

const params = new URLSearchParams({
  country,
  phone_number_type: numberType,
  limit: String(limit),
});
if (areaCode) params.set("area_code", areaCode);
if (locality) params.set("locality", locality);

const response = await fetch(`${apiBase}/numbers/search?${params.toString()}`, {
  method: "GET",
  signal: AbortSignal.timeout(30000),
  headers: {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  },
});

const text = await response.text();
let body = {};
try { body = text ? JSON.parse(text) : {}; } catch {}
if (!response.ok) fail(`PROVIDER: GET /numbers/search returned HTTP ${response.status}`, 40);

const numbers = Array.isArray(body?.numbers) ? body.numbers : [];
const safe = numbers.map((entry) => ({
  country_code: entry?.country_code ?? null,
  phone_number_type: entry?.phone_number_type ?? null,
  locality: entry?.locality ?? null,
  provider: entry?.provider ?? null,
  monthly_price_usd: Number.isFinite(Number(entry?.monthly_price_usd)) ? Number(entry.monthly_price_usd) : null,
  upfront_price_usd: Number.isFinite(Number(entry?.upfront_price_usd)) ? Number(entry.upfront_price_usd) : null,
  features: Array.isArray(entry?.features) ? entry.features : [],
  phone_number_masked: String(entry?.phone_number || "").replace(/.(?=.{4})/g, "*") || null,
}));

console.log(JSON.stringify({
  provider: "Call2Me",
  mode: "zero_spend_number_quote",
  query: { country, area_code: areaCode || null, locality: locality || null, phone_number_type: numberType, limit },
  total: Number(body?.total ?? safe.length),
  requires_payment: body?.requires_payment === true,
  response_upfront_price_usd: Number.isFinite(Number(body?.upfront_price_usd)) ? Number(body.upfront_price_usd) : null,
  offers: safe,
  purchase_made: false,
  checkout_created: false,
  payment_made: false,
  call_created: false,
}, null, 2));
