#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function jsonEnv(name, fallback) {
  try { return JSON.parse(process.env[name] || JSON.stringify(fallback)); }
  catch { return fallback; }
}

const queries = jsonEnv("OPENCLAW_BUSINESS_QUERIES", []);
const seedUrls = jsonEnv("OPENCLAW_BUSINESS_SEED_URLS", []);
const maxProspects = Math.max(1, Number(process.env.OPENCLAW_BUSINESS_MAX_PROSPECTS || "30"));
const minFitForPass = Math.max(1, Number(process.env.OPENCLAW_BUSINESS_MIN_FIT || "5"));
const outFile = process.env.OPENCLAW_BUSINESS_OUT_FILE || path.resolve("prospects.json");

const blockedHosts = new Set([
  "bing.com","www.bing.com","microsoft.com","www.microsoft.com","msn.com","www.msn.com",
  "duckduckgo.com","www.duckduckgo.com","html.duckduckgo.com","google.com","www.google.com",
  "yelp.com","www.yelp.com","angi.com","www.angi.com","homeadvisor.com","www.homeadvisor.com",
  "thumbtack.com","www.thumbtack.com","bbb.org","www.bbb.org","yellowpages.com","www.yellowpages.com",
  "facebook.com","www.facebook.com","instagram.com","www.instagram.com","linkedin.com","www.linkedin.com",
  "wikipedia.org","en.wikipedia.org","reddit.com","www.reddit.com","youtube.com","www.youtube.com",
  "merriam-webster.com","www.merriam-webster.com","usnews.com","www.usnews.com","travel.usnews.com",
  "mapquest.com","www.mapquest.com","nextdoor.com","www.nextdoor.com","indeed.com","www.indeed.com",
  "glassdoor.com","www.glassdoor.com","ziprecruiter.com","www.ziprecruiter.com"
]);

const negativeTitleTerms = [
  "wikipedia","definition","meaning","things to do","travel guide","best plumbers","best hvac","top plumbers",
  "top hvac","reviews","directory","near me","jobs","salary","training","school","license lookup",
  "utility company","electric utility","energy company","city of ","county of ","news","article","blog"
];

const decode = (value = "") => String(value)
  .replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "")
  .replaceAll("&amp;", "&").replaceAll("&quot;", "\"").replaceAll("&#39;", "'")
  .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).trim();
const strip = (html = "") => decode(String(html)
  .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
const hostname = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } };
const normalizeUrl = (url) => { try { const parsed = new URL(url); if (!/^https?:$/.test(parsed.protocol)) return null; parsed.hash = ""; return parsed.toString(); } catch { return null; } };
const absoluteUrl = (base, href) => { try { return new URL(decode(href), base).toString(); } catch { return "NOT_SPECIFIED"; } };
const containsAny = (text, terms) => terms.some((term) => String(text).toLowerCase().includes(term));

function vertical(text) {
  const value = String(text).toLowerCase();
  if (/\bplumb(?:er|ers|ing)?\b/.test(value)) return "plumbing";
  if (/\bhvac\b|\bheating and (?:air|cooling)\b|\bair conditioning\b|\bfurnace (?:repair|service|installation)\b/.test(value)) return "HVAC";
  return "NOT_TARGET";
}

function parseRss(xml, query, sourceUrl) {
  return (String(xml).match(/<item>[\s\S]*?<\/item>/gi) || []).slice(0, 20).map((item) => ({
    title: decode(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1]),
    url: decode(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1]),
    source_query: query,
    source_search_url: sourceUrl,
    search_source: "bing_rss"
  })).filter((item) => normalizeUrl(item.url));
}

function parseDuckDuckGo(html, query, sourceUrl) {
  const results = [];
  const regex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(regex)) {
    let url = decode(match[1]);
    try {
      const wrapped = new URL(url, "https://duckduckgo.com");
      url = wrapped.searchParams.get("uddg") || wrapped.toString();
    } catch {}
    if (normalizeUrl(url)) results.push({
      title: strip(match[2]), url, source_query: query, source_search_url: sourceUrl, search_source: "duckduckgo_html"
    });
    if (results.length >= 20) break;
  }
  return results;
}

async function getText(url, accept = "text/html") {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "Mozilla/5.0 (compatible; CallRescueResearch/3.0)", accept },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = response.headers.get("content-type") || "";
  return { text: await response.text(), finalUrl: response.url, contentType: type };
}

function candidateLooksCommercial(candidate) {
  const url = normalizeUrl(candidate.url);
  const host = hostname(url || "");
  if (!url || !host || blockedHosts.has(host) || host.endsWith(".gov") || host.endsWith(".edu")) return false;
  const parsed = new URL(url);
  if (/\/(wiki|news|article|articles|blog|blogs|travel|dictionary|jobs?|careers?|forum|forums)\//i.test(parsed.pathname)) return false;
  const title = String(candidate.title || "").toLowerCase();
  if (vertical(title) === "NOT_TARGET" || containsAny(title, negativeTitleTerms)) return false;
  return true;
}

async function search(query) {
  const enriched = `${query} official company website -wikipedia -yelp -angi -bbb -yellowpages -facebook -linkedin -jobs -news`;
  const rssUrl = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(enriched)}`;
  try {
    const rss = await getText(rssUrl, "application/rss+xml, application/xml, text/xml");
    const raw = parseRss(rss.text, query, rssUrl);
    const results = raw.filter(candidateLooksCommercial);
    if (results.length) return { results, diagnostic: { query, source: "bing_rss", raw_count: raw.length, accepted_count: results.length, status: "PASS" } };
  } catch {}

  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(enriched)}`;
  try {
    const ddg = await getText(ddgUrl);
    const raw = parseDuckDuckGo(ddg.text, query, ddgUrl);
    const results = raw.filter(candidateLooksCommercial);
    return { results, diagnostic: { query, source: "duckduckgo_html", raw_count: raw.length, accepted_count: results.length, status: results.length ? "PASS" : "FAIL" } };
  } catch (error) {
    return { results: [], diagnostic: { query, source: "duckduckgo_html", raw_count: 0, accepted_count: 0, status: "FAIL", error: error instanceof Error ? error.message : String(error) } };
  }
}

function extractMeta(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const first = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"));
  const second = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["']`, "i"));
  return decode(first?.[1] || second?.[1] || "");
}

function extractAnchors(html, baseUrl) {
  const anchors = [];
  const regex = /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(regex)) {
    anchors.push({ href: absoluteUrl(baseUrl, match[2]), text: strip(match[4]).slice(0, 160) });
    if (anchors.length >= 600) break;
  }
  return anchors;
}

function extractPhone(text) {
  const matches = String(text).match(/(?:\+?1[-.\s]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[-.\s][2-9]\d{2}[-.\s]\d{4}\b/g) || [];
  for (const candidate of matches) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length === 10 || (digits.length === 11 && digits.startsWith("1"))) return candidate.trim();
  }
  return "NOT_SPECIFIED";
}

function businessIdentity(html, title, description, headings, text) {
  const strongText = `${title} ${description} ${headings}`;
  const industry = vertical(strongText);
  const schemaType = /"@type"\s*:\s*(?:\[[^\]]*)?["'](?:Plumber|HVACBusiness|HomeAndConstructionBusiness|LocalBusiness)["']/i.test(html);
  const serviceLanguage = /\b(?:repair|installation|maintenance|service|contractor|technician|emergency service|residential|commercial)\b/i.test(strongText);
  const localitySignal = /\b(?:serving|service area|locally owned|family owned|licensed|insured)\b/i.test(text.slice(0, 30000));
  const negative = containsAny(strongText, negativeTitleTerms) || /\b(?:encyclopedia|travel|tourism|utility|electric company|natural gas utility|municipal)\b/i.test(strongText);
  const signals = [industry !== "NOT_TARGET", schemaType, serviceLanguage, localitySignal].filter(Boolean).length;
  return { industry, schemaType, serviceLanguage, localitySignal, negative, signals, passed: industry !== "NOT_TARGET" && !negative && signals >= 2 };
}

function leadScore(lead) {
  let score = 0;
  const reasons = [];
  if (lead.identity.schema_type) { score += 20; reasons.push("local-service business schema"); }
  if (lead.phone !== "NOT_SPECIFIED") { score += 20; reasons.push("valid public phone"); }
  if (lead.contact_url !== "NOT_SPECIFIED" || lead.public_email !== "NOT_SPECIFIED") { score += 15; reasons.push("commercial contact path"); }
  if (!lead.has_online_booking) { score += 15; reasons.push("no clear online booking"); }
  if (!lead.has_live_chat) { score += 10; reasons.push("no live-chat widget"); }
  if (!lead.claims_24_7) { score += 10; reasons.push("no clear 24/7 intake claim"); }
  if (lead.hours_evidence !== "NOT_SPECIFIED") { score += 5; reasons.push("published business hours"); }
  if (lead.has_service_form) { score += 5; reasons.push("service/contact form detected"); }
  const needGap = !lead.has_online_booking || !lead.has_live_chat || !lead.claims_24_7;
  const qualityGate = lead.identity.passed && lead.phone !== "NOT_SPECIFIED" && (lead.contact_url !== "NOT_SPECIFIED" || lead.public_email !== "NOT_SPECIFIED" || lead.has_service_form);
  const fitStatus = qualityGate && needGap && score >= 55 ? "FIT" : qualityGate ? "MAYBE" : "REJECT";
  return { score, fit_status: fitStatus, fit_reasons: reasons, quality_gate_passed: qualityGate };
}

async function inspect(candidate) {
  try {
    const page = await getText(candidate.url);
    const finalUrl = normalizeUrl(page.finalUrl || candidate.url);
    const host = hostname(finalUrl || "");
    if (!finalUrl || !host || blockedHosts.has(host) || host.endsWith(".gov") || host.endsWith(".edu") || !/html/i.test(page.contentType)) return null;

    const html = page.text;
    const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || candidate.title || host).slice(0, 180);
    const description = extractMeta(html, "description") || extractMeta(html, "og:description");
    const h1 = strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
    const h2 = strip(html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || "");
    const text = strip(html).slice(0, 250000);
    const identity = businessIdentity(html, title, description, `${h1} ${h2}`, text);
    if (!identity.passed) return null;

    const anchors = extractAnchors(html, finalUrl);
    const contact = anchors.find((item) => /\b(?:contact|request (?:service|estimate|quote)|get (?:an )?estimate|free estimate)\b/i.test(item.text));
    const booking = anchors.find((item) => /\b(?:book online|book now|schedule (?:service|an appointment)|request an appointment)\b/i.test(item.text));
    const publicEmail = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "NOT_SPECIFIED";
    const phone = extractPhone(text);
    const serviceForm = /<form\b[\s\S]{0,6000}(?:name|type|id)=["'][^"']*(?:phone|tel|email|service|message)[^"']*["'][\s\S]{0,6000}<\/form>/i.test(html);
    const hours = text.match(/\b(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b[^.!?]{0,160}\b(?:\d{1,2}(?::\d{2})?\s*(?:AM|PM)|Closed)\b/i)?.[0] || "NOT_SPECIFIED";

    const lead = {
      company: title.replace(/\s+[|–—-]\s+.*$/, "").trim() || title,
      website: finalUrl,
      hostname: host,
      source_query: candidate.source_query,
      source_search_url: candidate.source_search_url,
      search_source: candidate.search_source,
      vertical: identity.industry,
      identity: {
        passed: identity.passed,
        schema_type: identity.schemaType,
        service_language: identity.serviceLanguage,
        locality_signal: identity.localitySignal,
        strong_text_evidence: `${title} | ${description} | ${h1}`.slice(0, 600)
      },
      phone,
      public_email: publicEmail,
      contact_url: contact?.href || "NOT_SPECIFIED",
      booking_url: booking?.href || "NOT_SPECIFIED",
      has_online_booking: Boolean(booking),
      has_service_form: serviceForm,
      has_live_chat: /(intercom|drift|tawk\.to|tidio|livechat|crisp|zendesk|podium|housecallpro[^\n]{0,80}chat)/i.test(html),
      claims_24_7: /\b24\s*\/\s*7\b|24 hours a day|open 24 hours|around the clock/i.test(text.slice(0, 50000)),
      hours_evidence: hours,
      phone_or_contact_evidence: text.match(/[^.!?]{0,100}\b(?:call us|give us a call|contact us|request service|schedule service)\b[^.!?]{0,100}/i)?.[0] || "NOT_SPECIFIED",
      inspected_at: new Date().toISOString()
    };
    return { ...lead, ...leadScore(lead) };
  } catch (error) {
    return {
      company: candidate.title || hostname(candidate.url), website: candidate.url, hostname: hostname(candidate.url),
      source_query: candidate.source_query, score: 0, fit_status: "REJECT", quality_gate_passed: false,
      fit_reasons: ["page inspection failed"], error: error instanceof Error ? error.message : String(error), inspected_at: new Date().toISOString()
    };
  }
}

if (!queries.length && !seedUrls.length) throw new Error("At least one query or seed URL is required");
fs.mkdirSync(path.dirname(outFile), { recursive: true });

const raw = [];
const searchDiagnostics = [];
for (const query of queries) {
  const found = await search(query);
  raw.push(...found.results);
  searchDiagnostics.push(found.diagnostic);
}
raw.push(...seedUrls.map((url) => ({ title: hostname(url), url, source_query: "seed URL", source_search_url: "NOT_SPECIFIED", search_source: "seed_url" })));

const candidates = [];
const seenHosts = new Set();
for (const item of raw) {
  const url = normalizeUrl(item.url);
  const host = hostname(url || "");
  if (!url || !host || seenHosts.has(host) || !candidateLooksCommercial({ ...item, url })) continue;
  seenHosts.add(host);
  candidates.push({ ...item, url });
}

const inspected = [];
for (let index = 0; index < candidates.length && inspected.filter((item) => item?.fit_status === "FIT").length < maxProspects; index += 5) {
  const batch = await Promise.all(candidates.slice(index, index + 5).map(inspect));
  inspected.push(...batch.filter(Boolean));
}

const ranked = inspected.sort((a, b) => (b.score || 0) - (a.score || 0));
const fitCount = ranked.filter((item) => item.fit_status === "FIT" && item.quality_gate_passed).length;
const maybeCount = ranked.filter((item) => item.fit_status === "MAYBE" && item.quality_gate_passed).length;
const status = !candidates.length || !ranked.length ? "FAIL" : fitCount < minFitForPass ? "DEGRADED" : "PASS";
const output = {
  status,
  mode: "READ_ONLY_PUBLIC_BUSINESS_RESEARCH",
  collector_version: "v3-strict-quality-gate",
  collected_at: new Date().toISOString(),
  queries,
  minimum_fit_required_for_pass: minFitForPass,
  search_diagnostics: searchDiagnostics,
  total_raw_results: raw.length,
  total_candidates: candidates.length,
  total_inspected: ranked.length,
  fit_count: fitCount,
  maybe_count: maybeCount,
  failure_reason: status === "FAIL" ? "No inspectable target-business candidates." : status === "DEGRADED" ? `Only ${fitCount} quality-gated FIT prospects; ${minFitForPass} required.` : null,
  prospects: ranked
};
fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ status, outFile, total_candidates: candidates.length, total_inspected: ranked.length, fit_count: fitCount, maybe_count: maybeCount }));
