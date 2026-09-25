import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { checkDockerfile, checkCompose, checkEnvTemplate, checkPackage, runPolicyChecks, mergeCompose, REPO } from "../../scripts/security/policyCheck.js";
import { scanText } from "../../scripts/security/secretScan.js";
import { normalizeAudit, sbomFromLock } from "../../scripts/security/dependencyScan.js";

const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
// Production Compose is layered: the core file plus one edge layer. Tests
// check each combination as Compose merges it.
const layer = (f) => yaml.load(read(`deploy/production/${f}`));
const core = layer("compose.yaml");
const standalone = mergeCompose(core, layer("compose.edge.yaml"));
const aapanel = mergeCompose(core, layer("compose.aapanel.yaml"));
const prodCompose = standalone;
const svc = standalone.services;
const VIEWS = { standalone, aapanel };

describe("production images", () => {
  const api = read("server/Dockerfile");
  it("run as a non-root user with version metadata and a health check", () => {
    const runtime = api.slice(api.indexOf("AS runtime"));
    expect(runtime).toMatch(/^USER node$/m);
    expect(runtime).toMatch(/org\.opencontainers\.image\.version="\$\{VERSION\}"/);
    expect(runtime).toMatch(/org\.opencontainers\.image\.revision="\$\{REVISION\}"/);
    expect(runtime).toMatch(/^HEALTHCHECK /m);
    expect(read("Dockerfile.web")).toMatch(/^USER 101$/m);
  });
  it("exclude development dependencies, package managers, tests and env files", () => {
    expect(api).toMatch(/AS prod-deps[\s\S]*npm ci --omit=dev/);
    const runtime = api.slice(api.indexOf("AS runtime"));
    expect(runtime).toMatch(/COPY --from=prod-deps .* \/app\/node_modules/);
    expect(runtime).not.toMatch(/COPY --from=build .*\/app\/node_modules \.\/node_modules$/m);
    expect(runtime).toMatch(/rm -rf \/usr\/local\/lib\/node_modules\/npm/);
    const ignore = read("server/.dockerignore");
    for (const p of [".env", ".env.*", "**/*.test.js", "*.pem", "*.key", "secrets"]) expect(ignore.split(/\r?\n/)).toContain(p);
    expect(read(".dockerignore")).toMatch(/^\.env$/m);
  });
  it("pin base images by version and digest, with no secret build arguments", () => {
    for (const f of ["server/Dockerfile", "Dockerfile.web", "deploy/production/postgres/Dockerfile"]) {
      const findings = checkDockerfile(path.join(REPO, f), read(f));
      expect(findings.filter((x) => ["Critical", "High", "Medium"].includes(x.severity))).toEqual([]);
    }
  });
  it("the Dockerfile checker catches insecure images", () => {
    const bad = "FROM node:latest\nARG DB_PASSWORD=secret\nADD https://example.com/x.sh /x.sh\nCOPY .env /app/.env\nUSER root\n";
    const titles = checkDockerfile("bad/Dockerfile", bad).map((f) => f.title).join("\n");
    expect(titles).toMatch(/floating tag/);
    expect(titles).toMatch(/looks like a secret/);
    expect(titles).toMatch(/ADD from a URL/);
    expect(titles).toMatch(/\.env file is copied/);
    expect(titles).toMatch(/runs as root/);
  });
});

describe("production compose topology", () => {
  it("the core layer publishes nothing; a standalone host publishes only the proxy", () => {
    expect(Object.values(core.services).some((s) => s.ports)).toBe(false);
    const published = Object.entries(svc).filter(([, s]) => s.ports).map(([n]) => n);
    expect(published).toEqual(["proxy"]);
    expect(svc.proxy.ports).toEqual(["80:8080", "443:8443"]);
  });
  it("on the aaPanel VPS only the api and Mailpit UI are published, on loopback only", () => {
    const published = Object.fromEntries(Object.entries(aapanel.services).filter(([, s]) => s.ports).map(([n, s]) => [n, s.ports]));
    expect(published).toEqual({ api: ["127.0.0.1:4010:4000"], mailpit: ["127.0.0.1:8026:8025"] });
    expect(aapanel.services.proxy).toBeUndefined();
    expect(aapanel.services.db.ports).toBeUndefined();
  });
  it("aaPanel images are built locally and never pulled by tag", () => {
    for (const name of ["api", "worker", "migrate", "db", "backup-agent"]) expect(aapanel.services[name].pull_policy, name).toBe("never");
  });
  it("never mounts the Docker socket, runs privileged or shares host namespaces", () => {
    for (const [view, doc] of Object.entries(VIEWS)) {
      for (const [name, s] of Object.entries(doc.services)) {
        expect(s.privileged, `${view}.${name}`).toBeFalsy();
        expect(s.network_mode, `${view}.${name}`).not.toBe("host");
        expect(JSON.stringify(s.volumes || [])).not.toMatch(/docker\.sock/);
      }
    }
  });
  it("drops all capabilities, forbids privilege escalation and sets resource limits", () => {
    for (const [view, doc] of Object.entries(VIEWS)) {
      for (const [name, s] of Object.entries(doc.services)) {
        expect(s.cap_drop, `${view}.${name}`).toContain("ALL");
        expect((s.security_opt || []).join(), `${view}.${name}`).toMatch(/no-new-privileges/);
        if (name !== "migrate") expect(s.deploy?.resources?.limits?.memory, `${view}.${name}`).toBeTruthy();
      }
    }
  });
  it("the database pushes WAL off-host: backup network, passphrase and (aaPanel) pinned SFTP host key", () => {
    expect(core.services.db.networks).toEqual(["data", "backup"]);
    expect(core.services.db.environment.OFFSITE_ENABLED).toMatch(/BACKUP_OFFSITE_ENABLED/);
    expect(core.services.db.secrets.map((s) => s.source)).toContain("backup_offsite_credentials");
    for (const name of ["db", "backup-agent"]) {
      expect(aapanel.services[name].secrets.map((s) => s.source), name).toContain("backup_offsite_sftp_key");
      expect(aapanel.services[name].volumes, name).toContain("./env/offsite_known_hosts:/etc/caspira/offsite_known_hosts:ro");
    }
  });
  it("OAuth callbacks and webhooks use the public api URL", () => {
    expect(core["x-app-env"].INTEGRATIONS_PUBLIC_API_URL).toBe("${PUBLIC_API_URL:?}");
  });
  it("runs application containers as non-root on read-only root filesystems", () => {
    for (const name of ["api", "worker", "migrate"]) expect(svc[name].user).toBe("1000:1000");
    for (const name of ["api", "worker", "web", "proxy", "redis", "backup-agent"]) expect(svc[name].read_only, name).toBe(true);
    expect(aapanel.services.mailpit.read_only).toBe(true);
    expect(svc.db.user).toBe("999:999");
  });
  it("keeps the database and Redis on internal networks only", () => {
    expect(prodCompose.networks.data.internal).toBe(true);
    expect(prodCompose.networks.app.internal).toBe(true);
    expect(prodCompose.networks.backup.internal).toBeFalsy();
    expect(svc.redis.networks).toEqual(["data"]);
    expect(svc.worker.networks).not.toContain("app");
  });
  it("delivers secrets as files, never as literal environment values", () => {
    for (const [name, s] of Object.entries(svc)) {
      for (const [k, v] of Object.entries(s.environment || {})) if (/(PASSWORD|SECRET|TOKEN|_KEY)$/.test(k)) expect(String(v), `${name}.${k}`).toMatch(/^\$\{/);
    }
    for (const [name, def] of Object.entries(prodCompose.secrets)) expect(def.file, name).toMatch(/^\.\/secrets\/\$\{DEPLOY_ENVIRONMENT\}\//);
    expect(svc.api.secrets.map((s) => s.source)).toContain("jwt_secret");
  });
  it("uses digest-pinned images (from the release) and graceful stops", () => {
    expect(svc.api.image).toMatch(/^\$\{API_IMAGE:\?/);
    expect(svc.worker.stop_grace_period).toBeTruthy();
    expect(svc.db.stop_grace_period).toBe("120s");
    expect({ ...prodCompose["x-hardening"], ...svc.api }.init).toBe(true);
  });
  it("the compose checker catches insecure services", () => {
    const bad = yaml.dump({ services: { api: { image: "caspira/api:latest", privileged: true, ports: ["5432:5432"], volumes: ["/var/run/docker.sock:/var/run/docker.sock"], environment: { DB_PASSWORD: "hunter2" } } }, networks: { data: {} } });
    const titles = checkCompose("bad.yml", bad).map((f) => f.title).join("\n");
    expect(titles).toMatch(/privileged/);
    expect(titles).toMatch(/Docker socket/);
    expect(titles).toMatch(/publishes ports/);
    expect(titles).toMatch(/latest tag/);
    expect(titles).toMatch(/literal value for DB_PASSWORD/);
    expect(titles).toMatch(/Network data must be internal/);
  });
  it("the repository passes its own policy check", () => {
    const report = runPolicyChecks();
    expect(report.findings.filter((f) => ["Critical", "High"].includes(f.severity))).toEqual([]);
  });
  it("production procedures never use `down -v`", () => {
    for (const f of ["deploy/production/scripts/deploy.sh", "deploy/production/scripts/rollback.sh"]) expect(read(f)).not.toMatch(/down\s+-v/);
  });
});

describe("environment templates and packages", () => {
  it("templates hold no secrets and pin images by digest", () => {
    for (const f of ["deploy/production/env/production.env.example", "deploy/production/env/staging.env.example", "deploy/production/env/aapanel-production.env.example", "deploy/production/env/backup-offsite.sftp.env.example"]) expect(checkEnvTemplate(f, read(f)), f).toEqual([]);
    expect(checkEnvTemplate("x", "API_IMAGE=caspira/api:1.0\nDB_PASSWORD=abc")).toHaveLength(2);
  });
  it("staging and production templates are separate environments", () => {
    const p = read("deploy/production/env/production.env.example");
    const s = read("deploy/production/env/staging.env.example");
    expect(p).toMatch(/^DEPLOY_ENVIRONMENT=production$/m);
    expect(s).toMatch(/^DEPLOY_ENVIRONMENT=staging$/m);
    expect(s).not.toMatch(/https:\/\/api\.example\.com/);
  });
  it("flags floating production dependencies and missing lockfiles", () => {
    expect(checkPackage("p", { dependencies: { a: "*", b: "latest", c: "github:x/y" } }, false).map((f) => f.severity).sort()).toEqual(["High", "High", "High", "Medium"]);
  });
});

describe("secret scanning and dependency evidence", () => {
  it("finds real-looking secrets and ignores placeholders", () => {
    const pk = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
    expect(scanText("a.js", `const k = "${pk}";`)[0].severity).toBe("Critical");
    expect(scanText("b.env", "DB_PASSWORD=k7Qp2Lx9Vr4Tn8Wz1Hs6Jd3Ym5").length).toBe(1);
    expect(scanText("c.env", "DB_PASSWORD=changeme\nJWT_SECRET=${JWT_SECRET}")).toEqual([]);
    // Where a secret lives (a *_FILE setting or a path) is not the secret itself.
    expect(scanText("f.env", "POSTGRES_PASSWORD_FILE=/run/secrets/postgres_superuser_password\nREPO2_PRIVATE_KEY=/run/secrets/backup_offsite_sftp_key")).toEqual([]);
    expect(scanText("g.env", "REDIS_PASSWORD=k7Qp2Lx9Vr4Tn8Wz1Hs6Jd3Ym5").length).toBe(1);
    expect(scanText("d.js", "const s = process.env.SESSION_SECRET_VALUE_THAT_IS_LONG;")).toEqual([]);
  });
  it("the scanner reports file and line, never the secret itself", () => {
    const value = `sk-${"a1B2".repeat(12)}`;
    const f = scanText("e.js", `key = "${value}"`)[0];
    expect(JSON.stringify(f)).not.toContain(value);
    expect(f.title).toMatch(/e\.js line 1/);
  });
  it("normalizes npm audit output with scanner, severity, component and fixed version", () => {
    const r = normalizeAudit({ vulnerabilities: { lodash: { severity: "high", range: "<4.17.21", fixAvailable: { name: "lodash", version: "4.17.21" }, via: [{ title: "Prototype pollution", url: "GHSA-x", severity: "high" }] } } }, "server");
    expect(r).toMatchObject({ scanner: "npm-audit", target: "dependency:server" });
    expect(r.findings[0]).toMatchObject({ component: "lodash", severity: "high", fixedVersion: "lodash@4.17.21" });
  });
  it("generates a CycloneDX SBOM of production dependencies from the lockfile", () => {
    const bom = sbomFromLock(path.join(REPO, "server"));
    expect(bom).toMatchObject({ bomFormat: "CycloneDX", specVersion: "1.5" });
    expect(bom.components.length).toBeGreaterThan(50);
    expect(bom.components.find((c) => c.name === "express")?.purl).toMatch(/^pkg:npm\/express@/);
    expect(bom.components.some((c) => c.name === "vitest")).toBe(false);
  });
});
