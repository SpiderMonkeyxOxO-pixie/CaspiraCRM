// Backend Phase 13 — repository security policy checks (no network).
//
//   node scripts/security/policyCheck.js [--json]
//
// Dockerfiles: pinned base images (version AND digest), non-root final user,
//   no ADD from URLs, no secret-looking build arguments, a HEALTHCHECK.
// Production Compose: no privileged containers, no Docker socket, no host
//   network/PID, only the proxy publishes ports, internal data networks,
//   cap_drop ALL + no-new-privileges, read-only roots for app containers,
//   resource and log limits, images from variables pinned by digest.
// Env templates: image references pinned by digest, no secret values.
// package.json: no floating/unpinned production dependency specs, lockfiles present.
// Repository: no unexpected executables or binary artifacts tracked.
// Output is a normalized scan report (see src/platform/findings.js).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const rel = (p) => path.relative(REPO, p).replace(/\\/g, "/");
const DIGEST = /@sha256:[a-f0-9]{64}$/;

export function checkDockerfile(file, text) {
  const out = [];
  const add = (severity, id, title) => out.push({ id: `${id}:${rel(file)}`, category: "dockerfile", severity, title, component: rel(file) });
  const lines = text.split(/\r?\n/);
  const args = Object.fromEntries(lines.map((l) => l.match(/^ARG\s+([A-Z_]+)=(.+)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
  const stages = lines.filter((l) => /^FROM\s/i.test(l));
  if (!stages.length) add("High", "no-from", "Dockerfile has no FROM instruction.");
  for (const l of stages) {
    let image = l.split(/\s+/)[1];
    const m = image.match(/^\$\{([A-Z_]+)\}$/);
    if (m) image = args[m[1]] || image;
    const isStage = stages.some((s) => new RegExp(`\\bAS\\s+${image}\\b`, "i").test(s));
    if (isStage) continue;
    if (/:latest(@|$)/.test(image) || !image.includes(":")) add("High", "floating-base", `Base image ${image} uses a floating tag.`);
    else if (!DIGEST.test(image)) add("Medium", "unpinned-base", `Base image ${image} is not pinned by digest.`);
  }
  const lastFrom = lines.map((l, i) => (/^FROM\s/i.test(l) ? i : -1)).filter((i) => i >= 0).pop() ?? 0;
  const finalStage = lines.slice(lastFrom);
  const user = finalStage.filter((l) => /^USER\s/i.test(l)).pop();
  if (!user) add("High", "root-user", "The final stage has no USER (runs as root).");
  else if (/^USER\s+(root|0)(:|\s|$)/i.test(user)) add("High", "root-user", "The final stage runs as root.");
  if (lines.some((l) => /^ADD\s+https?:\/\//i.test(l))) add("Medium", "add-url", "ADD from a URL (unverified download).");
  for (const l of lines) {
    const m = l.match(/^(ARG|ENV)\s+([A-Z0-9_]*(PASSWORD|SECRET|TOKEN|PRIVATE_KEY|API_KEY|CREDENTIAL)[A-Z0-9_]*)/i);
    if (m) add("Critical", "secret-arg", `${m[1]} ${m[2]} looks like a secret in the image or build arguments.`);
  }
  if (!finalStage.some((l) => /^HEALTHCHECK\s/i.test(l)) && !/migrator/.test(text.slice(-400))) add("Low", "no-healthcheck", "No HEALTHCHECK in the final stage.");
  if (lines.some((l) => /COPY\s+.*\.env(\s|$)/.test(l) && !/\.env\.production/.test(l))) add("Critical", "env-copied", "An .env file is copied into the image.");
  return out;
}

const APP_SERVICES = ["api", "worker", "web", "proxy", "redis", "migrate", "prometheus"];
// Compose-style merge of layered files (the base plus an edge layer): mappings
// merge recursively; ports, volumes and secrets are appended.
export function mergeCompose(...docs) {
  const merge = (a, b, key) => {
    if (Array.isArray(a) && Array.isArray(b)) return ["ports", "volumes", "secrets"].includes(key) ? [...a, ...b] : b;
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      const out = { ...a };
      for (const [k, v] of Object.entries(b)) out[k] = k in a ? merge(a[k], v, k) : v;
      return out;
    }
    return b === undefined ? a : b;
  };
  return docs.reduce((acc, d) => merge(acc, d || {}), {});
}

// Published only on the host's loopback (reached through a local reverse proxy).
const loopbackOnly = (ports) => [].concat(ports || []).every((p) => /^127\.0\.0\.1:/.test(String(typeof p === "object" ? `${p.host_ip}:` : p)));

export function checkCompose(file, text, { production = true, doc: given = null } = {}) {
  const out = [];
  const add = (severity, id, title) => out.push({ id: `${id}:${rel(file)}`, category: "compose", severity, title, component: rel(file) });
  let doc = given;
  if (!doc) {
    try { doc = yaml.load(text); }
    catch (err) { add("Critical", "invalid-yaml", `Compose file doesn't parse: ${String(err.reason || err.message).slice(0, 120)} (line ${(err.mark?.line ?? -1) + 1}).`); return out; }
  }
  const services = doc?.services || {};
  const networks = doc?.networks || {};
  for (const [name, s] of Object.entries(services)) {
    const tag = `${name}`;
    if (s.privileged) add("Critical", `privileged-${tag}`, `Service ${name} is privileged.`);
    if (["host"].includes(s.network_mode)) add("Critical", `host-network-${tag}`, `Service ${name} uses the host network.`);
    if (s.pid === "host" || s.ipc === "host") add("Critical", `host-pid-${tag}`, `Service ${name} shares the host PID/IPC namespace.`);
    for (const v of [].concat(s.volumes || [])) {
      const src = typeof v === "string" ? v.split(":")[0] : v.source;
      if (/docker\.sock/.test(String(src))) add("Critical", `docker-socket-${tag}`, `Service ${name} mounts the Docker socket.`);
      if (String(src) === "/" || /^\/:/.test(String(v))) add("Critical", `host-root-${tag}`, `Service ${name} mounts the host root filesystem.`);
    }
    for (const c of [].concat(s.cap_add || [])) if (/SYS_ADMIN|NET_ADMIN|ALL|SYS_PTRACE|SYS_MODULE/.test(c)) add("High", `cap-add-${tag}`, `Service ${name} adds capability ${c}.`);
    if (!production) continue;
    if (s.ports && name !== "proxy" && !loopbackOnly(s.ports)) add("Critical", `published-${tag}`, `Internal service ${name} publishes ports beyond the host loopback.`);
    const img = String(s.image || "");
    if (/:latest(@|$)/.test(img)) add("High", `latest-${tag}`, `Service ${name} uses a latest tag.`);
    if (img && !img.startsWith("${") && !DIGEST.test(img.replace(/\}$/, ""))) add("High", `unpinned-${tag}`, `Service ${name} image isn't pinned by digest.`);
    if (!(s.cap_drop || []).includes("ALL")) add("High", `cap-drop-${tag}`, `Service ${name} doesn't drop all capabilities.`);
    if (!(s.security_opt || []).some((o) => /no-new-privileges(:true)?/.test(o))) add("High", `nnp-${tag}`, `Service ${name} lacks no-new-privileges.`);
    if (APP_SERVICES.includes(name) && s.read_only !== true) add("Medium", `read-only-${tag}`, `Service ${name} doesn't use a read-only root filesystem.`);
    if (!s.deploy?.resources?.limits?.memory && name !== "migrate") add("Medium", `limits-${tag}`, `Service ${name} has no memory limit.`);
    if (!s.deploy?.resources?.limits?.pids && name !== "migrate") add("Low", `pids-${tag}`, `Service ${name} has no PID limit.`);
    if (["api", "worker", "migrate"].includes(name) && !/^\d+(:\d+)?$/.test(String(s.user || "")) ) add("High", `user-${tag}`, `Service ${name} doesn't set a non-root user.`);
    if (String(s.user || "").split(":")[0] === "0") add("High", `root-${tag}`, `Service ${name} runs as root.`);
    if (!["migrate"].includes(name) && !s.logging && !text.includes("x-hardening")) add("Low", `logs-${tag}`, `Service ${name} has no log rotation.`);
    const env = s.environment || {};
    for (const [k, v] of Object.entries(Array.isArray(env) ? Object.fromEntries(env.map((e) => e.split("="))) : env)) {
      if (/(PASSWORD|SECRET|TOKEN|_KEY|_PASS)$/i.test(k) && v && !/^\$\{/.test(String(v))) add("Critical", `env-secret-${tag}-${k}`, `Service ${name} has a literal value for ${k}.`);
    }
  }
  if (production) {
    for (const n of ["data", "app"]) if (networks[n] && networks[n].internal !== true) add("High", `network-${n}`, `Network ${n} must be internal.`);
    for (const [name, s] of Object.entries(services)) {
      const nets = Array.isArray(s.networks) ? s.networks : Object.keys(s.networks || {});
      // The database may also join "backup" (outbound only, never published) so
      // archive_command can push WAL to the off-host repository.
      const allowedNets = name === "db" ? ["data", "backup"] : ["data"];
      if (["db", "redis"].includes(name) && nets.some((n) => !allowedNets.includes(n))) add("High", `db-network-${name}`, `${name} must be on the data network only${name === "db" ? " (plus the outbound-only backup network)" : ""}.`);
      if (name === "db" && [].concat(s.ports || []).length) add("Critical", "db-published", "The database must never publish a port.");
    }
  }
  return out;
}

export function checkEnvTemplate(file, text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (/_IMAGE$/.test(k) && v && !/<digest>/.test(v) && !DIGEST.test(v)) out.push({ id: `env-image-${k}:${rel(file)}`, category: "configuration", severity: "High", title: `${k} is not pinned by digest.`, component: rel(file) });
    if (/(PASSWORD|SECRET|TOKEN|PRIVATE_KEY)$/.test(k) && v) out.push({ id: `env-secret-${k}:${rel(file)}`, category: "secret", severity: "Critical", title: `${k} holds a value in an environment template.`, component: rel(file) });
  }
  return out;
}

export function checkPackage(file, json, lockExists) {
  const out = [];
  const add = (severity, id, title) => out.push({ id: `${id}:${rel(file)}`, category: "dependency", severity, title, component: rel(file) });
  if (!lockExists) add("High", "no-lock", "No package-lock.json: installs aren't reproducible.");
  for (const [name, spec] of Object.entries(json.dependencies || {})) {
    if (/^(\*|latest|x)$/i.test(spec) || spec === "") add("High", `floating-${name}`, `Production dependency ${name} uses "${spec}".`);
    if (/^(git|github:|https?:|file:)/.test(spec)) add("Medium", `source-${name}`, `Production dependency ${name} comes from ${spec.split(":")[0]} (not the registry).`);
  }
  return out;
}

// Tracked binaries/executables outside expected locations.
export function checkExecutables(files) {
  const out = [];
  for (const f of files) {
    if (/node_modules\//.test(f)) continue;
    if (/\.(exe|dll|so|dylib|bin|jar|class|pyc)$/i.test(f)) out.push({ id: `binary:${f}`, category: "configuration", severity: "Medium", title: `Unexpected binary tracked in the repository: ${f}`, component: f });
  }
  return out;
}

export function runPolicyChecks() {
  const findings = [];
  const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
  for (const df of ["server/Dockerfile", "Dockerfile.web", "deploy/production/postgres/Dockerfile"]) if (fs.existsSync(path.join(REPO, df))) findings.push(...checkDockerfile(path.join(REPO, df), read(df)));
  // Production Compose is layered: the core file plus exactly one edge layer.
  // Each combination is checked as Compose would merge it.
  const layer = (f) => `deploy/production/${f}`;
  for (const edge of ["compose.edge.yaml", "compose.aapanel.yaml"]) {
    const files = ["compose.yaml", edge].map(layer);
    let docs;
    try { docs = files.map((f) => yaml.load(read(f))); }
    catch (err) { findings.push({ id: `invalid-yaml:${files.join("+")}`, category: "compose", severity: "Critical", title: `Compose layers don't parse: ${String(err.reason || err.message).slice(0, 120)}`, component: files.join(" + ") }); continue; }
    findings.push(...checkCompose(path.join(REPO, layer(edge)), files.map(read).join("\n"), { production: true, doc: mergeCompose(...docs) }));
  }
  // Development compose: only the universal rules (no socket, not privileged).
  findings.push(...checkCompose(path.join(REPO, "docker-compose.yml"), read("docker-compose.yml"), { production: false }));
  for (const t of ["deploy/production/env/production.env.example", "deploy/production/env/staging.env.example", "deploy/production/env/aapanel-production.env.example", "deploy/production/env/backup-offsite.env.example", "deploy/production/env/backup-offsite.sftp.env.example"]) findings.push(...checkEnvTemplate(path.join(REPO, t), read(t)));
  for (const pkg of ["package.json", "server/package.json"]) findings.push(...checkPackage(path.join(REPO, pkg), JSON.parse(read(pkg)), fs.existsSync(path.join(REPO, path.dirname(pkg), "package-lock.json"))));
  let tracked = [];
  try { tracked = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean); } catch { tracked = []; }
  findings.push(...checkExecutables(tracked));
  return { scanner: "policy-check", target: "repository:dockerfile,compose,configuration", category: "configuration", findings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const report = runPolicyChecks();
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    for (const f of report.findings) console.log(`${f.severity.padEnd(9)} ${f.title}`);
    console.log(`${report.findings.length} finding(s).`);
  }
  process.exitCode = report.findings.some((f) => f.severity === "Critical") ? 1 : 0;
}
