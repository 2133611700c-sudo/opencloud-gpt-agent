#!/usr/bin/env node
import fs from "node:fs";

function envJson(name, fallback) {
  try { return JSON.parse(process.env[name] || JSON.stringify(fallback)); }
  catch { return fallback; }
}

const queries = envJson("OPENCLAW_COLLECT_QUERIES", []);
const maxLeads = Number(process.env.OPENCLAW_COLLECT_MAX_LEADS || "25");
const location = process.env.OPENCLAW_COLLECT_LOCATION || "NOT_SPECIFIED";
const profile = envJson("OPENCLAW_COLLECT_TARGET_PROFILE", {});
const outDir = process.env.OPENCLAW_COLLECT_OUT_DIR;
const outFile = process.env.OPENCLAW_COLLECT_OUT_FILE;
if (!outDir || !outFile) throw new Error("collector output paths are required");

const decodeHtml = (value) => String(value || "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'");
const text = (value) => decodeHtml(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function unwrapDuckDuckGo(value) {
  try {
    const url = new URL(value, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : url.href;
  } catch { return ""; }
}

function hostname(value) {
  try { return new URL(value).hostname.toLowerCase(); }
  catch { return "unknown"; }
}

function concreteUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, "");
    const lower = path.toLowerCase();
    if (!lower || lower === "/") return false;

    if (host.endsWith("indeed.com")) {
      return lower === "/viewjob" && Boolean(url.searchParams.get("jk"));
    }
    if (host.endsWith("linkedin.com")) {
      return lower.includes("/jobs/view/");
    }
    if (host.endsWith("ziprecruiter.com")) {
      return lower.includes("/c/") || Boolean(url.searchParams.get("jid"));
    }
    if (host.endsWith("glassdoor.com")) {
      return lower.includes("/job-listing/");
    }
    if (host.includes("craigslist.org")) {
      return /\/\d+\.html$/i.test(lower);
    }

    const genericRoots = new Set(["/search", "/job", "/jobs", "/career", "/careers", "/browse", "/results"]);
    if (genericRoots.has(lower)) return false;
    if (/jobs?[-_/](in|near|los|greater|box|driver)/i.test(lower)) return false;
    return /\d{5,}/.test(lower) || Boolean(url.searchParams.get("jobid")) || Boolean(url.searchParams.get("id"));
  } catch { return false; }
}

function relevantTitle(value) {
  const title = text(value);
  if (!/(driver|truck|delivery|courier|operator)/i.test(title)) return false;
  if (/\bjobs?\b.*\b(in|near)\b/i.test(title)) return false;
  if (/^\d+[,+]?\s+.*jobs?/i.test(title)) return false;
  return true;
}

function variants(query) {
  const q = text(query).replace(/"/g, "");
  return [
    `site:indeed.com/viewjob ${q}`,
    `site:linkedin.com/jobs/view ${q}`,
    `site:ziprecruiter.com/c ${q}`,
    `site:glassdoor.com/job-listing ${q}`,
    `site:losangeles.craigslist.org ${q}`,
    `${q} hiring Los Angeles`
  ];
}

async function ddg(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      "accept-language": "en-US,en;q=0.9"
    },
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error(`DDG HTTP ${response.status}`);
  const html = await response.text();
  const results = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(re)) {
    const href = unwrapDuckDuckGo(decodeHtml(match[1]));
    const title = text(match[2]);
    if (href && title) results.push({ href, title });
  }
  return results;
}

fs.mkdirSync(outDir, { recursive: true });
const leads = [];
const rejected = [];
for (const baseQuery of queries) {
  if (leads.length >= maxLeads) break;
  for (const query of variants(baseQuery)) {
    if (leads.length >= maxLeads) break;
    try {
      const results = await ddg(query);
      if (results.length === 0) rejected.push({ query, reason: "no_results" });
      for (const item of results) {
        if (leads.length >= maxLeads) break;
        if (!concreteUrl(item.href)) { rejected.push({ query, url: item.href, reason: "non_listing_url" }); continue; }
        if (!relevantTitle(item.title)) { rejected.push({ query, url: item.href, reason: "non_listing_title" }); continue; }
        if (leads.some((x) => x.listing_url === item.href)) continue;
        const parts = item.title.split(/\s+[|\-–—]\s+/).filter(Boolean);
        leads.push({
          company: parts.length > 1 ? parts.at(-1) : "NOT_SPECIFIED",
          role: item.title,
          location,
          listing_url: item.href,
          source_site: hostname(item.href),
          compensation: "NOT_SPECIFIED",
          experience_requirements: "NOT_SPECIFIED",
          license_requirements: "NOT_SPECIFIED",
          public_contact_channel_if_visible: "NOT_SPECIFIED",
          apply_url: item.href,
          target_profile: profile,
          validation: { concrete_listing_url: true, concrete_role: true }
        });
      }
    } catch (error) {
      rejected.push({ query, reason: "search_error", error: String(error?.message || error).slice(0, 300) });
    }
  }
}
const qualityStatus = leads.length > 0 ? "PASS" : "DEGRADED";
const output = { collected_at: new Date().toISOString(), provider: "duckduckgo_html_strict", quality_status: qualityStatus, valid_leads_count: leads.length, rejected_count: rejected.length, leads, rejected };
fs.writeFileSync(outFile, JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify({ provider: "duckduckgo_html_strict", quality_status: qualityStatus, valid_leads: leads.length, rejected: rejected.length, outFile }));
if (leads.length === 0) throw "DEGRADED: no valid concrete job listings collected";
