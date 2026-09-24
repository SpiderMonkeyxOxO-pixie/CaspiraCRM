// Backend Phase 11 — emergency exceptions and the human review queue.
// Exceptions need a requester and a separate approver, a reason, scope,
// expiry and compensating controls; they expire automatically, need System
// Owner review to take effect, and can never waive zero-tolerance controls,
// credential exposure, authentication/permission bypass or automatic
// destructive/permission-changing actions. Reviewers see only the safe
// context stored on the item and can't decide items they created.
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { aiAudit } from "../common/audit.js";
import { recordOutboxEvent } from "../../services/outboxService.js";
import { NEVER_EXCEPTED } from "./catalog.js";
import { isSystemOwner } from "./killSwitches.js";

const bad = (m, status = 422) => Object.assign(new AiError(CATEGORIES.INVALID_REQUEST, m), { httpStatus: status });
const EXCEPTABLE = ["quality", "latency", "cost", "review_date", "readiness_manual_item"];
const MAX_DAYS = 14;

export const serializeException = (e) => ({ _id: e.publicId, scope: e.scope === "platform" ? "Platform" : "Organization", requestedByUserId: e.requestedByUserId, approvedByUserId: e.approvedByUserId, systemOwnerReviewed: !!e.systemOwnerReviewedByUserId, reason: e.reason, target: e.target, compensatingControls: e.compensatingControls, status: e.status, expiresAt: e.expiresAt, postReviewDueAt: e.postReviewDueAt, postReviewNote: e.postReviewNote, createdAt: e.createdAt });

export async function requestException(req, { reason, target = {}, compensatingControls, expiresInDays = 3 }) {
  if (!reason || !compensatingControls) throw bad("reason and compensatingControls are required.");
  const controls = [].concat(target.controls || []);
  if (!controls.length) throw bad("target.controls: which control is excepted (quality, latency, cost, review_date, readiness_manual_item).");
  const forbidden = controls.filter((c) => NEVER_EXCEPTED.includes(c) || !EXCEPTABLE.includes(c));
  if (forbidden.length) {
    await aiAudit(req, "ai.emergency_exception.forbidden", "AiEmergencyException", null, { result: "Failure", reason, after: { controls } });
    throw bad(`These controls can never be excepted: ${forbidden.join(", ")}. Cross-tenant access, credentials, authentication or permission bypass and automatic destructive or permission changes are never allowed.`, 403);
  }
  const days = Math.min(MAX_DAYS, Math.max(1, Number(expiresInDays) || 3));
  const e = await prisma.aiEmergencyException.create({ data: { publicId: `aex_${crypto.randomBytes(8).toString("base64url")}`, organizationId: req.organizationId, scope: req.organizationId, requestedByUserId: req.user.id, reason: String(reason).slice(0, 1000), target: { ...target, controls }, compensatingControls: String(compensatingControls).slice(0, 1000), expiresAt: new Date(Date.now() + days * 86_400_000), postReviewDueAt: new Date(Date.now() + (days + 7) * 86_400_000) } });
  await prisma.aiHumanReviewItem.create({ data: { organizationId: req.organizationId, scope: req.organizationId, queue: "emergency_exception", subjectType: "Exception", subjectId: e.id, priority: "High", summary: `Emergency exception requested for ${controls.join(", ")}.`, context: { exceptionId: e.publicId, target: e.target, compensatingControls: e.compensatingControls, expiresAt: e.expiresAt }, createdByUserId: req.user.id } });
  await aiAudit(req, "ai.emergency_exception.requested", "AiEmergencyException", e.id, { reason, after: { controls, expiresAt: e.expiresAt } });
  await recordOutboxEvent(prisma, { aggregateType: "AiEmergencyException", aggregateId: e.id, eventType: "ai.emergency_exception.requested", payload: { organizationId: req.organizationId, controls, notifyRoleKeys: ["admin", "super_admin"] } });
  return e;
}

export async function decideException(req, id, { decision, reason }) {
  const e = await prisma.aiEmergencyException.findFirst({ where: { publicId: String(id), scope: { in: ["platform", req.organizationId] } } });
  if (!e) throw bad("Exception not found.", 404);
  if (!reason) throw bad("Give a reason.");
  if (!["Approve", "Reject", "Revoke"].includes(decision)) throw bad("decision: Approve, Reject or Revoke.");
  if (decision !== "Revoke" && e.requestedByUserId === req.user?.id) throw bad("The requester can't decide their own exception.", 403);
  const data = {};
  if (decision === "Approve") {
    if (e.status !== "Requested" && !(e.status === "Approved" && !e.systemOwnerReviewedByUserId)) throw bad(`This exception is ${e.status.toLowerCase()}.`);
    if (e.expiresAt < new Date()) throw bad("This exception has expired.");
    if (!e.approvedByUserId) { data.approvedByUserId = req.user.id; data.status = "Approved"; }
    if (isSystemOwner(req)) data.systemOwnerReviewedByUserId = req.user.id;
    if (e.approvedByUserId && !isSystemOwner(req)) throw bad("Already approved; it takes effect after a System Owner reviews it.", 409);
  } else if (decision === "Reject") { if (e.status !== "Requested") throw bad(`This exception is ${e.status.toLowerCase()}.`); data.status = "Rejected"; }
  else data.status = "Revoked";
  const u = await prisma.aiEmergencyException.update({ where: { id: e.id }, data });
  await prisma.aiGovernanceApproval.create({ data: { organizationId: e.organizationId, subjectType: "Exception", subjectId: e.id, reviewerUserId: req.user.id, decision: decision === "Revoke" ? "Reject" : decision, role: isSystemOwner(req) ? "system_owner" : "approver", reason: String(reason).slice(0, 500) } });
  if (["Rejected", "Revoked"].includes(u.status) || u.systemOwnerReviewedByUserId) await prisma.aiHumanReviewItem.updateMany({ where: { subjectType: "Exception", subjectId: e.id, status: "Open" }, data: { status: u.status === "Approved" ? "Approved" : "Rejected", decidedByUserId: req.user.id, decision, reason, decidedAt: new Date() } });
  await aiAudit(req, { Approve: "ai.emergency_exception.approved", Reject: "ai.emergency_exception.rejected", Revoke: "ai.emergency_exception.revoked" }[decision], "AiEmergencyException", e.id, { reason, before: { status: e.status }, after: { status: u.status, systemOwnerReviewed: !!u.systemOwnerReviewedByUserId } });
  return u;
}

export async function expireExceptions(now = new Date()) {
  const due = await prisma.aiEmergencyException.findMany({ where: { status: { in: ["Requested", "Approved"] }, expiresAt: { lt: now } } });
  for (const e of due) {
    await prisma.aiEmergencyException.update({ where: { id: e.id }, data: { status: "Expired" } });
    await aiAudit({ user: null, organizationId: e.organizationId }, "ai.emergency_exception.expired", "AiEmergencyException", e.id, { organizationId: e.organizationId, before: { status: e.status }, after: { status: "Expired" } });
  }
  return due.length;
}

// ---- Human review queue -------------------------------------------------------------------

export const serializeReview = (r) => ({ _id: r.id, queue: r.queue, subjectType: r.subjectType, subjectId: r.subjectId, priority: r.priority, status: r.status, summary: r.summary, context: r.context, recommendedDecision: r.recommendedDecision, createdByUserId: r.createdByUserId, assignedToUserId: r.assignedToUserId, decidedByUserId: r.decidedByUserId, decision: r.decision, reason: r.reason, decidedAt: r.decidedAt, createdAt: r.createdAt });

export async function loadReview(req, id) {
  const r = await prisma.aiHumanReviewItem.findFirst({ where: { id: String(id), scope: { in: ["platform", req.organizationId] } } });
  if (!r) throw bad("Review item not found.", 404);
  return r;
}

// Applies a reviewer's decision to the item and, where it has one, its subject.
export async function decideReview(req, r, { decision, reason, runId = null, resultDecision = null }) {
  if (!["Approve", "Reject", "Request changes", "Escalate"].includes(decision)) throw bad("decision: Approve, Reject, Request changes or Escalate.");
  if (!reason) throw bad("Give a reason.");
  if (!["Open", "Escalated"].includes(r.status)) throw bad(`This item is ${r.status.toLowerCase()}.`);
  if (r.createdByUserId && r.createdByUserId === req.user?.id && decision !== "Escalate") throw bad("You can't decide a review item you raised.", 403);
  // Subject effects.
  if (r.subjectType === "Release" && decision !== "Escalate") {
    const { approveRelease } = await import("./releases.js");
    const rel = await prisma.aiRelease.findUnique({ where: { id: r.subjectId } });
    if (rel?.status === "Awaiting approval") await approveRelease(req, rel, { decision, reason });
  } else if (r.subjectType === "EvaluationResult" && ["Approve", "Reject"].includes(decision)) {
    const { reviewResult } = await import("./evaluation/runner.js");
    const result = await prisma.aiEvalResult.findUnique({ where: { id: r.subjectId } });
    const run = result && await prisma.aiEvalRun.findUnique({ where: { id: result.runId } });
    if (run) await reviewResult(req, run, { resultId: result.id, decision: resultDecision || (decision === "Approve" ? "Pass" : "Fail"), reason });
  } else if (r.subjectType === "Exception" && ["Approve", "Reject"].includes(decision)) {
    const e = await prisma.aiEmergencyException.findUnique({ where: { id: r.subjectId } });
    if (e) await decideException(req, e.publicId, { decision, reason });
  } else if (r.subjectType === "Restoration" && decision === "Approve") {
    const { approveRestoration } = await import("./incidents.js");
    const inc = await prisma.aiIncident.findUnique({ where: { id: r.subjectId } });
    if (inc) await approveRestoration(req, inc, { runId, reason });
  } else if (r.subjectType === "SafetyEvent") {
    await prisma.aiSafetyEvent.updateMany({ where: { id: r.subjectId }, data: { reviewStatus: decision === "Escalate" ? "Escalated" : decision === "Reject" ? "Dismissed" : "Reviewed" } });
  } else if (r.subjectType === "Policy" && decision !== "Escalate") {
    const { approvePolicy, rejectPolicy } = await import("./policies.js");
    const p = await prisma.aiGovernancePolicy.findUnique({ where: { id: r.subjectId } });
    if (p) { if (decision === "Approve") await approvePolicy(req, p, { reason }); else await rejectPolicy(req, p, { reason, requestChanges: decision === "Request changes" }); }
  }
  const status = { Approve: "Approved", Reject: "Rejected", "Request changes": "Changes requested", Escalate: "Escalated" }[decision];
  const fresh = await prisma.aiHumanReviewItem.findUnique({ where: { id: r.id } });
  const u = ["Approved", "Rejected", "Changes requested"].includes(fresh.status) && fresh.decidedByUserId ? fresh : await prisma.aiHumanReviewItem.update({ where: { id: r.id }, data: { status, decision, reason: String(reason).slice(0, 1000), decidedByUserId: decision === "Escalate" ? null : req.user?.id, decidedAt: decision === "Escalate" ? null : new Date(), priority: decision === "Escalate" ? "High" : r.priority } });
  await aiAudit(req, "ai.review.decided", "AiHumanReviewItem", r.id, { reason, before: { status: r.status }, after: { status: u.status, decision, subjectType: r.subjectType } });
  if (decision === "Escalate") await recordOutboxEvent(prisma, { aggregateType: "AiHumanReviewItem", aggregateId: r.id, eventType: "ai.review.escalated", payload: { organizationId: r.organizationId, queue: r.queue, notifyRoleKeys: ["admin", "super_admin", "ai_safety_reviewer"] } });
  return u;
}

// Queue feeders that watch existing signals (feedback, low confidence, safety events).
export async function feedReviewQueues(since = new Date(Date.now() - 10 * 60_000)) {
  let n = 0;
  const add = async (row) => {
    if (await prisma.aiHumanReviewItem.findFirst({ where: { subjectType: row.subjectType, subjectId: row.subjectId, queue: row.queue } })) return;
    await prisma.aiHumanReviewItem.create({ data: { ...row, scope: row.organizationId || "platform" } }); n += 1;
  };
  for (const f of await prisma.aiFeedback.findMany({ where: { createdAt: { gte: since }, rating: { in: ["Incorrect", "Unsafe"] } }, take: 200 })) {
    await add({ organizationId: f.organizationId, queue: f.rating === "Unsafe" ? "unsafe_feedback" : "incorrect_feedback", subjectType: "Feedback", subjectId: f.id, priority: f.rating === "Unsafe" ? "High" : "Normal", summary: `${f.rating} feedback${f.reason ? ` (${f.reason})` : ""}.`, context: { rating: f.rating, reason: f.reason, requestId: f.requestId } });
  }
  for (const m of await prisma.aiCopilotMessage.findMany({ where: { completedAt: { gte: since }, role: "assistant", confidence: { in: ["Low Confidence", "Insufficient Data"] } }, take: 200, select: { id: true, organizationId: true, confidence: true, limitations: true } })) {
    await add({ organizationId: m.organizationId, queue: m.confidence === "Insufficient Data" ? "missing_citations" : "low_confidence", subjectType: "CopilotMessage", subjectId: m.id, summary: `${m.confidence} answer.`, context: { limitations: (m.limitations || []).slice(0, 5) } });
  }
  for (const e of await prisma.aiSafetyEvent.findMany({ where: { createdAt: { gte: since }, severity: { in: ["Medium", "High", "Critical"] }, category: { in: ["prompt_injection_suspected", "sensitive_data_detected", "credential_exposure_attempt", "cross_tenant_attempt"] }, NOT: { source: { startsWith: "evaluation:" } } }, take: 200 })) {
    await add({ organizationId: e.organizationId, queue: e.category.includes("injection") ? "prompt_injection" : "sensitive_data", subjectType: "SafetyEvent", subjectId: e.id, priority: ["High", "Critical"].includes(e.severity) ? "High" : "Normal", summary: e.summary, context: { category: e.category, severity: e.severity, source: e.source, actionTaken: e.actionTaken, policyVersion: e.policyVersion } });
  }
  return n;
}
