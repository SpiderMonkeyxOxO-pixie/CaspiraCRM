// Backend Phase 13 — for one-off operator scripts (the System Owner
// bootstrap) that run inside the production image. Resolves secret files
// into the process environment (DATABASE_URL is assembled from DB_* and the
// password file) and installs log redaction, WITHOUT refusing to run on
// startup rules — the bootstrap deliberately sets ALLOW_SYSTEM_OWNER_BOOTSTRAP
// for that single command. Long-running processes use ./load.js instead.
import { resolveConfig } from "./validate.js";
import { installLogRedaction } from "./secrets.js";

const result = resolveConfig(process.env);
for (const [k, v] of Object.entries(result.apply)) if (v !== undefined && v !== null) process.env[k] = v;
installLogRedaction(result.secretValues);
