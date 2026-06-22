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

function safeHostname(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "unknown";
  }
}

function isBlockedPage(title, bodyText) {
  const text = `${title} ${bodyText}`.toLowerCase();
  return [
    "request blocked",
    "you have been blocked",
    "sorry, you have been blocked",
    "attention required! | cloudflare",
    "verify you are human",
    "access denied",
    "captcha",
    "unusual traffic",
  ].some((marker) => text.includes(marker));
}

function isGenericOrSearchUrl(value) {
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (!pathname || pathname === "/") return true;
    const genericPath = /\/(search|jobs?|career|careers|browse|results)(\/|$)/i.test(pathname);
    const searchQuery = /(^|[?&])(q|query|keyword|search)=/i.test(url.search);
    return genericPath || searchQuery;
  } catch {
    return true;
  }
}

function looksLikeJobTitle(value) {
  const title = String(value || "").trim();
  if (!title || title.length < 4) return false;
  if (/^(unknown|search|jobs?|careers?|home)$/i.test(title)) return false;
  return /(driver|truck|delivery|courier|operator|manager|technician|associate|specialist|worker|helper|installer|mechanic)/i.test(title);
}

function extractCompany(title) {
  const cleaned = String(title || "").replace(/\s+/g, " ").trim();
  const parts = cleaned.split(/\s+[|\-–—]\s+/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts.at(-1) : "NOT_SPECIFIED";
}

function normalizeCandidate({ title, href, snippet = "", source = "" }) {
  if (!href || isGenericOrSearchUrl(href) || !looksLikeJobTitle(title)) return null;
  return {
    company: extractCompany(title),
    role: title.trim(),
    location: locationHint || "NOT_SPECIFIED",
    listing_url: href,
    source_site: source || safeHostname(href),
    housing_terms: "NOT_SPECIFIED",
    housing_evidence_quote: "NOT_SPECIFIED",
    compensation: "NOT_SPECIFIED",
    compensation_evidence_quote: "NOT_SPECIFIED",
    experience_requirements: "NOT_SPECIFIED",
    software_requirements: "NOT_SPECIFIED",
    license_requirements: "NOT_SPECIFIED",
    public_contact_channel_if_visible: "NOT_SPECIFIED",
    apply_url: href,
    screenshot_path_if_available: "NOT_SPECIFIED",
    target_profile: targetProfile,
    excerpt: String(snippet || "").slice(0, 500),
    validation: {
      concrete_listing_url: true,
      concrete_role: true,
      blocked_page: false,
    },
  };
}

const queryUrls = queries.map((q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`);
const urls = unique([...queryUrls, ...seedUrls]);
if (urls.length === 0) throw new Error("No seed URLs or query URLs to collect.");

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36" });
const leads = [];
const rejected = [];

for (const url of urls) {
  if (leads.length >= maxLeads) break;
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const title = (await page.title()).trim();
    const bodyText = ((await page.locator("body").innerText({ timeout: 10000 })) || "").replace(/\s+/g, " ").trim();

    if (isBlockedPage(title, bodyText)) {
      rejected.push({ url, reason: "blocked_or_challenge_page", title });
      continue;
    }

    const hostname = safeHostname(url);
    if (hostname.includes("bing.com")) {
      const results = await page.locator("li.b_algo").evaluateAll((nodes) => nodes.map((node) => {
        const anchor = node.querySelector("h2 a");
        const snippet = node.querySelector(".b_caption p")?.textContent || "";
        return { title: anchor?.textContent || "", href: anchor?.href || "", snippet };
      }));
      for (const result of results) {
        if (leads.length >= maxLeads) break;
        const candidate = normalizeCandidate({ ...result, source: safeHostname(result.href) });
        if (candidate && !leads.some((lead) => lead.listing_url === candidate.listing_url)) leads.push(candidate);
      }
      if (results.length === 0) rejected.push({ url, reason: "no_search_results", title });
      continue;
    }

    const candidate = normalizeCandidate({ title, href: page.url(), snippet: bodyText, source: hostname });
    if (!candidate) {
      rejected.push({ url, reason: "generic_or_non_listing_page", title });
      continue;
    }

    const emailMatch = bodyText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
    const compensationQuoteMatch = bodyText.match(/[^.]{0,100}(\$ ?\d[\d,]*(?:\.\d+)?(?:\s*-\s*\$ ?\d[\d,]*(?:\.\d+)?)?|per hour|per month|salary)[^.]{0,100}/i);
    candidate.public_contact_channel_if_visible = emailMatch?.[0] || "NOT_SPECIFIED";
    candidate.compensation = compensationQuoteMatch?.[0] || "NOT_SPECIFIED";
    candidate.compensation_evidence_quote = candidate.compensation;
    const screenshotPath = path.join(outDir, `lead-${String(leads.length + 1).padStart(2, "0")}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    candidate.screenshot_path_if_available = screenshotPath;
    leads.push(candidate);
  } catch (error) {
    rejected.push({ url, reason: "navigation_error", error: String(error?.message || error).slice(0, 300) });
  } finally {
    await page.close();
  }
}

await browser.close();
const output = {
  collected_at: new Date().toISOString(),
  valid_leads_count: leads.length,
  rejected_count: rejected.length,
  leads,
  rejected,
};
fs.writeFileSync(outFile, JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify({ valid_leads: leads.length, rejected: rejected.length, outFile }));
