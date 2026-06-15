#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function envJson(name, fallback) {
  try { return JSON.parse(process.env[name] || JSON.stringify(fallback)); }
  catch { return fallback; }
}

const queries = envJson("CALL_RESCUE_QUERIES", []);
const outputFile = process.env.CALL_RESCUE_OUTPUT_FILE || path.resolve("quality-prospects.json");
const minimumFit = Math.max(1, Number(process.env.CALL_RESCUE_MINIMUM_FIT || "5"));

const blockedDomains = [
  "wikipedia.org","reddit.com","youtube.com","facebook.com","instagram.com","linkedin.com",
  "yelp.com","angi.com","homeadvisor.com","thumbtack.com","bbb.org","yellowpages.com",
  "merriam-webster.com","usnews.com","mapquest.com","nextdoor.com","indeed.com","glassdoor.com",
  "ziprecruiter.com","bing.com","microsoft.com","msn.com"
];
const negativeTerms = [
  "wikipedia","definition","things to do","travel","best plumbers","best hvac","top plumbers","top hvac",
  "directory","reviews","jobs","salary","school","news","article","blog","utility company","energy company",
  "city of ","county of ","license lookup"
];

const decode = (value = "") => String(value)
  .replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "")
  .replaceAll("&amp;", "&").replaceAll("&quot;", "\"").replaceAll("&#39;", "'")
  .replaceAll("&lt;", "<").replaceAll("&gt;", ">").trim();
const textOnly = (html = "") => decode(String(html)
  .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } };
const validUrl = (url) => { try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.toString() : null; } catch { return null; } };
const blockedHost = (host) => blockedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
const containsNegative = (text) => negativeTerms.some((term) => String(text).toLowerCase().includes(term));

function industry(text) {
  const value = String(text).toLowerCase();
  if (/\bplumb(?:er|ers|ing)?\b/.test(value)) return "plumbing";
  if (/\bhvac\b|\bair conditioning\b|\bheating and (?:air|cooling)\b|\bfurnace (?:repair|service|installation)\b/.test(value)) return "HVAC";
  return "NOT_TARGET";
}

async function fetchText(url, accept = "text/html") {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "Mozilla/5.0 (compatible; CallRescueQualityAudit/1.0)", accept },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { body: await response.text(), finalUrl: response.url, contentType: response.headers.get("content-type") || "" };
}

function parseRss(xml, query, searchUrl) {
  return (String(xml).match(/<item>[\s\S]*?<\/item>/gi) || []).slice(0, 20).map((item) => ({
    title: decode(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1]),
    url: decode(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1]),
    query,
    search_url: searchUrl
  })).filter((item) => validUrl(item.url));
}

async function search(query) {
  const enriched = `${query} official website company -wikipedia -yelp -angi -bbb -yellowpages -facebook -jobs -news`;
  const searchUrl = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(enriched)}`;
  try {
    const response = await fetchText(searchUrl, "application/rss+xml, application/xml, text/xml");
    const raw = parseRss(response.body, query, searchUrl);
    const accepted = raw.filter((item) => {
      const host = hostOf(item.url);
      const title = item.title.toLowerCase();
      if (!host || blockedHost(host) || host.endsWith(".gov") || host.endsWith(".edu")) return false;
      if (industry(title) === "NOT_TARGET" || containsNegative(title)) return false;
      return !/\/(wiki|news|article|blog|travel|jobs?|careers?|forum)\//i.test(new URL(item.url).pathname);
    });
    return { results: accepted, diagnostic: { query, raw_count: raw.length, accepted_count: accepted.length, status: accepted.length ? "PASS" : "FAIL" } };
  } catch (error) {
    return { results: [], diagnostic: { query, raw_count: 0, accepted_count: 0, status: "FAIL", error: error instanceof Error ? error.message : String(error) } };
  }
}

function metaDescription(html) {
  const first = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const second = html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  return decode(first?.[1] || second?.[1] || "");
}

function anchors(html, baseUrl) {
  const items = [];
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(regex)) {
    try { items.push({ url: new URL(decode(match[1]), baseUrl).toString(), text: textOnly(match[2]).slice(0, 120) }); } catch {}
    if (items.length >= 600) break;
  }
  return items;
}

function validPhone(text) {
  const matches = String(text).match(/(?:\+?1[-.\s]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[-.\s][2-9]\d{2}[-.\s]\d{4}\b/g) || [];
  return matches.find((value) => {
    const digits = value.replace(/\D/g, "");
    return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
  })?.trim() || "NOT_SPECIFIED";
}

async function inspect(candidate) {
  try {
    const response = await fetchText(candidate.url);
    const finalUrl = validUrl(response.finalUrl || candidate.url);
    const host = hostOf(finalUrl || "");
    if (!finalUrl || !host || blockedHost(host) || !/html/i.test(response.contentType)) return null;

    const html = response.body;
    const title = textOnly(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || candidate.title).slice(0, 180);
    const description = metaDescription(html);
    const h1 = textOnly(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
    const h2 = textOnly(html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || "");
    const strongText = `${title} ${description} ${h1} ${h2}`;
    const vertical = industry(strongText);
    const pageText = textOnly(html).slice(0, 200000);
    const negative = containsNegative(strongText) || /\b(?:encyclopedia|tourism|municipal|electric utility|natural gas utility)\b/i.test(strongText);
    const serviceLanguage = /\b(?:repair|installation|maintenance|service|contractor|technician|emergency|residential|commercial)\b/i.test(strongText);
    const localSignal = /\b(?:serving|service area|locally owned|family owned|licensed|insured)\b/i.test(pageText.slice(0, 30000));
    const schemaSignal = /"@type"\s*:\s*(?:\[[^\]]*)?["'](?:Plumber|HVACBusiness|HomeAndConstructionBusiness|LocalBusiness)["']/i.test(html);
    if (vertical === "NOT_TARGET" || negative || (!serviceLanguage && !schemaSignal) || (!localSignal && !schemaSignal)) return null;

    const pageAnchors = anchors(html, finalUrl);
    const contact = pageAnchors.find((item) => /\b(?:contact us|request service|request estimate|get an estimate|free estimate|request quote)\b/i.test(item.text));
    const booking = pageAnchors.find((item) => /\b(?:book online|book now|schedule service|schedule an appointment|request an appointment)\b/i.test(item.text));
    const phone = validPhone(pageText);
    const email = pageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "NOT_SPECIFIED";
    const serviceForm = /<form\b[\s\S]{0,7000}(?:phone|tel|email|service|message)[\s\S]{0,7000}<\/form>/i.test(html);
    const contactPath = contact?.url || (email !== "NOT_SPECIFIED" ? `mailto:${email}` : "NOT_SPECIFIED");
    const qualityGate = phone !== "NOT_SPECIFIED" && contactPath !== "NOT_SPECIFIED";
    if (!qualityGate) return null;

    const hasChat = /(intercom|drift|tawk\.to|tidio|livechat|crisp|zendesk|podium)/i.test(html);
    const claims247 = /\b24\s*\/\s*7\b|24 hours a day|open 24 hours|around the clock/i.test(pageText.slice(0, 50000));
    const needSignals = [!booking, !hasChat, !claims247].filter(Boolean).length;
    const score = 55 + (schemaSignal ? 15 : 0) + (serviceForm ? 5 : 0) + needSignals * 5;

    return {
      company: title.replace(/\s+[|–—-]\s+.*$/, "").trim() || title,
      website: finalUrl,
      hostname: host,
      vertical,
      phone,
      public_email: email,
      contact_url: contactPath,
      booking_url: booking?.url || "NOT_SPECIFIED",
      has_online_booking: Boolean(booking),
      has_live_chat: hasChat,
      claims_24_7: claims247,
      has_service_form: serviceForm,
      quality_gate_passed: true,
      fit_status: needSignals > 0 ? "FIT" : "MAYBE",
      score,
      identity_evidence: `${title} | ${description} | ${h1}`.slice(0, 600),
      source_query: candidate.query,
      source_search_url: candidate.search_url,
      inspected_at: new Date().toISOString()
    };
  } catch (error) {
    return { website: candidate.url, fit_status: "REJECT", quality_gate_passed: false, error: error instanceof Error ? error.message : String(error) };
  }
}

if (!queries.length) throw new Error("CALL_RESCUE_QUERIES must contain at least one query");
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
const raw = [];
const diagnostics = [];
for (const query of queries) {
  const found = await search(query);
  raw.push(...found.results);
  diagnostics.push(found.diagnostic);
}

const candidates = [];
const seen = new Set();
for (const candidate of raw) {
  const host = hostOf(candidate.url);
  if (!host || seen.has(host)) continue;
  seen.add(host);
  candidates.push(candidate);
}

const inspected = [];
for (let index = 0; index < candidates.length; index += 5) {
  const batch = await Promise.all(candidates.slice(index, index + 5).map(inspect));
  inspected.push(...batch.filter(Boolean));
}
const prospects = inspected.filter((item) => item.quality_gate_passed).sort((a, b) => (b.score || 0) - (a.score || 0));
const fitCount = prospects.filter((item) => item.fit_status === "FIT").length;
const maybeCount = prospects.filter((item) => item.fit_status === "MAYBE").length;
const status = fitCount >= minimumFit ? "PASS" : candidates.length ? "DEGRADED" : "FAIL";
const output = {
  status,
  collector_version: "quality-audit-v1",
  collected_at: new Date().toISOString(),
  minimum_fit_required: minimumFit,
  total_search_results: raw.length,
  total_candidates: candidates.length,
  total_inspected: inspected.length,
  fit_count: fitCount,
  maybe_count: maybeCount,
  diagnostics,
  prospects,
  next_action: status === "PASS" ? "Human review of identity evidence before any outreach." : "Improve search coverage; no outreach authorized."
};
fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ status, outputFile, total_candidates: candidates.length, fit_count: fitCount, maybe_count: maybeCount }));
