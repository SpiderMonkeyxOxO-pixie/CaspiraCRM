import { Router } from "express";
import { asyncHandler } from "../utils/crudFactory.js";
import { requireCsrf } from "../middleware/csrf.js";
import { loginRateLimit, passwordResetRateLimit } from "../middleware/rateLimit.js";
import * as ctrl from "../controllers/auth2Controller.js";

const router = Router();

router.post("/login", loginRateLimit, asyncHandler(ctrl.login));
router.post("/logout", requireCsrf, asyncHandler(ctrl.logout));
router.post("/refresh", asyncHandler(ctrl.refresh)); // pre-session by nature; refresh-token possession is the proof
router.get("/me", ctrl.authenticateCookie, asyncHandler(ctrl.me));
router.post("/forgot-password", passwordResetRateLimit, asyncHandler(ctrl.forgotPassword));
router.post("/reset-password", passwordResetRateLimit, asyncHandler(ctrl.resetPassword));
router.post("/verify-email", asyncHandler(ctrl.verifyEmail));
router.get("/sessions", ctrl.authenticateCookie, asyncHandler(ctrl.listSessions));
router.delete("/sessions/:sessionId", ctrl.authenticateCookie, requireCsrf, asyncHandler(ctrl.revokeSession));
router.post("/sessions/revoke-others", ctrl.authenticateCookie, requireCsrf, asyncHandler(ctrl.revokeOtherSessions));

export default router;
