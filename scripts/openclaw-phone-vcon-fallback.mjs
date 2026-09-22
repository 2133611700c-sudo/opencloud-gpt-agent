#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const apiKey = String(process.env.CALL2ME_API_KEY || "").trim();
const privateDir = String(process.env.PHONE_CALL_PRIVATE_DIR || path.join(process.env.RUNNER_TEMP || "/tmp", "openclaw-phone-private")).trim();
const apiBase = "https://api.call2me.app/v1";

if (!apiKey) {
  console.error("BLOCKED_PRIVILEGE: CALL2ME_API_KEY is not configured");
  process.exit(20);
}

if (!fs.existsSync(privateDir)) process.exit(0);

const files = fs.readdirSync(privateDir).filter((name) => name.endsWith(".private.json"));
for (const name of files) {
  const file = path.join(privateDir, name);
  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    continue;
  }

  if (evidence?.transcript) continue;
  const callId = String(evidence?.call_id || "").trim();
  if (!/^[A-Za-z0-9._:-]{3,200}$/.test(callId)) continue;

  try {
    const response = await fetch(`${apiBase}/calls/${encodeURIComponent(callId)}/vcon`, {
      method: "GET",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      evidence.vcon_endpoint_status = `http_${response.status}`;
    } else {
      const text = await response.text();
      let vcon = null;
      try { vcon = text ? JSON.parse(text) : null; } catch {}
      if (vcon && (Array.isArray(vcon) || Object.keys(vcon).length > 0)) {
        evidence.transcript = vcon;
        evidence.transcript_source = "vcon";
        evidence.vcon_endpoint_status = "success";
      } else {
        evidence.vcon_endpoint_status = "empty";
      }
    }
  } catch {
    evidence.vcon_endpoint_status = "error";
  }

  fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
