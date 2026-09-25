// Backend Phase 13 — dependency vulnerability, license and SBOM tooling.
//
//   node scripts/security/dependencyScan.js audit <dir>   → normalized npm audit report
//   node scripts/security/dependencyScan.js sbom <dir> <out.json>  → CycloneDX SBOM + summary
//   node scripts/security/dependencyScan.js licenses <dir>          → license-policy report
//
// npm audit covers GitHub advisories, including packages flagged as
// malware. The container-image scan (Trivy) and image SBOM (Syft) run in CI
// and on the build host where those tools exist (see .github/workflows/security.yml).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (args, cwd) => spawnSync(npmCmd, args, { cwd, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });

// npm audit v2 JSON → normalized findings.
export function normalizeAudit(json, target) {
  const vulns = json?.vulnerabilities || {};
  const findings = [];
  for (const [name, v] of Object.entries(vulns)) {
    const advisories = (v.via || []).filter((x) => typeof x === "object");
    if (!advisories.length) continue; // transitive-only entries are reported under the advisory's package
    for (const a of advisories) {
      findings.push({
        id: a.url || a.source || `${name}-${a.title}`, category: /malware|malicious/i.test(a.title || "") ? "malicious_package" : "dependency",
        title: a.title || `Vulnerability in ${name}`, severity: a.severity || v.severity, component: name,
        installedVersion: v.range || null, fixedVersion: typeof v.fixAvailable === "object" ? `${v.fixAvailable.name}@${v.fixAvailable.version}` : v.fixAvailable ? "available" : null,
      });
    }
  }
  return { scanner: "npm-audit", target: `dependency:${target}`, category: "dependency", findings };
}

export function auditReport(dir) {
  const r = run(["audit", "--omit=dev", "--json"], dir);
  let json = {};
  try { json = JSON.parse(r.stdout || "{}"); } catch { json = {}; }
  if (json.error) return { scanner: "npm-audit", target: `dependency:${path.basename(dir)}`, category: "dependency", error: json.error.summary || "npm audit failed", findings: [] };
  return normalizeAudit(json, path.basename(dir) === "server" ? "server" : "web");
}

// CycloneDX 1.5 from package-lock.json: the exact resolved production
// dependency set (name, version, purl, license, integrity hash). Used when
// `npm sbom` refuses a tree with unrelated peer/optional warnings.
export function sbomFromLock(dir) {
  const lock = JSON.parse(fs.readFileSync(path.join(dir, "package-lock.json"), "utf8"));
  const root = lock.packages?.[""] || {};
  const components = [];
  for (const [p, meta] of Object.entries(lock.packages || {})) {
    if (!p || meta.dev || meta.devOptional || meta.link) continue;
    const name = meta.name || p.replace(/^.*node_modules\//, "");
    if (!meta.version) continue;
    const purl = `pkg:npm/${name.startsWith("@") ? name.replace("@", "%40") : name}@${meta.version}`;
    const c = { type: "library", "bom-ref": `${purl}#${p}`, name, version: meta.version, purl };
    if (meta.license) c.licenses = [{ license: /^[A-Za-z0-9.+-]+$/.test(meta.license) ? { id: meta.license } : { name: meta.license } }];
    const m = String(meta.integrity || "").match(/^(sha512|sha384|sha256|sha1)-(.+)$/);
    if (m) c.hashes = [{ alg: m[1].toUpperCase().replace("SHA", "SHA-"), content: Buffer.from(m[2], "base64").toString("hex") }];
    components.push(c);
  }
  return {
    bomFormat: "CycloneDX", specVersion: "1.5", serialNumber: `urn:uuid:${crypto.randomUUID()}`, version: 1,
    metadata: { timestamp: new Date().toISOString(), tools: [{ vendor: "Caspira", name: "lockfile-sbom", version: "1" }], component: { type: "application", name: root.name || path.basename(dir), version: root.version || "0.0.0" } },
    components,
  };
}

export function sbom(dir, outFile) {
  const r = run(["sbom", "--sbom-format", "cyclonedx", "--omit", "dev", "--sbom-type", "application"], dir);
  let text; let generator = "npm sbom";
  if (r.status === 0) text = r.stdout;
  else { text = JSON.stringify(sbomFromLock(dir), null, 2); generator = "lockfile-sbom (npm sbom rejected the installed tree)"; }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, text);
  const doc = JSON.parse(text);
  return { component: path.basename(dir) === "server" ? "api" : "web", format: "CycloneDX", specVersion: doc.specVersion, componentCount: (doc.components || []).length, sha256: crypto.createHash("sha256").update(text).digest("hex"), location: outFile, generator, generatedAt: new Date().toISOString() };
}

// Production dependencies under strong-copyleft or unknown licenses are flagged for review.
const DENY = /\b(AGPL|GPL-[23]|SSPL|BUSL|Commons-Clause)\b/i;
export function licenseReport(dir) {
  const lock = JSON.parse(fs.readFileSync(path.join(dir, "package-lock.json"), "utf8"));
  const findings = [];
  for (const [p, meta] of Object.entries(lock.packages || {})) {
    if (!p || meta.dev || meta.devOptional) continue;
    const license = meta.license || null;
    const name = p.replace(/^.*node_modules\//, "");
    if (!license) findings.push({ id: `license-unknown:${name}`, category: "license", severity: "Low", title: `No declared license for ${name}`, component: name, installedVersion: meta.version });
    else if (DENY.test(license) && !/LGPL/.test(license)) findings.push({ id: `license-deny:${name}`, category: "license", severity: "Medium", title: `License ${license} needs legal review for ${name}`, component: name, installedVersion: meta.version });
  }
  return { scanner: "license-policy", target: `dependency-license:${path.basename(dir)}`, category: "license", findings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, dir = ".", out] = process.argv.slice(2);
  const abs = path.resolve(dir);
  if (cmd === "audit") console.log(JSON.stringify(auditReport(abs), null, 2));
  else if (cmd === "sbom") console.log(JSON.stringify(sbom(abs, path.resolve(out || "sbom.cdx.json")), null, 2));
  else if (cmd === "licenses") console.log(JSON.stringify(licenseReport(abs), null, 2));
  else { console.error("usage: dependencyScan.js audit|sbom|licenses <dir> [out]"); process.exitCode = 2; }
}
