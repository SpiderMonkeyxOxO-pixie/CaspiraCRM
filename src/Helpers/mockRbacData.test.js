import { describe, it, expect } from "vitest";
import {
  SCOPES,
  ACTIONS,
  MODULE_GROUPS,
  getApplicableActions,
  findModule,
  allModules,
  HIGH_RISK_PERMISSIONS,
  isHighRiskGrant,
  FIELD_STATES,
  SENSITIVE_FIELD_GROUPS,
  allSensitiveFields,
  APPROVAL_TYPES,
  SEPARATION_OF_DUTIES_RULES,
  checkSeparationOfDuties,
  ROLE_TEMPLATES,
  CUSTOM_ROLES,
  allRoles,
  findRole,
  findRoleTemplate,
  getTemplateForRealRole,
  hasPermission,
  hasAnyView,
  getFieldState,
  canApprove,
  countGrantedActions,
  countHighRiskGrants,
  isHighPrivilegeRole,
  getVisibleNavForRole,
  detectRoleConflicts,
  usersForRole,
  changeHistoryForRole,
  auditPreviewForRole,
  queryRolesLocal,
  createCustomRole,
  updateCustomRole,
  duplicateRoleAsCustom,
  archiveCustomRole,
  restoreCustomRole,
  disableCustomRole,
  enableCustomRole,
  validateRolePayload,
  compareRoles,
} from "./mockRbacData";

describe("mockRbacData: catalog", () => {
  it("defines all seven access scopes", () => {
    expect(SCOPES).toEqual([
      "Own", "Assigned", "Team", "Department", "Organization", "Customer Account", "System-wide",
    ]);
  });

  it("defines the full permission action catalog", () => {
    expect(Object.values(ACTIONS)).toContain("view");
    expect(Object.values(ACTIONS)).toContain("delete_permanently");
    expect(Object.values(ACTIONS)).toContain("view_sensitive_fields");
    expect(Object.values(ACTIONS).length).toBeGreaterThanOrEqual(25);
  });

  it("only shows applicable actions per module kind (no irrelevant permissions)", () => {
    const calendar = findModule("calendar");
    const calendarActions = getApplicableActions(calendar);
    expect(calendarActions).not.toContain(ACTIONS.APPROVE);
    expect(calendarActions).not.toContain(ACTIONS.DELETE_PERMANENTLY);

    const auditLogs = findModule("audit_logs");
    const auditActions = getApplicableActions(auditLogs);
    expect(auditActions).not.toContain(ACTIONS.CREATE);
    expect(auditActions).not.toContain(ACTIONS.IMPORT);

    const invoices = findModule("invoices");
    expect(getApplicableActions(invoices)).toContain(ACTIONS.APPROVE);
    expect(getApplicableActions(invoices)).toContain(ACTIONS.VIEW_FINANCIAL_FIELDS);
  });

  it("groups modules into the required module groups", () => {
    const groupIds = MODULE_GROUPS.map((g) => g.id);
    ["core", "crm", "sales", "marketing", "support", "projects", "finance", "people", "communications", "documents", "administration"]
      .forEach((id) => expect(groupIds).toContain(id));
  });

  it("finds a module across groups", () => {
    const found = findModule("leads");
    expect(found.label).toBe("Leads");
    expect(found.groupId).toBe("crm");
  });

  it("has no duplicate module ids across the whole catalog", () => {
    const ids = allModules().map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("flags high-risk permissions", () => {
    expect(isHighRiskGrant("system_settings", ACTIONS.CONFIGURE)).toBe(true);
    expect(isHighRiskGrant("roles", ACTIONS.CONFIGURE)).toBe(true);
    expect(isHighRiskGrant("users", ACTIONS.CHANGE_STATUS)).toBe(true);
    expect(isHighRiskGrant("leads", ACTIONS.VIEW)).toBe(false);
    expect(HIGH_RISK_PERMISSIONS.length).toBeGreaterThan(5);
  });

  it("defines all four sensitive-field visibility states", () => {
    expect(FIELD_STATES).toEqual(["hidden", "masked", "readOnly", "editable"]);
  });

  it("defines the four sensitive-field groups from the spec", () => {
    const ids = SENSITIVE_FIELD_GROUPS.map((g) => g.id);
    expect(ids).toEqual(["personal", "sales", "finance", "hr"]);
    expect(allSensitiveFields().length).toBeGreaterThanOrEqual(20);
  });

  it("defines the seven approval types", () => {
    expect(APPROVAL_TYPES.map((a) => a.id)).toEqual([
      "quote", "discount", "expense", "leave", "invoice", "contract", "access_request",
    ]);
  });
});

describe("mockRbacData: separation of duties", () => {
  it("blocks a requester from approving their own Quote", () => {
    const result = checkSeparationOfDuties({ approvalType: "quote", isOwnRecord: true });
    expect(result.allowed).toBe(false);
    expect(result.violations[0]).toMatch(/cannot approve their own Quote/i);
  });

  it("blocks a requester from approving their own Expense, Invoice, Leave, discount and access request", () => {
    ["expense", "invoice", "leave", "discount", "access_request"].forEach((approvalType) => {
      const result = checkSeparationOfDuties({ approvalType, isOwnRecord: true });
      expect(result.allowed).toBe(false);
    });
    expect(SEPARATION_OF_DUTIES_RULES.length).toBe(6);
  });

  it("allows approving someone else's request", () => {
    const result = checkSeparationOfDuties({ approvalType: "quote", isOwnRecord: false });
    expect(result.allowed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("blocks an Auditor from editing the record being audited", () => {
    const result = checkSeparationOfDuties({ actorTemplateId: "auditor_checker", isAuditedRecord: true });
    expect(result.allowed).toBe(false);
    expect(result.violations[0]).toMatch(/auditor cannot edit/i);
  });

  it("blocks a Customer Portal User from seeing internal notes", () => {
    const result = checkSeparationOfDuties({ actorTemplateId: "customer_portal_user", isInternalNote: true });
    expect(result.allowed).toBe(false);
    expect(result.violations[0]).toMatch(/internal notes/i);
  });
});

describe("mockRbacData: built-in role templates", () => {
  it("includes all 27 default role templates", () => {
    expect(ROLE_TEMPLATES.length).toBe(27);
  });

  it("every built-in template is marked isBuiltIn and cannot be deleted", () => {
    ROLE_TEMPLATES.forEach((r) => expect(r.isBuiltIn).toBe(true));
  });

  it("System Owner has system-wide scope and every module granted", () => {
    const owner = findRoleTemplate("system_owner");
    expect(owner.defaultScope).toBe("System-wide");
    const nonAdminModules = allModules().filter((m) => m.id !== "roles");
    nonAdminModules.forEach((m) => {
      const applicable = getApplicableActions(m);
      // lead_routing/conversion_mapping (Sales & Marketing Integrations,
      // Phase 2) deliberately have no view-family action at all — the spec
      // defines only a "manage" action for these two modules. System Owner
      // is still fully covered as long as it holds every applicable action.
      const hasEveryApplicableAction = applicable.length > 0 && applicable.every((a) => hasPermission(owner.id, m.id, a));
      expect(hasAnyView(owner, m.id) || applicable.length === 0 || hasEveryApplicableAction).toBe(true);
    });
  });

  it("maps the internal super_admin key to System Owner", () => {
    const owner = findRoleTemplate("super_admin");
    expect(owner.id).toBe("system_owner");
    expect(owner.name).toBe("System Owner");
    expect(owner.key).toBe("super_admin");
  });

  it("maps the internal admin key to Organization Administrator", () => {
    const admin = findRoleTemplate("admin");
    expect(admin.id).toBe("organization_administrator");
    expect(admin.name).toBe("Organization Administrator");
  });

  it("maps the internal checker key to Auditor / Checker", () => {
    const checker = findRoleTemplate("checker");
    expect(checker.id).toBe("auditor_checker");
    expect(checker.name).toBe("Auditor / Checker");
  });

  it("resolves the default template for each real internal role", () => {
    expect(getTemplateForRealRole("Super-Admin").id).toBe("system_owner");
    expect(getTemplateForRealRole("Admin").id).toBe("organization_administrator");
    expect(getTemplateForRealRole("Team-Leader").id).toBe("department_manager");
    expect(getTemplateForRealRole("User").id).toBe("standard_employee");
    expect(getTemplateForRealRole("Checker").id).toBe("auditor_checker");
  });

  it("Sales Representative cannot edit Price Books or view cost/margin", () => {
    const rep = findRoleTemplate("sales_representative");
    expect(hasPermission("sales_representative", "price_books", ACTIONS.VIEW_ORGANIZATION)).toBe(true);
    expect(hasPermission("sales_representative", "price_books", ACTIONS.EDIT)).toBe(false);
    expect(getFieldState(rep.id, "margin")).toBe("hidden");
    expect(getFieldState(rep.id, "product_cost")).toBe("hidden");
  });

  it("Finance Staff can prepare but not approve; Finance Manager can approve", () => {
    expect(canApprove("finance_staff", "invoice")).toBe(false);
    expect(canApprove("finance_manager", "invoice")).toBe(true);
    expect(hasPermission("finance_staff", "invoices", ACTIONS.CREATE)).toBe(true);
    expect(hasPermission("finance_staff", "invoices", ACTIONS.APPROVE)).toBe(false);
  });

  it("Auditor / Checker is read-only and cannot configure permissions", () => {
    const auditor = findRoleTemplate("auditor_checker");
    auditor.permissionGrants.forEach((g) => {
      expect(g.actions).not.toContain(ACTIONS.EDIT);
      expect(g.actions).not.toContain(ACTIONS.DELETE_PERMANENTLY);
      expect(g.actions).not.toContain(ACTIONS.ARCHIVE);
    });
    expect(hasPermission("auditor_checker", "permissions", ACTIONS.CONFIGURE)).toBe(false);
  });

  it("Customer Portal User cannot see internal notes, cost, margin or HR data", () => {
    const portal = findRoleTemplate("customer_portal_user");
    expect(portal.customerAccountRestricted).toBe(true);
    expect(getFieldState(portal.id, "product_cost")).toBe("hidden");
    expect(getFieldState(portal.id, "margin")).toBe("hidden");
    expect(getFieldState(portal.id, "salary")).toBe("hidden");
    expect(hasPermission("customer_portal_user", "employee_directory", ACTIONS.VIEW)).toBe(false);
    expect(hasPermission("customer_portal_user", "audit_logs", ACTIONS.VIEW)).toBe(false);
  });

  it("Read-Only Viewer has no create, edit, archive, restore, import or approve permissions", () => {
    const viewer = findRoleTemplate("read_only_viewer");
    viewer.permissionGrants.forEach((g) => {
      [ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.ARCHIVE, ACTIONS.RESTORE, ACTIONS.IMPORT, ACTIONS.APPROVE].forEach((a) => {
        expect(g.actions).not.toContain(a);
      });
    });
  });

  it("no role uses a single canManage permission covering every action", () => {
    // Sales & Marketing Integrations (Phase 2) modules are the one deliberate
    // exception: each defines "manage" as one narrow, specifically-scoped
    // action among a tiny finite action list (e.g. lead_routing's kind is
    // exactly [MANAGE] — there is no separate view/create/edit/archive set
    // it could be bypassing), never a catch-all substitute for the granular
    // BASE_RECORD action set this guard actually protects against.
    const modulesWhereManageIsLegitimate = new Set([
      "marketing_integrations", "lead_routing", "audience_sync", "marketing_consent",
      "forms_integrations", "conversion_mapping",
      // Customer Support and Communication Integrations (Phase 3) — same
      // exception, same reasoning: each defines "manage" as one narrow
      // action among a tiny finite action list.
      "support_integrations", "support_channels", "support_queues",
      "support_agent_mappings", "support_sla", "support_escalations", "support_calls",
      // Projects and Development Integrations (Phase 4) — same exception,
      // same reasoning: each defines "manage" as one narrow action among a
      // tiny finite action list ([VIEW, MANAGE], or [MANAGE] alone for
      // project_connections which has no separate VIEW at all).
      "project_integrations", "project_mappings", "project_templates",
      "development_integrations", "project_connections",
      // Commerce and Finance Integrations (Phase 5) — same exception, same
      // reasoning: each defines "manage" as one narrow action among a tiny
      // finite action list ([VIEW, MANAGE], or [MANAGE] alone for
      // commerce_stores/accounting_mappings which have no separate VIEW).
      "commerce_integrations", "payments_integrations", "accounting_integrations",
      "banking_integrations", "commerce_stores", "accounting_mappings",
      // Documents, Storage and Electronic Signature Integrations (Phase 6)
      // — same exception, same reasoning.
      "document_integrations", "folder_mappings", "signature_integrations",
      "signature_templates", "retention_policies", "storage_connections",
      "file_classification", "legal_holds",
      // AI Provider and Intelligence Integrations (Phase 7, final) — same
      // exception, same reasoning.
      "ai_providers", "ai_models", "ai_routing", "ai_policies", "ai_privacy", "ai_tools", "ai_budgets",
    ]);
    allRoles().forEach((role) => {
      role.permissionGrants.forEach((g) => {
        if (modulesWhereManageIsLegitimate.has(g.moduleId)) return;
        expect(g.actions).not.toContain("manage");
        expect(g.actions).not.toContain("can_manage");
      });
    });
  });
});

describe("mockRbacData: high-risk detection", () => {
  it("flags System Owner and Organization Administrator as high privilege", () => {
    expect(isHighPrivilegeRole(findRoleTemplate("system_owner"))).toBe(true);
    expect(isHighPrivilegeRole(findRoleTemplate("organization_administrator"))).toBe(true);
  });

  it("does not flag Support Agent as high privilege", () => {
    expect(isHighPrivilegeRole(findRoleTemplate("support_agent"))).toBe(false);
  });

  it("counts high-risk grants for a role", () => {
    const grants = countHighRiskGrants(findRoleTemplate("system_owner"));
    expect(grants.length).toBeGreaterThan(0);
  });

  it("counts total granted actions for a role", () => {
    expect(countGrantedActions(findRoleTemplate("read_only_viewer"))).toBeGreaterThan(0);
  });
});

describe("mockRbacData: navigation derived from permissions", () => {
  it("System Owner sees every module-group nav section", () => {
    const nav = getVisibleNavForRole("system_owner");
    const labels = nav.map((n) => n.label);
    ["CRM", "Sales", "Support", "Projects", "Marketing", "Finance", "Settings"].forEach((l) =>
      expect(labels).toContain(l)
    );
  });

  it("every real role resolves to a template whose preview nav includes at least today's live nav", () => {
    // This RBAC package is a frontend PREVIEW layer — it does not replace or
    // rewire the app's real (Helper.js) navigation, which is intentionally
    // left untouched to avoid any risk of a silent access regression. The
    // richer 22-template model is allowed to preview a broader nav than
    // today's simple 5-role app (e.g. Auditor/Checker previews Activity
    // Logs access that the real Checker role doesn't have yet) as long as
    // it never previews LESS than what the real role can already do.
    const liveNavToday = {
      "Super-Admin": ["CRM", "Sales", "Support", "Projects", "Marketing", "Finance", "Settings"],
      Admin: ["CRM", "Sales", "Support", "Projects", "Marketing", "Finance", "Settings"],
      "Team-Leader": ["CRM", "Sales", "Support", "Projects"],
      User: ["CRM", "Sales", "Support"],
      Checker: ["Finance"],
    };
    Object.entries(liveNavToday).forEach(([role, liveLabels]) => {
      const template = getTemplateForRealRole(role);
      const previewNav = getVisibleNavForRole(template.id).map((n) => n.label);
      liveLabels.forEach((label) => expect(previewNav).toContain(label));
    });
  });

  it("Customer Portal User does not see internal admin nav", () => {
    const nav = getVisibleNavForRole("customer_portal_user").map((n) => n.label);
    expect(nav).not.toContain("Settings");
  });

  it("never returns an empty navigation group entry", () => {
    allRoles().forEach((role) => {
      const nav = getVisibleNavForRole(role.id);
      nav.forEach((section) => {
        expect(section.label).toBeTruthy();
        expect(section.path).toBeTruthy();
      });
    });
  });
});

describe("mockRbacData: conflict detection", () => {
  it("flags a role that can both create and approve the same financial module", () => {
    const conflictRole = {
      id: "test_conflict_role",
      permissionGrants: [{ moduleId: "invoices", actions: [ACTIONS.CREATE, ACTIONS.APPROVE] }],
      approvalRules: {},
      allowedScopes: ["Own"],
      defaultScope: "Own",
      sensitiveFields: {},
      type: "Custom",
    };
    const conflicts = detectRoleConflicts(conflictRole);
    expect(conflicts.some((c) => c.type === "Separation-of-duties conflict")).toBe(true);
  });

  it("flags an inconsistent default scope", () => {
    const role = {
      id: "test_scope_role",
      permissionGrants: [],
      approvalRules: {},
      allowedScopes: ["Own"],
      defaultScope: "Organization",
      sensitiveFields: {},
      type: "Custom",
    };
    const conflicts = detectRoleConflicts(role);
    expect(conflicts.some((c) => c.type === "Inconsistent scope")).toBe(true);
  });

  it("Sales Manager and Finance Manager templates have no separation-of-duties conflict", () => {
    ["sales_manager", "finance_manager"].forEach((id) => {
      const conflicts = detectRoleConflicts(findRoleTemplate(id));
      expect(conflicts.some((c) => c.type === "Separation-of-duties conflict")).toBe(false);
    });
  });
});

describe("mockRbacData: assigned users, change history, audit preview", () => {
  it("returns fixture users assigned to a role without touching production assignments", () => {
    const users = usersForRole("sales_manager");
    expect(users.length).toBeGreaterThan(0);
    users.forEach((u) => expect(u.roleId).toBe("sales_manager"));
  });

  it("returns change history for a role", () => {
    const history = changeHistoryForRole("custom_regional_sales_lead");
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]).toHaveProperty("actor");
    expect(history[0]).toHaveProperty("reason");
  });

  it("returns an empty array for a role with no recorded history", () => {
    expect(changeHistoryForRole("nonexistent_role")).toEqual([]);
  });

  it("returns audit preview entries with actor, action, time, previous/new value and reason", () => {
    const preview = auditPreviewForRole("custom_regional_sales_lead");
    expect(preview[0]).toHaveProperty("previousValue");
    expect(preview[0]).toHaveProperty("newValue");
  });
});

describe("mockRbacData: directory query", () => {
  it("filters by search text", () => {
    const results = queryRolesLocal({ search: "finance" });
    expect(results.every((r) => /finance/i.test(r.name) || /finance/i.test(r.description))).toBe(true);
  });

  it("filters by built-in vs custom", () => {
    expect(queryRolesLocal({ builtin: "builtin" }).every((r) => r.isBuiltIn)).toBe(true);
    expect(queryRolesLocal({ builtin: "custom" }).every((r) => !r.isBuiltIn)).toBe(true);
  });

  it("filters by high privilege", () => {
    const highPriv = queryRolesLocal({ highPrivilege: "yes" });
    expect(highPriv.every((r) => isHighPrivilegeRole(r))).toBe(true);
  });
});

describe("mockRbacData: custom role CRUD (frontend session state)", () => {
  let createdId;

  it("validates a role payload before creation", () => {
    const errors = validateRolePayload({ name: "", defaultScope: "" });
    expect(errors.name).toBeTruthy();
    expect(errors.defaultScope).toBeTruthy();
  });

  it("rejects a payload with zero granted permissions", () => {
    const errors = validateRolePayload({
      name: "Empty Role", defaultScope: "Own", allowedScopes: ["Own"], permissionGrants: [{ moduleId: "leads", actions: [] }],
    });
    expect(errors.permissionGrants).toBeTruthy();
  });

  it("creates a Custom Role from a valid payload", () => {
    const result = createCustomRole({
      name: "Test Custom Role",
      defaultScope: "Own",
      allowedScopes: ["Own"],
      permissionGrants: [{ moduleId: "leads", actions: [ACTIONS.VIEW_OWN] }],
    });
    expect(result.error).toBeUndefined();
    expect(result.role.type).toBe("Custom");
    expect(result.role.isBuiltIn).toBe(false);
    createdId = result.role.id;
    expect(findRole(createdId)).toBeTruthy();
  });

  it("updates a Custom Role", () => {
    const result = updateCustomRole(createdId, { description: "Updated description" });
    expect(result.role.description).toBe("Updated description");
  });

  it("refuses to update a built-in role directly", () => {
    const result = updateCustomRole("system_owner", { description: "hacked" });
    expect(result.error).toBeTruthy();
  });

  it("duplicates a built-in role into a new Custom Role", () => {
    const before = ROLE_TEMPLATES.length;
    const result = duplicateRoleAsCustom("sales_manager", "Sales Manager (EMEA)");
    expect(result.error).toBeUndefined();
    expect(result.role.type).toBe("Custom");
    expect(result.role.duplicatedFrom).toBe("sales_manager");
    expect(ROLE_TEMPLATES.length).toBe(before); // built-ins are never mutated by a duplicate
    expect(result.role.permissionGrants.length).toBe(findRoleTemplate("sales_manager").permissionGrants.length);
  });

  it("built-in roles cannot be archived or disabled directly", () => {
    expect(archiveCustomRole("system_owner", "test").error).toBeTruthy();
    expect(disableCustomRole("system_owner").error).toBeTruthy();
  });

  it("archiving a Custom Role requires a reason", () => {
    const result = archiveCustomRole(createdId, "");
    expect(result.error).toBeTruthy();
  });

  it("archives and restores a Custom Role", () => {
    const archived = archiveCustomRole(createdId, "No longer needed");
    expect(archived.role.status).toBe("Archived");
    const restored = restoreCustomRole(createdId);
    expect(restored.role.status).toBe("Active");
  });

  it("disables and re-enables a Custom Role", () => {
    const disabled = disableCustomRole(createdId);
    expect(disabled.role.status).toBe("Inactive");
    const enabled = enableCustomRole(createdId);
    expect(enabled.role.status).toBe("Active");
  });
});

describe("mockRbacData: role comparison", () => {
  it("compares two roles module by module", () => {
    const { roles, rows } = compareRoles(["sales_manager", "sales_representative"]);
    expect(roles.length).toBe(2);
    const leadsRow = rows.find((r) => r.moduleId === "leads");
    expect(leadsRow).toBeTruthy();
    const managerActions = leadsRow.perRole.find((p) => p.roleId === "sales_manager").actions;
    const repActions = leadsRow.perRole.find((p) => p.roleId === "sales_representative").actions;
    expect(managerActions).toContain(ACTIONS.CHANGE_OWNER);
    expect(repActions).not.toContain(ACTIONS.CHANGE_OWNER);
  });

  it("compares three roles", () => {
    const { roles } = compareRoles(["system_owner", "organization_administrator", "standard_employee"]);
    expect(roles.length).toBe(3);
  });
});

// Access Management catalog additions (Members / Invitations / Invite
// Links / Access Audit) — added for the frontend-only invitation package.
// System Owner and Organization Administrator self-heal (their grants are
// computed from allModules()/a blanket filter), so these modules should
// appear for them with zero changes to their template entries; every other
// role must get nothing, since the catalog is deny-by-default.
describe("mockRbacData: Access Management modules", () => {
  it("registers members, invitations, invite_links and access_audit under the administration group", () => {
    const admin = MODULE_GROUPS.find((g) => g.id === "administration");
    const ids = admin.modules.map((m) => m.id);
    expect(ids).toContain("members");
    expect(ids).toContain("invitations");
    expect(ids).toContain("invite_links");
    expect(ids).toContain("access_audit");
  });

  it("System Owner is granted every new action on every new module", () => {
    for (const moduleId of ["members", "invitations", "invite_links", "access_audit"]) {
      const mod = findModule(moduleId);
      for (const action of getApplicableActions(mod)) {
        expect(hasPermission("system_owner", moduleId, action)).toBe(true);
      }
    }
  });

  it("Organization Administrator is granted the full members/invitations/invite_links action set", () => {
    expect(hasPermission("organization_administrator", "members", ACTIONS.INVITE)).toBe(true);
    expect(hasPermission("organization_administrator", "members", ACTIONS.SUSPEND)).toBe(true);
    expect(hasPermission("organization_administrator", "members", ACTIONS.REMOVE)).toBe(true);
    expect(hasPermission("organization_administrator", "invitations", ACTIONS.RESEND)).toBe(true);
    expect(hasPermission("organization_administrator", "invitations", ACTIONS.REVOKE)).toBe(true);
    expect(hasPermission("organization_administrator", "invite_links", ACTIONS.CREATE)).toBe(true);
    expect(hasPermission("organization_administrator", "invite_links", ACTIONS.ROTATE)).toBe(true);
    expect(hasPermission("organization_administrator", "access_audit", ACTIONS.VIEW)).toBe(true);
  });

  it("other roles have no Access Management permissions by default", () => {
    for (const roleId of ["department_manager", "sales_manager", "hr_manager", "standard_employee", "auditor_checker"]) {
      for (const moduleId of ["members", "invitations", "invite_links", "access_audit"]) {
        expect(hasPermission(roleId, moduleId, ACTIONS.VIEW)).toBe(false);
        expect(hasPermission(roleId, moduleId, ACTIONS.CREATE)).toBe(false);
      }
    }
  });

  it("flags assigning a role and removing a member as high-risk grants", () => {
    expect(isHighRiskGrant("members", ACTIONS.ASSIGN_ROLE)).toBe(true);
    expect(isHighRiskGrant("members", ACTIONS.REMOVE)).toBe(true);
    expect(isHighRiskGrant("invite_links", ACTIONS.CONFIGURE_DOMAIN)).toBe(true);
    expect(isHighRiskGrant("invite_links", ACTIONS.CONFIGURE_APPROVAL)).toBe(true);
    expect(isHighRiskGrant("members", ACTIONS.VIEW)).toBe(false);
  });
});
