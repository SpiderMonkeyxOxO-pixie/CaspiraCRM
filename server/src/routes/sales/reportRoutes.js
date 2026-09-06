import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import * as ctrl from "../../controllers/sales/reportsController.js";

const router = Router();
router.use(authenticateCookie);

router.get("/pipeline-summary", requireCrmOrgPermission("sales_reports", "view"), asyncHandler(ctrl.pipelineSummary));
router.get("/forecast", requireCrmOrgPermission("sales_reports", "view_forecast"), asyncHandler(ctrl.forecast));

export default router;
