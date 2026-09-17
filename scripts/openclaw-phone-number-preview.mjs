#!/usr/bin/env node

const apiKey = String(process.env.CALL2ME_API_KEY || "").trim();
const country = String(process.env.CALL2ME_NUMBER_COUNTRY || "US").trim().toUpperCase();
const numberType = String(process.env.CALL2ME_NUMBER_TYPE || "local").trim().toLowerCase();
const areaCode = String(process.env.CALL2ME_NUMBER_AREA_CODE || "").trim();
const locality = String(process.env.CALL2ME_NUMBER_LOCALITY || "").trim();
const limit = Math.min(20, Math.max(1, Number(process.env.CALL2ME_NUMBER_LIMIT || 10)));
const apiBase = "https://api.call2me.app/v1";

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

if (!apiKey) fail("BLOCKED_PRIVILEGE: CALL2ME_API_KEY is not configured", 20);
if (!/^[A-Z]{2}$/.test(country)) fail("CODE: invalid CALL2ME_NUMBER_COUNTRY", 21);
if (!/^[A-Za-z0-9_-]{2,30}$/.test(numberType)) fail("CODE: invalid CALL2ME_NUMBER_TYPE", 22);
if (areaCode && !/^\d{2,6}$/.test(areaCode)) fail("CODE: invalid CALL2ME_NUMBER_AREA_CODE", 23);
if (locality.length > 100) fail("CODE: CALL2ME_NUMBER_LOCALITY is too long", 24);

function maskNumber(value) {
  const n = String(value || "").trim();
  if (!/^\+[1-9]\d{7,14}$/.test(n)) return "unavailable";
  return `${n.slice(0, 2)}${"*".repeat(Math.max(0, n.length - 6))}${n.slice(-4)}`;
}

const qs = new URLSearchParams({
  country,
  phone_number_type: numberType,
  limit: String(limit),
});
if (areaCode) qs.set("area_code", areaCode);
if (locality) qs.set("locality", locality);

try {
  const response = await fetch(`${apiBase}/numbers/search?${qs.toString()}`, {
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
  if (!response.ok) fail(`PROVIDER: number search returned HTTP ${response.status}`, 40);

  const numbers = Array.isArray(body?.numbers) ? body.numbers : [];
  const candidates = numbers.slice(0, limit).map((entry) => ({
    number_masked: maskNumber(entry?.phone_number),
    country_code: entry?.country_code ?? country,
    phone_number_type: entry?.phone_number_type ?? numberType,
    monthly_price_usd: Number.isFinite(Number(entry?.monthly_price_usd)) ? Number(entry.monthly_price_usd) : null,
    upfront_price_usd: Number.isFinite(Number(entry?.upfront_price_usd)) ? Number(entry.upfront_price_usd) : null,
    provider: typeof entry?.provider === "string" ? entry.provider : null,
  }));

  const report = {
    provider: "Call2Me",
    mode: "zero_spend_number_preview",
    search: { country, phone_number_type: numberType, area_code: areaCode || null, locality: locality || null, limit },
    total: Number.isFinite(Number(body?.total)) ? Number(body.total) : candidates.length,
    requires_payment: body?.requires_payment === true,
    search_upfront_price_usd: Number.isFinite(Number(body?.upfront_price_usd)) ? Number(body.upfront_price_usd) : null,
    candidates,
    purchase_made: false,
    payment_made: false,
    checkout_created: false,
    call_created: false,
  };

  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  fail(error?.message || "PROVIDER: number preview failed", 40);
}
