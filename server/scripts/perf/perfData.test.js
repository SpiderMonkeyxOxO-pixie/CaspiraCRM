import { describe, it, expect } from "vitest";
import { createRng, hashSeed } from "./rng.js";
import { PROFILES, getProfile, profileTotals, tierVolumes } from "./profiles.js";
import { buildOrganization, organizationsFor, PERF_EMAIL_DOMAIN } from "./plan.js";
import { assertPerfTarget, databaseName } from "./guard.js";

const dev = getProfile("developer");
const roleIds = { admin: "r-admin", user: "r-user", team_leader: "r-tl", checker: "r-ch", executive: "r-ex", finance_manager: "r-fm", accountant: "r-ac", ai_governance_admin: "r-ai" };
const build = (index, seed = "s1") => buildOrganization({ seed, profile: dev, index, roleIds, passwordHash: "hash" });

describe("seeded random numbers", () => {
  it("are reproducible and differ between seeds", () => {
    const a = createRng(hashSeed("x")), b = createRng(hashSeed("x")), c = createRng(hashSeed("y"));
    const seqA = Array.from({ length: 5 }, a.next), seqB = Array.from({ length: 5 }, b.next), seqC = Array.from({ length: 5 }, c.next);
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });
});

describe("benchmark dataset", () => {
  it("the same seed builds exactly the same rows", () => {
    expect(JSON.stringify(build(0))).toEqual(JSON.stringify(build(0)));
    expect(JSON.stringify(build(0, "s2"))).not.toEqual(JSON.stringify(build(0)));
  });

  it("matches the profile volumes and spreads tenants from large to small", () => {
    const orgs = organizationsFor(dev).map(({ index }) => build(index));
    const large = orgs[0].rows, small = orgs[1].rows;
    expect(large.user).toHaveLength(tierVolumes(dev.tiers[0]).members);
    expect(large.lead).toHaveLength(tierVolumes(dev.tiers[0]).leads);
    expect(large.lead.length).toBeGreaterThan(small.lead.length * 10);
    expect(orgs.map((o) => o.tier)).toEqual(["large", "small", "small"]);
  });

  it("keeps every record inside its own organization", () => {
    for (const { index } of organizationsFor(dev)) {
      const { organizationId, rows } = build(index);
      for (const [table, list] of Object.entries(rows)) {
        if (["organization", "user", "membershipRole"].includes(table)) continue;
        for (const row of list) expect(row.organizationId, table).toBe(organizationId);
      }
      // Every reference points at a record of the same organization (ids carry the org slug).
      const slug = organizationId.replace(/-org-0$/, "");
      for (const d of rows.deal) for (const ref of [d.companyId, d.primaryContactId, d.pipelineStageId, d.ownerMembershipId]) if (ref) expect(ref.startsWith(slug)).toBe(true);
    }
  });

  it("contains no real personal data: reserved email domain, fictional phone numbers", () => {
    const { rows } = build(0);
    const emails = [...rows.user, ...rows.contact, ...rows.lead].map((r) => r.email);
    expect(emails.every((e) => e.endsWith(`.${PERF_EMAIL_DOMAIN}`))).toBe(true);
    expect([...rows.contact, ...rows.lead].every((r) => /^\+1-202-555-01\d\d$/.test(r.phone))).toBe(true);
    expect(rows.user.every((u) => u.passwordHash === "hash")).toBe(true);
  });

  it("is realistic, not uniform: mixed states, archived records, skewed owners, duplicates", () => {
    const { rows } = build(0);
    expect(new Set(rows.lead.map((l) => l.status)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(rows.deal.map((d) => d.status)).size).toBeGreaterThanOrEqual(3);
    const archived = rows.lead.filter((l) => l.archived).length / rows.lead.length;
    expect(archived).toBeGreaterThan(0.02);
    expect(archived).toBeLessThan(0.15);
    const perOwner = {};
    for (const l of rows.lead) perOwner[l.ownerMembershipId] = (perOwner[l.ownerMembershipId] || 0) + 1;
    const counts = Object.values(perOwner).sort((a, b) => b - a);
    expect(counts[0]).toBeGreaterThan(counts[counts.length - 1] * 3);
    const emails = rows.contact.map((c) => c.normalizedEmail);
    expect(new Set(emails).size).toBeLessThan(emails.length); // duplicate candidates exist
    const years = new Set(rows.lead.map((l) => l.createdAt.getUTCFullYear()));
    expect(years.size).toBeGreaterThanOrEqual(2);
  });

  it("gives members a mix of roles, with the first member as administrator", () => {
    const { rows } = build(0);
    expect(rows.membershipRole[0].roleId).toBe("r-admin");
    expect(new Set(rows.membershipRole.map((r) => r.roleId)).size).toBeGreaterThanOrEqual(4);
  });

  it("the initial-production profile targets 1,000–10,000 accounts", () => {
    const totals = profileTotals("initial-production");
    expect(totals.members).toBeGreaterThanOrEqual(1000);
    expect(totals.members).toBeLessThanOrEqual(10000);
    expect(totals.organizations).toBe(40);
    expect(Object.keys(PROFILES)).toEqual(["developer", "initial-production", "growth"]);
  });
});

describe("environment guard", () => {
  const ok = { PERF_TARGET: "staging", DATABASE_URL: "postgresql://u:p@db:5432/caspira_staging", PERF_DATABASE_CONFIRM: "caspira_staging" };

  it("accepts a confirmed benchmark database", () => {
    expect(assertPerfTarget(ok)).toEqual({ target: "staging", database: "caspira_staging" });
    expect(databaseName("postgresql://u:p@h:5432/caspira_perf?schema=public")).toBe("caspira_perf");
  });

  it("refuses production, unnamed or unconfirmed targets", () => {
    expect(() => assertPerfTarget({ ...ok, PERF_TARGET: "production" })).toThrow(/never runs against production/);
    expect(() => assertPerfTarget({ ...ok, PERF_TARGET: undefined })).toThrow(/Set PERF_TARGET/);
    expect(() => assertPerfTarget({ ...ok, DATABASE_URL: "postgresql://u:p@db:5432/caspira_crm", PERF_DATABASE_CONFIRM: "caspira_crm" })).toThrow(/doesn't look like a benchmark database/);
    expect(() => assertPerfTarget({ ...ok, PERF_DATABASE_CONFIRM: "other" })).toThrow(/PERF_DATABASE_CONFIRM=caspira_staging/);
  });

  it("allows breakpoint runs only in an isolated environment", () => {
    expect(() => assertPerfTarget(ok, { requireIsolated: true })).toThrow(/PERF_TARGET=isolated/);
    expect(assertPerfTarget({ ...ok, PERF_TARGET: "isolated" }, { requireIsolated: true }).target).toBe("isolated");
  });
});

describe("generated rows fit the database schema", () => {
  it("uses only columns that exist on each model", async () => {
    const fs = await import("node:fs");
    const lines = fs.readFileSync("prisma/schema.prisma", "utf8").replace(/\r\n/g, "\n").split("\n");
    const fieldsOf = (model) => {
      const start = lines.findIndex((l) => l.startsWith(`model ${model} {`));
      const out = new Set();
      for (let i = start + 1; i < lines.length && !lines[i].startsWith("}"); i++) {
        const name = lines[i].trim().split(/\s+/)[0];
        if (name && !name.startsWith("//") && !name.startsWith("@@")) out.add(name);
      }
      return out;
    };
    const { rows } = build(0);
    for (const [table, list] of Object.entries(rows)) {
      const model = table[0].toUpperCase() + table.slice(1);
      const fields = fieldsOf(model);
      expect(fields.size, model).toBeGreaterThan(0);
      const unknown = [...new Set(list.flatMap(Object.keys))].filter((k) => !fields.has(k));
      expect(unknown, model).toEqual([]);
    }
  });
});
