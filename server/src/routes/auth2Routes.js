import { Router } from "express";
import { asyncHandler } from "../utils/crudFactory.js";
import { requireCsrf } from "../middleware/csrf.js";
import { loginRateLimit, passwordResetRateLimit } from "../middleware/rateLimit.js";
import * as ctrl from "../controllers/auth2Controller.js";

const router = Router();

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Log in and receive session cookies
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties: { email: { type: string }, password: { type: string } }
 *     responses:
 *       200: { description: Logged in — sets csrm_access/csrm_refresh/csrm_csrf cookies, content: { application/json: { schema: { type: object, properties: { user: { $ref: "#/components/schemas/User" } } } } } }
 *       400: { description: Missing email or password }
 *       401: { description: Invalid credentials — same message whether the account doesn't exist or the password is wrong }
 *       429: { description: Too many attempts }
 */
router.post("/login", loginRateLimit, asyncHandler(ctrl.login));

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Revoke the current session and clear cookies
 *     tags: [Auth]
 *     responses:
 *       200: { description: Logged out }
 *       403: { description: Missing/invalid CSRF token }
 */
router.post("/logout", requireCsrf, asyncHandler(ctrl.logout));

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     summary: Rotate the refresh session and issue new cookies
 *     description: Reusing an already-rotated refresh token revokes the entire token family and requires a fresh login.
 *     tags: [Auth]
 *     security: []
 *     responses:
 *       200: { description: Rotated }
 *       401: { description: No/invalid/expired session, or reuse detected (code SESSION_REVOKED) }
 */
router.post("/refresh", asyncHandler(ctrl.refresh)); // pre-session by nature; refresh-token possession is the proof

/**
 * @openapi
 * /auth/me:
 *   get:
 *     summary: Get the current authenticated user
 *     tags: [Auth]
 *     responses:
 *       200: { description: OK, content: { application/json: { schema: { type: object, properties: { user: { $ref: "#/components/schemas/User" } } } } } }
 *       401: { description: Not authenticated }
 */
router.get("/me", ctrl.authenticateCookie, asyncHandler(ctrl.me));

/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     summary: Request a password reset email
 *     description: Always returns the same generic response, whether or not the email is registered — never confirms account existence.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       content: { application/json: { schema: { type: object, properties: { email: { type: string } } } } }
 *     responses:
 *       200: { description: Generic acknowledgement }
 *       429: { description: Too many attempts }
 */
router.post("/forgot-password", passwordResetRateLimit, asyncHandler(ctrl.forgotPassword));

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     summary: Reset a password using a token from the reset email
 *     description: Revokes every existing session for the account on success.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [token, newPassword], properties: { token: { type: string }, newPassword: { type: string } } } } }
 *     responses:
 *       200: { description: Password reset }
 *       400: { description: Invalid or expired token }
 *       429: { description: Too many attempts }
 */
router.post("/reset-password", passwordResetRateLimit, asyncHandler(ctrl.resetPassword));

/**
 * @openapi
 * /auth/verify-email:
 *   post:
 *     summary: Verify an email address using a token
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       content: { application/json: { schema: { type: object, properties: { token: { type: string } } } } }
 *     responses:
 *       200: { description: Verified }
 *       400: { description: Invalid or expired token }
 */
router.post("/verify-email", asyncHandler(ctrl.verifyEmail));

/**
 * @openapi
 * /auth/sessions:
 *   get:
 *     summary: List the current user's active refresh sessions
 *     tags: [Auth]
 *     responses:
 *       200: { description: OK }
 *       401: { description: Not authenticated }
 */
router.get("/sessions", ctrl.authenticateCookie, asyncHandler(ctrl.listSessions));

/**
 * @openapi
 * /auth/sessions/{sessionId}:
 *   delete:
 *     summary: Revoke a specific session belonging to the current user
 *     tags: [Auth]
 *     parameters: [{ name: sessionId, in: path, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Revoked }
 *       404: { description: Not found (not yours, or doesn't exist) }
 */
router.delete("/sessions/:sessionId", ctrl.authenticateCookie, requireCsrf, asyncHandler(ctrl.revokeSession));

/**
 * @openapi
 * /auth/sessions/revoke-others:
 *   post:
 *     summary: Revoke every session except the one making this request
 *     tags: [Auth]
 *     responses:
 *       200: { description: Revoked }
 */
router.post("/sessions/revoke-others", ctrl.authenticateCookie, requireCsrf, asyncHandler(ctrl.revokeOtherSessions));

export default router;
