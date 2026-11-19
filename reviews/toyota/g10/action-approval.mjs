// G10 REVIEW ONLY. Server-side, one-shot tool-action authorization.
// No external-site exactly-once guarantee: a consumed grant is never replayed.
import { createHash, randomBytes } from "node:crypto";

const PASSIVE_ACTIONS = new Set(["hover", "scrollIntoView", "resize", "wait"]);
const NAVIGATION_TOOLS = new Set(["browser_open", "browser_navigate", "browser_emulate"]);

export function needsOwnerApproval(tool, mutating, args = {}) {
  if (!mutating || tool === "sms_send") return false;  // SMS has its own mandatory approval
  if (NAVIGATION_TOOLS.has(tool)) return false;  // HTTP GET still has residual risk
  if (tool === "browser_act") return !PASSIVE_ACTIONS.has(args.kind);
  if (tool === "browser_batch") return !Array.isArray(args.actions) || args.actions.some(a => !PASSIVE_ACTIONS.has(a?.kind));
  return true; // evaluate, arbitrary OpenClaw tools, clicks, uploads, downloads, dialog, close, reset
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  }
  return value;
}

export function actionHash(owner, tool, args) {
  if (!owner || !tool) throw new Error("missing requester/tool for approval");
  return createHash("sha256").update(JSON.stringify(stable({ owner, tool, args }))).digest("hex");
}

export function requestActionApproval(Q, owner, tool, args, now = () => new Date().toISOString()) {
  const approvalId = randomBytes(18).toString("base64url");
  const expiry = new Date(Date.now() + 30 * 60000).toISOString();
  // Exact payload is available ONLY in the local SQLite database / owner-only control tool.
  // The public action journal logs only a redacted representation.
  Q.apReq.run(approvalId, now(), owner, "hub_action:" + tool, actionHash(owner, tool, args), JSON.stringify({tool,args}), expiry);
  return { status:"NEEDS_APPROVAL", approvalId, expiresAt:expiry, tool, argsSha256:actionHash(owner,tool,args) };
}

export function consumeActionApproval(Q, owner, tool, args, approvalId, now = () => new Date().toISOString()) {
  if (typeof approvalId !== "string" || approvalId.length < 16 || approvalId.length > 64)
    throw Object.assign(new Error("valid action approvalId required"), {reason:"policy"});
  const use = Q.apUse.run(now(), approvalId, owner, actionHash(owner,tool,args), now());
  if (use.changes !== 1)
    throw Object.assign(new Error("approval missing, expired, already used or bound to different requester/action"), {reason:"policy"});
  return true;
}
