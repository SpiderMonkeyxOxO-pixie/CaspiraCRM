import { Router } from "express";
import { asyncHandler } from "../../utils/crudFactory.js";
import { authenticateCookie } from "../../controllers/auth2Controller.js";
import { requireCrmOrgPermission } from "../../middleware/rbac.js";
import { requireCsrf } from "../../middleware/csrf.js";
import * as ctrl from "../../controllers/sales/priceBooksController.js";

const router = Router();
router.use(authenticateCookie);

router.get("/", requireCrmOrgPermission("price_books", "view"), asyncHandler(ctrl.list));
router.post("/", requireCsrf, requireCrmOrgPermission("price_books", "create"), asyncHandler(ctrl.create));
router.get("/:priceBookId", requireCrmOrgPermission("price_books", "view"), asyncHandler(ctrl.getOne));
router.patch("/:priceBookId", requireCsrf, requireCrmOrgPermission("price_books", "edit"), asyncHandler(ctrl.update));
router.post("/:priceBookId/archive", requireCsrf, requireCrmOrgPermission("price_books", "archive"), asyncHandler(ctrl.archive));
router.post("/:priceBookId/restore", requireCsrf, requireCrmOrgPermission("price_books", "restore"), asyncHandler(ctrl.restore));
router.post("/:priceBookId/entries", requireCsrf, requireCrmOrgPermission("price_books", "edit"), asyncHandler(ctrl.createEntry));
router.patch("/:priceBookId/entries/:entryId", requireCsrf, requireCrmOrgPermission("price_books", "edit"), asyncHandler(ctrl.updateEntry));

export default router;
