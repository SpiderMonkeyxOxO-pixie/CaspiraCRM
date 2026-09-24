// Backend Phase 9 — idempotent seed of the AI catalog (platform data only;
// organization settings are created lazily with safe defaults). Published
// prompt-template versions are immutable: a changed text needs a new
// version number, and a mismatch is reported, never overwritten.
import crypto from "node:crypto";
import { canonical } from "../integrations/providers/catalogSeed.js";
import { AI_PROVIDERS, AI_MODELS, PROMPT_TEMPLATES, DEFAULT_PRICE_TABLES, EVALUATION_SCENARIOS } from "./catalog.js";

export const templateChecksum = (v) => crypto.createHash("sha256").update(canonical({ system: v.system, userTemplate: v.userTemplate, outputSchema: v.outputSchema || null })).digest("hex");

export async function seedAiCatalog(db) {
  const out = { providers: { created: 0, updated: 0 }, models: { created: 0, updated: 0 }, templates: { created: 0, unchanged: 0, conflicts: [] }, priceTables: { created: 0 }, scenarios: { created: 0 } };

  for (const p of AI_PROVIDERS) {
    const data = {
      name: p.name, description: p.description, authType: p.authType, capabilities: p.capabilities || [], availability: p.availability,
      availabilityReason: p.availabilityReason || null, dataRetentionNote: p.dataRetentionNote || null, docsUrl: p.docsUrl || null,
      dataPolicyUrl: p.dataPolicyUrl || null, adapterVersion: p.adapterVersion || null, enabledByDefault: p.enabledByDefault !== false,
    };
    const existing = await db.aiProvider.findUnique({ where: { key: p.key } });
    if (!existing) { await db.aiProvider.create({ data: { key: p.key, ...data } }); out.providers.created += 1; continue; }
    const current = Object.fromEntries(Object.keys(data).map((k) => [k, existing[k]]));
    if (canonical(current) !== canonical(data)) { await db.aiProvider.update({ where: { key: p.key }, data }); out.providers.updated += 1; }
  }

  for (const m of AI_MODELS) {
    const data = { displayName: m.displayName, capabilities: m.capabilities, contextWindow: m.contextWindow ?? null, maxOutputTokens: m.maxOutputTokens ?? null };
    const existing = await db.aiModel.findUnique({ where: { providerKey_modelId: { providerKey: m.providerKey, modelId: m.modelId } } });
    if (!existing) { await db.aiModel.create({ data: { providerKey: m.providerKey, modelId: m.modelId, ...data } }); out.models.created += 1; continue; }
    const current = Object.fromEntries(Object.keys(data).map((k) => [k, existing[k]]));
    if (canonical(current) !== canonical(data)) { await db.aiModel.update({ where: { id: existing.id }, data }); out.models.updated += 1; }
  }

  for (const t of PROMPT_TEMPLATES) {
    const template = await db.aiPromptTemplate.upsert({ where: { key: t.key }, update: { description: t.description, useCaseKey: t.useCaseKey }, create: { key: t.key, useCaseKey: t.useCaseKey, description: t.description } });
    for (const v of t.versions) {
      const checksum = templateChecksum(v);
      const existing = await db.aiPromptTemplateVersion.findUnique({ where: { templateId_version: { templateId: template.id, version: v.version } } });
      if (!existing) {
        await db.aiPromptTemplateVersion.create({ data: { templateId: template.id, version: v.version, system: v.system, userTemplate: v.userTemplate, outputSchema: v.outputSchema || null, status: "Published", checksum, publishedAt: new Date() } });
        out.templates.created += 1;
      } else if (existing.checksum !== checksum) out.templates.conflicts.push(`${t.key} v${v.version}`);
      else out.templates.unchanged += 1;
    }
  }

  for (const table of DEFAULT_PRICE_TABLES) {
    const existing = await db.aiPriceTable.findFirst({ where: { organizationId: null, providerKey: table.providerKey, version: table.version } });
    if (existing) continue;
    await db.aiPriceTable.updateMany({ where: { organizationId: null, providerKey: table.providerKey, status: "Active" }, data: { status: "Superseded" } });
    const created = await db.aiPriceTable.create({ data: { organizationId: null, providerKey: table.providerKey, version: table.version, currency: table.currency, unit: table.unit, effectiveFrom: new Date(), sourceNote: table.sourceNote, status: "Active" } });
    for (const e of table.entries) await db.aiPriceEntry.create({ data: { priceTableId: created.id, modelId: e.modelId, inputPrice: e.inputPrice, outputPrice: e.outputPrice, cachedInputPrice: e.cachedInputPrice } });
    out.priceTables.created += 1;
  }

  for (const s of EVALUATION_SCENARIOS) {
    const existing = await db.aiEvaluationScenario.findFirst({ where: { organizationId: null, name: s.name } });
    if (existing) continue;
    await db.aiEvaluationScenario.create({ data: { organizationId: null, useCaseKey: s.useCaseKey, name: s.name, input: s.input, expectations: s.expectations } });
    out.scenarios.created += 1;
  }
  return out;
}
