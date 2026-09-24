// Idempotent provider catalog seed: creates missing providers and refreshes
// changed definitions. Never touches connections or credentials (the
// catalog holds none). Safe to run on every deploy.
import { PROVIDER_CATALOG } from "./catalog.js";

const fields = (p) => ({
  name: p.name, category: p.category, description: p.description, icon: p.icon || p.key, apiVersion: p.apiVersion || null, authType: p.authType,
  ownershipTypes: p.ownershipTypes || [], capabilities: p.capabilities || [], requiredScopes: p.requiredScopes || [], optionalScopes: p.optionalScopes || [],
  webhookSupport: !!p.webhookSupport, incrementalSync: !!p.incrementalSync, sandboxSupport: !!p.sandboxSupport, docsUrl: p.docsUrl || null, statusPageUrl: p.statusPageUrl || null,
  dataCategories: p.dataCategories || [], sensitiveWarning: p.sensitiveWarning || null, availability: p.availability, availabilityReason: p.availabilityReason || null,
  adapterVersion: p.adapterVersion || null, protocol: p.protocol || {},
});

// JSONB reorders object keys, so compare with keys sorted.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && !(value instanceof Date)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

export async function seedProviderCatalog(db) {
  const existing = new Map((await db.integrationProvider.findMany()).map((p) => [p.key, p]));
  let created = 0;
  let updated = 0;
  for (const p of PROVIDER_CATALOG) {
    const data = fields(p);
    const row = existing.get(p.key);
    if (!row) {
      await db.integrationProvider.create({ data: { key: p.key, ...data } });
      created += 1;
    } else if (Object.keys(data).some((k) => canonical(row[k]) !== canonical(data[k]))) {
      // `active` is the System Owner's switch and is never overwritten here.
      await db.integrationProvider.update({ where: { key: p.key }, data });
      updated += 1;
    }
  }
  return { total: PROVIDER_CATALOG.length, created, updated, unchanged: PROVIDER_CATALOG.length - created - updated };
}
