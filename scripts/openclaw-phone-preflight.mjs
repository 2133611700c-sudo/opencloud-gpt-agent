#!/usr/bin/env node

const apiKey = String(process.env.CALL2ME_API_KEY || "").trim();
const agentId = String(process.env.CALL2ME_AGENT_ID || "agent_f2949915a3f2").trim();
const requestedFromNumber = String(process.env.CALL2ME_FROM_NUMBER || "").trim();
const apiBase = "https://api.call2me.app/v1";

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

if (!apiKey) fail("BLOCKED_PRIVILEGE: CALL2ME_API_KEY is not configured", 20);
if (!/^agent_[A-Za-z0-9]+$/.test(agentId)) fail("CODE: invalid CALL2ME_AGENT_ID", 21);
if (requestedFromNumber && !/^\+[1-9]\d{7,14}$/.test(requestedFromNumber)) fail("CODE: invalid CALL2ME_FROM_NUMBER", 22);

async function get(endpoint) {
  const response = await fetch(`${apiBase}${endpoint}`, {
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
  if (!response.ok) {
    const error = new Error(`PROVIDER: GET ${endpoint} returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function list(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["phone_numbers", "numbers", "items", "data"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function e164(entry) {
  const value = String(entry?.phone_number || entry?.number || entry?.e164 || "").trim();
  return /^\+[1-9]\d{7,14}$/.test(value) ? value : "";
}

try {
  const [agent, numbersPayload, wallet] = await Promise.all([
    get(`/agents/${encodeURIComponent(agentId)}`),
    get("/phone-numbers"),
    get("/wallet/balance"),
  ]);

  const numbers = list(numbersPayload);
  const owned = numbers.map(e164).filter(Boolean);
  const bound = numbers.find((entry) => String(entry?.agent_id || entry?.assigned_agent_id || "") === agentId);
  const boundNumber = e164(bound);
  const selectedNumber = requestedFromNumber || boundNumber || owned[0] || "";
  const requestedOwned = !requestedFromNumber || owned.includes(requestedFromNumber);
  const balance = Number(wallet?.balance_usd ?? wallet?.balance ?? wallet?.available_balance ?? 0);
  const minimum = Number(wallet?.min_balance ?? 0.01);
  const walletCanProceed = wallet?.can_proceed !== false && Number.isFinite(balance) && balance >= minimum;

  const readiness = {
    provider: "Call2Me",
    mode: "zero_spend_preflight",
    agent_id: agentId,
    agent_exists: Boolean(agent?.agent_id || agent?.id || Object.keys(agent || {}).length),
    owned_number_count: owned.length,
    bound_number_present: Boolean(boundNumber),
    selected_number_present: Boolean(selectedNumber),
    requested_number_owned: requestedOwned,
    wallet_balance_usd: Number.isFinite(balance) ? balance : null,
    wallet_minimum_usd: Number.isFinite(minimum) ? minimum : null,
    wallet_can_proceed: walletCanProceed,
    api_key_present: true,
    purchase_made: false,
    payment_made: false,
    reservation_made: false,
    call_created: false,
    ready_for_paid_call: Boolean(selectedNumber && requestedOwned && walletCanProceed),
  };

  console.log(JSON.stringify(readiness, null, 2));

  if (!readiness.agent_exists) fail("PROVIDER: universal agent not found", 30);
  if (!requestedOwned) fail("PROVIDER: configured CALL2ME_FROM_NUMBER is not owned", 31);

  // A missing number or insufficient wallet is an expected commercial blocker,
  // not a code failure. Preflight exits successfully after reporting it.
} catch (error) {
  fail(error?.message || "PROVIDER: Call2Me preflight failed", 40);
}
