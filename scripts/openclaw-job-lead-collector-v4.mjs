#!/usr/bin/env node
import fs from "node:fs";

let upstreamError = null;
try {
  await import("./openclaw-job-lead-collector-v3.mjs");
} catch (error) {
  upstreamError = error;
}

const outFile = process.env.OPENCLAW_COLLECT_OUT_FILE;
if (!outFile || !fs.existsSync(outFile)) {
  throw upstreamError || new Error("collector output file was not created");
}

const output = JSON.parse(fs.readFileSync(outFile, "utf8"));
const original = Array.isArray(output.leads) ? output.leads : [];
const accepted = [];
const semanticRejected = [];

for (const lead of original) {
  const role = String(lead.role || "");
  const hasRole = /(driver|truck|delivery|courier|operator)/i.test(role);
  const hasBoxDelivery = /(box|bobtail|delivery)/i.test(role);
  if (hasRole && hasBoxDelivery) accepted.push(lead);
  else semanticRejected.push({
    query: "post_validation",
    url: lead.listing_url || lead.apply_url || "",
    role,
    reason: "semantic_box_delivery_mismatch"
  });
}

output.provider = "duckduckgo_html_strict_v4";
output.leads = accepted;
output.rejected = [...(Array.isArray(output.rejected) ? output.rejected : []), ...semanticRejected];
output.valid_leads_count = accepted.length;
output.rejected_count = output.rejected.length;
output.quality_status = accepted.length > 0 ? "PASS" : "DEGRADED";
fs.writeFileSync(outFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ provider: output.provider, quality_status: output.quality_status, valid_leads: accepted.length, rejected: output.rejected_count, outFile }));

if (accepted.length === 0) throw "DEGRADED: no semantically valid box or delivery listings collected";
