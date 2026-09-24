// Backend Phase 9 — AI audit events reuse the scrubbed integration audit
// helper: keys, tokens and secrets can't be written even by mistake.
export { integrationAudit as aiAudit, scrub } from "../../integrations/common/audit.js";
