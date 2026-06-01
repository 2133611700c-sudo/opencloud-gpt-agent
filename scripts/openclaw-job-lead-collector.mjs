#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

function parseJsonEnv(name, fallback) {
  try {
    return JSON.parse(process.env[name] || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

const queries = parseJsonEnv("OPENCLAW_COLLECT_QUERIES", []);
const seedUrls = parseJsonEnv("OPENCLAW_COLLECT_SEED_URLS", []);
const maxLeads = Number(process.env.OPENCLAW_COLLECT_MAX_LEADS || "25");
const locationHint = process.env.OPENCLAW_COLLECT_LOCATION || "";
const targetProfile = parseJsonEnv("OPENCLAW_COLLECT_TARGET_PROFILE", {});
const outDir = process.env.OPENCLAW_COLLECT_OUT_DIR || path.resolve("ops", "agent-control", "reports", "job-lead-audit", new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"));
const outFile = process.env.OPENCLAW_COLLECT_OUT_FILE || path.join(outDir, "collected-leads.json");

function unique(values) {
  return Array.from(new Set(values.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())));
}

const queryUrls = queries.map((q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`);
const urls = unique([...seedUrls, ...queryUrls]);
if (urls.length === 0) {
  throw new Error("No seed URLs or query URLs to collect.");
}

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const leads = [];

for (const url of urls) {
  if (leads.length >= maxLeads) break;
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const title = (await page.title()).trim();
    const bodyText = ((await page.locator("body").innerText({ timeout: 10000 })) || "").replace(/\s+/g, " ").trim();
    const emailMatch = bodyText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
    const housingQuoteMatch = bodyText.match(/[^.]{0,80}(free apartment|free unit|unit included|housing provided|live-in|rent credit)[^.]{0,80}/i);
    const compensationQuoteMatch = bodyText.match(/[^.]{0,80}(\$ ?\d[\d,]*(?:\.\d+)?(?:\s*-\s*\$ ?\d[\d,]*(?:\.\d+)?)?|per hour|per month|salary)[^.]{0,80}/i);
    const experienceQuoteMatch = bodyText.match(/[^.]{0,80}(3\+ years|minimum 3 years|experience required|experience preferred)[^.]{0,80}/i);
    const softwareQuoteMatch = bodyText.match(/[^.]{0,80}(yardi|appfolio|required software|crm)[^.]{0,80}/i);
    const licenseQuoteMatch = bodyText.match(/[^.]{0,80}(license required|licensed)[^.]{0,80}/i);
    const roleQuoteMatch = bodyText.match(/[^.]{0,80}(resident manager|onsite manager|property manager|building manager|caretaker)[^.]{0,80}/i);
    const screenshotPath = path.join(outDir, `lead-${String(leads.length + 1).padStart(2, "0")}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    leads.push({
      company: title || "UNKNOWN",
      role: "UNKNOWN",
      location: locationHint || "UNKNOWN",
      listing_url: url,
      source_site: new URL(url).hostname,
      housing_terms: housingQuoteMatch ? housingQuoteMatch[0] : "NOT_SPECIFIED",
      housing_evidence_quote: housingQuoteMatch ? housingQuoteMatch[0] : "NOT_SPECIFIED",
      compensation: compensationQuoteMatch ? compensationQuoteMatch[0] : "NOT_SPECIFIED",
      compensation_evidence_quote: compensationQuoteMatch ? compensationQuoteMatch[0] : "NOT_SPECIFIED",
      experience_requirements: experienceQuoteMatch ? experienceQuoteMatch[0] : "NOT_SPECIFIED",
      software_requirements: softwareQuoteMatch ? softwareQuoteMatch[0] : "NOT_SPECIFIED",
      license_requirements: licenseQuoteMatch ? licenseQuoteMatch[0] : "NOT_SPECIFIED",
      public_contact_channel_if_visible: emailMatch?.[0] || "NOT_SPECIFIED",
      apply_url: url,
      screenshot_path_if_available: screenshotPath,
      role: roleQuoteMatch ? roleQuoteMatch[0] : "UNKNOWN",
      target_profile: targetProfile,
      excerpt: bodyText.slice(0, 300),
    });
  } catch {
    // Continue collecting from other URLs.
  } finally {
    await page.close();
  }
}

await browser.close();
const output = { collected_at: new Date().toISOString(), leads };
fs.writeFileSync(outFile, JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify({ collected: leads.length, outFile }));
