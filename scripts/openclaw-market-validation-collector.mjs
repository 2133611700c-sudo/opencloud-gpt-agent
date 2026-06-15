#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function jsonEnv(name, fallback) {
  try {
    return JSON.parse(process.env[name] || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

const queries = jsonEnv("OPENCLAW_MARKET_QUERIES", []);
const seedUrls = jsonEnv("OPENCLAW_MARKET_SEED_URLS", []);
const maxInspected = Math.max(1, Number(process.env.OPENCLAW_MARKET_MAX_INSPECTED || "150"));
const outFile = process.env.OPENCLAW_MARKET_OUT_FILE || path.resolve("market-validation.json");

const blockedHosts = new Set([
  "bing.com", "www.bing.com", "microsoft.com", "www.microsoft.com", "msn.com", "www.msn.com",
  "duckduckgo.com", "www.duckduckgo.com", "google.com", "www.google.com",
  "yelp.com", "www.yelp.com", "angi.com", "www.angi.com", "homeadvisor.com", "www.homeadvisor.com",
  "thumbtack.com", "www.thumbtack.com", "bbb.org", "www.bbb.org", "yellowpages.com", "www.yellowpages.com",
  "facebook.com", "www.facebook.com", "instagram.com", "www.instagram.com", "linkedin.com", "www.linkedin.com",
  "mapquest.com", "www.mapquest.com", "nextdoor.com", "www.nextdoor.com", "houzz.com", "www.houzz.com"
]);

const thirdPartyEmailHosts = [
  "godaddy.com", "sentry.io", "wixpress.com", "wordpress.com", "example.com", "cloudflare.com",
  "google.com", "facebook.com", "instagram.com", "schema.org"
];

const vendorPatterns = [
  ["ServiceTitan", /servicetitan/i],
  ["Jobber", /getjobber|jobber\.com/i],
  ["Housecall Pro", /housecallpro/i],
  ["CallRail", /callrail/i],
  ["Podium", /podium\.com|podium-webchat/i],
  ["Goodcall", /goodcall\.com/i],
  ["Smith.ai", /smith\.ai/i],
  ["Ruby", /ruby\.com/i],
  ["Nexa", /nexa\.com/i],
  ["Birdeye", /birdeye/i],
  ["Intercom", /intercom/i],
  ["Tidio", /tidio/i],
  ["LiveChat", /livechatinc|livechat\.com/i],
  ["Tawk", /tawk\.to/i],
  ["Crisp", /crisp\.chat/i],
  ["Zendesk", /zendesk/i]
];

const decode = (value = "") => String(value)
  .replace(/^<!\[CDATA\[/, "")
  .replace(/\]\]>$/, "")
  .replaceAll("&amp;", "&")
  .replaceAll("&quot;", "\"")
  .replaceAll("&#39;", "'")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .trim();

const strip = (html = "") => decode(String(html)
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " "));

const host = (url) => {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
};

const normalizeUrl = (url) => {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
};

const absolute = (base, href) => {
  try { return new URL(decode(href), base).toString(); } catch { return "NOT_SPECIFIED"; }
};

function parseRss(xml, query, sourceUrl) {
  return (String(xml).match(/<item>[\s\S]*?<\/item>/gi) || [])
    .slice(0, 20)
    .map((item) => ({
      title: decode(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1]),
      url: decode(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1]),
      source_query: query,
      source_search_url: sourceUrl,
      search_source: "bing_rss"
    }))
    .filter((item) => normalizeUrl(item.url));
}

function parseDuck(html, query, sourceUrl) {
  const output = [];
  const regex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(regex)) {
    let url = decode(match[1]);
    try {
      const wrapped = new URL(url, "https://duckduckgo.com");
      url = wrapped.searchParams.get("uddg") || wrapped.toString();
    } catch {}
    if (normalizeUrl(url)) {
      output.push({
        title: strip(match[2]),
        url,
        source_query: query,
        source_search_url: sourceUrl,
        search_source: "duckduckgo_html"
      });
    }
    if (output.length >= 20) break;
  }
  return output;
}

async function getText(url, accept = "text/html") {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; CallRescueMarketResearch/1.0; public-read-only)",
      accept
    },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { text: await response.text(), finalUrl: response.url };
}

async function search(query) {
  const rssUrl = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
  try {
    const rss = await getText(rssUrl, "application/rss+xml, application/xml, text/xml");
    const results = parseRss(rss.text, query, rssUrl);
    if (results.length) {
      return { results, diagnostic: { query, source: "bing_rss", status: "PASS", result_count: results.length } };
    }
  } catch {}

  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const ddg = await getText(ddgUrl);
    const results = parseDuck(ddg.text, query, ddgUrl);
    return {
      results,
      diagnostic: { query, source: "duckduckgo_html", status: results.length ? "PASS" : "FAIL", result_count: results.length }
    };
  } catch (error) {
    return {
      results: [],
      diagnostic: {
        query,
        source: "duckduckgo_html",
        status: "FAIL",
        result_count: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function detectVertical(text) {
  const normalized = text.toLowerCase();
  const plumbing = /\bplumb(?:er|ing)?\b|drain cleaning|sewer repair|water heater/.test(normalized);
  const hvac = /\bhvac\b|air conditioning|air conditioner|heating repair|furnace|heat pump/.test(normalized);
  if (plumbing && hvac) return "plumbing_hvac";
  if (plumbing) return "plumbing";
  if (hvac) return "HVAC";
  return "NOT_TARGET";
}

function extractJsonLd(html) {
  const entries = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of String(html).matchAll(regex)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) entries.push(...parsed);
      else if (parsed && typeof parsed === "object") entries.push(parsed);
    } catch {}
  }
  return entries.flatMap((entry) => Array.isArray(entry?.["@graph"]) ? entry["@graph"] : [entry]);
}

function firstBusinessEntity(entities) {
  return entities.find((entry) => {
    const type = entry?.["@type"];
    const types = Array.isArray(type) ? type : [type];
    return types.some((value) => /LocalBusiness|Plumber|HVACBusiness|HomeAndConstructionBusiness|Organization/i.test(String(value || "")));
  }) || null;
}

function cleanCompanyName(value, hostname) {
  const raw = strip(value || "").replace(/\s+[|–—-]\s+.*$/, "").trim();
  if (!raw || raw.length < 2 || raw.length > 120) return hostname;
  if (/^(home|contact|services|plumber in|hvac in|air conditioning|heating and cooling)$/i.test(raw)) return hostname;
  return raw;
}

function extractEmail(text, websiteHost) {
  const matches = [...String(text).matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) => match[0]);
  for (const email of matches) {
    const emailHost = email.split("@")[1]?.toLowerCase() || "";
    if (thirdPartyEmailHosts.some((blocked) => emailHost === blocked || emailHost.endsWith(`.${blocked}`))) continue;
    const websiteRoot = websiteHost.replace(/^www\./, "");
    if (emailHost === websiteRoot || emailHost.endsWith(`.${websiteRoot}`)) return email;
  }
  return "NOT_SPECIFIED";
}

function detectVendors(html) {
  return vendorPatterns.filter(([, pattern]) => pattern.test(html)).map(([name]) => name);
}

function classify(record) {
  const exclusions = [];
  const evidence = [];

  if (record.vertical === "NOT_TARGET") exclusions.push("not a target vertical");
  if (!record.official_site_likelihood) exclusions.push("official business identity is not sufficiently supported");
  if (record.phone === "NOT_SPECIFIED" && record.contact_url === "NOT_SPECIFIED") exclusions.push("no reliable public contact path");
  if (record.has_ai_receptionist_claim) exclusions.push("site explicitly claims an AI receptionist or AI call handling");
  if (record.has_answering_service_claim) exclusions.push("site explicitly claims an answering service or call center");

  if (record.phone !== "NOT_SPECIFIED") evidence.push("public business phone detected");
  if (record.business_hours !== "NOT_SPECIFIED") evidence.push("explicit business-hours evidence detected");
  if (record.has_online_booking) evidence.push("online booking detected");
  if (record.has_live_chat) evidence.push("live chat detected");
  if (record.claims_24_7) evidence.push("24/7 claim detected");
  if (record.detected_vendors.length) evidence.push(`detected vendors: ${record.detected_vendors.join(", ")}`);

  if (exclusions.length) {
    return {
      status: "EXCLUDE",
      status_reasons: exclusions,
      hypothesis: "No sales hypothesis generated.",
      manual_review_required: false
    };
  }

  const existingSolutionSignals = [
    record.claims_24_7,
    record.has_online_booking,
    record.has_live_chat,
    record.detected_vendors.length > 0,
    record.has_ai_receptionist_claim,
    record.has_answering_service_claim
  ].filter(Boolean).length;

  if (record.business_hours !== "NOT_SPECIFIED" && existingSolutionSignals === 0) {
    return {
      status: "PROVISIONAL_MATCH",
      status_reasons: [
        "target business identity supported",
        "limited-hours evidence exists",
        "no explicit call-handling solution detected on inspected page"
      ],
      hypothesis: "The business may have an after-hours coverage gap. This is not proof of missed calls and requires an owner interview or call-log evidence.",
      manual_review_required: true
    };
  }

  return {
    status: "MANUAL_REVIEW",
    status_reasons: evidence.length ? evidence : ["insufficient positive or exclusion evidence"],
    hypothesis: "Public website evidence is insufficient to establish a lost-call problem.",
    manual_review_required: true
  };
}

async function inspect(candidate) {
  try {
    const page = await getText(candidate.url);
    const finalUrl = normalizeUrl(page.finalUrl || candidate.url);
    if (!finalUrl || blockedHosts.has(host(finalUrl))) return null;

    const html = page.text;
    const visibleText = strip(html).slice(0, 300000);
    const pageTitle = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || candidate.title || host(finalUrl));
    const entities = extractJsonLd(html);
    const business = firstBusinessEntity(entities);
    const websiteHost = host(finalUrl);
    const company = cleanCompanyName(business?.name || pageTitle || candidate.title, websiteHost);
    const vertical = detectVertical(`${company} ${pageTitle} ${visibleText}`);

    const phone = String(business?.telephone || visibleText.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0] || "NOT_SPECIFIED");
    const publicEmail = extractEmail(`${JSON.stringify(business || {})} ${visibleText}`, websiteHost);
    const contactHref = html.match(/href=["']([^"']*(?:contact|request|estimate|quote)[^"']*)["']/i)?.[1];
    const bookingHref = html.match(/href=["']([^"']*(?:book|schedule|appointment|reserve)[^"']*)["']/i)?.[1];
    const businessHours = visibleText.match(/(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)[^.!?]{0,180}(?:am|pm|closed)/i)?.[0] || "NOT_SPECIFIED";
    const detectedVendors = detectVendors(html);

    const record = {
      company,
      website: finalUrl,
      hostname: websiteHost,
      source_query: candidate.source_query,
      source_search_url: candidate.source_search_url,
      search_source: candidate.search_source,
      vertical,
      phone,
      public_email: publicEmail,
      contact_url: contactHref ? absolute(finalUrl, contactHref) : "NOT_SPECIFIED",
      booking_url: bookingHref ? absolute(finalUrl, bookingHref) : "NOT_SPECIFIED",
      business_hours: businessHours,
      has_online_booking: Boolean(bookingHref),
      has_contact_form: /<form\b/i.test(html),
      has_live_chat: /(intercom|drift|tawk\.to|tidio|livechat|crisp|zendesk|podium)/i.test(html),
      claims_24_7: /\b24\s*\/\s*7\b|24 hours a day|open 24 hours|around the clock/i.test(visibleText),
      has_ai_receptionist_claim: /ai receptionist|artificial intelligence receptionist|ai voice agent|virtual ai receptionist/i.test(visibleText),
      has_answering_service_claim: /answering service|live call center|24\/7 call center|professional call center/i.test(visibleText),
      detected_vendors: detectedVendors,
      official_site_likelihood: Boolean(business?.name || (phone !== "NOT_SPECIFIED" && vertical !== "NOT_TARGET")),
      company_size: "NOT_VERIFIED",
      paid_lead_usage: "NOT_VERIFIED",
      missed_call_volume: "NOT_VERIFIED",
      average_job_value: "NOT_VERIFIED",
      evidence_limitations: [
        "Website inspection cannot prove missed calls or lost revenue.",
        "Company size, advertising spend, call volume, software configuration, and buying intent require direct verification."
      ],
      inspected_at: new Date().toISOString()
    };

    return { ...record, ...classify(record) };
  } catch (error) {
    return {
      company: candidate.title || host(candidate.url),
      website: candidate.url,
      hostname: host(candidate.url),
      source_query: candidate.source_query,
      status: "EXCLUDE",
      status_reasons: ["page inspection failed"],
      error: error instanceof Error ? error.message : String(error),
      manual_review_required: false,
      inspected_at: new Date().toISOString()
    };
  }
}

if (!queries.length && !seedUrls.length) throw new Error("At least one query or seed URL is required");
fs.mkdirSync(path.dirname(outFile), { recursive: true });

const raw = [];
const diagnostics = [];
for (const query of queries) {
  const found = await search(query);
  raw.push(...found.results);
  diagnostics.push(found.diagnostic);
}
raw.push(...seedUrls.map((url) => ({
  title: host(url),
  url,
  source_query: "seed URL",
  source_search_url: "NOT_SPECIFIED",
  search_source: "seed_url"
})));

const candidates = [];
const seen = new Set();
for (const item of raw) {
  const url = normalizeUrl(item.url);
  const hostname = host(url || "");
  if (!url || !hostname || blockedHosts.has(hostname) || seen.has(hostname)) continue;
  seen.add(hostname);
  candidates.push({ ...item, url });
}

const inspected = [];
for (let index = 0; index < candidates.length && inspected.length < maxInspected; index += 5) {
  const batch = await Promise.all(candidates.slice(index, index + 5).map(inspect));
  inspected.push(...batch.filter(Boolean));
}

const provisional = inspected.filter((item) => item.status === "PROVISIONAL_MATCH");
const manualReview = inspected.filter((item) => item.status === "MANUAL_REVIEW");
const excluded = inspected.filter((item) => item.status === "EXCLUDE");
const inspectable = provisional.length + manualReview.length + excluded.length;

const output = {
  status: inspectable >= 100 ? "DATASET_READY" : inspectable >= 20 ? "PARTIAL_DATASET" : "INSUFFICIENT_DATA",
  mode: "READ_ONLY_PUBLIC_MARKET_VALIDATION",
  generated_at: new Date().toISOString(),
  queries,
  search_diagnostics: diagnostics,
  total_raw_results: raw.length,
  total_unique_candidates: candidates.length,
  total_inspected: inspected.length,
  provisional_match_count: provisional.length,
  manual_review_count: manualReview.length,
  excluded_count: excluded.length,
  provisional_match_rate: inspected.length ? Number((provisional.length / inspected.length).toFixed(4)) : 0,
  messages_sent: 0,
  money_spent_usd: 0,
  interpretation: "PROVISIONAL_MATCH means suitable for manual problem validation only. It is not a qualified sales lead and does not prove missed calls, lost revenue, or purchase intent.",
  records: inspected
};

fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
console.log(JSON.stringify({
  status: output.status,
  outFile,
  total_unique_candidates: candidates.length,
  total_inspected: inspected.length,
  provisional_match_count: provisional.length,
  manual_review_count: manualReview.length,
  excluded_count: excluded.length
}));
