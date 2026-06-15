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

const queries = parseJsonEnv("OPENCLAW_BUSINESS_QUERIES", []);
const seedUrls = parseJsonEnv("OPENCLAW_BUSINESS_SEED_URLS", []);
const maxProspects = Math.max(1, Number(process.env.OPENCLAW_BUSINESS_MAX_PROSPECTS || "30"));
const outDir = process.env.OPENCLAW_BUSINESS_OUT_DIR || path.resolve("ops", "agent-control", "reports", "business-lead-audit", new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"));
const outFile = process.env.OPENCLAW_BUSINESS_OUT_FILE || path.join(outDir, "prospects.json");
const takeScreenshots = String(process.env.OPENCLAW_BUSINESS_SCREENSHOTS || "false").toLowerCase() === "true";

const directoryHosts = new Set([
  "yelp.com", "www.yelp.com", "angi.com", "www.angi.com", "homeadvisor.com", "www.homeadvisor.com",
  "thumbtack.com", "www.thumbtack.com", "bbb.org", "www.bbb.org", "yellowpages.com", "www.yellowpages.com",
  "facebook.com", "www.facebook.com", "instagram.com", "www.instagram.com", "linkedin.com", "www.linkedin.com",
  "mapquest.com", "www.mapquest.com", "nextdoor.com", "www.nextdoor.com"
]);

const serviceTerms = [
  "plumb", "hvac", "heating", "air conditioning", "roof", "electric", "garage door",
  "appliance repair", "locksmith", "water damage", "restoration", "pest control", "tree service"
];

function unique(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())));
}

function normalizeUrl(raw) {
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function hostname(raw) {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function firstMatch(text, regex, fallback = "NOT_SPECIFIED") {
  const match = text.match(regex);
  return match?.[0]?.replace(/\s+/g, " ").trim() || fallback;
}

function nearbyQuote(text, regex, radius = 100) {
  const match = regex.exec(text);
  if (!match || typeof match.index !== "number") return "NOT_SPECIFIED";
  const start = Math.max(0, match.index - radius);
  const end = Math.min(text.length, match.index + match[0].length + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function serviceVertical(text) {
  const lower = text.toLowerCase();
  return serviceTerms.find((term) => lower.includes(term)) || "home service";
}

function scoreProspect(data) {
  let score = 0;
  const reasons = [];
  if (data.phone !== "NOT_SPECIFIED") { score += 20; reasons.push("public phone found"); }
  if (data.public_email !== "NOT_SPECIFIED" || data.contact_url !== "NOT_SPECIFIED") { score += 15; reasons.push("public contact path found"); }
  if (!data.has_online_booking) { score += 20; reasons.push("no clear online booking detected"); }
  if (!data.has_live_chat) { score += 10; reasons.push("no live-chat widget detected"); }
  if (!data.claims_24_7) { score += 10; reasons.push("no clear 24/7 response claim detected"); }
  if (data.hours_evidence !== "NOT_SPECIFIED") { score += 10; reasons.push("limited business hours displayed"); }
  if (data.vertical !== "home service") { score += 10; reasons.push(`target vertical: ${data.vertical}`); }
  if (data.has_contact_form) { score += 5; reasons.push("existing contact form can support integration"); }
  const fitStatus = score >= 65 ? "FIT" : score >= 45 ? "MAYBE" : "REJECT";
  return { score, fit_status: fitStatus, fit_reasons: reasons };
}

async function collectSearchResults(page, query) {
  const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(800);
  const results = await page.locator("li.b_algo h2 a").evaluateAll((anchors) => anchors.slice(0, 12).map((anchor) => ({
    url: anchor.href,
    title: (anchor.textContent || "").trim()
  })));
  return results.map((result) => ({ ...result, source_query: query, search_url: searchUrl }));
}

async function inspectBusinessPage(context, candidate, index) {
  const page = await context.newPage();
  try {
    await page.goto(candidate.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(500);
    const finalUrl = page.url();
    const siteHost = hostname(finalUrl);
    if (!siteHost || directoryHosts.has(siteHost)) return null;

    const title = (await page.title()).replace(/\s+/g, " ").trim();
    const bodyText = ((await page.locator("body").innerText({ timeout: 10000 })) || "").replace(/\s+/g, " ").trim();
    if (!bodyText || !serviceTerms.some((term) => `${title} ${bodyText}`.toLowerCase().includes(term))) return null;

    const links = await page.locator("a").evaluateAll((anchors) => anchors.slice(0, 500).map((anchor) => ({
      text: (anchor.textContent || "").replace(/\s+/g, " ").trim(),
      href: anchor.href || ""
    })));
    const forms = await page.locator("form").count();
    const html = (await page.content()).toLowerCase();
    const lower = bodyText.toLowerCase();

    const phone = firstMatch(bodyText, /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/);
    const email = firstMatch(bodyText, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const contactLink = links.find((link) => /contact|request|estimate|quote/i.test(link.text) && /^https?:/i.test(link.href));
    const bookingLink = links.find((link) => /book|schedule|appointment|reserve/i.test(link.text) && /^https?:/i.test(link.href));
    const hasLiveChat = /(intercom|drift|tawk\.to|tidio|livechat|crisp|zendesk|hubspot.*chat|podium)/i.test(html) || /live chat|chat with us/i.test(lower);
    const claims247 = /\b24\s*\/\s*7\b|24 hours a day|open 24 hours|around the clock/i.test(lower);
    const hoursRegex = /(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)[^.!?]{0,180}(?:am|pm|closed)/i;
    const hoursEvidence = nearbyQuote(bodyText, hoursRegex);
    const missedCallEvidence = nearbyQuote(bodyText, /call us|give us a call|phone|contact us/i);
    const vertical = serviceVertical(`${title} ${bodyText}`);
    let screenshotPath = "NOT_SPECIFIED";
    if (takeScreenshots) {
      screenshotPath = path.join(outDir, `prospect-${String(index).padStart(3, "0")}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }

    const base = {
      company: title || candidate.title || siteHost,
      website: finalUrl,
      hostname: siteHost,
      source_query: candidate.source_query || "seed URL",
      source_search_url: candidate.search_url || "NOT_SPECIFIED",
      vertical,
      phone,
      public_email: email,
      contact_url: contactLink?.href || "NOT_SPECIFIED",
      booking_url: bookingLink?.href || "NOT_SPECIFIED",
      has_online_booking: Boolean(bookingLink),
      has_contact_form: forms > 0,
      has_live_chat: hasLiveChat,
      claims_24_7: claims247,
      hours_evidence: hoursEvidence,
      phone_or_contact_evidence: missedCallEvidence,
      screenshot_path_if_available: screenshotPath,
      inspected_at: new Date().toISOString()
    };
    return { ...base, ...scoreProspect(base) };
  } catch (error) {
    return {
      company: candidate.title || hostname(candidate.url) || "UNKNOWN",
      website: candidate.url,
      hostname: hostname(candidate.url),
      source_query: candidate.source_query || "seed URL",
      fit_status: "REJECT",
      fit_score: 0,
      fit_reasons: ["page inspection failed"],
      error: error instanceof Error ? error.message : String(error),
      inspected_at: new Date().toISOString()
    };
  } finally {
    await page.close();
  }
}

if (queries.length === 0 && seedUrls.length === 0) {
  throw new Error("business lead collection requires at least one search query or seed URL");
}

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  viewport: { width: 1440, height: 1000 }
});

const searchPage = await context.newPage();
const candidates = [];
for (const query of queries) {
  try {
    candidates.push(...await collectSearchResults(searchPage, query));
  } catch {
    // Continue with other public queries.
  }
}
await searchPage.close();
candidates.push(...seedUrls.map((url) => ({ url, title: hostname(url), source_query: "seed URL", search_url: "NOT_SPECIFIED" })));

const deduped = [];
const seenHosts = new Set();
for (const candidate of candidates) {
  const normalized = normalizeUrl(candidate.url);
  const host = hostname(normalized || "");
  if (!normalized || !host || directoryHosts.has(host) || seenHosts.has(host)) continue;
  seenHosts.add(host);
  deduped.push({ ...candidate, url: normalized });
}

const prospects = [];
for (const candidate of deduped) {
  if (prospects.filter((item) => item.fit_status !== "REJECT").length >= maxProspects) break;
  const inspected = await inspectBusinessPage(context, candidate, prospects.length + 1);
  if (inspected) prospects.push(inspected);
}

await browser.close();
const ranked = prospects.sort((a, b) => (b.score || 0) - (a.score || 0));
const output = {
  mode: "READ_ONLY_PUBLIC_BUSINESS_RESEARCH",
  collected_at: new Date().toISOString(),
  queries,
  total_candidates: deduped.length,
  total_inspected: prospects.length,
  fit_count: ranked.filter((item) => item.fit_status === "FIT").length,
  maybe_count: ranked.filter((item) => item.fit_status === "MAYBE").length,
  prospects: ranked
};
fs.writeFileSync(outFile, JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify({ status: "PASS", outFile, total_inspected: output.total_inspected, fit_count: output.fit_count }));
