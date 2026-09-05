// Provider-catalog "typed contract" factories shared between
// mockIntegrationsData.js (Phase 1) and mockSalesMarketingData.js (Phase 2).
//
// This file exists ONLY to break a circular import: mockIntegrationsData.js
// builds its PROVIDERS array from `[...BASE_PROVIDERS, ...PHASE2_PROVIDERS]`
// (importing PHASE2_PROVIDERS from mockSalesMarketingData.js), and
// mockSalesMarketingData.js needs these same factory functions to build
// PHASE2_PROVIDERS. If mockSalesMarketingData.js imported them directly from
// mockIntegrationsData.js, the two files would import each other — and
// whichever one happens to load first (e.g. a test importing
// mockSalesMarketingData.js directly) would evaluate the OTHER's top-level
// `const` exports before they exist, throwing "PHASE2_PROVIDERS is not
// iterable". Depending on neither file avoids that order-dependent failure
// entirely. mockIntegrationsData.js re-exports these so every existing
// import of createIntegrationProvider/etc. from "./mockIntegrationsData"
// keeps working unchanged.
export function createIntegrationPlanRequirement({
  classification, minimumPlan = null, notes = "",
}) {
  return { classification, minimumPlan, notes };
}

export function createIntegrationCapability({
  id, name, crmModule, direction = "read", requiredPermission = "integrations.view",
  availability = "Available in Preview", sensitiveData = false, requiresHumanApproval = false,
  description = "",
}) {
  return { id, name, crmModule, direction, requiredPermission, availability, sensitiveData, requiresHumanApproval, description };
}

export function createIntegrationAuthMethod({ method, description = "", credentialFieldLabel = null }) {
  return { method, description, credentialFieldLabel };
}

export function createIntegrationProvider({
  key, name, category, shortDescription, longDescription,
  authMethod, pricingClassification, planRequirement,
  supportedModules = [], capabilities = [],
  dataLeavingCrm = [], dataEnteringCrm = [],
  knownLimitations = [], securityNotes = [],
  catalogStatus = "Preview Available",
  credentialFieldInfo = null,
  icon = "Blocks",
  // Sales & Marketing Integrations (Phase 2) — which of the Overview page's
  // channel filters this provider belongs to. null for Phase 1's
  // general-purpose providers, which predate the channel concept.
  channel = null,
}) {
  return {
    key, name, category, shortDescription, longDescription,
    authMethod, pricingClassification, planRequirement,
    supportedModules, capabilities,
    dataLeavingCrm, dataEnteringCrm,
    knownLimitations, securityNotes,
    catalogStatus, credentialFieldInfo, icon,
    channel,
  };
}
