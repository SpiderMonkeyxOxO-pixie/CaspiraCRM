// Backend Phase 13 — secret scanner for tracked files (no network).
//
//   node scripts/security/secretScan.js [--json]
//
// Looks for private keys, cloud/provider tokens, JWTs, connection strings
// with passwords and high-entropy assignments to secret-named variables.
// Never prints the matched value: only file, line and rule. Allowed test
// fixtures are listed in .secretscan-allow (path:line or path glob).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const RULES = [
  { id: "private-key", severity: "Critical", re: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY( BLOCK)?-----/ },
  { id: "aws-access-key", severity: "Critical", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "openai-key", severity: "Critical", re: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { id: "anthropic-key", severity: "Critical", re: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/ },
  { id: "github-token", severity: "Critical", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/ },
  { id: "slack-token", severity: "Critical", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: "stripe-key", severity: "Critical", re: /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/ },
  { id: "google-api-key", severity: "High", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "jwt", severity: "High", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { id: "automation-token", severity: "Critical", re: /\bcpat_pat_[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}\b/ },
  { id: "url-password", severity: "High", re: /\b(postgres(ql)?|mysql|redis|mongodb(\+srv)?|amqp):\/\/[^:\s/]+:([^@\s]{6,})@/ , valueGroup: 4 },
  { id: "secret-assignment", severity: "High", re: /\b([A-Z0-9_]*(SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*[:=]\s*["']?([A-Za-z0-9+/_=.-]{20,})["']?/, valueGroup: 3 },
];

// Obvious placeholders and development values aren't secrets.
const PLACEHOLDER = /^(x+|0+|changeme|change-me|placeholder|example|dummy|test|your[-_].*|<.*>|\$\{.*\}|caspira_dev_password|dev-secret)$/i;
const entropy = (s) => { const f = {}; for (const c of s) f[c] = (f[c] || 0) + 1; return Object.values(f).reduce((h, n) => h - (n / s.length) * Math.log2(n / s.length), 0); };
const SKIP = /(^|\/)(node_modules|dist|\.git|screenshots)\/|\.(png|jpe?g|gif|pdf|ico|woff2?|ttf|lock|svg|map)$|package-lock\.json$/;

export function scanText(file, text, allow = new Set()) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (allow.has(`${file}:${i + 1}`)) return;
    if (/secretscan:allow/.test(line)) return;
    for (const r of RULES) {
      const m = line.match(r.re);
      if (!m) continue;
      const value = r.valueGroup ? m[r.valueGroup] : m[0];
      if (r.valueGroup && (PLACEHOLDER.test(value) || entropy(value) < 3.5 || /process\.env|\$\{/.test(line))) continue;
      // A *_FILE setting or an absolute path names where a secret lives, not the secret.
      if (r.valueGroup && (value.startsWith("/") || /_FILE$/.test(m[1] || ""))) continue;
      findings.push({ id: `${r.id}:${file}:${i + 1}`, category: "secret", severity: r.severity, title: `Possible secret (${r.id}) in ${file} line ${i + 1}`, component: file });
    }
  });
  return findings;
}

export function runSecretScan() {
  let files = [];
  try { files = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean); } catch { files = []; }
  const allowFile = path.join(REPO, ".secretscan-allow");
  const allowLines = fs.existsSync(allowFile) ? fs.readFileSync(allowFile, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")) : [];
  const allow = new Set(allowLines.filter((l) => /:\d+$/.test(l)));
  const allowPaths = allowLines.filter((l) => !/:\d+$/.test(l));
  const findings = [];
  for (const f of files) {
    if (SKIP.test(f) || allowPaths.some((p) => f.startsWith(p))) continue;
    const full = path.join(REPO, f);
    let text;
    try { const st = fs.statSync(full); if (st.size > 1_000_000) continue; text = fs.readFileSync(full, "utf8"); } catch { continue; }
    findings.push(...scanText(f, text, allow));
  }
  return { scanner: "secret-scan", target: "secret:repository", category: "secret", findings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const report = runSecretScan();
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else { for (const f of report.findings) console.log(`${f.severity.padEnd(9)} ${f.title}`); console.log(`${report.findings.length} possible secret(s).`); }
  process.exitCode = report.findings.some((f) => f.severity === "Critical") ? 1 : 0;
}
