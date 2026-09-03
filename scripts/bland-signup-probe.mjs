#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const outDir = path.resolve('ops/agent-control/reports');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'bland-signup-probe.json');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let result = { timestamp: new Date().toISOString(), ok: false };
try {
  const response = await page.goto('https://app.bland.ai/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  const inputs = await page.locator('input').evaluateAll((els) => els.map((e) => ({
    type: e.getAttribute('type'),
    name: e.getAttribute('name'),
    placeholder: e.getAttribute('placeholder'),
    autocomplete: e.getAttribute('autocomplete'),
  })));
  const buttons = await page.locator('button').evaluateAll((els) => els.map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim()).filter(Boolean));
  const links = await page.locator('a').evaluateAll((els) => els.map((e) => ({ text: (e.innerText || '').trim(), href: e.href })).filter((x) => x.text || x.href));
  result = {
    timestamp: new Date().toISOString(),
    ok: true,
    status: response?.status() ?? null,
    url: page.url(),
    title: await page.title(),
    bodyText: (await page.locator('body').innerText()).slice(0, 12000),
    inputs,
    buttons,
    links: links.slice(0, 100),
  };
} catch (error) {
  result = { timestamp: new Date().toISOString(), ok: false, error: String(error?.stack || error) };
} finally {
  await browser.close();
}
fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
