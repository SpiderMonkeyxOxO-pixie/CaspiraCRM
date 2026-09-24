// Backend Phase 11 — production-readiness checklist (machine- and
// human-readable). Automatic items are computed from evidence in the
// database; manual items need a person to confirm them with evidence.
// General availability is blocked while any mandatory item is incomplete.
import prisma from "../../lib/prisma.js";
import { AiError, CATEGORIES } from "../common/errors.js";
import { aiAudit } from "../common/audit.js";
import { READINESS_ITEMS } from "./catalog.js";

const bad = (m, status = 422) => Object.assign(new AiError(CATEGORIES.INVALID_REQUEST, m), { httpStatus: status });
const DAYS = (n) => new Date(Date.now() - n * 86_400_000);

async function automatic(req, capabilityKey, release) {
  const org = req.organizationId;
  const cap = await prisma.aiCapability.findUnique({ where: { key: capabilityKey } });
  const suiteIds = (await prisma.aiEvaluationSuite.findMany({ where: { OR: [{ capabilityKey }, { key: cap?.evaluationSuiteKey || "__none__" }, { key: "zero_tolerance_quick" }] }, select: { id: true } })).map((s) => s.id);
  const lastRun = await prisma.aiEvalRun.findFirst({ where: { suiteId: { in: suiteIds }, status: { in: ["Passed", "Passed with warnings"] }, completedAt: { gte: DAYS(30) } }, orderBy: { completedAt: "desc" } });
  const categoriesCovered = async (cats) => {
    if (!lastRun) return false;
    const results = await prisma.aiEvalResult.findMany({ where: { runId: lastRun.id }, select: { caseId: true, outcome: true } });
    const cases = await prisma.aiEvaluationCase.findMany({ where: { id: { in: results.map((r) => r.caseId) } }, select: { id: true, zeroTolerance: true, type: true } });
    const passedIds = new Set(results.filter((r) => r.outcome === "Pass").map((r) => r.caseId));
    return cats.every((cat) => cases.some((c) => passedIds.has(c.id) && ((c.zeroTolerance || []).includes(cat) || c.type === cat)));
  };
  const policy = await prisma.aiPolicy.findUnique({ where: { organizationId: org } });
  const members = await prisma.organizationMembership.findMany({ where: { organizationId: org, status: "Active" }, include: { roles: { include: { role: true } } } });
  const reviewers = members.filter((m) => m.roles.some((r) => (r.role.permissionGrants || []).some((g) => g.moduleId === "ai_safety" && g.actions.includes("review")))).length;
  const killTest = await prisma.auditEvent.findFirst({ where: { action: "ai.kill_switch.deactivated", createdAt: { gte: DAYS(90) } } });
  const rollbackTest = await prisma.auditEvent.findFirst({ where: { action: "ai.release.rolled_back", createdAt: { gte: DAYS(90) } } });
  const providerContact = await prisma.aiProviderGovernance.findFirst({ where: { scope: { in: [org, "platform"] }, incidentContact: { not: null } } });
  const cohort = release ? await prisma.aiRolloutCohort.findFirst({ where: { releaseId: release.id, approvedByUserId: { not: null } } }) : await prisma.aiRolloutCohort.findFirst({ where: { approvedByUserId: { not: null }, releaseId: { in: (await prisma.aiRelease.findMany({ where: { capabilityKey }, select: { id: true } })).map((r) => r.id) } } });
  const prodApproval = release ? await prisma.aiGovernanceApproval.findFirst({ where: { subjectType: "Release", subjectId: release.id, role: "production_approval" } }) : null;
  return {
    retention: !!policy?.retention || !!cap?.retentionPolicy,
    authorization_tests: await categoriesCovered(["authorization_bypass", "unauthorized_record_disclosure"]),
    cross_tenant_tests: await categoriesCovered(["cross_tenant_leakage"]),
    sensitive_field_tests: await categoriesCovered(["restricted_field_leakage", "credential_leakage"]),
    prompt_injection_tests: await categoriesCovered(["prompt_injection"]),
    prohibited_action_tests: await categoriesCovered(["prohibited_action_execution", "action_without_approval", "fabricated_execution"]),
    evaluation_gates: !!lastRun && lastRun.zeroToleranceFailures === 0,
    human_reviewers: reviewers > 0,
    budgets: (await prisma.aiBudget.count({ where: { organizationId: org, active: true } })) > 0,
    rate_limits: !!policy && policy.maxRequestsPerUserPerHour > 0,
    alerts: (await prisma.aiAlertRule.count({ where: { active: true } })) > 0,
    kill_switches_tested: !!killTest, rollback_tested: !!rollbackTest, incident_contacts: !!providerContact,
    user_limitations: true, // the Copilot and AI Overview display the disclaimer and per-answer limitations
    pilot_cohort: !!cohort, production_approval: !!prodApproval,
    _evidence: { lastPassingRun: lastRun?.publicId || null, killSwitchTestAt: killTest?.createdAt || null, rollbackTestAt: rollbackTest?.createdAt || null, reviewers },
  };
}

export async function readinessFor(req, capabilityKey, release = null) {
  const auto = await automatic(req, capabilityKey, release);
  const rows = await prisma.aiReadinessItem.findMany({ where: { capabilityKey, scope: { in: ["platform", req.organizationId] } } });
  const items = READINESS_ITEMS.map((def) => {
    const org = rows.find((r) => r.key === def.key && r.scope === req.organizationId);
    const base = rows.find((r) => r.key === def.key && r.scope === "platform");
    const row = org || base;
    const status = def.source === "automatic" ? (auto[def.key] ? "Complete" : "Incomplete") : row?.status || "Incomplete";
    return { key: def.key, label: def.label, mandatory: def.mandatory, source: def.source, status, evidence: def.source === "automatic" ? null : row?.evidence || null, confirmedByUserId: row?.confirmedByUserId || null, confirmedAt: row?.confirmedAt || null };
  });
  const incomplete = items.filter((i) => i.mandatory && i.status !== "Complete");
  return { capabilityKey, items, complete: !incomplete.length, incomplete: incomplete.map((i) => i.key), evidence: auto._evidence, generallyAvailableAllowed: !incomplete.length, note: incomplete.length ? "General availability is blocked until every mandatory item is complete." : "All mandatory items are complete; general availability still needs a recorded production approval." };
}

// A person confirms a manual item for their organization, with evidence.
export async function confirmReadinessItem(req, capabilityKey, key, { status = "Complete", evidence }) {
  const def = READINESS_ITEMS.find((i) => i.key === key);
  if (!def) throw bad("Unknown readiness item.", 404);
  if (def.source === "automatic") throw bad("This item is computed from evidence and can't be confirmed by hand.");
  if (!["Complete", "Incomplete", "Not applicable"].includes(status)) throw bad("status: Complete, Incomplete or Not applicable.");
  if (status !== "Incomplete" && !evidence) throw bad("Record the evidence (what was checked, where, by whom).");
  if (status === "Not applicable" && def.mandatory) throw bad("A mandatory item can't be marked not applicable.");
  const row = await prisma.aiReadinessItem.upsert({
    where: { scope_capabilityKey_key: { scope: req.organizationId, capabilityKey, key } },
    update: { status, evidence: evidence ? String(evidence).slice(0, 1000) : null, confirmedByUserId: req.user?.id, confirmedAt: new Date() },
    create: { scope: req.organizationId, organizationId: req.organizationId, capabilityKey, key, label: def.label, mandatory: def.mandatory, source: "manual", status, evidence: evidence ? String(evidence).slice(0, 1000) : null, confirmedByUserId: req.user?.id, confirmedAt: new Date() },
  });
  await aiAudit(req, "ai.readiness.confirmed", "AiReadinessItem", row.id, { after: { capabilityKey, key, status } });
  return row;
}
