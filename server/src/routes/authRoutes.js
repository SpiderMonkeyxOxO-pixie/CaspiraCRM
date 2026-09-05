import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/crudFactory.js";
import * as ctrl from "../controllers/authController.js";

const router = Router();

router.post("/login", asyncHandler(ctrl.login));
router.post("/verify-2fa", asyncHandler(ctrl.verify2FA));
router.post("/register", asyncHandler(ctrl.register));
router.get("/me", authenticate, asyncHandler(ctrl.me));
router.post("/logout", authenticate, asyncHandler(ctrl.logout));
router.post("/updateFCM", authenticate, asyncHandler(ctrl.updateFCM));
router.get("/all", authenticate, asyncHandler(ctrl.listUsers));
router.get("/departmentwise", authenticate, asyncHandler(ctrl.listUsers));
router.put("/edit/:id", authenticate, requireRole("Super-Admin", "Admin"), asyncHandler(ctrl.updateUser));
router.put("/update/:id", authenticate, asyncHandler(ctrl.updateUser));
router.put("/:id/status", authenticate, requireRole("Super-Admin", "Admin"), asyncHandler(ctrl.updateUserStatus));
router.put("/:id/role", authenticate, requireRole("Super-Admin"), asyncHandler(ctrl.updateUserRole));
router.delete("/delete/:userId", authenticate, requireRole("Super-Admin"), asyncHandler(ctrl.deleteUser));
router.post("/change-password", authenticate, asyncHandler(ctrl.changePassword));
router.post("/2fa/setup", authenticate, asyncHandler(ctrl.setup2FA));
router.post("/2fa/confirm", authenticate, asyncHandler(ctrl.confirm2FA));

export default router;
