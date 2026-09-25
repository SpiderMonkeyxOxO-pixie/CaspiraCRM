// Backend Phase 13 — imported FIRST by src/index.js and src/worker.js (after
// dotenv), before anything creates a Prisma or Redis client. Resolves secret
// files into the process environment, installs log redaction for every
// secret value, and refuses to start staging or production on any
// configuration error. Only setting names are printed, never values.
import { resolveConfig } from "./validate.js";
import { installLogRedaction } from "./secrets.js";

const result = resolveConfig(process.env);
for (const [k, v] of Object.entries(result.apply)) if (v !== undefined && v !== null) process.env[k] = v;
installLogRedaction(result.secretValues);

for (const w of result.warnings) console.warn(`[config] warning: ${w}`);
if (result.errors.length) {
  console.error(`[config] ${result.profile} configuration is invalid — refusing to start:`);
  for (const e of result.errors) console.error(`[config]  - ${e}`);
  process.exit(1);
}
console.log(`[config] profile ${result.profile}; secrets from ${Object.entries(result.secretSources).filter(([, s]) => s).map(([n, s]) => `${n}:${s}`).join(", ") || "none"}`);

export const configProfile = result.profile;
