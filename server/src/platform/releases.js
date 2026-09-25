// Backend Phase 13 — immutable release artifacts. A release is built once
// (deploy/production/scripts/build-release.sh), identified by its image
// digests, and promoted unchanged through staging and production. A release
// ID can never be re-registered with different content.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../lib/prisma.js";
import { PlatformError, currentEnvironment, platformAudit, toJson } from "./common.js";
import { CONFIG_SCHEMA_VERSION } from "../config/validate.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{7,40}$/;
const RELEASE_ID = /^[A-Za-z0-9._-]{3,80}$/;

export function knownMigrations() {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../prisma/migrations");
  // Any folder with a migration.sql (Prisma's rule), including 0001_baseline.
  try { return fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "migration.sql"))).sort(); } catch { return []; }
}

export function validateManifest(m) {
  const errors = [];
  if (!RELEASE_ID.test(String(m.releaseId || ""))) errors.push("releaseId must be 3–80 characters of letters, digits, dot, dash or underscore.");
  if (!m.version) errors.push("version is required.");
  if (!COMMIT.test(String(m.gitCommit || ""))) errors.push("gitCommit must be a git commit hash.");
  const images = m.images && typeof m.images === "object" ? m.images : {};
  if (!images.api) errors.push("images.api is required.");
  for (const [name, ref] of Object.entries(images)) {
    // Production is deployed by digest only: repository@sha256:…
    if (!/@sha256:[a-f0-9]{64}$/.test(String(ref))) errors.push(`images.${name} must be pinned by digest (repository@sha256:…), never a tag.`);
    if (/:latest(@|$)/.test(String(ref))) errors.push(`images.${name} must not use the latest tag.`);
  }
  if (!m.buildTimestamp || Number.isNaN(new Date(m.buildTimestamp).getTime())) errors.push("buildTimestamp is required.");
  if (!/^\d{14}_[a-z0-9_]+$/.test(String(m.migrationVersion || ""))) errors.push("migrationVersion must name the release's newest migration folder.");
  if (!Array.isArray(m.migrations) || !m.migrations.includes(m.migrationVersion)) errors.push("migrations must list every migration in the release, including migrationVersion.");
  if (m.configSchemaVersion !== undefined && !Number.isInteger(m.configSchemaVersion)) errors.push("configSchemaVersion must be an integer.");
  for (const s of [].concat(m.sboms || [])) if (!s.component || !/^[a-f0-9]{64}$/.test(String(s.sha256 || ""))) errors.push("Each SBOM needs component and sha256.");
  return errors;
}

export async function registerRelease(req, manifest) {
  const errors = validateManifest(manifest || {});
  if (errors.length) throw new PlatformError(422, "INVALID_MANIFEST", "The release manifest is invalid.", errors);
  const primaryImageDigest = String(manifest.images.api).split("@")[1];
  if (!DIGEST.test(primaryImageDigest)) throw new PlatformError(422, "INVALID_MANIFEST", "images.api digest is invalid.");
  const existing = await prisma.releaseArtifact.findUnique({ where: { releaseId: manifest.releaseId } });
  if (existing) {
    // Immutable: identical content is idempotent; different content is refused.
    const same = existing.primaryImageDigest === primaryImageDigest && existing.gitCommit === manifest.gitCommit && JSON.stringify(existing.images) === JSON.stringify(manifest.images);
    if (!same) {
      await platformAudit(req, "release.immutable_violation", "ReleaseArtifact", manifest.releaseId, { result: "Denied" });
      throw new PlatformError(409, "RELEASE_IMMUTABLE", "This release ID already exists with different content. Build a new release ID; never rebuild a different image under an existing release.");
    }
    return { release: existing, existing: true };
  }
  const release = await prisma.releaseArtifact.create({ data: {
    releaseId: manifest.releaseId, version: String(manifest.version).slice(0, 60), gitCommit: manifest.gitCommit, images: manifest.images, primaryImageDigest,
    buildTimestamp: new Date(manifest.buildTimestamp), migrationVersion: manifest.migrationVersion, sbomRef: manifest.sbomRef || null, scanRef: manifest.scanRef || null,
    testResultRef: manifest.testResultRef || null, testSummary: toJson({ ...(manifest.tests || {}), migrations: manifest.migrations }),
    configSchemaVersion: manifest.configSchemaVersion ?? CONFIG_SCHEMA_VERSION, releaseNotes: manifest.releaseNotes ? String(manifest.releaseNotes).slice(0, 10000) : null,
    rollbackCompatibleWith: [].concat(manifest.rollbackCompatibleWith || []), destructiveMigration: !!manifest.destructiveMigration,
    createdByUserId: req.user?.id || null, correlationId: req.correlationId,
  } });
  for (const s of [].concat(manifest.sboms || [])) {
    await prisma.sbomReference.create({ data: { releaseId: release.releaseId, component: String(s.component).slice(0, 60), format: String(s.format || "CycloneDX").slice(0, 40), specVersion: s.specVersion || null, componentCount: Number(s.componentCount) || 0, sha256: s.sha256, location: String(s.location || "release evidence").slice(0, 300), generator: String(s.generator || "unknown").slice(0, 80), generatedAt: new Date(s.generatedAt || manifest.buildTimestamp) } });
  }
  if (manifest.scans) {
    const { ingestScanReport } = await import("./findings.js");
    for (const scan of [].concat(manifest.scans)) await ingestScanReport(req, scan, { releaseId: release.releaseId });
  }
  await platformAudit(req, "release.registered", "ReleaseArtifact", release.releaseId, { after: { digest: primaryImageDigest, commit: manifest.gitCommit, migrationVersion: manifest.migrationVersion } });
  return { release, existing: false };
}

export async function approveRelease(req, releaseId, { decision = "approve", note } = {}) {
  const r = await prisma.releaseArtifact.findUnique({ where: { releaseId: String(releaseId) } });
  if (!r) throw new PlatformError(404, "NOT_FOUND", "Release not found.");
  if (r.status === "Revoked") throw new PlatformError(409, "REVOKED", "This release has been revoked.");
  if (r.createdByUserId && r.createdByUserId === req.user.id) throw new PlatformError(403, "SEPARATION_OF_DUTIES", "The person who registered a release can't approve it.");
  const approval = await prisma.releaseApproval.upsert({ where: { releaseId_environment_approverUserId: { releaseId: r.releaseId, environment: currentEnvironment(), approverUserId: req.user.id } }, update: { decision, note: note || null }, create: { releaseId: r.releaseId, environment: currentEnvironment(), approverUserId: req.user.id, decision, note: note || null, correlationId: req.correlationId } });
  if (decision === "approve" && r.status === "Registered") await prisma.releaseArtifact.update({ where: { id: r.id }, data: { status: "Approved" } });
  await platformAudit(req, `release.${decision === "approve" ? "approved" : "rejected"}`, "ReleaseArtifact", r.releaseId, { reason: note });
  return approval;
}

export const serializeRelease = (r) => toJson({ releaseId: r.releaseId, version: r.version, gitCommit: r.gitCommit, images: r.images, primaryImageDigest: r.primaryImageDigest, buildTimestamp: r.buildTimestamp, migrationVersion: r.migrationVersion, sbomRef: r.sbomRef, scanRef: r.scanRef, testResultRef: r.testResultRef, testSummary: r.testSummary, configSchemaVersion: r.configSchemaVersion, releaseNotes: r.releaseNotes, rollbackCompatibleWith: r.rollbackCompatibleWith, destructiveMigration: r.destructiveMigration, status: r.status, createdAt: r.createdAt });
