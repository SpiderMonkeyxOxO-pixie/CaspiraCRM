import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../utils/crudFactory.js";
import * as ctrl from "../controllers/orderController.js";

const router = Router();
router.use(authenticate);

router.get("/", asyncHandler(ctrl.list));
router.get("/:id", asyncHandler(ctrl.getOne));
router.post("/", asyncHandler(ctrl.create));
router.put("/:id", asyncHandler(ctrl.update));
router.post("/:id/archive", asyncHandler(ctrl.archiveOrder));
router.post("/:id/restore", asyncHandler(ctrl.restoreOrder));
router.post("/bulk/assign", asyncHandler(ctrl.bulkAssign));
router.post("/bulk/archive", asyncHandler(ctrl.bulkArchive));
router.post("/:id/submit-review", asyncHandler(ctrl.submitForReview));
router.post("/:id/confirm", asyncHandler(ctrl.confirmOrder));
router.post("/:id/start-processing", asyncHandler(ctrl.startProcessing));
router.post("/:id/hold", asyncHandler(ctrl.putOnHold));
router.post("/:id/resume", asyncHandler(ctrl.resumeOrder));
router.post("/:id/cancel", asyncHandler(ctrl.cancelOrder));
router.post("/:id/fulfilled", asyncHandler(ctrl.markFulfilled));
router.post("/:id/complete", asyncHandler(ctrl.markCompleted));
router.post("/:id/request-invoice-preview", asyncHandler(ctrl.requestInvoicePreview));
router.post("/:id/lines/:lineId/fulfillment", asyncHandler(ctrl.updateLineFulfillment));

export default router;
