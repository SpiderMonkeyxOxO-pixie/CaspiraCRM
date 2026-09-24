// Backend Phase 9 — governed AI action proposals.
//
//   preview   → Awaiting Confirmation   (validated, current values captured)
//   confirm   → Awaiting Approval       (when policy or the action type needs an approver)
//             → Executed | Failed       (otherwise, through the domain handler)
//   approve   → Executed | Failed       (a different person with ai_actions:approve)
//   reject / cancel / expire             (nothing happens to the record)
//   undo      → Undone                   (when the action type supports it)
//
// A proposal is never executed from a model call, never shown as done
// before the domain handler confirms it, and fails safely if the record
// changed after the preview (version conflict).
import crypto from "node:crypto";
import prisma from "../../lib/prisma.js";
import { hasGrant } from "../../utils/grants.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { aiAudit } from "../common/audit.js";
import { getAiPolicy } from "../policy/policyService.js";
import { ACTION_TYPES, PROHIBITED, PROHIBITED_ALIASES, loadTarget } from "./actionTypes.js";
import { checkCapability, checkActionExecution } from "../governance/runtime.js";
import { recordSafetyEvent } from "../governance/safety.js";

export const PROPOSAL_TTL_MS = 24 * 3_600_000;
export const UNDO_WINDOW_MS = 24 * 3_600_000;
const newPublicId = () => `aia_${crypto.randomBytes(9).toString("base64url")}`;

export function prohibitedExplanation(actionType) {
  const key = PROHIBITED[actionType] ? actionType : PROHIBITED_ALIASES[actionType];
  if (!key) return null;
  const [what, who] = PROHIBITED[key];
  return { actionType, what, message: `${what} is never done through AI. It's restricted to ${who}.`, authorized: who };
}

export function serializeProposal(p, req) {
  const mine = p.proposedByMembershipId && p.proposedByMembershipId === req?.membership?.id;
  return {
    _id: p.publicId, publicId: p.publicId, actionType: p.actionType, label: ACTION_TYPES[p.actionType]?.label || p.actionType, status: p.status, source: p.source,
    requestId: p.requestId, targetType: p.targetType, targetId: p.targetId, targetVersion: p.targetVersion,
    currentValues: p.currentValues, proposedValues: p.proposedValues, reason: p.reason, evidence: p.evidence, impact: p.impact,
    requiredPermission: p.requiredPermission, approvalRequired: p.approvalRequired, requiredApprover: p.approvalRequired ? "Someone else with AI action approval (ai_actions:approve)" : null,
    proposedByMembershipId: p.proposedByMembershipId, confirmedByMembershipId: p.confirmedByMembershipId, confirmedAt: p.confirmedAt,
    expiresAt: p.expiresAt, result: p.result, undoAvailable: p.status === "Executed" && !!p.undoData && ACTION_TYPES[p.actionType]?.undo && Date.now() - new Date(p.updatedAt).getTime() < UNDO_WINDOW_MS,
    undoneAt: p.undoneAt, errorMessage: p.errorMessage, isMine: !!mine, version: p.version, createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

export async function loadProposal(req, id) {
  return prisma.aiActionProposal.findFirst({ where: { organizationId: req.organizationId, OR: [{ publicId: String(id) }, { id: String(id) }] } });
}

export async function previewAction(req, { actionType, targetType, targetId, proposedValues = {}, reason, evidence = [], source = "User", requestId = null }) {
  // Phase 11: AI-sourced proposals are a governed capability.
  if (source === "Model") await checkCapability(req, "suggested_actions", { evaluation: !!req.aiEvaluation });
  const prohibited = prohibitedExplanation(actionType);
  if (prohibited) {
    await aiAudit(req, "ai.action.prohibited_attempt", "AiActionProposal", null, { result: "Failure", reason: prohibited.message, after: { actionType, targetType, targetId, source } });
    await recordSafetyEvent(req, { severity: source === "Model" ? "Medium" : "Low", category: "prohibited_action_request", capabilityKey: "suggested_actions", summary: `Prohibited action type requested (${String(actionType).slice(0, 40)}).`, source: `governed_actions:${source}`, actionTaken: "Refuse" }).catch(() => {});
    throw new AiError(CATEGORIES.POLICY, prohibited.message, { details: { prohibited: true, authorized: prohibited.authorized } });
  }
  const def = ACTION_TYPES[actionType];
  if (!def) throw new AiError(CATEGORIES.INVALID_REQUEST, `Unknown action type. Allowed: ${Object.keys(ACTION_TYPES).join(", ")}.`);
  if (!def.targets.includes(targetType)) throw new AiError(CATEGORIES.INVALID_REQUEST, `${def.label} applies to: ${def.targets.join(", ")}.`);
  if (!hasGrant(req, def.grant[0], def.grant[1])) throw new AiError(CATEGORIES.PERMISSION, `This action needs ${def.grant[0]}:${def.grant[1]}, which your role doesn't have.`);
  if (source === "Model" && requestId) {
    const r = await prisma.aiRequest.findFirst({ where: { id: requestId, organizationId: req.organizationId } });
    if (!r) throw new AiError(CATEGORIES.INVALID_REQUEST, "The AI request this proposal came from wasn't found.");
  }
  const target = await loadTarget(req, targetType, String(targetId || ""));
  const values = def.validate(proposedValues || {}, target);
  const policy = await getAiPolicy(req.organizationId);
  const approvalRequired = policy.actionApprovals?.[actionType] ?? def.defaultApproval;
  const proposal = await prisma.aiActionProposal.create({
    data: {
      publicId: newPublicId(), organizationId: req.organizationId, actionType, source: source === "Model" ? "Model" : "User", requestId: requestId || null,
      targetType, targetId: String(targetId), targetVersion: target.version, currentValues: target.current, proposedValues: values,
      reason: String(reason || def.label).slice(0, 1000), evidence: Array.isArray(evidence) ? evidence.slice(0, 20) : [],
      requiredPermission: `${def.grant[0]}:${def.grant[1]}`, approvalRequired,
      impact: `${def.label} on ${targetType} "${target.label}". ${approvalRequired ? "An approver must review it after you confirm." : "It runs when you confirm."}`,
      proposedByMembershipId: req.membership?.id || null, expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
    },
  });
  await aiAudit(req, "ai.action.proposed", "AiActionProposal", proposal.id, { after: { actionType, targetType, targetId, source: proposal.source, approvalRequired } });
  return proposal;
}

async function expireIfNeeded(p) {
  if (["Awaiting Confirmation", "Awaiting Approval"].includes(p.status) && p.expiresAt < new Date()) {
    await prisma.aiActionProposal.update({ where: { id: p.id }, data: { status: "Expired" } });
    throw new AiError(CATEGORIES.INVALID_REQUEST, "This proposal expired. Prepare it again.");
  }
}

// Atomic state change; refuses if someone else moved it first.
async function transition(p, from, data) {
  const out = await prisma.aiActionProposal.updateMany({ where: { id: p.id, status: { in: [].concat(from) }, version: p.version }, data: { ...data, version: { increment: 1 } } });
  if (out.count !== 1) throw new AiError(CATEGORIES.INVALID_REQUEST, "This proposal was changed by someone else. Refresh and try again.");
  return prisma.aiActionProposal.findUnique({ where: { id: p.id } });
}

async function execute(req, p) {
  const def = ACTION_TYPES[p.actionType];
  if (!hasGrant(req, def.grant[0], def.grant[1])) throw new AiError(CATEGORIES.PERMISSION, `Carrying out this action needs ${p.requiredPermission}.`);
  // Version check before running (the domain handler checks again).
  if (p.targetVersion !== null && p.targetVersion !== undefined) {
    const fresh = await loadTarget(req, p.targetType, p.targetId);
    if (fresh.version !== p.targetVersion) {
      const failed = await transition(p, ["Executing"], { status: "Failed", errorMessage: "The record changed after this proposal was prepared. Prepare it again." });
      await prisma.aiActionExecution.create({ data: { organizationId: p.organizationId, proposalId: p.id, status: "Failed", errorMessage: "version_conflict", executedByMembershipId: req.membership?.id || null, completedAt: new Date() } });
      await aiAudit(req, "ai.action.failed", "AiActionProposal", p.id, { result: "Failure", reason: "version_conflict" });
      return failed;
    }
  }
  const exec = await prisma.aiActionExecution.create({ data: { organizationId: p.organizationId, proposalId: p.id, status: "Running", executedByMembershipId: req.membership?.id || null } });
  try {
    const { result, undo } = await def.execute(req, p);
    await prisma.aiActionExecution.update({ where: { id: exec.id }, data: { status: "Succeeded", result, completedAt: new Date() } });
    const done = await transition(p, ["Executing"], { status: "Executed", result, undoData: undo || null, errorMessage: null });
    await aiAudit(req, "ai.action.executed", "AiActionProposal", p.id, { after: { actionType: p.actionType, targetType: p.targetType, targetId: p.targetId, result } });
    return done;
  } catch (err) {
    const message = err instanceof AiError ? err.message : "The action failed.";
    await prisma.aiActionExecution.update({ where: { id: exec.id }, data: { status: "Failed", errorMessage: message.slice(0, 500), completedAt: new Date() } });
    const failed = await transition(p, ["Executing"], { status: "Failed", errorMessage: message.slice(0, 500) });
    await aiAudit(req, "ai.action.failed", "AiActionProposal", p.id, { result: "Failure", reason: message });
    return failed;
  }
}

export async function confirmProposal(req, p) {
  await expireIfNeeded(p);
  if (p.status !== "Awaiting Confirmation") throw new AiError(CATEGORIES.INVALID_REQUEST, `This proposal is ${p.status.toLowerCase()}.`);
  await checkActionExecution(p.organizationId);
  const mine = p.proposedByMembershipId === req.membership?.id;
  if (!mine && !hasGrant(req, "ai_actions", "approve")) {
    await recordSafetyEvent(req, { severity: "Medium", category: "approval_bypass_attempt", capabilityKey: "suggested_actions", summary: "Confirmation attempted by someone who neither prepared the proposal nor may approve it.", source: "governed_actions", actionTaken: "Refuse" }).catch(() => {});
    throw new AiError(CATEGORIES.PERMISSION, "Only the person who prepared this proposal, or an approver, can confirm it.");
  }
  if (p.approvalRequired) {
    const next = await transition(p, ["Awaiting Confirmation"], { status: "Awaiting Approval", confirmedByMembershipId: req.membership?.id || null, confirmedAt: new Date() });
    await aiAudit(req, "ai.action.confirmed", "AiActionProposal", p.id, { after: { awaitingApproval: true } });
    return next;
  }
  const running = await transition(p, ["Awaiting Confirmation"], { status: "Executing", confirmedByMembershipId: req.membership?.id || null, confirmedAt: new Date() });
  await aiAudit(req, "ai.action.confirmed", "AiActionProposal", p.id, { after: { awaitingApproval: false } });
  return execute(req, running);
}

export async function approveProposal(req, p, reason) {
  await expireIfNeeded(p);
  if (p.status !== "Awaiting Approval") throw new AiError(CATEGORIES.INVALID_REQUEST, `This proposal is ${p.status.toLowerCase()}.`);
  await checkActionExecution(p.organizationId);
  if (p.proposedByMembershipId === req.membership?.id || p.confirmedByMembershipId === req.membership?.id) {
    await recordSafetyEvent(req, { severity: "High", category: "approval_bypass_attempt", capabilityKey: "suggested_actions", summary: "Self-approval of an AI action proposal was attempted (separation of duties).", source: "governed_actions", actionTaken: "Refuse" }).catch(() => {});
    throw new AiError(CATEGORIES.PERMISSION, "An approver must be someone other than the person who proposed or confirmed it.");
  }
  await prisma.aiActionApproval.create({ data: { organizationId: p.organizationId, proposalId: p.id, approverMembershipId: req.membership.id, decision: "Approved", reason: reason ? String(reason).slice(0, 500) : null } });
  const running = await transition(p, ["Awaiting Approval"], { status: "Executing" });
  await aiAudit(req, "ai.action.approved", "AiActionProposal", p.id, { reason });
  return execute(req, running);
}

export async function rejectProposal(req, p, reason) {
  if (!["Awaiting Confirmation", "Awaiting Approval"].includes(p.status)) throw new AiError(CATEGORIES.INVALID_REQUEST, `This proposal is ${p.status.toLowerCase()}.`);
  if (!String(reason || "").trim()) throw new AiError(CATEGORIES.INVALID_REQUEST, "Give a reason for rejecting it.");
  if (p.proposedByMembershipId === req.membership?.id) throw new AiError(CATEGORIES.PERMISSION, "Cancel your own proposal instead of rejecting it.");
  await prisma.aiActionApproval.create({ data: { organizationId: p.organizationId, proposalId: p.id, approverMembershipId: req.membership.id, decision: "Rejected", reason: String(reason).slice(0, 500) } });
  const next = await transition(p, ["Awaiting Confirmation", "Awaiting Approval"], { status: "Rejected" });
  await aiAudit(req, "ai.action.rejected", "AiActionProposal", p.id, { reason });
  return next;
}

export async function cancelProposal(req, p) {
  if (!["Awaiting Confirmation", "Awaiting Approval"].includes(p.status)) throw new AiError(CATEGORIES.INVALID_REQUEST, `This proposal is ${p.status.toLowerCase()}.`);
  if (p.proposedByMembershipId !== req.membership?.id) throw new AiError(CATEGORIES.PERMISSION, "Only the person who prepared this proposal can cancel it.");
  const next = await transition(p, ["Awaiting Confirmation", "Awaiting Approval"], { status: "Cancelled" });
  await aiAudit(req, "ai.action.cancelled", "AiActionProposal", p.id);
  return next;
}

export async function undoProposal(req, p) {
  const def = ACTION_TYPES[p.actionType];
  if (p.status !== "Executed") throw new AiError(CATEGORIES.INVALID_REQUEST, "Only an executed action can be undone.");
  await checkActionExecution(p.organizationId);
  if (!def?.undo || !p.undoData) throw new AiError(CATEGORIES.INVALID_REQUEST, "This action can't be undone automatically.");
  if (Date.now() - new Date(p.updatedAt).getTime() > UNDO_WINDOW_MS) throw new AiError(CATEGORIES.INVALID_REQUEST, "The undo window has passed.");
  const involved = [p.proposedByMembershipId, p.confirmedByMembershipId].includes(req.membership?.id);
  if (!involved && !hasGrant(req, "ai_actions", "approve")) throw new AiError(CATEGORIES.PERMISSION, "Only the people involved, or an approver, can undo this action.");
  if (!hasGrant(req, def.grant[0], def.grant[1])) throw new AiError(CATEGORIES.PERMISSION, `Undoing this action needs ${p.requiredPermission}.`);
  try {
    await def.undo(req, p);
  } catch (err) {
    await prisma.aiActionExecution.create({ data: { organizationId: p.organizationId, proposalId: p.id, kind: "Undo", status: "Failed", errorMessage: (err.message || "failed").slice(0, 500), executedByMembershipId: req.membership?.id || null, completedAt: new Date() } });
    throw err instanceof AiError ? err : new AiError(CATEGORIES.UNKNOWN, "Undo failed.");
  }
  await prisma.aiActionExecution.create({ data: { organizationId: p.organizationId, proposalId: p.id, kind: "Undo", status: "Succeeded", executedByMembershipId: req.membership?.id || null, completedAt: new Date() } });
  const next = await transition(p, ["Executed"], { status: "Undone", undoneAt: new Date() });
  await aiAudit(req, "ai.action.undone", "AiActionProposal", p.id);
  return next;
}

export async function expireProposals(now = new Date()) {
  return (await prisma.aiActionProposal.updateMany({ where: { status: { in: ["Awaiting Confirmation", "Awaiting Approval"] }, expiresAt: { lt: now } }, data: { status: "Expired" } })).count;
}
