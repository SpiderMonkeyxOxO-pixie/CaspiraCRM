import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../utils/crudFactory.js";
import * as ctrl from "../controllers/contractController.js";

const router = Router();
router.use(authenticate);

router.get("/", asyncHandler(ctrl.list));
router.get("/:id", asyncHandler(ctrl.getOne));
router.post("/", asyncHandler(ctrl.create));
router.put("/:id", asyncHandler(ctrl.update));
router.post("/:id/archive", asyncHandler(ctrl.archiveContract));
router.post("/:id/restore", asyncHandler(ctrl.restoreContract));
router.post("/bulk/assign", asyncHandler(ctrl.bulkAssign));
router.post("/bulk/archive", asyncHandler(ctrl.bulkArchive));
router.post("/:id/submit-review", asyncHandler(ctrl.submitForInternalReview));
router.post("/:id/send-for-signature", asyncHandler(ctrl.sendForSignature));
router.post("/:id/record-signature", asyncHandler(ctrl.recordSignature));
router.post("/:id/renew", asyncHandler(ctrl.renewContract));
router.post("/:id/terminate", asyncHandler(ctrl.terminateContract));
router.post("/:id/cancel", asyncHandler(ctrl.cancelContract));
router.post("/:id/expire", asyncHandler(ctrl.expireContract));

export default router;
