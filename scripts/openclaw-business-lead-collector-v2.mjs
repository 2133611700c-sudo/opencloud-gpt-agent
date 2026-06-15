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
const outFile = process.env.OPENCLAW_BUSINESS_OUT_FILE || path.resolve("prospects.json");
const blockedHosts = new Set(["bing.com","www.bing.com","microsoft.com","www.microsoft.com","msn.com","www.msn.com","duckduckgo.com","www.duckduckgo.com","yelp.com","www.yelp.com","angi.com","www.angi.com","homeadvisor.com","www.homeadvisor.com","thumbtack.com","www.thumbtack.com","bbb.org","www.bbb.org","yellowpages.com","www.yellowpages.com","facebook.com","www.facebook.com","instagram.com","www.instagram.com","linkedin.com","www.linkedin.com"]);

const decode = (s = "") => String(s).replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").replaceAll("&amp;", "&").replaceAll("&quot;", "\"").replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").trim();
const strip = (html = "") => decode(String(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
const host = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
const normal = (u) => { try { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) return null; x.hash = ""; return x.toString(); } catch { return null; } };
const absolute = (base, href) => { try { return new URL(decode(href), base).toString(); } catch { return "NOT_SPECIFIED"; } };

function parseRss(xml, query, sourceUrl) {
  return (String(xml).match(/<item>[\s\S]*?<\/item>/gi) || []).slice(0, 15).map((item) => ({
    title: decode(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1]),
    url: decode(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1]),
    source_query: query,
    source_search_url: sourceUrl,
    search_source: "bing_rss"
  })).filter((x) => normal(x.url));
}

function parseDuck(html, query, sourceUrl) {
  const out = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(re)) {
    let url = decode(match[1]);
    try { const wrapped = new URL(url, "https://duckduckgo.com"); url = wrapped.searchParams.get("uddg") || wrapped.toString(); } catch {}
    if (normal(url)) out.push({ title: strip(match[2]), url, source_query: query, source_search_url: sourceUrl, search_source: "duckduckgo_html" });
    if (out.length >= 15) break;
  }
  return out;
}

async function getText(url, accept = "text/html") {
  const response = await fetch(url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; CallRescueResearch/2.0)", accept }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { text: await response.text(), finalUrl: response.url };
}

async function search(query) {
  const rssUrl = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
  try {
    const rss = await getText(rssUrl, "application/rss+xml, application/xml, text/xml");
    const results = parseRss(rss.text, query, rssUrl);
    if (results.length) return { results, diagnostic: { query, source: "bing_rss", status: "PASS", result_count: results.length } };
  } catch (error) {}

  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const ddg = await getText(ddgUrl);
    const results = parseDuck(ddg.text, query, ddgUrl);
    return { results, diagnostic: { query, source: "duckduckgo_html", status: results.length ? "PASS" : "FAIL", result_count: results.length } };
  } catch (error) {
    return { results: [], diagnostic: { query, source: "duckduckgo_html", status: "FAIL", result_count: 0, error: error instanceof Error ? error.message : String(error) } };
  }
}

function vertical(text) {
  const t = text.toLowerCase();
  if (t.includes("plumb")) return "plumbing";
  if (["hvac","heating","air conditioning","air conditioner","furnace"].some((x) => t.includes(x))) return "HVAC";
  return "NOT_TARGET";
}

function score(p) {
  let n = 0; const reasons = [];
  if (p.phone !== "NOT_SPECIFIED") { n += 20; reasons.push("public phone found"); }
  if (p.public_email !== "NOT_SPECIFIED" || p.contact_url !== "NOT_SPECIFIED") { n += 15; reasons.push("public contact path found"); }
  if (!p.has_online_booking) { n += 20; reasons.push("no clear online booking detected"); }
  if (!p.has_live_chat) { n += 10; reasons.push("no live-chat widget detected"); }
  if (!p.claims_24_7) { n += 10; reasons.push("no clear 24/7 response claim detected"); }
  if (p.hours_evidence !== "NOT_SPECIFIED") { n += 10; reasons.push("business hours displayed"); }
  if (p.vertical !== "NOT_TARGET") { n += 10; reasons.push(`target vertical: ${p.vertical}`); }
  if (p.has_contact_form) { n += 5; reasons.push("contact form detected"); }
  return { score: n, fit_status: p.vertical === "NOT_TARGET" ? "REJECT" : n >= 65 ? "FIT" : n >= 45 ? "MAYBE" : "REJECT", fit_reasons: reasons };
}

async function inspect(candidate) {
  try {
    const page = await getText(candidate.url);
    const finalUrl = normal(page.finalUrl || candidate.url);
    if (!finalUrl || blockedHosts.has(host(finalUrl))) return null;
    const html = page.text;
    const text = strip(html).slice(0, 300000);
    const v = vertical(`${candidate.title} ${text}`);
    if (v === "NOT_TARGET") return null;
    const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || candidate.title || host(finalUrl)).slice(0, 180);
    const phone = text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0] || "NOT_SPECIFIED";
    const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "NOT_SPECIFIED";
    const contactHref = html.match(/href=["']([^"']*(?:contact|request|estimate|quote)[^"']*)["']/i)?.[1];
    const bookingHref = html.match(/href=["']([^"']*(?:book|schedule|appointment|reserve)[^"']*)["']/i)?.[1];
    const hours = text.match(/(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)[^.!?]{0,180}(?:am|pm|closed)/i)?.[0] || "NOT_SPECIFIED";
    const base = {
      company: title,
      website: finalUrl,
      hostname: host(finalUrl),
      source_query: candidate.source_query,
      source_search_url: candidate.source_search_url,
      search_source: candidate.search_source,
      vertical: v,
      phone,
      public_email: email,
      contact_url: contactHref ? absolute(finalUrl, contactHref) : "NOT_SPECIFIED",
      booking_url: bookingHref ? absolute(finalUrl, bookingHref) : "NOT_SPECIFIED",
      has_online_booking: Boolean(bookingHref),
      has_contact_form: /<form\b/i.test(html),
      has_live_chat: /(intercom|drift|tawk\.to|tidio|livechat|crisp|zendesk|podium)/i.test(html),
      claims_24_7: /\b24\s*\/\s*7\b|24 hours a day|open 24 hours|around the clock/i.test(text),
      hours_evidence: hours,
      phone_or_contact_evidence: text.match(/[^.!?]{0,90}(?:call us|give us a call|contact us|phone)[^.!?]{0,90}/i)?.[0] || "NOT_SPECIFIED",
      inspected_at: new Date().toISOString()
    };
    return { ...base, ...score(base) };
  } catch (error) {
    return { company: candidate.title || host(candidate.url), website: candidate.url, hostname: host(candidate.url), source_query: candidate.source_query, score: 0, fit_status: "REJECT", fit_reasons: ["page inspection failed"], error: error instanceof Error ? error.message : String(error), inspected_at: new Date().toISOString() };
  }
}

if (!queries.length && !seedUrls.length) throw new Error("At least one query or seed URL is required");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const raw = []; const diagnostics = [];
for (const query of queries) { const found = await search(query); raw.push(...found.results); diagnostics.push(found.diagnostic); }
raw.push(...seedUrls.map((url) => ({ title: host(url), url, source_query: "seed URL", source_search_url: "NOT_SPECIFIED", search_source: "seed_url" })));

const candidates = []; const seen = new Set();
for (const item of raw) { const url = normal(item.url); const h = host(url || ""); if (!url || !h || blockedHosts.has(h) || seen.has(h)) continue; seen.add(h); candidates.push({ ...item, url }); }

const inspected = [];
for (let i = 0; i < candidates.length && inspected.filter((x) => x && ["FIT","MAYBE"].includes(x.fit_status)).length < maxProspects; i += 5) {
  const batch = await Promise.all(candidates.slice(i, i + 5).map(inspect));
  inspected.push(...batch.filter(Boolean));
}
const ranked = inspected.sort((a, b) => (b.score || 0) - (a.score || 0));
const fitCount = ranked.filter((x) => x.fit_status === "FIT").length;
const maybeCount = ranked.filter((x) => x.fit_status === "MAYBE").length;
const status = !candidates.length || !ranked.length ? "FAIL" : !fitCount ? "DEGRADED" : "PASS";
const output = { status, mode: "READ_ONLY_PUBLIC_BUSINESS_RESEARCH", collected_at: new Date().toISOString(), queries, search_diagnostics: diagnostics, total_raw_results: raw.length, total_candidates: candidates.length, total_inspected: ranked.length, fit_count: fitCount, maybe_count: maybeCount, failure_reason: status === "FAIL" ? "Search produced no inspectable target-business candidates." : null, prospects: ranked };
fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ status, outFile, total_candidates: candidates.length, total_inspected: ranked.length, fit_count: fitCount, maybe_count: maybeCount }));
