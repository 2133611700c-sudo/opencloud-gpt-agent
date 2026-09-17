#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const outDir = path.resolve('ops/agent-control/reports');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'bland-signup-probe.json');
const phone = '2133611700';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let result = { timestamp: new Date().toISOString(), ok: false };
try {
  const response = await page.goto('https://app.bland.ai/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const phoneInput = page.locator('input[name="phone"]');
  await phoneInput.fill(phone);
  const getCode = page.getByRole('button', { name: /get code/i });
  await getCode.click();
  await page.waitForTimeout(8000);
  const inputs = await page.locator('input').evaluateAll((els) => els.map((e) => ({
    type: e.getAttribute('type'),
    name: e.getAttribute('name'),
    placeholder: e.getAttribute('placeholder'),
    autocomplete: e.getAttribute('autocomplete'),
    disabled: e.disabled,
  })));
  const buttons = await page.locator('button').evaluateAll((els) => els.map((e) => ({
    text: (e.innerText || e.getAttribute('aria-label') || '').trim(),
    disabled: e.disabled,
  })).filter((x) => x.text));
  result = {
    timestamp: new Date().toISOString(),
    ok: true,
    initialStatus: response?.status() ?? null,
    url: page.url(),
    title: await page.title(),
    bodyText: (await page.locator('body').innerText()).slice(0, 8000),
    inputs,
    buttons,
    otpInputCount: await page.locator('input[autocomplete="one-time-code"], input[name*="code" i], input[placeholder*="code" i]').count(),
  };
} catch (error) {
  result = { timestamp: new Date().toISOString(), ok: false, url: page.url(), error: String(error?.stack || error), bodyText: await page.locator('body').innerText().catch(() => '') };
} finally {
  await browser.close();
}
fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
