#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const inputFile = process.env.OPENCLAW_BUSINESS_INPUT_FILE;
const outFile = process.env.OPENCLAW_BUSINESS_DRAFT_FILE;
const maxDrafts = Math.max(1, Number(process.env.OPENCLAW_BUSINESS_MAX_DRAFTS || "20"));
const productUrl = process.env.CALL_RESCUE_PRODUCT_URL || "https://callrescuekit.com";
const senderName = process.env.CALL_RESCUE_SENDER_NAME || "Call Rescue Kit";

if (!inputFile || !outFile) {
  throw new Error("OPENCLAW_BUSINESS_INPUT_FILE and OPENCLAW_BUSINESS_DRAFT_FILE are required");
}

const input = JSON.parse(fs.readFileSync(path.resolve(inputFile), "utf8"));
const prospects = Array.isArray(input.prospects) ? input.prospects : [];

function clean(value, fallback = "NOT_SPECIFIED") {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : fallback;
}

function companyName(raw) {
  const title = clean(raw, "your company");
  return title.split(/[|–—-]/)[0].trim().slice(0, 80) || "your company";
}

function observationFor(lead) {
  const observations = [];
  if (!lead.has_online_booking) observations.push("I could not find a clear online booking path");
  if (!lead.has_live_chat) observations.push("I did not detect a live-chat option");
  if (lead.hours_evidence && lead.hours_evidence !== "NOT_SPECIFIED") observations.push("the site appears to publish limited office hours");
  if (!lead.claims_24_7) observations.push("I did not see a clear 24/7 response claim");
  return observations.slice(0, 2).join(", and ") || "your public contact flow may have room for a faster after-hours response";
}

function contactChannel(lead) {
  if (lead.public_email && lead.public_email !== "NOT_SPECIFIED") return lead.public_email;
  if (lead.contact_url && lead.contact_url !== "NOT_SPECIFIED") return lead.contact_url;
  return lead.website;
}

const selected = prospects
  .filter((lead) => lead.fit_status === "FIT")
  .filter((lead) => contactChannel(lead) && contactChannel(lead) !== "NOT_SPECIFIED")
  .slice(0, maxDrafts);

const drafts = selected.map((lead) => {
  const company = companyName(lead.company);
  const vertical = clean(lead.vertical, "home-service");
  const observation = observationFor(lead);
  const subject = `Quick missed-call recovery idea for ${company}`;
  const body = `Hello,\n\nI reviewed ${company}'s public website while researching ${vertical} businesses. ${observation}.\n\nWe install a narrow missed-call recovery system for home-service companies: an immediate text response, basic job qualification, callback or booking routing, and a daily lead summary. It is designed to support the existing team rather than replace its phone process.\n\nI can prepare a short, no-cost audit showing the exact flow I would recommend for ${company}. Would it be useful if I sent that over?\n\nRegards,\n${senderName}\n${productUrl}`;
  return {
    company,
    website: clean(lead.website),
    recipient: clean(contactChannel(lead)),
    evidence: {
      observation,
      hours_evidence: clean(lead.hours_evidence),
      phone_or_contact_evidence: clean(lead.phone_or_contact_evidence)
    },
    draft_subject: subject,
    draft_text: body,
    text_hash: crypto.createHash("sha256").update(`${subject}\n${body}`, "utf8").digest("hex"),
    status: "AWAITING_HUMAN_APPROVAL",
    recommended_action: "Review evidence and recipient, then approve or reject. Do not send automatically."
  };
});

const output = {
  mode: "EVIDENCE_BASED_DRAFT_ONLY",
  generated_at: new Date().toISOString(),
  input_file: path.resolve(inputFile),
  total_fit_prospects: prospects.filter((lead) => lead.fit_status === "FIT").length,
  total_drafts: drafts.length,
  drafts
};

fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
fs.writeFileSync(path.resolve(outFile), JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify({ status: "PASS", outFile: path.resolve(outFile), total_drafts: drafts.length }));
