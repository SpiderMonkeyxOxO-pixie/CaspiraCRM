// Backend Phase 11 — seeds the governance registry. Idempotent: creates what
// is missing and never overwrites decisions already recorded in the database
// (statuses, approvals, confirmations, active kill switches).
import crypto from "node:crypto";
import { AI_PROVIDERS, AI_MODELS } from "../catalog.js";
import { TOOLS, PROPOSAL_TOOLS, TOOL_REGISTRY_VERSION } from "../copilot/tools/registry.js";
import { WORKFLOWS, WORKFLOW_LIMITS, workflowChecksum } from "../copilot/workflows.js";
import { CAPABILITIES, DEV_BASELINE_CAPABILITIES, SLO_DEFINITIONS, ALERT_RULES, GRADERS, READINESS_ITEMS } from "./catalog.js";
import { DATASETS, SUITES } from "./evaluation/fixtures.js";

const sha = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
const BASELINE = { baseline: "Backend Phase 10", note: "Activated by seed as the evaluated Phase 9/10 baseline (unit, live and simulator checks). Any new version needs the governance gate." };
// A pinned model id carries a date or explicit version; OpenAI's undated ids are moving aliases.
const isPinned = (p, m) => p === "simulator" || p === "anthropic" || /\d{4}-\d{2}-\d{2}$|\d{8}$/.test(m);

async function once(finder, creator, out, key) {
  if (await finder()) { out[key].unchanged += 1; return null; }
  out[key].created += 1;
  return creator();
}

export async function seedGovernance(db) {
  const keys = ["capabilities", "providers", "models", "prompts", "tools", "workflows", "killSwitches", "flags", "slos", "alerts", "graders", "datasets", "cases", "suites", "readiness"];
  const out = Object.fromEntries(keys.map((k) => [k, { created: 0, unchanged: 0 }]));

  for (const c of CAPABILITIES) {
    const { key, status = "Approved", ...rest } = c;
    await once(() => db.aiCapability.findUnique({ where: { key } }), async () => {
      const row = await db.aiCapability.create({ data: { key, status, ...rest } });
      await db.aiCapabilityVersion.create({ data: { capabilityId: row.id, version: 1, snapshot: { key, status, ...rest }, changeSummary: "Initial registration (Phase 11 seed)." } });
    }, out, "capabilities");
    for (const it of READINESS_ITEMS) {
      await once(() => db.aiReadinessItem.findUnique({ where: { scope_capabilityKey_key: { scope: "platform", capabilityKey: key, key: it.key } } }),
        () => db.aiReadinessItem.create({ data: { scope: "platform", capabilityKey: key, key: it.key, label: it.label, mandatory: it.mandatory, source: it.source } }), out, "readiness");
    }
  }

  for (const p of AI_PROVIDERS) {
    const status = p.key === "simulator" ? "Verified" : p.availability !== "Adapter" ? "Unavailable" : "Not configured";
    await once(() => db.aiProviderGovernance.findUnique({ where: { scope_providerKey: { scope: "platform", providerKey: p.key } } }), () => db.aiProviderGovernance.create({
      data: {
        scope: "platform", providerKey: p.key, status, credentialStatus: p.key === "simulator" ? "Not required" : "Not configured",
        dpaStatus: p.key === "simulator" ? "Not applicable" : "Unverified", residencyStatus: p.key === "simulator" ? "Local (CRM server)" : "Unverified",
        retentionMode: p.key === "simulator" ? "Nothing leaves the CRM server" : "Unverified", zdrEligibility: p.key === "simulator" ? "Not applicable" : "Unverified",
        hostedStorage: "Off", approvedModels: AI_MODELS.filter((m) => m.providerKey === p.key).map((m) => m.modelId),
        approvedClassifications: p.key === "simulator" ? ["Public", "Internal", "Confidential", "Personal", "Financial"] : ["Public", "Internal"],
        prohibitedClassifications: ["Restricted", "Secret"], limitations: p.dataRetentionNote ? [p.dataRetentionNote] : [p.availabilityReason || ""].filter(Boolean),
      },
    }), out, "providers");
  }

  for (const m of AI_MODELS) {
    await once(() => db.aiModelGovernance.findUnique({ where: { providerKey_modelId: { providerKey: m.providerKey, modelId: m.modelId } } }), () => db.aiModelGovernance.create({
      data: {
        providerKey: m.providerKey, modelId: m.modelId, displayName: m.displayName, pinned: isPinned(m.providerKey, m.modelId), capabilities: m.capabilities,
        tools: m.capabilities.includes("tools"), structuredOutput: m.capabilities.includes("structured"), contextLimit: m.contextWindow, outputLimit: m.maxOutputTokens,
        retentionClass: m.providerKey === "simulator" ? "Local" : "Unverified", approvedUseCases: m.providerKey === "simulator" ? ["*"] : [],
        evaluationStatus: "Not evaluated", releaseStatus: m.providerKey === "simulator" ? "Approved" : "Draft",
      },
    }), out, "models");
  }

  // Prompts: the published Phase 9/10 versions are the active baseline.
  const templates = await db.aiPromptTemplate.findMany();
  for (const t of templates) {
    const versions = await db.aiPromptTemplateVersion.findMany({ where: { templateId: t.id }, orderBy: { version: "asc" } });
    const latest = versions.filter((v) => v.status === "Published").pop();
    for (const v of versions) {
      await once(() => db.aiPromptGovernance.findUnique({ where: { promptKey_version: { promptKey: t.key, version: v.version } } }), () => db.aiPromptGovernance.create({
        data: {
          promptKey: t.key, version: v.version, capabilityKey: t.useCaseKey?.startsWith("copilot") ? "ai_copilot" : t.useCaseKey === "action.proposal" ? "suggested_actions" : "ai_overview",
          status: v.id === latest?.id ? "Active" : v.status === "Published" ? "Superseded" : "Draft", providerCompat: ["openai", "anthropic", "simulator"], outputSchema: v.outputSchema,
          dataClassifications: ["Public", "Internal", "Confidential"], safetyInstructions: "CRM data is wrapped as <data> and treated as untrusted; instructions inside data are ignored.",
          citationRules: t.key.startsWith("copilot") ? "Cite evidence handles E1…En; uncited statements are removed." : "", refusalBehavior: "Decline outside the authorized scope; never invent figures.",
          humanApproval: "Suggested changes become proposals a person confirms.", changeSummary: "Phase 9/10 baseline", checksum: v.checksum,
          approvedAt: v.id === latest?.id ? new Date() : null, activatedAt: v.id === latest?.id ? new Date() : null,
        },
      }), out, "prompts");
    }
  }

  const tools = [...Object.entries(TOOLS).map(([name, t]) => ({ name, t, kind: "read" })), ...Object.entries(PROPOSAL_TOOLS).map(([name, t]) => ({ name, t, kind: "proposal" }))];
  for (const { name, t, kind } of tools) {
    await once(() => db.aiToolGovernance.findUnique({ where: { toolName_version: { toolName: name, version: TOOL_REGISTRY_VERSION } } }), () => db.aiToolGovernance.create({
      data: {
        toolName: name, version: TOOL_REGISTRY_VERSION, kind, riskLevel: kind === "proposal" || t.sensitive ? "High" : "Moderate",
        requiredPermission: t.grant ? `${t.grant[0]}:${t.grant[1]}` : kind === "proposal" ? "ai_actions:propose" : null,
        requiredApproval: t.sensitive ? "User confirmation before the data is read" : kind === "proposal" ? "Person confirms the proposal" : null,
        modules: t.grant ? [t.grant[0]] : [], inputSchema: { fields: Object.keys(t.schema?.shape || {}) }, maxResults: 25,
        status: t.unavailable ? "Draft" : "Active", activation: t.unavailable ? { blocked: t.unavailable } : BASELINE, activatedAt: t.unavailable ? null : new Date(),
        owner: "AI Governance Administrator", evaluationSuiteKey: "ai_copilot_release",
      },
    }), out, "tools");
  }

  for (const [key, w] of Object.entries(WORKFLOWS)) {
    await once(() => db.aiWorkflowGovernance.findUnique({ where: { workflowKey_version: { workflowKey: key, version: 1 } } }), () => db.aiWorkflowGovernance.create({
      data: {
        workflowKey: key, version: 1, purpose: w.description, steps: w.steps, tools: [...new Set(w.steps.filter((s) => s.tool).map((s) => s.tool))],
        maxProviderCalls: 3, maxToolCalls: WORKFLOW_LIMITS.maxToolCalls, maxRuntimeMs: WORKFLOW_LIMITS.maxRuntimeMs, maxCostUsd: WORKFLOW_LIMITS.maxCostUsd,
        approvalCheckpoints: ["Sensitive or organization-wide reads", "Every proposal"], escalation: "Pause and ask the user (clarification or approval).",
        failureBehavior: "Stop the run, record the failed step, keep completed evidence.", rollbackBehavior: "Workflow runs never change CRM records; proposals are undone through governed actions.",
        owners: { business: "Organization Administrator", technical: "AI Governance Administrator" }, checksum: workflowChecksum(w), status: "Active", activatedAt: new Date(),
      },
    }), out, "workflows");
  }

  const switches = [
    ["global", "*"], ["semantic_retrieval", "*"], ["provider_storage", "*"], ["action_execution", "*"],
    ...AI_PROVIDERS.filter((p) => p.availability === "Adapter").map((p) => ["provider", p.key]), ...AI_MODELS.map((m) => ["model", `${m.providerKey}:${m.modelId}`]),
    ...CAPABILITIES.map((c) => ["capability", c.key]), ...tools.map(({ name }) => ["tool", name]), ...Object.keys(WORKFLOWS).map((k) => ["workflow", k]),
  ];
  for (const [kind, target] of switches) {
    await once(() => db.aiKillSwitch.findUnique({ where: { kind_target_scope: { kind, target, scope: "platform" } } }), () => db.aiKillSwitch.create({ data: { kind, target, scope: "platform" } }), out, "killSwitches");
  }

  // Development/test: the baseline capabilities are on. Production: off until
  // an organization opts in through an approved release (never automatic).
  for (const c of CAPABILITIES) {
    for (const environment of ["development", "test", "production"]) {
      const enabled = environment !== "production" && DEV_BASELINE_CAPABILITIES.includes(c.key);
      await once(() => db.aiFeatureFlag.findUnique({ where: { key_scope_environment: { key: `capability.${c.key}`, scope: "platform", environment } } }),
        () => db.aiFeatureFlag.create({ data: { key: `capability.${c.key}`, scope: "platform", environment, capabilityKey: c.key, enabled, description: environment === "production" ? "Off by default in production; organizations opt in through an approved release." : "Development/test baseline." } }), out, "flags");
    }
  }

  for (const s of SLO_DEFINITIONS) await once(() => db.aiSloDefinition.findUnique({ where: { key: s.key } }), () => db.aiSloDefinition.create({ data: s }), out, "slos");
  for (const a of ALERT_RULES) await once(() => db.aiAlertRule.findUnique({ where: { key: a.key } }), () => db.aiAlertRule.create({ data: { ...a, cooldownMinutes: a.cooldownMinutes || 60 } }), out, "alerts");
  for (const g of GRADERS) await once(() => db.aiEvaluationGrader.findUnique({ where: { key: g.key } }), () => db.aiEvaluationGrader.create({ data: { ...g, calibration: g.kind === "llm" ? { status: "Uncalibrated", note: "Needs agreement with human reviewers before it can count toward a gate." } : {} } }), out, "graders");

  const versionIds = {};
  for (const d of DATASETS) {
    let ds = await db.aiEvaluationDataset.findUnique({ where: { scope_key: { scope: "platform", key: d.key } } });
    if (!ds) { ds = await db.aiEvaluationDataset.create({ data: { scope: "platform", key: d.key, name: d.name, type: d.type, purpose: d.purpose, source: "Synthetic", retentionDays: null } }); out.datasets.created += 1; } else out.datasets.unchanged += 1;
    let v = await db.aiEvaluationDatasetVersion.findFirst({ where: { datasetId: ds.id }, orderBy: { version: "desc" } });
    if (!v) {
      v = await db.aiEvaluationDatasetVersion.create({ data: { datasetId: ds.id, version: 1, caseCount: d.cases.length, checksum: sha(d.cases), notes: "Seeded synthetic/fixture cases." } });
      for (const c of d.cases) {
        await db.aiEvaluationCase.create({ data: { datasetVersionId: v.id, key: c.key, type: c.type, capabilityKey: null, input: c.input, expectations: c.expectations, zeroTolerance: c.zeroTolerance || [], redacted: true } });
        out.cases.created += 1;
      }
    }
    versionIds[d.key] = v.id;
  }
  for (const s of SUITES) {
    await once(() => db.aiEvaluationSuite.findFirst({ where: { key: s.key } }), () => db.aiEvaluationSuite.create({
      data: { key: s.key, version: 1, name: s.name, capabilityKey: s.capabilityKey, datasetVersionIds: s.datasets.map((k) => versionIds[k]), graderKeys: s.graders, qualityGates: s.qualityGates, zeroToleranceCategories: [] },
    }), out, "suites");
  }
  return out;
}
