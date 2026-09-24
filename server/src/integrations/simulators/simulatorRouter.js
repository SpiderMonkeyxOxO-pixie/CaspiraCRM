// HTTP face of the provider simulator, mounted at
// /api/v1/integrations/simulator ONLY in simulator mode outside production
// (see app.js) — and runnable standalone (npm run simulator) as the
// "provider-simulator" service.
import express, { Router } from "express";
import { simulator, SIMULATOR_LABEL } from "./simulatorCore.js";

const router = Router();
const send = (res, r) => {
  if (r.redirect) return res.redirect(302, r.redirect);
  if (r.headers) res.set(r.headers);
  return res.status(r.status).json(r.body);
};
const bearer = (req) => (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

router.use(express.urlencoded({ extended: false }));
router.use(express.json());
router.get("/", (_req, res) => res.json({ label: SIMULATOR_LABEL }));
router.get("/:provider/oauth/authorize", (req, res) => send(res, simulator.authorize({ provider: req.params.provider, ...req.query })));
router.post("/:provider/oauth/token", (req, res) => send(res, simulator.token({ provider: req.params.provider, ...req.body })));
router.post("/:provider/oauth/revoke", (req, res) => send(res, simulator.revoke({ token: req.body.token })));
router.get("/:provider/me", (req, res) => send(res, simulator.me({ provider: req.params.provider, bearer: bearer(req) })));
router.get("/:provider/records", (req, res) => send(res, simulator.records({ provider: req.params.provider, bearer: bearer(req), ...req.query })));

router.patch("/:provider/records/:entityType/:id", (req, res) => send(res, simulator.updateRecord({ provider: req.params.provider, bearer: bearer(req), entityType: req.params.entityType, id: req.params.id, fields: req.body?.fields || {}, idempotencyKey: req.headers["idempotency-key"] })));

// Controls for local testing only.
router.post("/_control/:provider/rate-limit", (req, res) => { simulator.control.rateLimit(req.params.provider, Number.isInteger(Number(req.body.count)) ? Number(req.body.count) : 1, Number(req.body.retryAfterSec) || 2); res.json({ ok: true }); });
router.post("/_control/:provider/fail", (req, res) => { simulator.control.fail(req.params.provider, [].concat(req.body.kinds || "transient")); res.json({ ok: true }); });
router.post("/_control/:provider/grant-scopes", (req, res) => { simulator.control.grantScopes(req.params.provider, req.body.scopes || null); res.json({ ok: true }); });
router.post("/_control/:provider/expire-tokens", (req, res) => { simulator.control.expireTokens(req.params.provider); res.json({ ok: true }); });
router.post("/_control/:provider/revoke-all", (req, res) => { simulator.control.revokeAll(req.params.provider); res.json({ ok: true }); });
router.post("/_control/:provider/records/:entityType/:id", (req, res) => res.json({ record: simulator.control.updateRecord(req.params.provider, req.params.entityType, req.params.id, req.body || {}) }));
router.post("/_control/:provider/records/:entityType/:id/delete", (req, res) => res.json({ record: simulator.control.deleteRecord(req.params.provider, req.params.entityType, req.params.id) }));

export default router;
