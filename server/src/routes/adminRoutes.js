import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/crudFactory.js";
import prisma from "../lib/prisma.js";
import { toApi } from "../utils/serialize.js";
import { ACTIONS, SCOPES, MODULE_GROUPS, APPROVAL_TYPES } from "../constants/permissionCatalog.js";

const router = Router();
router.use(authenticate, requireRole("Super-Admin", "Admin"));

router.get("/roles", asyncHandler(async (req, res) => {
  const roles = await prisma.role.findMany({ orderBy: { name: "asc" } });
  res.json({
    roles: toApi(roles),
    counts: {
      builtin: roles.filter((r) => r.isBuiltIn).length,
      custom: roles.filter((r) => !r.isBuiltIn).length,
      withUsers: 0,
      needingReview: 0,
    },
  });
}));

router.get("/roles/:id", asyncHandler(async (req, res) => {
  const role = await prisma.role.findUnique({ where: { id: req.params.id }, include: { users: { include: { user: true } } } });
  if (!role) return res.status(404).json({ message: "Role not found" });
  res.json({ role: toApi(role), assignedUsers: toApi(role.users.map((ur) => ur.user)) });
}));

router.post("/roles", requireRole("Super-Admin"), asyncHandler(async (req, res) => {
  const role = await prisma.role.create({ data: { ...req.body, type: "Custom", isBuiltIn: false } });
  res.status(201).json({ role: toApi(role) });
}));

router.put("/roles/:id", requireRole("Super-Admin"), asyncHandler(async (req, res) => {
  const existing = await prisma.role.findUnique({ where: { id: req.params.id } });
  if (existing?.isBuiltIn) return res.status(400).json({ message: "Built-in roles cannot be edited directly — duplicate into a Custom Role first" });
  const role = await prisma.role.update({ where: { id: req.params.id }, data: req.body });
  res.json({ role: toApi(role) });
}));

router.post("/roles/:id/duplicate", requireRole("Super-Admin"), asyncHandler(async (req, res) => {
  const source = await prisma.role.findUnique({ where: { id: req.params.id } });
  if (!source) return res.status(404).json({ message: "Role not found" });
  const { id, key, createdAt, updatedAt, ...rest } = source;
  const role = await prisma.role.create({
    data: { ...rest, name: req.body.name || `${source.name} (Copy)`, type: "Custom", isBuiltIn: false, duplicatedFromId: source.id },
  });
  res.status(201).json({ role: toApi(role) });
}));

router.post("/roles/:id/archive", requireRole("Super-Admin"), asyncHandler(async (req, res) => {
  if (!req.body.reason?.trim()) return res.status(400).json({ message: "An archive reason is required" });
  const existing = await prisma.role.findUnique({ where: { id: req.params.id } });
  if (existing?.isBuiltIn) return res.status(400).json({ message: "Built-in roles cannot be archived" });
  const role = await prisma.role.update({ where: { id: req.params.id }, data: { status: "Archived", archiveReason: req.body.reason, archivedAt: new Date() } });
  res.json({ role: toApi(role) });
}));

router.post("/roles/:id/restore", requireRole("Super-Admin"), asyncHandler(async (req, res) => {
  const role = await prisma.role.update({ where: { id: req.params.id }, data: { status: "Active", archiveReason: null } });
  res.json({ role: toApi(role) });
}));
router.post("/roles/:id/disable", requireRole("Super-Admin"), asyncHandler(async (req, res) => {
  const role = await prisma.role.update({ where: { id: req.params.id }, data: { status: "Inactive" } });
  res.json({ role: toApi(role) });
}));
router.post("/roles/:id/enable", requireRole("Super-Admin"), asyncHandler(async (req, res) => {
  const role = await prisma.role.update({ where: { id: req.params.id }, data: { status: "Active" } });
  res.json({ role: toApi(role) });
}));

router.post("/roles/compare", asyncHandler(async (req, res) => {
  const roles = await prisma.role.findMany({ where: { id: { in: req.body.roleIds || [] } } });
  res.json({ roles: toApi(roles) });
}));

router.get("/permissions/catalog", asyncHandler(async (_req, res) => {
  res.json({ moduleGroups: MODULE_GROUPS, actions: ACTIONS, scopes: SCOPES, approvalTypes: APPROVAL_TYPES });
}));

// A lightweight real-backend counterpart to the frontend's Access Preview
// simulator — evaluates a role's stored permissionGrants against a
// requested module/action instead of the frontend's own local logic.
router.post("/permissions/access-preview", asyncHandler(async (req, res) => {
  const { roleId, moduleId, action } = req.body;
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) return res.status(404).json({ message: "Role not found" });
  const grants = role.permissionGrants || [];
  const grant = grants.find((g) => g.moduleId === moduleId);
  const allowed = !!grant?.actions?.includes(action);
  res.json({ allowed, scope: role.defaultScope, explanation: allowed ? null : "This permission is not included in this role." });
}));

export default router;
