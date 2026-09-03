#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const EMAIL = '2133611700c@gmail.com';
const PHONE = '+12133611700';
const password = `V0ice!${crypto.randomBytes(18).toString('hex')}Aa1`;
const outDir = path.resolve('ops/agent-control/reports/call2me-selftest');
fs.mkdirSync(outDir, { recursive: true });
const reportFile = path.join(outDir, 'latest.json');

const prompt = `You are Sergii's automated purchasing and vendor-call assistant. You place outbound calls to stores, parts departments, trailer dealers, repair shops, and suppliers.

ROLE RULES:
- You are the caller/buyer, never the receptionist or seller.
- Never say "Can I help you?", "How can I help you?", or anything that sounds like you answered their call.
- Open immediately with who you represent, what item/service you need, and the concrete question.
- If asked who you are, say you are an automated purchasing assistant calling on behalf of Sergii. Never pretend to be human.

CALL FLOW:
1. OPEN: Introduce yourself in one sentence and state the exact request from the call context.
2. VERIFY: Confirm whether the exact item/service is physically available now and whether it can be picked up today.
3. DETAILS: Ask current price, whether price is per item or per pair, quantity available, exact pickup address, and relevant hours.
4. ALTERNATIVE: If the exact item is unavailable and the context allows alternatives, ask for a genuinely equivalent option and verify its specs.
5. CLARIFY: If the employee gives an ambiguous answer, ask one short follow-up rather than guessing.
6. CLOSE: Repeat the key confirmed facts back once, thank them, and end the call.

BEHAVIOR:
- Keep each turn short and natural. Ask one question at a time.
- If transferred, restate the request to the new employee without restarting the whole conversation.
- If the person says they do not know, ask whether someone in parts/inventory can verify.
- Never invent inventory, price, quantity, address, hours, model, compatibility, or availability.
- Never buy, reserve, order, pay, provide card details, accept terms, or make commitments.
- Treat "in stock" as confirmed only when the employee explicitly verifies physical inventory.
- Treat "we can order it" as NOT in stock today.
- If a price is unclear, confirm whether it is for one ramp or the pair.
- If voicemail answers, do not leave sensitive details; end the call.

For this self-test call, Sergii will answer as if he is a store employee. The requested item is a pair of GEN-Y GH-16072 heavy-duty aluminum car-hauler ramps, 72 x 14 inches, rated 3,000 lb per ramp. Your first line should be: "Hi, I'm an automated purchasing assistant calling on behalf of Sergii. I'm looking for a pair of GEN-Y GH-16072 aluminum car-hauler ramps, 72 by 14 inches, rated 3,000 pounds per ramp. Do you have them physically in stock for pickup today?"`;

const extractionFields = [
  { name: 'answered', type: 'boolean', description: 'Whether a real person answered and engaged in the call' },
  { name: 'exact_item_discussed', type: 'string', description: 'Exact model or item discussed' },
  { name: 'in_stock', type: 'enum', description: 'yes, no, or unclear based only on explicit physical inventory confirmation' },
  { name: 'quantity', type: 'number', description: 'Confirmed quantity physically in stock, null/unknown if not stated' },
  { name: 'price', type: 'string', description: 'Exact price stated including whether it is each or pair; unclear if not confirmed' },
  { name: 'pickup_today', type: 'enum', description: 'yes, no, or unclear' },
  { name: 'pickup_address', type: 'string', description: 'Exact pickup address stated in the call' },
  { name: 'alternative_available', type: 'boolean', description: 'Whether an equivalent alternative was explicitly offered' },
  { name: 'alternative_details', type: 'string', description: 'Model/specs/price of any alternative offered' },
  { name: 'employee_name', type: 'string', description: 'Employee name if given' },
  { name: 'store_hours', type: 'string', description: 'Relevant pickup/store hours if stated' },
  { name: 'verification_status', type: 'enum', description: 'confirmed, partial, or unverified' },
  { name: 'blockers', type: 'string', description: 'Anything that prevented full verification' },
  { name: 'summary', type: 'string', description: 'One concise factual summary of the call result' }
];

const report = {
  started_at: new Date().toISOString(),
  email: EMAIL,
  phone: PHONE,
  stage: 'starting',
  signup: null,
  login: null,
  agent: null,
  outbound: null,
  call_result: null,
  error: null,
};

function save() {
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
function logStage(stage, extra = {}) {
  report.stage = stage;
  Object.assign(report, extra);
  save();
  console.log(`STAGE=${stage}`);
}
function maskSecret(value) {
  const s = String(value || '');
  if (s.length < 12) return s ? '***' : '';
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

let accessToken = '';
let loginResponseBody = null;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

page.on('response', async (response) => {
  const req = response.request();
  const url = response.url();
  if (req.method() !== 'POST') return;
  if (!/(auth|login|register)/i.test(url)) return;
  try {
    const json = await response.json();
    if (json?.access_token) {
      accessToken = String(json.access_token);
      loginResponseBody = json;
      console.log(`AUTH_TOKEN_CAPTURED=${maskSecret(accessToken)}`);
    }
  } catch {}
});

async function fillFirst(locator, value) {
  if (await locator.count()) {
    await locator.first().fill(value);
    return true;
  }
  return false;
}

async function register() {
  logStage('register_page');
  await page.goto('https://dash.call2me.app/register', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const emailOk = await fillFirst(page.locator('input[type="email"], input[name*="email" i]'), EMAIL);
  const passInputs = page.locator('input[type="password"]');
  const passCount = await passInputs.count();
  for (let i = 0; i < passCount; i += 1) await passInputs.nth(i).fill(password);
  const checks = page.locator('input[type="checkbox"]');
  for (let i = 0; i < await checks.count(); i += 1) {
    if (!(await checks.nth(i).isChecked())) await checks.nth(i).check().catch(() => {});
  }
  if (!emailOk || passCount === 0) throw new Error(`Registration form not recognized: email=${emailOk} passwords=${passCount}`);
  const submit = page.getByRole('button', { name: /sign up|register|create account|get started/i });
  if (await submit.count()) await submit.first().click(); else await passInputs.last().press('Enter');
  await page.waitForTimeout(5000);
  const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 2500);
  report.signup = { url: page.url(), body };
  logStage('verification_wait');
  console.log('WAITING_FOR_EMAIL_VERIFICATION');
}

async function tryLogin() {
  await page.goto('https://dash.call2me.app/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1200);
  await fillFirst(page.locator('input[type="email"], input[name*="email" i]'), EMAIL);
  const pass = page.locator('input[type="password"]');
  if (!(await pass.count())) return false;
  await pass.first().fill(password);
  const submit = page.getByRole('button', { name: /sign in|log in|login|continue/i });
  if (await submit.count()) await submit.first().click(); else await pass.first().press('Enter');
  await page.waitForTimeout(3500);
  const url = page.url();
  const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 1600);
  if (accessToken || (!/\/login|\/register/i.test(url) && !/verify your email|email verification/i.test(body))) {
    report.login = { url, body, token: maskSecret(accessToken) };
    return true;
  }
  return false;
}

async function api(pathname, { method = 'GET', body } = {}) {
  if (!accessToken) throw new Error('No access token available');
  const response = await fetch(`https://api.call2me.app${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: response.status, ok: response.ok, json };
}

async function chooseVoice() {
  const candidates = ['/v1/voices', '/v1/voice/voices'];
  for (const p of candidates) {
    const r = await api(p).catch(() => null);
    if (!r?.ok) continue;
    const list = Array.isArray(r.json) ? r.json : (r.json.voices || r.json.data || []);
    if (Array.isArray(list) && list.length) {
      const preferred = list.find((v) => /en|english|multilingual/i.test(JSON.stringify(v))) || list[0];
      return preferred.voice_id || preferred.id || preferred.slug || 'elevenlabs-selin';
    }
  }
  return 'elevenlabs-selin';
}

async function createAgent() {
  logStage('creating_agent');
  const voiceId = await chooseVoice();
  const base = {
    agent_name: 'Sergii Vendor Buyer',
    voice_id: voiceId,
    language: 'en-US',
    response_engine: { llm_model: 'openai/gpt-4o-mini', system_prompt: prompt },
    welcome_message: "Hi, I'm an automated purchasing assistant calling on behalf of Sergii. I'm looking for a pair of GEN-Y GH-16072 aluminum car-hauler ramps, 72 by 14 inches, rated 3,000 pounds per ramp. Do you have them physically in stock for pickup today?",
    recording_enabled: false,
  };
  let r = await api('/v1/agents', { method: 'POST', body: { ...base, post_call_data_extraction: extractionFields } });
  if (!r.ok) r = await api('/v1/agents', { method: 'POST', body: { ...base, post_call_extraction: extractionFields } });
  if (!r.ok) r = await api('/v1/agents', { method: 'POST', body: base });
  if (!r.ok) throw new Error(`Create agent failed ${r.status}: ${JSON.stringify(r.json)}`);
  const agentId = r.json.agent_id || r.json.id || r.json.data?.agent_id || r.json.data?.id;
  if (!agentId) throw new Error(`Create agent returned no id: ${JSON.stringify(r.json)}`);
  report.agent = { id: agentId, voice_id: voiceId, response: r.json };
  save();
  return agentId;
}

async function placeCall(agentId) {
  logStage('placing_call');
  const callContext = 'SELF-TEST: Sergii will answer as a store employee. Confirm physical in-stock status today for GEN-Y GH-16072 aluminum car-hauler ramps, 72 x 14 inches, 3,000 lb per ramp; then confirm quantity, current price and whether it is per ramp or pair, exact pickup address, and pickup availability today. If exact model is unavailable, ask for an equivalent heavy-duty aluminum car-hauler ramp around 6 ft x 14 in and about 3,000 lb per ramp. Do not buy or reserve anything.';
  const bodies = [
    { agent_id: agentId, to_number: PHONE, context: callContext },
    { agent_id: agentId, phone_number: PHONE, context: callContext },
  ];
  let last;
  for (const body of bodies) {
    last = await api('/v1/calls/outbound', { method: 'POST', body });
    if (last.ok) break;
  }
  report.outbound = last;
  save();
  if (!last?.ok) throw new Error(`Outbound call failed ${last?.status}: ${JSON.stringify(last?.json)}`);
  const callId = last.json.call_id || last.json.id || last.json.data?.call_id || last.json.data?.id;
  if (!callId) throw new Error(`Outbound response has no call id: ${JSON.stringify(last.json)}`);
  logStage('call_in_progress');
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const detail = await api(`/v1/calls/${encodeURIComponent(callId)}`);
    if (!detail.ok) continue;
    report.call_result = detail.json;
    save();
    const s = String(detail.json.status || detail.json.call_status || detail.json.data?.status || '').toLowerCase();
    if (['completed','ended','answered','failed','busy','no-answer','no_answer','voicemail'].includes(s) && !['queued','ringing','in-progress','in_progress'].includes(s)) break;
  }
  logStage('complete');
}

try {
  await register();
  let loggedIn = false;
  for (let attempt = 1; attempt <= 36; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    try {
      loggedIn = await tryLogin();
      console.log(`LOGIN_ATTEMPT=${attempt} success=${loggedIn}`);
      if (loggedIn) break;
    } catch (e) {
      console.log(`LOGIN_ATTEMPT=${attempt} error=${String(e.message || e)}`);
    }
  }
  if (!loggedIn) throw new Error('Email verification/login did not complete within wait window');
  if (!accessToken && loginResponseBody?.access_token) accessToken = String(loginResponseBody.access_token);
  if (!accessToken) {
    const storage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    for (const v of Object.values(storage)) if (typeof v === 'string' && v.startsWith('eyJ')) accessToken = v;
  }
  if (!accessToken) throw new Error('Logged in but access token could not be captured');
  const me = await api('/v1/auth/me');
  report.login = { ...(report.login || {}), me_status: me.status, me: me.ok ? me.json : undefined };
  save();
  const agentId = await createAgent();
  await placeCall(agentId);
} catch (error) {
  report.error = String(error?.stack || error);
  logStage('failed');
  console.error(report.error);
  process.exitCode = 1;
} finally {
  report.finished_at = new Date().toISOString();
  save();
  await browser.close();
}
