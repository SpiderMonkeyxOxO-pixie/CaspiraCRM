// Backend Phase 9 — AI maintenance for the existing worker. Every job is
// idempotent; none calls a model except connection re-verification (an
// authenticated models list, no generation).
import prisma from "../../lib/prisma.js";
import { Prisma } from "@prisma/client";
import { expireReservations, resetBudgetPeriods } from "../usage/usageService.js";
import { expireProposals } from "../actions/actionService.js";
import { verifyAiConnection } from "../connections/connectionService.js";
import { getAiPolicy } from "../policy/policyService.js";

// Redacted payload snapshots, request events, evaluation results and
// feedback past the organization's retention. Usage records and audit
// metadata are kept.
export async function applyAiRetention(now = new Date()) {
  const out = {};
  out.payloads = (await prisma.aiRequest.updateMany({ where: { payloadExpiresAt: { lt: now }, NOT: { payload: { equals: Prisma.DbNull } } }, data: { payload: Prisma.DbNull } })).count;
  out.events = 0; out.evaluationResults = 0; out.feedback = 0; out.providerMetadata = 0;
  const orgs = await prisma.aiRequest.findMany({ distinct: ["organizationId"], select: { organizationId: true } });
  for (const { organizationId } of orgs) {
    const { retention } = await getAiPolicy(organizationId);
    const before = (days) => new Date(now.getTime() - days * 86_400_000);
    out.events += (await prisma.aiRequestEvent.deleteMany({ where: { organizationId, createdAt: { lt: before(retention.providerMetadataDays) } } })).count;
    out.providerMetadata += (await prisma.aiRequest.updateMany({ where: { organizationId, createdAt: { lt: before(retention.providerMetadataDays) }, providerRequestId: { not: null } }, data: { providerRequestId: null } })).count;
    out.evaluationResults += (await prisma.aiEvaluationResult.deleteMany({ where: { organizationId, createdAt: { lt: before(retention.evaluationDays) } } })).count;
    out.feedback += (await prisma.aiFeedback.deleteMany({ where: { organizationId, createdAt: { lt: before(retention.feedbackDays) } } })).count;
  }
  return out;
}

// Connected connections are re-verified daily.
export async function reverifyConnections(now = new Date()) {
  const stale = await prisma.aiProviderConnection.findMany({ where: { mode: "Live", status: { in: ["Connected", "Connected with Warnings"] }, OR: [{ verifiedAt: null }, { verifiedAt: { lt: new Date(now - 24 * 3_600_000) } }] }, take: 25 });
  let checked = 0;
  for (const c of stale) {
    try { await verifyAiConnection(c); } catch { /* recorded on the connection */ }
    checked += 1;
  }
  return checked;
}

// Requests left Running by a restarted process.
export async function failStaleRequests(now = new Date()) {
  return (await prisma.aiRequest.updateMany({ where: { status: { in: ["Queued", "Running"] }, createdAt: { lt: new Date(now - 30 * 60_000) } }, data: { status: "Failed", errorCategory: "unknown", safeError: "The request didn't finish (the server restarted).", completedAt: now } })).count;
}

export async function runAiMaintenance() {
  const results = {};
  for (const [name, fn] of Object.entries({ reservations: expireReservations, proposals: expireProposals, budgets: resetBudgetPeriods, staleRequests: failStaleRequests, retention: applyAiRetention, reverify: reverifyConnections })) {
    try { results[name] = await fn(); } catch (err) { results[name] = `error: ${err.message}`; }
  }
  return results;
}
