// Centralized, provider-neutral frontend fixtures for Documents, Storage and
// Electronic Signature Integrations (/admin/integrations/documents-storage/*)
// — Phase 6 preview, extending (never forking) the Phase 1-5 Integration
// Center architecture in mockIntegrationsData.js.
//
// STRICT BOUNDARY: nothing here contacts a real provider, uploads/downloads/
// deletes a real file, creates a real folder or public sharing link, sends a
// real signature request, opens a real signing session, or applies a real
// signature. Every simulated connection stays "Frontend Connection Preview",
// every sync "Preview Synchronization", every signature workflow "Signature
// Workflow Preview".
//
// CRITICAL: no standalone Documents/Files module exists anywhere in this
// codebase (confirmed by research). File storage today is ad hoc `files:[]`
// arrays embedded in Leads/Companies/Contacts/Deals/Quotes/Orders/Contracts/
// Catalog items, holding `{ _id, name, size, type, dataUrl, uploadedBy,
// uploadedAt }` — no provider/source metadata. This file's external-file
// references are a NEW preview-only layer that associates with those real
// records by id; it never reads, copies or duplicates their `dataUrl`
// binary content. Projects/Tasks/Support Tickets/Invoices/Payments have no
// file field at all — association there is still offered (the spec
// requires it) as a pure preview-layer reference.
//
// NO IMPORT FROM mockIntegrationsData.js HERE — same circular-import hazard
// documented in every prior phase's data file. Provider-catalog factories
// come from the dependency-free mockIntegrationsContracts.js.
//
// `createSeparationOfDutiesCheck` is imported directly from Phase 5's data
// file rather than reimplemented — it's a pure, provider-agnostic function
// with no phase-specific dependency, so this one import does not reopen any
// circular-import hazard (mockCommerceFinanceData.js does not import this
// file back).
import {
  createIntegrationProvider,
  createIntegrationCapability,
  createIntegrationPlanRequirement,
} from "./mockIntegrationsContracts";
import { ORGANIZATIONS, DEFAULT_ORGANIZATION_ID } from "./mockAccessData";
import { CRM_TEAM } from "./mockUsersData";
import { companies, contacts, leads, deals, findCompany, findContact, findDeal } from "./mockCrmData";
import { quotes, findQuoteRecord } from "./mockQuoteData";
import { findOrderRecord } from "./mockOrderData";
import { contracts, findContractRecord } from "./mockContractData";
import { projects, tasks } from "./mockProjectsData";
import { findTicket } from "./mockSupportData";
import { createSeparationOfDutiesCheck } from "./mockCommerceFinanceData";

const ORG_HQ = ORGANIZATIONS[0]?.id || DEFAULT_ORGANIZATION_ID;
const ORG_NIMBUS = ORGANIZATIONS[1]?.id || ORG_HQ;
const ORG_SOLSTICE = ORGANIZATIONS[2]?.id || ORG_HQ;

const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(n) { return new Date(Date.now() - n * DAY_MS).toISOString(); }
function daysFromNow(n) { return new Date(Date.now() + n * DAY_MS).toISOString(); }
function hoursAgo(n) { return new Date(Date.now() - n * 60 * 60 * 1000).toISOString(); }

// Generic connection-health factory — same trivial local shape every prior
// phase's fixture file defines for itself.
function health(overrides = {}) {
  return { status: "Healthy", lastCheckedAt: new Date().toISOString(), issues: [], ...overrides };
}

// ---------------------------------------------------------------------------
// Canonical enums (verbatim from spec)
// ---------------------------------------------------------------------------
export const FileStateCanonical = [
  "Available", "Processing Preview", "Linked", "Unlinked", "New Version Available",
  "Synchronization Required", "Conflict", "Restricted", "Archived", "Retention Hold",
  "Deleted at Provider", "Unavailable", "Unknown",
];
export const SignatureEnvelopeStateCanonical = [
  "Draft", "Prepared", "Approval Required", "Ready for Send Preview", "Sent Preview",
  "Viewed Preview", "Partially Signed Preview", "Signed Preview", "Declined Preview",
  "Expired Preview", "Voided Preview", "Failed Preview",
];
export const FileClassification = [
  "Public", "Internal", "Confidential", "Restricted", "Financial", "Legal", "Personal Data", "HR Restricted",
];
export const RESTRICTED_CLASSIFICATIONS = ["Restricted", "Financial", "Legal", "Personal Data", "HR Restricted"];
export const RetentionStateCanonical = [
  "Active", "Review Due", "Archive Due", "Deletion Review Due", "On Hold",
  "Legal Hold", "Expired", "Policy Missing", "Restricted",
];
export const RecipientRole = ["Signer", "Approver", "Reviewer", "Acknowledgement Recipient", "Receives Copy", "Internal Witness"];
export const RecipientStatus = ["Pending", "Sent Preview", "Viewed Preview", "Signed Preview", "Declined Preview", "Expired Preview"];
export const AuthenticationMethod = [
  "Email access", "SMS verification", "Access code", "Knowledge-based verification",
  "Identity verification", "Provider account authentication",
];
export const FieldOwnershipOptions = [
  "CRM metadata wins", "Provider metadata wins", "Newest permitted value", "Manual review required",
  "Provider-only file", "CRM-only file", "Linked reference only", "Do not synchronize",
];
export const DocumentSyncConflictType = [
  "File-name mismatch", "Folder mismatch", "Owner mismatch", "Permission mismatch",
  "Classification mismatch", "Version mismatch", "Record-association mismatch", "Retention mismatch",
  "Deleted provider file", "Missing provider file", "Duplicate file reference", "Wrong organization",
  "Restricted-field conflict", "Signature-status mismatch",
];
export const DocumentSyncConflictResolution = [
  "Keep CRM metadata", "Keep provider metadata", "Use newest permitted metadata", "Update association preview",
  "Map manually", "Unlink preview", "Ignore preview event", "Escalate for review",
];
export const RelationshipType = [
  "Attachment", "Proposal", "Quote", "Order Document", "Contract", "Invoice",
  "Project Deliverable", "Support Evidence", "Identity Document", "Other",
];
export const MAPPING_REVIEW_REQUIRED = "Mapping Review Required";

// ---------------------------------------------------------------------------
// Providers — Dropbox/Box ("Documents", already an existing category) +
// Dropbox Sign/Adobe Acrobat Sign ("Electronic Signature", already
// existing). Capabilities are deliberately named per the spec's own
// capability lists.
// ---------------------------------------------------------------------------
function cap(id, name, crmModule, requiredPermission, extra = {}) {
  return createIntegrationCapability({ id, name, crmModule, direction: "read", requiredPermission, ...extra });
}

export const PHASE6_PROVIDERS = [
  createIntegrationProvider({
    key: "dropbox", name: "Dropbox", category: "Documents",
    shortDescription: "Preview Dropbox team spaces, folders, files and shared links against linked CRM records.",
    longDescription: "Frontend-only preview of Dropbox team-space/folder/file metadata, shared links and member access, mapped to Caspira records.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Subscription Required", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Companies", "Deals", "Contracts", "Projects"],
    capabilities: [
      cap("dropbox_team_spaces", "Team spaces", "Organization", "storage_connections.manage"),
      cap("dropbox_folders", "Folders", "Organization", "folder_mappings.view"),
      cap("dropbox_files", "Files and File metadata", "Organization", "external_files.view"),
      cap("dropbox_shared_links", "Shared links", "Organization", "file_permissions.view", { sensitiveData: true }),
      cap("dropbox_member_access", "Member access", "Organization", "file_permissions.view", { sensitiveData: true }),
      cap("dropbox_versions", "Version metadata", "Organization", "file_versions.view"),
      cap("dropbox_associations", "CRM associations", "Organization", "external_files.link"),
    ],
    dataLeavingCrm: ["Nothing — Dropbox is read/preview only in this phase."],
    dataEnteringCrm: ["File/folder reference metadata only. File contents are never retrieved."],
    knownLimitations: ["No file is ever uploaded, downloaded, moved or deleted.", "No real shared link is ever created."],
    securityNotes: ["No Dropbox access token is stored anywhere in this preview."],
    icon: "FolderOpenDot",
  }),
  createIntegrationProvider({
    key: "box", name: "Box", category: "Documents",
    shortDescription: "Preview Box enterprise folders, files, collaborators and classification references.",
    longDescription: "Frontend-only preview of Box enterprise-folder/file metadata, collaborators, shared links and classification references.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Subscription Required", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Companies", "Deals", "Contracts", "Projects"],
    capabilities: [
      cap("box_enterprise_folders", "Enterprise folders", "Organization", "folder_mappings.view"),
      cap("box_files", "Files and File metadata", "Organization", "external_files.view"),
      cap("box_collaborators", "Collaborators", "Organization", "file_permissions.view", { sensitiveData: true }),
      cap("box_shared_links", "Shared links", "Organization", "file_permissions.view", { sensitiveData: true }),
      cap("box_versions", "Version metadata", "Organization", "file_versions.view"),
      cap("box_classification", "Classification references", "Organization", "file_classification.view"),
      cap("box_associations", "CRM associations", "Organization", "external_files.link"),
    ],
    dataLeavingCrm: ["Nothing — Box is read/preview only in this phase."],
    dataEnteringCrm: ["File/folder reference metadata and classification references only."],
    knownLimitations: ["No file is ever uploaded, downloaded, moved or deleted.", "No real shared link is ever created."],
    securityNotes: ["No Box access token is stored anywhere in this preview."],
    icon: "Box",
  }),
  createIntegrationProvider({
    key: "dropbox_sign", name: "Dropbox Sign", category: "Electronic Signature",
    shortDescription: "Preview Dropbox Sign templates, signature requests, signers and status.",
    longDescription: "Frontend-only preview of Dropbox Sign template/signature-request/signer/field/status/reminder/expiration metadata.",
    authMethod: "API Key",
    credentialFieldInfo: { label: "Dropbox Sign API Key", disabledPlaceholder: "Credentials will be configured securely during backend integration." },
    pricingClassification: "Provider Subscription Required", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Quotes", "Orders", "Contracts"],
    capabilities: [
      cap("dsign_templates", "Templates", "Contracts", "signature_templates.view"),
      cap("dsign_requests_documents", "Signature requests and Documents", "Contracts", "signature_workflows.view"),
      cap("dsign_signers_order", "Signers and Signing order", "Contracts", "signature_workflows.view"),
      cap("dsign_fields", "Fields", "Contracts", "signature_templates.view"),
      cap("dsign_status", "Status", "Contracts", "signature_workflows.view"),
      cap("dsign_reminders_expiration", "Reminders and Expiration", "Contracts", "signature_workflows.remind_preview"),
    ],
    dataLeavingCrm: ["Nothing — Dropbox Sign is read/preview only in this phase."],
    dataEnteringCrm: ["Signature workflow/status reference metadata only."],
    knownLimitations: ["No signature request is ever sent.", "No signature is ever applied."],
    securityNotes: ["No Dropbox Sign API key is stored anywhere in this preview."],
    icon: "PenLine",
  }),
  createIntegrationProvider({
    key: "adobe_acrobat_sign", name: "Adobe Acrobat Sign", category: "Electronic Signature",
    shortDescription: "Preview Adobe Acrobat Sign library templates, agreements, participants and audit metadata.",
    longDescription: "Frontend-only preview of Adobe Acrobat Sign library-template/agreement/document/recipient/participant-role/status/reminder/audit metadata.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Subscription Required", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Quotes", "Orders", "Contracts"],
    capabilities: [
      cap("adobe_library_templates", "Library templates", "Contracts", "signature_templates.view"),
      cap("adobe_agreements_documents", "Agreements and Documents", "Contracts", "signature_workflows.view"),
      cap("adobe_recipients_roles", "Recipients and Participant roles", "Contracts", "signature_workflows.view"),
      cap("adobe_signing_order_status", "Signing order and Status", "Contracts", "signature_workflows.view"),
      cap("adobe_reminders_expiration", "Reminders and Expiration", "Contracts", "signature_workflows.remind_preview"),
      cap("adobe_audit_metadata", "Audit metadata", "Contracts", "signature_audit.view"),
    ],
    dataLeavingCrm: ["Nothing — Adobe Acrobat Sign is read/preview only in this phase."],
    dataEnteringCrm: ["Agreement/status/audit reference metadata only."],
    knownLimitations: ["No agreement is ever sent for signature.", "No signature is ever applied."],
    securityNotes: ["No Adobe Acrobat Sign OAuth token is stored anywhere in this preview."],
    icon: "FileSignature",
  }),
];

// ---------------------------------------------------------------------------
// Folders, files, associations.
// ---------------------------------------------------------------------------
export function createExternalFolderReference({ id, providerKey, organizationId, folderName, parentFolderId = null, crmScope }) {
  return { id, providerKey, organizationId, folderName, parentFolderId, crmScope, health: health({}) };
}
export const EXTERNAL_FOLDERS = [
  createExternalFolderReference({ id: "fold_1", providerKey: "google_workspace", organizationId: ORG_HQ, folderName: "Caspira HQ / Companies", crmScope: "Organization root folder" }),
  createExternalFolderReference({ id: "fold_2", providerKey: "dropbox", organizationId: ORG_HQ, folderName: "Contracts/Signed", parentFolderId: "fold_1", crmScope: "Contract folder" }),
  createExternalFolderReference({ id: "fold_3", providerKey: "box", organizationId: ORG_NIMBUS, folderName: "Nimbus Retail/Deals", crmScope: "Deal folder" }),
];
export function queryExternalFoldersLocal(filters = {}) {
  let results = EXTERNAL_FOLDERS.slice();
  if (filters.organizationId) results = results.filter((f) => f.organizationId === filters.organizationId);
  return results;
}

export function createExternalFileReference({
  id, providerKey, organizationId, folderId = null, fileName, fileType, sizeBytes, contentType = "application/octet-stream",
  owner, versionNumber = 1, sharingState = "Private", collaborators = [], classification = "Internal",
  scanStatus = "Clean", canonicalState = "Available", createdAt = new Date().toISOString(), updatedAt = new Date().toISOString(),
  syncState = "Synced",
}) {
  return {
    id, providerKey, organizationId, folderId, fileName, fileType, sizeBytes, contentType, owner, versionNumber,
    sharingState, collaborators, classification, scanStatus, canonicalState, createdAt, updatedAt, syncState,
  };
}
export const EXTERNAL_FILES = [
  createExternalFileReference({ id: "file_1", providerKey: "google_workspace", organizationId: ORG_HQ, folderId: "fold_1", fileName: "Caspira HQ - Master Services Agreement.pdf", fileType: "PDF", sizeBytes: 482_000, owner: "Dominic Wuckert", classification: "Legal", canonicalState: "Linked", updatedAt: hoursAgo(3) }),
  createExternalFileReference({ id: "file_2", providerKey: "dropbox", organizationId: ORG_HQ, folderId: "fold_2", fileName: "Renewal Proposal Q3.pdf", fileType: "PDF", sizeBytes: 210_000, owner: "Priya Nair", classification: "Confidential", canonicalState: "New Version Available", updatedAt: hoursAgo(20), versionNumber: 3 }),
  createExternalFileReference({ id: "file_3", providerKey: "microsoft_365", organizationId: ORG_HQ, folderId: null, fileName: "Payroll Summary — Internal.xlsx", fileType: "Spreadsheet", sizeBytes: 88_000, owner: "Grace Kim", classification: "HR Restricted", canonicalState: "Restricted", sharingState: "Restricted", updatedAt: daysAgo(2) }),
  createExternalFileReference({ id: "file_4", providerKey: "box", organizationId: ORG_NIMBUS, folderId: "fold_3", fileName: "Nimbus Rollout Deck.pptx", fileType: "Presentation", sizeBytes: 3_400_000, owner: "Marcus Chen", classification: "Internal", canonicalState: "Unlinked", sharingState: "Public Link", updatedAt: daysAgo(1) }),
  createExternalFileReference({ id: "file_5", providerKey: "dropbox", organizationId: ORG_HQ, folderId: "fold_2", fileName: "Invoice INV-8021 — Finance.pdf", fileType: "PDF", sizeBytes: 64_000, owner: "Fatima Al-Sayed", classification: "Financial", canonicalState: "Synchronization Required", updatedAt: hoursAgo(30), syncState: "Conflict" }),
  createExternalFileReference({ id: "file_6", providerKey: "google_workspace", organizationId: ORG_SOLSTICE, folderId: null, fileName: "Unknown External Reference.docx", fileType: "Document", sizeBytes: 12_000, owner: "External Collaborator", classification: "Internal", canonicalState: "Unavailable", sharingState: "External Collaborator", updatedAt: daysAgo(9) }),
];
export function findExternalFile(id) { return EXTERNAL_FILES.find((f) => f.id === id) || null; }
export function queryExternalFilesLocal(filters = {}) {
  let results = EXTERNAL_FILES.slice();
  if (filters.organizationId) results = results.filter((f) => f.organizationId === filters.organizationId);
  if (filters.providerKey) results = results.filter((f) => f.providerKey === filters.providerKey);
  if (filters.classification) results = results.filter((f) => f.classification === filters.classification);
  if (filters.canonicalState) results = results.filter((f) => f.canonicalState === filters.canonicalState);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    results = results.filter((f) => f.fileName.toLowerCase().includes(q));
  }
  return results;
}
export function unlinkExternalFile(fileId, reason) {
  if (!reason?.trim()) return { error: "A written reason is required to unlink a file preview." };
  const idx = EXTERNAL_FILES.findIndex((f) => f.id === fileId);
  if (idx === -1) return { error: "File not found." };
  const [removed] = EXTERNAL_FILES.splice(idx, 1);
  return { removed, reason };
}

export function createFileAssociation({ id, fileId, crmModule, crmRecordId, relationshipType, visibility = "Internal" }) {
  return { id, fileId, crmModule, crmRecordId, relationshipType, visibility };
}
export const FILE_ASSOCIATIONS = [
  createFileAssociation({ id: "assoc_1", fileId: "file_1", crmModule: "Company", crmRecordId: companies[0]?._id || null, relationshipType: "Contract" }),
  createFileAssociation({ id: "assoc_2", fileId: "file_2", crmModule: "Deal", crmRecordId: deals[0]?._id || null, relationshipType: "Proposal" }),
];
export function queryFileAssociationsLocal(filters = {}) {
  let results = FILE_ASSOCIATIONS.slice();
  if (filters.fileId) results = results.filter((a) => a.fileId === filters.fileId);
  return results;
}
let lastAssociationUndo = null;
// Modules whose real record array/finder is confirmed and browsable today —
// every other listed relationship target (Invoice, and the file-less
// Projects/Tasks/Support-Ticket destinations) is offered as a relationship
// option but never resolves to a working deep link, matching the spec's
// "do not link to an unfinished route" instruction.
const RESOLVABLE_CRM_MODULES = {
  Company: (id) => findCompany(id),
  Contact: (id) => findContact(id),
  Lead: (id) => leads.find((l) => l._id === id),
  Deal: (id) => findDeal(id),
  Quote: (id) => findQuoteRecord(id),
  Order: (id) => findOrderRecord(id),
  Contract: (id) => findContractRecord(id),
  Project: (id) => projects.find((p) => p._id === id),
  Task: (id) => tasks.find((t) => t._id === id),
  "Support Ticket": (id) => findTicket(id),
};
export function resolveCrmRecordLabel(crmModule, crmRecordId) {
  const resolver = RESOLVABLE_CRM_MODULES[crmModule];
  if (!resolver) return { available: false, label: `${crmModule} — requires a future module` };
  const record = resolver(crmRecordId);
  if (!record) return { available: false, label: "Record not found" };
  return { available: true, label: record.name || record.fileName || record.contractNumber || record.quoteNumber || record.orderNumber || record.subject || record._id };
}
export function associateFilePreview({ fileId, crmModule, crmRecordId, relationshipType, visibility }, actorName = "Preview User") {
  const file = findExternalFile(fileId);
  if (!file) return { error: "File not found." };
  if (crmModule !== "Invoice" && !RESOLVABLE_CRM_MODULES[crmModule]) return { error: "Unsupported CRM module." };
  const association = createFileAssociation({ id: `assoc_${FILE_ASSOCIATIONS.length + 1}`, fileId, crmModule, crmRecordId, relationshipType, visibility });
  FILE_ASSOCIATIONS.push(association);
  lastAssociationUndo = { associationId: association.id };
  return { association, associatedBy: actorName };
}
export function undoLastAssociation() {
  if (!lastAssociationUndo) return { error: "Nothing to undo in the current session." };
  const idx = FILE_ASSOCIATIONS.findIndex((a) => a.id === lastAssociationUndo.associationId);
  if (idx >= 0) FILE_ASSOCIATIONS.splice(idx, 1);
  lastAssociationUndo = null;
  return { undone: true };
}

// ---------------------------------------------------------------------------
// Folder mappings (reusable across CRM scopes) + document sync conflicts.
// ---------------------------------------------------------------------------
export function createFolderMapping({ id, providerKey, organizationId, providerFolderId, crmScope, namingPattern, creationPolicy = "Automatic on record creation", accessPolicy = "Inherit from CRM record", inheritance = "Inherit parent permissions", syncDirection = "Provider to CRM", validation = "Valid", conflictState = null }) {
  return { id, providerKey, organizationId, providerFolderId, crmScope, namingPattern, creationPolicy, accessPolicy, inheritance, syncDirection, validation, conflictState };
}
// "/" is deliberately excluded — naming patterns represent folder path
// templates (e.g. "Contracts/{contractNumber}") where "/" is the segment
// separator, not an illegal character. "\\" (Windows-style separator) stays
// illegal since providers use "/" exclusively for nesting.
const ILLEGAL_PROVIDER_CHARS = /[<>:"\\|?*]/;
export const NAMING_PLACEHOLDERS = ["{organizationName}", "{companyName}", "{recordNumber}", "{projectName}", "{contractNumber}", "{year}", "{month}"];
export function validateNamingPattern(pattern) {
  if (!pattern?.trim()) return { valid: false, reason: "Naming pattern cannot be empty." };
  if (ILLEGAL_PROVIDER_CHARS.test(pattern.replace(/\{[^}]+\}/g, ""))) return { valid: false, reason: "Naming pattern contains a character not allowed by storage providers (< > : \" / \\ | ? *)." };
  const placeholderMatches = pattern.match(/\{[^}]+\}/g) || [];
  const unknown = placeholderMatches.filter((p) => !NAMING_PLACEHOLDERS.includes(p));
  if (unknown.length > 0) return { valid: false, reason: `Unrecognized placeholder(s): ${unknown.join(", ")}. Only fixed placeholders are supported — no scripts or expressions.` };
  return { valid: true, reason: null };
}
export const FOLDER_MAPPINGS = [
  createFolderMapping({ id: "fm_1", providerKey: "google_workspace", organizationId: ORG_HQ, providerFolderId: "fold_1", crmScope: "Organization root folder", namingPattern: "{organizationName}" }),
  createFolderMapping({ id: "fm_2", providerKey: "dropbox", organizationId: ORG_HQ, providerFolderId: "fold_2", crmScope: "Contract folder", namingPattern: "Contracts/{contractNumber}", conflictState: "Naming collision with fm_1" }),
  createFolderMapping({ id: "fm_3", providerKey: "box", organizationId: ORG_NIMBUS, providerFolderId: "fold_3", crmScope: "Deal folder", namingPattern: "{companyName}/Deals" }),
];
export function queryFolderMappingsLocal(filters = {}) {
  let results = FOLDER_MAPPINGS.slice();
  if (filters.organizationId) results = results.filter((m) => m.organizationId === filters.organizationId);
  return results;
}

export function createDocumentSyncConflict({ id, conflictType, providerKey, organizationId, fileId = null, description, resolutionState = "Open" }) {
  return { id, conflictType, providerKey, organizationId, fileId, description, resolutionState };
}
export const DOCUMENT_SYNC_CONFLICTS = [
  createDocumentSyncConflict({ id: "dsc_1", conflictType: "Version mismatch", providerKey: "dropbox", organizationId: ORG_HQ, fileId: "file_5", description: "CRM reference is on version 2; Dropbox shows version 3 available." }),
  createDocumentSyncConflict({ id: "dsc_2", conflictType: "Wrong organization", providerKey: "google_workspace", organizationId: ORG_SOLSTICE, fileId: "file_6", description: "File is linked to Caspira HQ but the provider folder belongs to Solstice Partners.", resolutionState: "Resolved" }),
];
export function queryDocumentSyncConflictsLocal(filters = {}) {
  let results = DOCUMENT_SYNC_CONFLICTS.slice();
  if (filters.organizationId) results = results.filter((c) => c.organizationId === filters.organizationId);
  return results;
}
export function resolveDocumentSyncConflict(conflictId, resolution, actorName = "Preview User") {
  const conflict = DOCUMENT_SYNC_CONFLICTS.find((c) => c.id === conflictId);
  if (!conflict) return { error: "Conflict not found." };
  if (!DocumentSyncConflictResolution.includes(resolution)) return { error: "Unrecognized resolution." };
  conflict.resolutionState = "Resolved";
  conflict.resolution = resolution;
  conflict.resolvedBy = actorName;
  return { conflict };
}

// ---------------------------------------------------------------------------
// Access review — detected risks over EXTERNAL_FILES, always excluding
// unauthorized records first (callers pass an already-scoped file list).
// ---------------------------------------------------------------------------
function accessFinding({ id, type, file, why, affectedUsers = [], supportingPermission, requiredAction, requiredApprover = "Organization Administrator" }) {
  return {
    id, type, fileId: file.id, fileName: file.fileName, providerKey: file.providerKey, classification: file.classification,
    why, affectedUsers, supportingPermission, requiredAction, requiredApprover, freshness: new Date().toISOString(),
  };
}
export function computeAccessReviewFindings(files = EXTERNAL_FILES) {
  const findings = [];
  files.forEach((f) => {
    if (f.sharingState === "Public Link") {
      findings.push(accessFinding({ id: `risk_public_${f.id}`, type: "Public sharing link", file: f, why: "The file has an active public sharing link — anyone with the link can access it.", supportingPermission: f.sharingState, requiredAction: "Remove the public link or restrict access.", }));
    }
    if (f.sharingState === "External Collaborator") {
      findings.push(accessFinding({ id: `risk_external_${f.id}`, type: "External collaborator", file: f, why: "A collaborator outside the organization has access to this file.", affectedUsers: [f.owner], supportingPermission: f.sharingState, requiredAction: "Review whether external access is still required." }));
    }
    if (RESTRICTED_CLASSIFICATIONS.includes(f.classification) && (f.sharingState === "Public Link" || f.sharingState === "External Collaborator")) {
      findings.push(accessFinding({ id: `risk_restricted_shared_${f.id}`, type: "Restricted file shared externally", file: f, why: `A file classified as ${f.classification} is shared beyond the organization.`, supportingPermission: f.sharingState, requiredAction: "Revoke external access immediately.", requiredApprover: "Legal / Compliance" }));
    }
    if (f.canonicalState === "Unavailable" || f.owner === "External Collaborator") {
      findings.push(accessFinding({ id: `risk_missing_owner_${f.id}`, type: "Missing owner", file: f, why: "No verified internal owner is recorded for this file.", supportingPermission: "Owner field", requiredAction: "Assign a verified internal owner." }));
    }
    if (f.organizationId === ORG_SOLSTICE && f.providerKey === "google_workspace" && f.id === "file_6") {
      findings.push(accessFinding({ id: `risk_wrong_org_${f.id}`, type: "File linked to the wrong organization", file: f, why: "The provider folder belongs to a different organization than the file's CRM association.", supportingPermission: "Organization scope", requiredAction: "Re-link to the correct organization or unlink." }));
    }
  });
  return findings;
}

// ---------------------------------------------------------------------------
// Retention policies and legal holds.
// ---------------------------------------------------------------------------
export function createRetentionPolicy({ id, organizationId, providerKey = null, classification = null, recordType = null, folderId = null, contractStatus = null, projectStatus = null, legalRequirementReference = null, durationDays, archiveBehavior = "Archive after duration", reviewDate = null, deletionApprovalRequired = true, state = "Active" }) {
  return { id, organizationId, providerKey, classification, recordType, folderId, contractStatus, projectStatus, legalRequirementReference, durationDays, archiveBehavior, reviewDate, deletionApprovalRequired, state };
}
export const RETENTION_POLICIES = [
  createRetentionPolicy({ id: "rp_1", organizationId: ORG_HQ, classification: "Legal", durationDays: 2555, legalRequirementReference: "7-year contract retention", reviewDate: daysFromNow(400), state: "Active" }),
  createRetentionPolicy({ id: "rp_2", organizationId: ORG_HQ, classification: "Financial", durationDays: 2190, reviewDate: daysFromNow(20), state: "Review Due" }),
  createRetentionPolicy({ id: "rp_3", organizationId: ORG_NIMBUS, recordType: "Deal", durationDays: 730, reviewDate: daysAgo(5), state: "Archive Due" }),
  createRetentionPolicy({ id: "rp_4", organizationId: ORG_HQ, classification: "HR Restricted", durationDays: null, state: "Policy Missing" }),
];
export function queryRetentionPoliciesLocal(filters = {}) {
  let results = RETENTION_POLICIES.slice();
  if (filters.organizationId) results = results.filter((p) => p.organizationId === filters.organizationId);
  return results;
}

export function createLegalHoldPreview({ id, fileId, organizationId, reason, requestedBy, requiredApprover = "Legal / Compliance", effectiveDate = new Date().toISOString(), status = "Active" }) {
  return { id, fileId, organizationId, reason, requestedBy, requiredApprover, effectiveDate, status };
}
export const LEGAL_HOLDS = [
  createLegalHoldPreview({ id: "lh_1", fileId: "file_1", organizationId: ORG_HQ, reason: "Pending contract dispute review", requestedBy: CRM_TEAM[0]?.name || "Dominic Wuckert" }),
];
export function findLegalHold(id) { return LEGAL_HOLDS.find((h) => h.id === id) || null; }
export function queryLegalHoldsLocal(filters = {}) {
  let results = LEGAL_HOLDS.slice();
  if (filters.organizationId) results = results.filter((h) => h.organizationId === filters.organizationId);
  return results;
}
export function isFileOnLegalHold(fileId) {
  return LEGAL_HOLDS.some((h) => h.fileId === fileId && h.status === "Active");
}
export function removeLegalHold(id, { reason, requesterName, approverName }) {
  const hold = findLegalHold(id);
  if (!hold) return { error: "Legal hold not found." };
  if (!reason?.trim()) return { error: "A written reason is required to remove a legal hold." };
  const check = createSeparationOfDutiesCheck({ action: "legal_holds.manage", requester: requesterName, requiredApprover: hold.requiredApprover, approverName });
  if (!check.eligible) return { error: check.reason, check };
  hold.status = "Removed";
  hold.removalReason = reason;
  hold.removedBy = approverName;
  return { hold, check };
}
export function unlinkBlockedByLegalHold(fileId) {
  return isFileOnLegalHold(fileId);
}

// ---------------------------------------------------------------------------
// Signature templates, workflows, recipients, audit events.
// ---------------------------------------------------------------------------
export function createSignatureFieldMapping({ crmField, templateFieldLabel, fieldType = "Text field", restricted = false }) {
  return { crmField, templateFieldLabel, fieldType, restricted };
}
export function createSignatureTemplatePreview({ id, providerKey, organizationId, name, documentType, relatedCrmModule, recipientRoles = ["Signer"], fieldMappings = [], version = 1, status = "Active", updatedAt = new Date().toISOString() }) {
  return { id, providerKey, organizationId, name, documentType, relatedCrmModule, recipientRoles, fieldMappings, version, status, updatedAt };
}
export const SIGNATURE_TEMPLATES = [
  createSignatureTemplatePreview({
    id: "tmpl_quote_acceptance", providerKey: "docusign", organizationId: ORG_HQ, name: "Quote Acceptance", documentType: "Quote Acceptance", relatedCrmModule: "Quote",
    fieldMappings: [
      createSignatureFieldMapping({ crmField: "Company name", templateFieldLabel: "Client", fieldType: "Text field" }),
      createSignatureFieldMapping({ crmField: "Quote total", templateFieldLabel: "Total Due", fieldType: "Text field" }),
      createSignatureFieldMapping({ crmField: "Signature date", templateFieldLabel: "Date Signed", fieldType: "Signature date" }),
    ],
  }),
  createSignatureTemplatePreview({
    id: "tmpl_service_contract", providerKey: "dropbox_sign", organizationId: ORG_HQ, name: "Service Contract", documentType: "Service Contract", relatedCrmModule: "Contract", recipientRoles: ["Signer", "Approver"],
    fieldMappings: [
      createSignatureFieldMapping({ crmField: "Contract number", templateFieldLabel: "Agreement #", fieldType: "Text field" }),
      createSignatureFieldMapping({ crmField: "Contract start date", templateFieldLabel: "Effective Date", fieldType: "Text field" }),
      createSignatureFieldMapping({ crmField: "Authorized representative", templateFieldLabel: "Signatory Name", fieldType: "Text field", restricted: true }),
    ],
  }),
  createSignatureTemplatePreview({
    id: "tmpl_nda", providerKey: "adobe_acrobat_sign", organizationId: ORG_HQ, name: "Non-Disclosure Agreement", documentType: "Non-Disclosure Agreement", relatedCrmModule: "Company",
    fieldMappings: [createSignatureFieldMapping({ crmField: "Company name", templateFieldLabel: "Disclosing Party", fieldType: "Text field" })],
  }),
];
export function findSignatureTemplate(id) { return SIGNATURE_TEMPLATES.find((t) => t.id === id) || null; }
export function querySignatureTemplatesLocal(filters = {}) {
  let results = SIGNATURE_TEMPLATES.slice();
  if (filters.organizationId) results = results.filter((t) => t.organizationId === filters.organizationId);
  return results;
}

export function createSignatureRecipient({ name, email, role, routingOrder = 1, authMethod = "Email access", status = "Pending" }) {
  return { name, email, role, routingOrder, authMethod, status };
}
export function createSignatureAuditEvent({ eventType, actor, timestamp = new Date().toISOString() }) {
  return { eventType, actor, timestamp, isPreviewFixture: true };
}
export function createSignatureEnvelopePreview({
  id, providerKey, organizationId, sourceModule, sourceRecordId, templateId = null, documents = [],
  recipients = [], status = "Draft", approvalStatus = "Not Required", requestedBy = null, requiredApprover = null,
  reminderConfig = { enabled: true, initialDelayDays: 2, frequencyDays: 3, maxReminders: 3 },
  expirationConfig = { expirationDate: daysFromNow(30), warningDays: 5 },
  certificateMetadata = null, auditEvents = [], updatedAt = new Date().toISOString(),
}) {
  return {
    id, providerKey, organizationId, sourceModule, sourceRecordId, templateId, documents, recipients, status,
    approvalStatus, requestedBy, requiredApprover, reminderConfig, expirationConfig, certificateMetadata, auditEvents, updatedAt,
  };
}
export const SIGNATURE_ENVELOPES = [
  createSignatureEnvelopePreview({
    id: "env_1", providerKey: "docusign", organizationId: ORG_HQ, sourceModule: "Quote", sourceRecordId: quotes[0]?._id || null, templateId: "tmpl_quote_acceptance",
    documents: [{ id: "doc_1", name: "Quote-Acceptance.pdf" }], status: "Sent Preview", approvalStatus: "Approved",
    requestedBy: CRM_TEAM[1]?.name || "Priya Nair", requiredApprover: "Sales Manager",
    recipients: [createSignatureRecipient({ name: contacts[0] ? `${contacts[0].firstName} ${contacts[0].lastName}` : "Verified Contact", email: contacts[0]?.email || "contact@example.com", role: "Signer", routingOrder: 1, status: "Sent Preview" })],
    auditEvents: [createSignatureAuditEvent({ eventType: "Workflow created", actor: "Priya Nair" }), createSignatureAuditEvent({ eventType: "Send Preview confirmed", actor: "Priya Nair" })],
  }),
  createSignatureEnvelopePreview({
    id: "env_2", providerKey: "dropbox_sign", organizationId: ORG_HQ, sourceModule: "Contract", sourceRecordId: contracts[0]?._id || null, templateId: "tmpl_service_contract",
    documents: [{ id: "doc_2", name: "Service-Contract.pdf" }], status: "Approval Required", approvalStatus: "Pending",
    requestedBy: CRM_TEAM[0]?.name || "Dominic Wuckert", requiredApprover: "Contract / Legal Manager",
    recipients: [createSignatureRecipient({ name: "Internal Reviewer", email: "reviewer@caspira.example", role: "Reviewer", routingOrder: 1 })],
    auditEvents: [createSignatureAuditEvent({ eventType: "Workflow created", actor: "Dominic Wuckert" }), createSignatureAuditEvent({ eventType: "Internal approval requested", actor: "Dominic Wuckert" })],
  }),
  createSignatureEnvelopePreview({
    id: "env_3", providerKey: "adobe_acrobat_sign", organizationId: ORG_NIMBUS, sourceModule: "Contract", sourceRecordId: null, templateId: "tmpl_nda",
    documents: [{ id: "doc_3", name: "NDA.pdf" }], status: "Signed Preview", approvalStatus: "Approved",
    requestedBy: CRM_TEAM[2]?.name || "Marcus Chen", requiredApprover: "Contract / Legal Manager",
    recipients: [createSignatureRecipient({ name: "External Party", email: "external@partner.example", role: "Signer", status: "Signed Preview" })],
    certificateMetadata: { completedAt: daysAgo(3), previewOnly: true },
    auditEvents: [createSignatureAuditEvent({ eventType: "Signed Preview", actor: "External Party" })],
    updatedAt: daysAgo(3),
  }),
  createSignatureEnvelopePreview({
    id: "env_4", providerKey: "docusign", organizationId: ORG_HQ, sourceModule: "Quote", sourceRecordId: quotes[1]?._id || null, templateId: "tmpl_quote_acceptance",
    documents: [{ id: "doc_4", name: "Quote-Acceptance-2.pdf" }], status: "Expired Preview", approvalStatus: "Approved",
    requestedBy: CRM_TEAM[1]?.name || "Priya Nair", requiredApprover: "Sales Manager",
    recipients: [createSignatureRecipient({ name: "Unresponsive Client", email: "client@unresponsive.example", role: "Signer", status: "Expired Preview" })],
    expirationConfig: { expirationDate: daysAgo(1), warningDays: 5 },
  }),
];
export function findSignatureEnvelope(id) { return SIGNATURE_ENVELOPES.find((e) => e.id === id) || null; }
export function querySignatureEnvelopesLocal(filters = {}) {
  let results = SIGNATURE_ENVELOPES.slice();
  if (filters.organizationId) results = results.filter((e) => e.organizationId === filters.organizationId);
  if (filters.status) results = results.filter((e) => e.status === filters.status);
  return results;
}

// Source-record status gates — mirrors the spec's "Contract or Quote status
// permits signature" validation rule using the REAL status enums.
const QUOTE_STATUSES_ALLOWING_SIGNATURE = ["Approved", "Preview Sent", "Preview Viewed"];
const ORDER_STATUSES_ALLOWING_SIGNATURE = ["Pending Review", "Confirmed"];
const CONTRACT_STATUSES_ALLOWING_SIGNATURE = ["Pending Internal Review", "Sent for Signature"];
function sourceRecordPermitsSignature(sourceModule, record) {
  if (sourceModule === "Quote") return QUOTE_STATUSES_ALLOWING_SIGNATURE.includes(record.status);
  if (sourceModule === "Order") return ORDER_STATUSES_ALLOWING_SIGNATURE.includes(record.status);
  if (sourceModule === "Contract") return CONTRACT_STATUSES_ALLOWING_SIGNATURE.includes(record.status);
  return true;
}
const SOURCE_RECORD_RESOLVERS = { Quote: findQuoteRecord, Order: findOrderRecord, Contract: findContractRecord };

export function validateSignatureWorkflowDraft({ sourceModule, sourceRecordId, documents, templateId, recipients, hasApproval }) {
  const checks = [];
  const pass = (label) => checks.push({ label, passed: true });
  const fail = (label) => checks.push({ label, passed: false });

  const resolver = SOURCE_RECORD_RESOLVERS[sourceModule];
  const record = resolver ? resolver(sourceRecordId) : null;
  record ? pass("Source record exists") : fail("Source record exists");
  (documents && documents.length > 0) ? pass("Document exists") : fail("Document exists");
  const template = templateId ? findSignatureTemplate(templateId) : null;
  const requiredFieldsMapped = template ? template.fieldMappings.length > 0 : false;
  requiredFieldsMapped ? pass("Required fields are mapped") : fail("Required fields are mapped");
  const signers = (recipients || []).filter((r) => r.role !== "Receives Copy");
  const emailsValid = signers.length > 0 && signers.every((r) => !!r.email && !!r.role);
  emailsValid ? pass("Recipient email is available and permitted") : fail("Recipient email is available and permitted");
  const rolesComplete = signers.every((r) => RecipientRole.includes(r.role));
  rolesComplete ? pass("Recipient roles are complete") : fail("Recipient roles are complete");
  const orders = signers.map((r) => r.routingOrder);
  const orderValid = orders.length === new Set(orders).size && orders.every((o) => Number.isInteger(o) && o >= 1);
  orderValid ? pass("Signing order is valid") : fail("Signing order is valid");
  hasApproval ? pass("Required internal approval exists") : fail("Required internal approval exists");
  const conflicting = SIGNATURE_ENVELOPES.some((e) => e.sourceModule === sourceModule && e.sourceRecordId === sourceRecordId && !["Signed Preview", "Declined Preview", "Voided Preview", "Expired Preview"].includes(e.status));
  !conflicting ? pass("No conflicting active workflow exists") : fail("No conflicting active workflow exists");
  const statusPermits = record ? sourceRecordPermitsSignature(sourceModule, record) : false;
  statusPermits ? pass(`${sourceModule} status permits signature`) : fail(`${sourceModule} status permits signature`);

  return { valid: checks.every((c) => c.passed), checks, record, template };
}

export function createSignatureWorkflowPreview(draft, actorName = "Preview User") {
  const { valid, checks } = validateSignatureWorkflowDraft(draft);
  if (!valid) return { error: "This workflow does not yet meet all requirements for a signature preview.", checks };
  const envelope = createSignatureEnvelopePreview({
    id: `env_${SIGNATURE_ENVELOPES.length + 1}`, providerKey: draft.providerKey, organizationId: draft.organizationId,
    sourceModule: draft.sourceModule, sourceRecordId: draft.sourceRecordId, templateId: draft.templateId,
    documents: draft.documents, recipients: draft.recipients, status: "Draft", approvalStatus: draft.hasApproval ? "Approved" : "Pending",
    requestedBy: actorName, requiredApprover: draft.requiredApprover,
    reminderConfig: draft.reminderConfig, expirationConfig: draft.expirationConfig,
    auditEvents: [createSignatureAuditEvent({ eventType: "Workflow created", actor: actorName }), createSignatureAuditEvent({ eventType: "Document added", actor: actorName }), createSignatureAuditEvent({ eventType: "Template selected", actor: actorName })],
  });
  SIGNATURE_ENVELOPES.push(envelope);
  return { envelope, message: "Signature workflow preview created. No request was sent to the provider or recipient.", checks };
}

// A blocked workflow (approvalStatus !== "Approved") can never reach "Ready
// for Send Preview" — enforced here, not just hidden in the UI.
export function markSignatureWorkflowReady(envelopeId) {
  const envelope = findSignatureEnvelope(envelopeId);
  if (!envelope) return { error: "Workflow not found." };
  if (envelope.approvalStatus !== "Approved") return { error: "This workflow cannot reach Ready for Send Preview until required approval is granted." };
  envelope.status = "Ready for Send Preview";
  return { envelope };
}
export function sendSignatureWorkflowPreview(envelopeId, actorName = "Preview User") {
  const envelope = findSignatureEnvelope(envelopeId);
  if (!envelope) return { error: "Workflow not found." };
  if (envelope.status !== "Ready for Send Preview") return { error: "The workflow must reach Ready for Send Preview before it can be sent." };
  envelope.status = "Sent Preview";
  envelope.auditEvents.push(createSignatureAuditEvent({ eventType: "Send Preview confirmed", actor: actorName }));
  return { envelope };
}
export function remindSignatureWorkflowPreview(envelopeId, actorName = "Preview User") {
  const envelope = findSignatureEnvelope(envelopeId);
  if (!envelope) return { error: "Workflow not found." };
  envelope.auditEvents.push(createSignatureAuditEvent({ eventType: "Reminder Preview sent", actor: actorName }));
  return { envelope };
}
export function voidSignatureWorkflowPreview(envelopeId, reason, actorName = "Preview User") {
  const envelope = findSignatureEnvelope(envelopeId);
  if (!envelope) return { error: "Workflow not found." };
  if (!reason?.trim()) return { error: "A written reason is required to void a signature workflow." };
  envelope.status = "Voided Preview";
  envelope.auditEvents.push(createSignatureAuditEvent({ eventType: "Voided Preview", actor: actorName }));
  return { envelope };
}

// ---------------------------------------------------------------------------
// Deterministic calculations — unauthorized records must already be
// excluded from the array the caller passes in (enforced at the mockApi
// layer via organization/classification scoping, same discipline as every
// prior phase).
// ---------------------------------------------------------------------------
export function computeLinkedFilesCount(files = EXTERNAL_FILES) { return files.filter((f) => f.canonicalState === "Linked").length; }
export function computeUnlinkedFilesCount(files = EXTERNAL_FILES) { return files.filter((f) => f.canonicalState === "Unlinked").length; }
export function computeFilesByProvider(files = EXTERNAL_FILES) {
  const counts = {};
  files.forEach((f) => { counts[f.providerKey] = (counts[f.providerKey] || 0) + 1; });
  return counts;
}
export function computeFilesByClassification(files = EXTERNAL_FILES) {
  const counts = {};
  files.forEach((f) => { counts[f.classification] = (counts[f.classification] || 0) + 1; });
  return counts;
}
export function computeTotalPreviewStorageBytes(files = EXTERNAL_FILES) { return files.reduce((sum, f) => sum + (f.sizeBytes || 0), 0); }
export function computeFilesWithNewerVersions(files = EXTERNAL_FILES) { return files.filter((f) => f.canonicalState === "New Version Available").length; }
export function computeStaleFileReferences(files = EXTERNAL_FILES, hoursThreshold = 24) {
  const cutoff = Date.now() - hoursThreshold * 60 * 60 * 1000;
  return files.filter((f) => new Date(f.updatedAt).getTime() < cutoff);
}
export function computePublicSharingRisks(files = EXTERNAL_FILES) { return files.filter((f) => f.sharingState === "Public Link").length; }
export function computeExternalCollaboratorCount(files = EXTERNAL_FILES) { return files.filter((f) => f.sharingState === "External Collaborator").length; }
export function computeRestrictedSharingRisks(files = EXTERNAL_FILES) {
  return files.filter((f) => RESTRICTED_CLASSIFICATIONS.includes(f.classification) && (f.sharingState === "Public Link" || f.sharingState === "External Collaborator")).length;
}
export function computeOrphanedFiles(files = EXTERNAL_FILES) {
  const associatedIds = new Set(FILE_ASSOCIATIONS.map((a) => a.fileId));
  return files.filter((f) => !associatedIds.has(f.id) && f.canonicalState !== "Unlinked").length;
}
export function computeSignatureWorkflowsByStatus(envelopes = SIGNATURE_ENVELOPES) {
  const counts = {};
  envelopes.forEach((e) => { counts[e.status] = (counts[e.status] || 0) + 1; });
  return counts;
}
export function computeWorkflowsAwaitingApproval(envelopes = SIGNATURE_ENVELOPES) { return envelopes.filter((e) => e.approvalStatus === "Pending").length; }
export function computeWorkflowsAwaitingRecipients(envelopes = SIGNATURE_ENVELOPES) { return envelopes.filter((e) => e.status === "Sent Preview" && e.recipients.some((r) => r.status === "Pending" || r.status === "Sent Preview")).length; }
export function computeExpiringWorkflows(envelopes = SIGNATURE_ENVELOPES, withinDays = 7) {
  const cutoff = daysFromNow(withinDays);
  return envelopes.filter((e) => e.status === "Sent Preview" && e.expirationConfig?.expirationDate && e.expirationConfig.expirationDate <= cutoff && e.expirationConfig.expirationDate > new Date().toISOString()).length;
}
export function computeDeclinedWorkflows(envelopes = SIGNATURE_ENVELOPES) { return envelopes.filter((e) => e.status === "Declined Preview").length; }
export function computeRetentionReviewsDue(policies = RETENTION_POLICIES) { return policies.filter((p) => p.state === "Review Due" || p.state === "Archive Due" || p.state === "Deletion Review Due").length; }
export function computeActiveLegalHolds(holds = LEGAL_HOLDS) { return holds.filter((h) => h.status === "Active").length; }
export function computeMappingCompleteness(mappings = FOLDER_MAPPINGS) {
  if (mappings.length === 0) return 0;
  return Math.round((mappings.filter((m) => m.validation === "Valid" && !m.conflictState).length / mappings.length) * 100);
}
export function computeOpenDocumentSyncConflicts(conflicts = DOCUMENT_SYNC_CONFLICTS) { return conflicts.filter((c) => c.resolutionState === "Open").length; }
export function computeProviderHealthCounts(connections, organizationId) {
  const providerKeys = new Set(PHASE6_PROVIDERS.map((p) => p.key));
  const scoped = connections.filter((c) => providerKeys.has(c.providerKey) && (!organizationId || c.organizationId === organizationId));
  const counts = {};
  scoped.forEach((c) => {
    const status = c.health?.status;
    if (!status) return;
    counts[status] = (counts[status] || 0) + 1;
  });
  return counts;
}

function scopeFilesByOrganization(organizationId) { return EXTERNAL_FILES.filter((f) => f.organizationId === organizationId); }
export function computeDocumentsStorageOverviewMetrics({ organizationId, connections = [] } = {}) {
  const files = organizationId ? scopeFilesByOrganization(organizationId) : EXTERNAL_FILES;
  const envelopes = organizationId ? SIGNATURE_ENVELOPES.filter((e) => e.organizationId === organizationId) : SIGNATURE_ENVELOPES;
  const providerKeys = new Set(PHASE6_PROVIDERS.map((p) => p.key));
  const previewConnectedProviders = connections.filter(
    (c) => providerKeys.has(c.providerKey) && c.status === "Preview Connected" && (!organizationId || c.organizationId === organizationId)
  ).length;
  return {
    previewConnectedProviders,
    linkedFiles: computeLinkedFilesCount(files),
    unlinkedFiles: computeUnlinkedFilesCount(files),
    filesWithNewVersions: computeFilesWithNewerVersions(files),
    restrictedFiles: files.filter((f) => f.canonicalState === "Restricted").length,
    externalSharingRisks: computePublicSharingRisks(files) + computeExternalCollaboratorCount(files),
    workflowsAwaitingApproval: computeWorkflowsAwaitingApproval(envelopes),
    workflowsAwaitingRecipients: computeWorkflowsAwaitingRecipients(envelopes),
    expiringWorkflows: computeExpiringWorkflows(envelopes),
    retentionActionsDue: computeRetentionReviewsDue(organizationId ? RETENTION_POLICIES.filter((p) => p.organizationId === organizationId) : RETENTION_POLICIES),
    synchronizationConflicts: computeOpenDocumentSyncConflicts(organizationId ? DOCUMENT_SYNC_CONFLICTS.filter((c) => c.organizationId === organizationId) : DOCUMENT_SYNC_CONFLICTS),
    providerErrors: connections.filter((c) => providerKeys.has(c.providerKey) && c.health?.status === "Attention Required" && (!organizationId || c.organizationId === organizationId)).length,
  };
}
