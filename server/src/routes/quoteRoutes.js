import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../utils/crudFactory.js";
import * as ctrl from "../controllers/quoteController.js";

const router = Router();
router.use(authenticate);

router.get("/", asyncHandler(ctrl.list));
router.get("/:id", asyncHandler(ctrl.getOne));
router.post("/", asyncHandler(ctrl.create));
router.put("/:id", asyncHandler(ctrl.update));
router.post("/:id/archive", asyncHandler(ctrl.archiveQuote));
router.post("/:id/restore", asyncHandler(ctrl.restoreQuote));
router.post("/bulk/assign", asyncHandler(ctrl.bulkAssign));
router.post("/bulk/archive", asyncHandler(ctrl.bulkArchive));
router.post("/:id/submit-review", asyncHandler(ctrl.submitForReview));
router.post("/:id/approve", asyncHandler(ctrl.approveReview));
router.post("/:id/reject", asyncHandler(ctrl.rejectReview));
router.post("/:id/request-changes", asyncHandler(ctrl.requestReviewChanges));
router.post("/:id/cancel", asyncHandler(ctrl.cancelQuote));
router.post("/:id/preview-send", asyncHandler(ctrl.previewSend));
router.post("/:id/customer-response", asyncHandler(ctrl.customerResponse));
router.post("/:id/new-version", asyncHandler(ctrl.newVersion));

export default router;
