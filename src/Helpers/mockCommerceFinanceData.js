// Centralized, provider-neutral frontend fixtures for Commerce and Finance
// Integrations (/admin/integrations/commerce-finance/*) — Phase 5 preview,
// extending (never forking) the Phase 1-4 Integration Center architecture in
// mockIntegrationsData.js.
//
// STRICT BOUNDARY: nothing here contacts a real provider, connects a bank
// account, accesses a real balance/transaction, processes/captures/refunds a
// payment, creates a payout/transfer, posts an accounting entry, or
// modifies/cancels a real subscription. Every simulated connection stays
// "Frontend Connection Preview", every sync "Preview Synchronization", every
// financial action "Financial Action Preview".
//
// CRITICAL: the real Orders/Contracts/Products/Price Books modules already
// exist and are reused by reference, never forked. The real Finance module
// (mockFinanceData.js) is real but genuinely incomplete — `invoices`,
// `creditNotes` and `expenses` all start as EMPTY arrays with zero seed
// fixtures (confirmed by reading the file), and Orders' own
// `requestInvoicePreview()` already logs "Finance route not yet
// implemented". Accounting-mapping fixtures below honestly reflect that gap
// (crmRecordId stays null with a "No CRM record linked yet" state) rather
// than fabricating links the real Finance module doesn't have.
//
// Money handling: every amount is an integer minor-unit value (cents) with
// an explicit ISO currency code — never a floating-point dollar total.
// Selectors group by currency and never sum across currencies except
// through the one documented EXCHANGE_RATES fixture pair below.
//
// NO IMPORT FROM mockIntegrationsData.js HERE — same circular-import hazard
// documented in every prior phase's data file. Provider-catalog factories
// come from the dependency-free mockIntegrationsContracts.js.
import {
  createIntegrationProvider,
  createIntegrationCapability,
  createIntegrationPlanRequirement,
} from "./mockIntegrationsContracts";
import { ORGANIZATIONS, DEFAULT_ORGANIZATION_ID } from "./mockAccessData";
import { CRM_TEAM } from "./mockUsersData";
import { companies, contacts, normalizeEmail, normalizePhone } from "./mockCrmData";
import { contracts } from "./mockContractData";
import { orders } from "./mockOrderData";
import { catalogItems } from "./mockCatalogData";
import { priceBooks } from "./mockPriceBookData";
import { invoices as financeInvoices } from "./mockFinanceData";

const ORG_HQ = ORGANIZATIONS[0]?.id || DEFAULT_ORGANIZATION_ID;
const ORG_NIMBUS = ORGANIZATIONS[1]?.id || ORG_HQ;
const ORG_SOLSTICE = ORGANIZATIONS[2]?.id || ORG_HQ;

const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(n) { return new Date(Date.now() - n * DAY_MS).toISOString(); }
function daysFromNow(n) { return new Date(Date.now() + n * DAY_MS).toISOString(); }
function hoursAgo(n) { return new Date(Date.now() - n * 60 * 60 * 1000).toISOString(); }

// Generic connection-health factory — same trivial local shape every prior
// phase's fixture file defines for itself rather than reopening the
// mockIntegrationsData.js circular-import hazard for a one-line factory.
function health(overrides = {}) {
  return { status: "Healthy", lastCheckedAt: new Date().toISOString(), issues: [], ...overrides };
}

// ---------------------------------------------------------------------------
// Canonical enums (verbatim from spec)
// ---------------------------------------------------------------------------
export const CommerceOrderStatusCanonical = [
  "Draft", "Pending", "Confirmed", "Processing", "Partially Fulfilled", "Fulfilled",
  "Cancelled", "Returned", "Partially Refunded", "Refunded",
];
export const PaymentStatusCanonical = [
  "Requires Action", "Pending", "Authorized", "Paid", "Failed", "Cancelled",
  "Partially Refunded", "Refunded", "Disputed", "Chargeback", "Unknown",
];
export const InvoiceStatusCanonical = [
  "Draft", "Open", "Partially Paid", "Paid", "Overdue", "Void", "Uncollectible", "Unknown",
];
export const SubscriptionStatusCanonical = [
  "Trialing", "Active", "Past Due", "Paused", "Cancelled", "Expired", "Incomplete", "Unknown",
];
export const ReconciliationStatusCanonical = [
  "Matched", "Suggested Match", "Partial Match", "Unmatched", "Conflict", "Ignored",
  "Restricted", "Insufficient Data", "Unknown",
];
export const MAPPING_REVIEW_REQUIRED = "Mapping Review Required";

// Field-ownership options, spec's own wording for this phase (distinct
// phrasing from Phase 4's, kept as given rather than force-unified).
export const FieldOwnershipOptions = [
  "CRM wins", "Provider wins", "Newest permitted update", "Manual review",
  "One-way synchronization", "Do not synchronize",
];

export const FinancialSyncConflictType = [
  "Order-status mismatch", "Payment-status mismatch", "Customer-mapping conflict",
  "Product-mapping conflict", "Ledger-mapping conflict", "Duplicate Order",
  "Currency mismatch", "Unknown provider status", "Stale provider data", "Concurrent update",
];
export const FinancialSyncConflictResolution = [
  "Keep CRM value", "Keep provider value", "Use newest permitted value", "Map manually",
  "Ignore preview event", "Escalate for review",
];

export const LedgerAccounts = [
  "Sales Revenue", "Service Revenue", "Discounts", "Sales Tax", "Accounts Receivable",
  "Payment Fees", "Refunds", "Chargebacks", "Deferred Revenue", "Other",
];

export const PaymentMethodSummaryType = ["Card", "Bank Transfer", "Wallet", "UPI", "Cash", "Other"];

// One documented fixture exchange-rate pair — the spec's sole exception to
// "never combine currencies into one total." Everything else stays grouped
// by currency.
export const EXCHANGE_RATES = {
  EUR_USD: { rate: 1.08, asOf: daysAgo(1), source: "Documented fixture rate — not a live feed" },
};
export function convertMinorUnits(amountMinor, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return { amountMinor, converted: false };
  const key = `${fromCurrency}_${toCurrency}`;
  const rate = EXCHANGE_RATES[key];
  if (!rate) return null; // no documented rate — caller must group by currency instead
  return { amountMinor: Math.round(amountMinor * rate.rate), converted: true, rateUsed: rate.rate, source: rate.source };
}

// ---------------------------------------------------------------------------
// Providers — Shopify/WooCommerce ("Commerce"), PayPal/Razorpay/Square
// ("Payments"), Wise Business/Plaid ("Banking", new category),
// Chargebee/Paddle ("Subscriptions", new category). Capabilities are
// deliberately named per the spec's own capability lists so each provider
// card is meaningfully distinct, not a template swap.
// ---------------------------------------------------------------------------
function cap(id, name, crmModule, requiredPermission, extra = {}) {
  return createIntegrationCapability({ id, name, crmModule, direction: "read", requiredPermission, ...extra });
}

export const PHASE5_PROVIDERS = [
  createIntegrationProvider({
    key: "shopify", name: "Shopify", category: "Commerce",
    shortDescription: "Preview Shopify stores, products, orders, fulfilments and returns against linked CRM records.",
    longDescription: "Frontend-only preview of Shopify store/customer/product/order/fulfilment/return metadata, mapped to Caspira Companies, Contacts, Products and Orders.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Provider Subscription Required", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Commerce"],
    capabilities: [
      cap("shopify_stores", "Stores", "Organization", "commerce_stores.manage"),
      cap("shopify_customers", "Customers", "Contact", "commerce_customers.map"),
      cap("shopify_products", "Products, Variants and Prices", "Product", "commerce_products.map"),
      cap("shopify_inventory", "Inventory references", "Product", "commerce_inventory.view"),
      cap("shopify_orders", "Orders, Discounts, Taxes and Shipping", "Order", "commerce_orders.view", { sensitiveData: true }),
      cap("shopify_fulfilments_returns", "Fulfilments and Returns", "Order", "commerce_orders.view"),
      cap("shopify_refunds", "Refund references", "Order", "refunds.view", { sensitiveData: true }),
      cap("shopify_webhooks", "Webhook-event previews", "Order", "commerce_integrations.view"),
    ],
    dataLeavingCrm: ["Nothing — Shopify is read/preview only in this phase."],
    dataEnteringCrm: ["Store/customer/product/order reference metadata only."],
    knownLimitations: ["No real Order is ever confirmed or fulfilled.", "No inventory level is ever changed."],
    securityNotes: ["No Shopify Admin API access token is stored anywhere in this preview."],
    icon: "ShoppingBag",
  }),
  createIntegrationProvider({
    key: "woocommerce", name: "WooCommerce", category: "Commerce",
    shortDescription: "Preview WooCommerce stores, products, coupons and orders against linked CRM records.",
    longDescription: "Frontend-only preview of WooCommerce store/customer/product/variation/order metadata.",
    authMethod: "API Key",
    credentialFieldInfo: { label: "WooCommerce Consumer Key", disabledPlaceholder: "Credentials will be configured securely during backend integration." },
    pricingClassification: "Provider Free Tier Available", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Commerce"],
    capabilities: [
      cap("woo_stores", "Stores", "Organization", "commerce_stores.manage"),
      cap("woo_customers", "Customers", "Contact", "commerce_customers.map"),
      cap("woo_products", "Products, Variations and Prices", "Product", "commerce_products.map"),
      cap("woo_inventory_coupons", "Inventory and Coupons", "Product", "commerce_inventory.view"),
      cap("woo_orders_taxes_shipping", "Orders, Taxes and Shipping", "Order", "commerce_orders.view", { sensitiveData: true }),
      cap("woo_refunds", "Refund references", "Order", "refunds.view", { sensitiveData: true }),
    ],
    dataLeavingCrm: ["Nothing — WooCommerce is read/preview only in this phase."],
    dataEnteringCrm: ["Store/customer/product/order reference metadata only."],
    knownLimitations: ["No real Order is ever confirmed or fulfilled.", "Coupons are referenced by code only, never redeemed."],
    securityNotes: ["No WooCommerce REST API key/secret is stored anywhere in this preview."],
    icon: "Store",
  }),
  createIntegrationProvider({
    key: "paypal", name: "PayPal", category: "Payments",
    shortDescription: "Preview PayPal orders, payments, refunds, disputes and subscriptions.",
    longDescription: "Frontend-only preview of PayPal customer/order/authorization/capture/payment/refund/dispute/subscription metadata.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Transaction-Based Provider", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Payments"],
    capabilities: [
      cap("paypal_customers", "Customers", "Contact", "commerce_customers.map"),
      cap("paypal_orders_auth_capture", "Orders, Authorizations and Captures", "Order", "commerce_orders.view"),
      cap("paypal_payments", "Payments", "Order", "payment_transactions.view", { sensitiveData: true }),
      cap("paypal_refunds_disputes", "Refunds and Disputes", "Order", "refunds.view", { sensitiveData: true }),
      cap("paypal_subscriptions", "Subscriptions", "Order", "subscription_integrations.view"),
      cap("paypal_payouts", "Payout references", "Order", "payouts.view", { sensitiveData: true }),
    ],
    dataLeavingCrm: ["Nothing — PayPal is read/preview only in this phase."],
    dataEnteringCrm: ["Payment/refund/dispute/subscription reference metadata only. No card data is ever retrieved."],
    knownLimitations: ["No payment is ever captured or refunded for real.", "No dispute evidence is ever uploaded."],
    securityNotes: ["No PayPal client secret is stored anywhere in this preview."],
    icon: "Wallet",
  }),
  createIntegrationProvider({
    key: "razorpay", name: "Razorpay", category: "Payments",
    shortDescription: "Preview Razorpay orders, payments, payment links, invoices and subscriptions.",
    longDescription: "Frontend-only preview of Razorpay customer/order/payment/invoice/refund/subscription/settlement metadata. Regional availability is provider-dependent (primarily India-focused).",
    authMethod: "API Key",
    credentialFieldInfo: { label: "Razorpay Key Secret", disabledPlaceholder: "Credentials will be configured securely during backend integration." },
    pricingClassification: "Transaction-Based Provider", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Payments"],
    capabilities: [
      cap("razorpay_customers", "Customers", "Contact", "commerce_customers.map"),
      cap("razorpay_orders", "Orders", "Order", "commerce_orders.view"),
      cap("razorpay_payments_links", "Payments and Payment Links", "Order", "payment_transactions.view", { sensitiveData: true }),
      cap("razorpay_invoices", "Invoices", "Order", "accounting_invoice_sync.view"),
      cap("razorpay_refunds", "Refunds", "Order", "refunds.view", { sensitiveData: true }),
      cap("razorpay_subscriptions_settlements", "Subscriptions and Settlement references", "Order", "subscription_integrations.view"),
    ],
    dataLeavingCrm: ["Nothing — Razorpay is read/preview only in this phase."],
    dataEnteringCrm: ["Payment/invoice/subscription reference metadata only."],
    knownLimitations: ["Regional availability is provider-dependent.", "No payment is ever captured or refunded for real."],
    securityNotes: ["No Razorpay key secret is stored anywhere in this preview."],
    icon: "IndianRupee",
  }),
  createIntegrationProvider({
    key: "square", name: "Square", category: "Payments",
    shortDescription: "Preview Square locations, catalog, orders, payments and subscriptions.",
    longDescription: "Frontend-only preview of Square location/customer/catalog/order/payment/invoice/subscription metadata.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Transaction-Based Provider", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Payments"],
    capabilities: [
      cap("square_locations_customers", "Locations and Customers", "Contact", "commerce_customers.map"),
      cap("square_catalog_orders", "Catalog and Orders", "Order", "commerce_orders.view"),
      cap("square_payments_refunds", "Payments and Refunds", "Order", "payment_transactions.view", { sensitiveData: true }),
      cap("square_inventory", "Inventory references", "Product", "commerce_inventory.view"),
      cap("square_invoices_subscriptions", "Invoices and Subscriptions", "Order", "subscription_integrations.view"),
    ],
    dataLeavingCrm: ["Nothing — Square is read/preview only in this phase."],
    dataEnteringCrm: ["Order/payment/subscription reference metadata only."],
    knownLimitations: ["No payment is ever processed or refunded for real."],
    securityNotes: ["No Square access token is stored anywhere in this preview."],
    icon: "Square",
  }),
  createIntegrationProvider({
    key: "wise_business", name: "Wise Business", category: "Banking",
    shortDescription: "Read-only preview of Wise Business profiles, currency balances and transfer/recipient references.",
    longDescription: "Frontend-only, read-only preview of Wise Business profile/balance/transfer/recipient/statement metadata.",
    authMethod: "OAuth 2.0",
    pricingClassification: "Usage-Based Provider", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Banking"],
    capabilities: [
      cap("wise_profiles_balances", "Business profiles and Currency balances", "Organization", "banking_integrations.view", { sensitiveData: true }),
      cap("wise_transfers_recipients", "Transfer and Recipient references", "Organization", "bank_transactions.view", { sensitiveData: true }),
      cap("wise_statements_activity", "Statements and Transaction activity", "Organization", "bank_transactions.view", { sensitiveData: true }),
    ],
    dataLeavingCrm: ["Nothing — Wise Business is read-only in this phase."],
    dataEnteringCrm: ["Balance/transfer/statement reference metadata only."],
    knownLimitations: ["No real transfer is ever initiated.", "This is a read-only preview by design, not a partial banking integration."],
    securityNotes: ["No Wise API token is stored anywhere in this preview."],
    icon: "Landmark",
  }),
  createIntegrationProvider({
    key: "plaid", name: "Plaid", category: "Banking",
    shortDescription: "Preview bank-connection status, masked accounts and transaction feeds via Plaid.",
    longDescription: "Frontend-only preview of Plaid institution/account/balance/transaction/consent metadata. No custom bank-credential form is ever built — production connection uses Plaid's own hosted Link flow only.",
    authMethod: "Provider-Managed Authorization",
    pricingClassification: "Usage-Based Provider", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Banking"],
    capabilities: [
      cap("plaid_institution_account", "Institution reference and Connected-account preview", "Organization", "banking_integrations.view", { sensitiveData: true }),
      cap("plaid_balance_transactions", "Balance availability and Transaction feed", "Organization", "bank_transactions.view", { sensitiveData: true }),
      cap("plaid_consent_health", "Consent status and Connection health", "Organization", "banking_integrations.view"),
    ],
    dataLeavingCrm: ["Nothing — Plaid is read-only in this phase."],
    dataEnteringCrm: ["Masked account/transaction reference metadata only. Full account numbers and bank credentials are never retrieved or displayed."],
    knownLimitations: ["No custom bank-login form is ever built — this preview never asks for banking credentials of any kind."],
    securityNotes: ["No Plaid access token or bank credential is stored anywhere in this preview."],
    icon: "Banknote",
  }),
  createIntegrationProvider({
    key: "chargebee", name: "Chargebee", category: "Subscriptions",
    shortDescription: "Preview Chargebee subscriptions, invoices, credit notes and dunning status.",
    longDescription: "Frontend-only preview of Chargebee customer/item/price/subscription/invoice/credit-note/payment/dunning metadata.",
    authMethod: "API Key",
    credentialFieldInfo: { label: "Chargebee Site API Key", disabledPlaceholder: "Credentials will be configured securely during backend integration." },
    pricingClassification: "Provider Subscription Required", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Subscriptions"],
    capabilities: [
      cap("chargebee_customers_items", "Customers, Items and Prices", "Contact", "subscription_integrations.view"),
      cap("chargebee_subscriptions", "Subscriptions", "Contract", "subscription_integrations.view"),
      cap("chargebee_invoices_credit_notes", "Invoices and Credit notes", "Contract", "accounting_credit_notes.view"),
      cap("chargebee_payments_dunning", "Payments, Dunning, Cancellation and Renewal status", "Contract", "subscription_integrations.manage_preview", { sensitiveData: true }),
    ],
    dataLeavingCrm: ["Nothing — Chargebee is read/preview only in this phase."],
    dataEnteringCrm: ["Subscription/invoice/dunning reference metadata only."],
    knownLimitations: ["No real subscription is ever modified or cancelled."],
    securityNotes: ["No Chargebee site API key is stored anywhere in this preview."],
    icon: "RefreshCcw",
  }),
  createIntegrationProvider({
    key: "paddle", name: "Paddle", category: "Subscriptions",
    shortDescription: "Preview Paddle subscriptions, transactions and merchant-of-record billing periods.",
    longDescription: "Frontend-only preview of Paddle customer/product/price/subscription/transaction/adjustment metadata. Paddle acts as merchant of record — referenced informationally, never altered.",
    authMethod: "API Key",
    credentialFieldInfo: { label: "Paddle API Key", disabledPlaceholder: "Credentials will be configured securely during backend integration." },
    pricingClassification: "Transaction-Based Provider", planRequirement: createIntegrationPlanRequirement({ classification: "Standard" }),
    supportedModules: ["Subscriptions"],
    capabilities: [
      cap("paddle_customers_products", "Customers, Products and Prices", "Contact", "subscription_integrations.view"),
      cap("paddle_subscriptions_periods", "Subscriptions and Billing periods", "Contract", "subscription_integrations.view"),
      cap("paddle_transactions_adjustments", "Transactions and Adjustments", "Contract", "payment_transactions.view", { sensitiveData: true }),
    ],
    dataLeavingCrm: ["Nothing — Paddle is read/preview only in this phase."],
    dataEnteringCrm: ["Subscription/transaction reference metadata only."],
    knownLimitations: ["No real subscription, transaction or adjustment is ever created.", "Paddle's merchant-of-record status is shown informationally only."],
    securityNotes: ["No Paddle API key is stored anywhere in this preview."],
    icon: "CreditCard",
  }),
];

// ---------------------------------------------------------------------------
// Commerce — stores, customer matching, product mapping, orders, returns.
// ---------------------------------------------------------------------------
export function createCommerceStoreLink({
  id, organizationId, providerKey, storeName, currency, region,
  productSyncDirection = "Provider to CRM", orderSyncDirection = "Provider to CRM",
  inventorySyncDirection = "Provider to CRM", lastPreviewSyncAt = null, paused = false,
}) {
  return { id, organizationId, providerKey, storeName, currency, region, productSyncDirection, orderSyncDirection, inventorySyncDirection, lastPreviewSyncAt, paused, health: health({}) };
}
export const COMMERCE_STORES = [
  createCommerceStoreLink({ id: "store_1", organizationId: ORG_HQ, providerKey: "shopify", storeName: "caspira-hq.myshopify.com", currency: "USD", region: "United States", lastPreviewSyncAt: hoursAgo(3) }),
  createCommerceStoreLink({ id: "store_2", organizationId: ORG_HQ, providerKey: "woocommerce", storeName: "shop.caspira.example", currency: "EUR", region: "European Union", lastPreviewSyncAt: hoursAgo(10) }),
  createCommerceStoreLink({ id: "store_3", organizationId: ORG_NIMBUS, providerKey: "shopify", storeName: "nimbus-retail.myshopify.com", currency: "GBP", region: "United Kingdom", paused: true, lastPreviewSyncAt: daysAgo(4) }),
];
export function findCommerceStore(id) { return COMMERCE_STORES.find((s) => s.id === id) || null; }
export function queryCommerceStoresLocal(filters = {}) {
  let results = COMMERCE_STORES.slice();
  if (filters.organizationId) results = results.filter((s) => s.organizationId === filters.organizationId);
  return results;
}
export function pauseCommerceStore(id, paused) {
  const store = findCommerceStore(id);
  if (!store) return { error: "Store not found." };
  store.paused = paused;
  return { store };
}
export function previewCommerceStoreSync(id) {
  const store = findCommerceStore(id);
  if (!store) return { error: "Store not found." };
  store.lastPreviewSyncAt = new Date().toISOString();
  return { store };
}

// Customer matching — normalized-email/phone lookup against real
// Contacts/Companies, same verified-match discipline every prior phase used.
export function matchCommerceCustomer({ email, phone }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  const contactMatches = contacts.filter((c) => normalizeEmail(c.email) === normalizedEmail && normalizedEmail);
  if (contactMatches.length > 1) return { state: "Multiple Matches", contactId: null, companyId: null };
  if (contactMatches.length === 1) return { state: "Matched", contactId: contactMatches[0]._id, companyId: contactMatches[0].companyId || null };
  const phoneMatches = contacts.filter((c) => normalizePhone(c.phone) === normalizedPhone && normalizedPhone);
  if (phoneMatches.length === 1) return { state: "Possible Match", contactId: phoneMatches[0]._id, companyId: phoneMatches[0].companyId || null };
  if (phoneMatches.length > 1) return { state: "Multiple Matches", contactId: null, companyId: null };
  return { state: "No Match", contactId: null, companyId: null };
}
export function createCommerceCustomerMapping({ id, providerKey, storeId, organizationId, providerCustomerId, providerCustomerName, providerCustomerEmail, providerCustomerPhone, stateOverride = null }) {
  const matched = matchCommerceCustomer({ email: providerCustomerEmail, phone: providerCustomerPhone });
  return {
    id, providerKey, storeId, organizationId, providerCustomerId, providerCustomerName, providerCustomerEmail, providerCustomerPhone,
    contactId: matched.contactId, companyId: matched.companyId, state: stateOverride || matched.state,
  };
}
const firstContactEmail = contacts[0]?.email || null;
export const COMMERCE_CUSTOMER_MAPPINGS = [
  createCommerceCustomerMapping({ id: "ccm_1", providerKey: "shopify", storeId: "store_1", organizationId: ORG_HQ, providerCustomerId: "shopify_cust_1", providerCustomerName: contacts[0]?.firstName ? `${contacts[0].firstName} ${contacts[0].lastName}` : "Verified Customer", providerCustomerEmail: firstContactEmail, providerCustomerPhone: contacts[0]?.phone }),
  createCommerceCustomerMapping({ id: "ccm_2", providerKey: "woocommerce", storeId: "store_2", organizationId: ORG_HQ, providerCustomerId: "woo_cust_9", providerCustomerName: "Unmatched Shopper", providerCustomerEmail: "shopper@unmapped.example", providerCustomerPhone: "0000000000" }),
  createCommerceCustomerMapping({ id: "ccm_3", providerKey: "shopify", storeId: "store_3", organizationId: ORG_NIMBUS, providerCustomerId: "shopify_cust_44", providerCustomerName: "Restricted Org Customer", providerCustomerEmail: "cross-org@unmapped.example", providerCustomerPhone: "1111111111", stateOverride: "Restricted Match" }),
  createCommerceCustomerMapping({ id: "ccm_4", providerKey: "woocommerce", storeId: "store_2", organizationId: ORG_HQ, providerCustomerId: "woo_cust_12", providerCustomerName: "Conflicting Record", providerCustomerEmail: "conflict@unmapped.example", providerCustomerPhone: "2222222222", stateOverride: "Conflict" }),
];
export function queryCommerceCustomerMappingsLocal(filters = {}) {
  let results = COMMERCE_CUSTOMER_MAPPINGS.slice();
  if (filters.organizationId) results = results.filter((m) => m.organizationId === filters.organizationId);
  return results;
}

export function createCommerceProductMapping({ id, providerKey, storeId, organizationId, crmProductId, providerProductId, variant = null, sku, priceBookId = null, providerPriceMinor, currency, inventoryPolicy = "Track", taxCategory = "Standard", mappingState = "Mapped", syncDirection = "Provider to CRM", conflictState = null }) {
  return { id, providerKey, storeId, organizationId, crmProductId, providerProductId, variant, sku, priceBookId, providerPriceMinor, currency, inventoryPolicy, taxCategory, mappingState, syncDirection, conflictState };
}
const mappableCatalogItems = catalogItems.slice(0, 4);
export const COMMERCE_PRODUCT_MAPPINGS = mappableCatalogItems.map((item, i) => createCommerceProductMapping({
  id: `cpm_${i + 1}`, providerKey: ["shopify", "woocommerce", "shopify", "woocommerce"][i], storeId: ["store_1", "store_2", "store_1", "store_3"][i],
  organizationId: i === 3 ? ORG_NIMBUS : ORG_HQ, crmProductId: item._id, providerProductId: `ext_prod_${1000 + i}`,
  variant: i % 2 === 0 ? "Default" : "Large", sku: item.sku || `SKU-${1000 + i}`, priceBookId: priceBooks[0]?._id || null,
  providerPriceMinor: Math.round((item.standardPrice || 100) * 100), currency: item.currency || "USD",
  mappingState: i === 3 ? "Requires Review" : "Mapped", conflictState: i === 2 ? "Price mismatch" : null,
}));
export function queryCommerceProductMappingsLocal(filters = {}) {
  let results = COMMERCE_PRODUCT_MAPPINGS.slice();
  if (filters.organizationId) results = results.filter((m) => m.organizationId === filters.organizationId);
  return results;
}

export function createCommerceOrderReference({
  id, providerKey, storeId, organizationId, providerOrderId, crmOrderId = null, customerMappingId = null,
  orderDate = new Date().toISOString(), currency, subtotalMinor, discountMinor = 0, taxMinor = 0, shippingMinor = 0,
  refundMinor = 0, totalMinor, canonicalStatus, paymentStatus, fulfilmentStatus = "Unfulfilled", returnStatus = "None", syncStatus = "Synced",
}) {
  return { id, providerKey, storeId, organizationId, providerOrderId, crmOrderId, customerMappingId, orderDate, currency, subtotalMinor, discountMinor, taxMinor, shippingMinor, refundMinor, totalMinor, canonicalStatus, paymentStatus, fulfilmentStatus, returnStatus, syncStatus };
}
export const COMMERCE_ORDERS = [
  createCommerceOrderReference({ id: "corder_1", providerKey: "shopify", storeId: "store_1", organizationId: ORG_HQ, providerOrderId: "#SHOP1001", crmOrderId: orders[0]?._id || null, customerMappingId: "ccm_1", currency: "USD", subtotalMinor: 24900, discountMinor: 2000, taxMinor: 1992, shippingMinor: 500, totalMinor: 25392, canonicalStatus: "Fulfilled", paymentStatus: "Paid", fulfilmentStatus: "Fulfilled" }),
  createCommerceOrderReference({ id: "corder_2", providerKey: "woocommerce", storeId: "store_2", organizationId: ORG_HQ, providerOrderId: "WOO-2044", crmOrderId: null, customerMappingId: "ccm_2", currency: "EUR", subtotalMinor: 8900, taxMinor: 1690, shippingMinor: 0, totalMinor: 10590, canonicalStatus: "Processing", paymentStatus: "Pending", fulfilmentStatus: "Unfulfilled" }),
  createCommerceOrderReference({ id: "corder_3", providerKey: "shopify", storeId: "store_3", organizationId: ORG_NIMBUS, providerOrderId: "#SHOP2077", crmOrderId: null, customerMappingId: "ccm_3", currency: "GBP", subtotalMinor: 15000, refundMinor: 15000, taxMinor: 0, totalMinor: 15000, canonicalStatus: "Refunded", paymentStatus: "Refunded", fulfilmentStatus: "Fulfilled", returnStatus: "Returned" }),
  createCommerceOrderReference({ id: "corder_4", providerKey: "shopify", storeId: "store_1", organizationId: ORG_HQ, providerOrderId: "#SHOP1002", crmOrderId: null, customerMappingId: "ccm_4", currency: "USD", subtotalMinor: 5000, taxMinor: 400, totalMinor: 5400, canonicalStatus: "Partially Refunded", paymentStatus: "Partially Refunded", refundMinor: 2000, fulfilmentStatus: "Fulfilled", returnStatus: "Partially Returned", syncStatus: "Conflict" }),
];
export function findCommerceOrder(id) { return COMMERCE_ORDERS.find((o) => o.id === id) || null; }
export function queryCommerceOrdersLocal(filters = {}) {
  let results = COMMERCE_ORDERS.slice();
  if (filters.organizationId) results = results.filter((o) => o.organizationId === filters.organizationId);
  if (filters.currency) results = results.filter((o) => o.currency === filters.currency);
  if (filters.canonicalStatus) results = results.filter((o) => o.canonicalStatus === filters.canonicalStatus);
  return results;
}
export function previewCommerceOrderSync(id) {
  const order = findCommerceOrder(id);
  if (!order) return { error: "Order not found." };
  order.syncStatus = order.syncStatus === "Conflict" ? "Conflict" : "Synced";
  return { order };
}

export function createCommerceReturnReference({ id, orderId, providerKey, organizationId, reason, restockingStatus = "Pending", refundId = null, status = "Requested" }) {
  return { id, orderId, providerKey, organizationId, reason, restockingStatus, refundId, status };
}
export const COMMERCE_RETURNS = [
  createCommerceReturnReference({ id: "cret_1", orderId: "corder_3", providerKey: "shopify", organizationId: ORG_NIMBUS, reason: "Damaged in transit", restockingStatus: "Not Restockable", refundId: "refund_2", status: "Completed" }),
  createCommerceReturnReference({ id: "cret_2", orderId: "corder_4", providerKey: "shopify", organizationId: ORG_HQ, reason: "Wrong size", restockingStatus: "Restocked", refundId: "refund_3", status: "Completed" }),
];
export function queryCommerceReturnsLocal(filters = {}) {
  let results = COMMERCE_RETURNS.slice();
  if (filters.organizationId) results = results.filter((r) => r.organizationId === filters.organizationId);
  return results;
}

// ---------------------------------------------------------------------------
// Financial synchronization conflicts — one shared shape across Commerce,
// Payments, Accounting, Banking and Subscriptions ("domain" field), same
// reuse discipline Phase 4 applied to its own single conflict shape.
// ---------------------------------------------------------------------------
export function createFinancialSyncConflict({ id, domain, conflictType, providerKey, organizationId, description, resolutionState = "Open" }) {
  return { id, domain, conflictType, providerKey, organizationId, description, resolutionState };
}
export const FINANCIAL_SYNC_CONFLICTS = [
  createFinancialSyncConflict({ id: "fsc_1", domain: "Commerce", conflictType: "Order-status mismatch", providerKey: "shopify", organizationId: ORG_HQ, description: "CRM Order shows Processing; Shopify order shows Partially Refunded." }),
  createFinancialSyncConflict({ id: "fsc_2", domain: "Accounting", conflictType: "Ledger-mapping conflict", providerKey: "quickbooks_online", organizationId: ORG_HQ, description: "Two Products map to the same ledger account with different tax categories." }),
  createFinancialSyncConflict({ id: "fsc_3", domain: "Banking", conflictType: "Currency mismatch", providerKey: "plaid", organizationId: ORG_NIMBUS, description: "Bank transaction currency (GBP) does not match the linked invoice currency (USD).", resolutionState: "Resolved" }),
];
export function queryFinancialSyncConflictsLocal(filters = {}) {
  let results = FINANCIAL_SYNC_CONFLICTS.slice();
  if (filters.organizationId) results = results.filter((c) => c.organizationId === filters.organizationId);
  if (filters.domain) results = results.filter((c) => c.domain === filters.domain);
  return results;
}
export function resolveFinancialSyncConflict(conflictId, resolution, actorName = "Preview User") {
  const conflict = FINANCIAL_SYNC_CONFLICTS.find((c) => c.id === conflictId);
  if (!conflict) return { error: "Conflict not found." };
  if (!FinancialSyncConflictResolution.includes(resolution)) return { error: "Unrecognized resolution." };
  conflict.resolutionState = "Resolved";
  conflict.resolution = resolution;
  conflict.resolvedBy = actorName;
  return { conflict };
}

// ---------------------------------------------------------------------------
// Payments — transactions, refunds, disputes, payouts.
// ---------------------------------------------------------------------------
export function createPaymentTransactionReference({ id, providerKey, organizationId, companyId = null, contactId = null, orderRef = null, invoiceRef = null, subscriptionRef = null, amountMinor, currency, status, paymentMethodSummary, feeMinor = 0, settlementStatus = "Pending", transactionDate = new Date().toISOString(), syncStatus = "Synced" }) {
  return { id, providerKey, organizationId, companyId, contactId, orderRef, invoiceRef, subscriptionRef, amountMinor, currency, status, paymentMethodSummary, feeMinor, netAmountMinor: amountMinor - feeMinor, settlementStatus, transactionDate, syncStatus };
}
export const PAYMENT_TRANSACTIONS = [
  createPaymentTransactionReference({ id: "ptx_1", providerKey: "stripe", organizationId: ORG_HQ, companyId: companies[0]?._id, orderRef: "corder_1", amountMinor: 25392, currency: "USD", status: "Paid", paymentMethodSummary: "Card ending in 4242", feeMinor: 767, settlementStatus: "Settled" }),
  createPaymentTransactionReference({ id: "ptx_2", providerKey: "paypal", organizationId: ORG_HQ, companyId: companies[1]?._id, orderRef: "corder_2", amountMinor: 10590, currency: "EUR", status: "Pending", paymentMethodSummary: "Wallet", feeMinor: 318, settlementStatus: "Pending" }),
  createPaymentTransactionReference({ id: "ptx_3", providerKey: "razorpay", organizationId: ORG_NIMBUS, companyId: companies[2]?._id, orderRef: "corder_3", amountMinor: 15000, currency: "GBP", status: "Refunded", paymentMethodSummary: "UPI", feeMinor: 300, settlementStatus: "Settled" }),
  createPaymentTransactionReference({ id: "ptx_4", providerKey: "square", organizationId: ORG_HQ, companyId: companies[0]?._id, amountMinor: 4200, currency: "USD", status: "Failed", paymentMethodSummary: "Card ending in 0002", feeMinor: 0, settlementStatus: "Not Applicable" }),
];
export function queryPaymentTransactionsLocal(filters = {}) {
  let results = PAYMENT_TRANSACTIONS.slice();
  if (filters.organizationId) results = results.filter((t) => t.organizationId === filters.organizationId);
  if (filters.currency) results = results.filter((t) => t.currency === filters.currency);
  if (filters.status) results = results.filter((t) => t.status === filters.status);
  return results;
}

export function createRefundPreview({ id, paymentTransactionId, organizationId, orderRef = null, invoiceRef = null, amountMinor, currency, reason, refundableRemainingMinor, requestedBy, requiredApprover = "Finance Manager", status = "Pending Approval" }) {
  return { id, paymentTransactionId, organizationId, orderRef, invoiceRef, amountMinor, currency, reason, refundableRemainingMinor, requestedBy, requiredApprover, status };
}
export const REFUND_PREVIEWS = [
  createRefundPreview({ id: "refund_1", paymentTransactionId: "ptx_1", organizationId: ORG_HQ, orderRef: "corder_1", amountMinor: 5000, currency: "USD", reason: "Partial customer dissatisfaction", refundableRemainingMinor: 20392, requestedBy: CRM_TEAM[1]?.name || "Priya Nair" }),
  createRefundPreview({ id: "refund_2", paymentTransactionId: "ptx_3", organizationId: ORG_NIMBUS, orderRef: "corder_3", amountMinor: 15000, currency: "GBP", reason: "Item damaged in transit", refundableRemainingMinor: 0, requestedBy: CRM_TEAM[2]?.name || "Marcus Chen", status: "Approved" }),
  createRefundPreview({ id: "refund_3", paymentTransactionId: "ptx_1", organizationId: ORG_HQ, orderRef: "corder_4", amountMinor: 2000, currency: "USD", reason: "Wrong size returned", refundableRemainingMinor: 3400, requestedBy: CRM_TEAM[1]?.name || "Priya Nair", status: "Approved" }),
];
export function findRefundPreview(id) { return REFUND_PREVIEWS.find((r) => r.id === id) || null; }
export function queryRefundPreviewsLocal(filters = {}) {
  let results = REFUND_PREVIEWS.slice();
  if (filters.organizationId) results = results.filter((r) => r.organizationId === filters.organizationId);
  return results;
}
export function approveRefundPreview(id, approverName) {
  const refund = findRefundPreview(id);
  if (!refund) return { error: "Refund preview not found." };
  const check = createSeparationOfDutiesCheck({ action: "refunds.approve_preview", requester: refund.requestedBy, requiredApprover: refund.requiredApprover, approverName });
  if (!check.eligible) return { error: check.reason, check };
  refund.status = "Approved";
  refund.approvedBy = approverName;
  return { refund, check };
}

export function createDisputePreview({ id, paymentTransactionId, organizationId, providerKey, disputedAmountMinor, currency, reasonCategory, evidenceDueDate, status = "Needs Response", assignedOwner = null }) {
  return { id, paymentTransactionId, organizationId, providerKey, disputedAmountMinor, currency, reasonCategory, evidenceDueDate, status, assignedOwner };
}
export const DISPUTE_PREVIEWS = [
  createDisputePreview({ id: "disp_1", paymentTransactionId: "ptx_1", organizationId: ORG_HQ, providerKey: "stripe", disputedAmountMinor: 25392, currency: "USD", reasonCategory: "Product Not Received", evidenceDueDate: daysFromNow(5), assignedOwner: CRM_TEAM[0]?.name || "Dominic Wuckert" }),
];
export function queryDisputePreviewsLocal(filters = {}) {
  let results = DISPUTE_PREVIEWS.slice();
  if (filters.organizationId) results = results.filter((d) => d.organizationId === filters.organizationId);
  return results;
}

export function createPayoutReference({ id, providerKey, organizationId, amountMinor, currency, status = "Scheduled", settlementReference = null, payoutDate = new Date().toISOString() }) {
  return { id, providerKey, organizationId, amountMinor, currency, status, settlementReference, payoutDate };
}
export const PAYOUT_REFERENCES = [
  createPayoutReference({ id: "payout_1", providerKey: "stripe", organizationId: ORG_HQ, amountMinor: 184320, currency: "USD", status: "Paid", settlementReference: "po_stripe_88213" }),
  createPayoutReference({ id: "payout_2", providerKey: "paypal", organizationId: ORG_HQ, amountMinor: 42100, currency: "EUR", status: "Scheduled", settlementReference: "po_paypal_11029" }),
];
export function queryPayoutReferencesLocal(filters = {}) {
  let results = PAYOUT_REFERENCES.slice();
  if (filters.organizationId) results = results.filter((p) => p.organizationId === filters.organizationId);
  return results;
}

// ---------------------------------------------------------------------------
// Accounting — customer/product/invoice/payment/tax mapping, ledger mapping,
// credit notes. The real Finance module has zero seeded Invoices/Credit
// Notes/Expenses (confirmed), so mapping rows reference real records only
// when one genuinely exists; otherwise crmRecordId stays null and the state
// says so honestly.
// ---------------------------------------------------------------------------
export function createAccountingMapping({ id, kind, providerKey, organizationId, crmRecordId = null, crmRecordLabel = null, providerRecordId, sourceOfTruth = "CRM wins", direction = "Provider to CRM", mappingState, lastPreviewSyncAt = null, conflict = null }) {
  return { id, kind, providerKey, organizationId, crmRecordId, crmRecordLabel, providerRecordId, sourceOfTruth, direction, mappingState, lastPreviewSyncAt, conflict };
}
export const ACCOUNTING_MAPPINGS = [
  createAccountingMapping({ id: "am_1", kind: "customer", providerKey: "quickbooks_online", organizationId: ORG_HQ, crmRecordId: companies[0]?._id || null, crmRecordLabel: companies[0]?.name || null, providerRecordId: "qbo_cust_1", mappingState: companies[0] ? "Mapped" : "No CRM record linked yet" }),
  createAccountingMapping({ id: "am_2", kind: "product", providerKey: "xero", organizationId: ORG_HQ, crmRecordId: catalogItems[0]?._id || null, crmRecordLabel: catalogItems[0]?.name || null, providerRecordId: "xero_item_1", mappingState: "Mapped" }),
  createAccountingMapping({ id: "am_3", kind: "invoice", providerKey: "quickbooks_online", organizationId: ORG_HQ, crmRecordId: null, crmRecordLabel: null, providerRecordId: "qbo_inv_5521", mappingState: "No CRM record linked yet", lastPreviewSyncAt: hoursAgo(6) }),
  createAccountingMapping({ id: "am_4", kind: "payment", providerKey: "xero", organizationId: ORG_HQ, crmRecordId: null, crmRecordLabel: null, providerRecordId: "xero_pay_902", mappingState: "No CRM record linked yet" }),
  createAccountingMapping({ id: "am_5", kind: "tax", providerKey: "quickbooks_online", organizationId: ORG_HQ, crmRecordId: null, crmRecordLabel: "Standard", providerRecordId: "qbo_tax_std", mappingState: "Mapped" }),
];
export function queryAccountingMappingsLocal(kind, filters = {}) {
  let results = ACCOUNTING_MAPPINGS.filter((m) => m.kind === kind);
  if (filters.organizationId) results = results.filter((m) => m.organizationId === filters.organizationId);
  return results;
}

export function createCreditNoteReference({ id, providerKey, organizationId, amountMinor, currency, reason, status = "Draft", crmInvoiceId = null }) {
  return { id, providerKey, organizationId, amountMinor, currency, reason, status, crmInvoiceId };
}
export const CREDIT_NOTE_REFERENCES = [
  createCreditNoteReference({ id: "cn_1", providerKey: "quickbooks_online", organizationId: ORG_HQ, amountMinor: 5000, currency: "USD", reason: "Partial refund for returned item", status: "Pending Approval" }),
];
export function findCreditNoteReference(id) { return CREDIT_NOTE_REFERENCES.find((c) => c.id === id) || null; }
export function queryCreditNoteReferencesLocal(filters = {}) {
  let results = CREDIT_NOTE_REFERENCES.slice();
  if (filters.organizationId) results = results.filter((c) => c.organizationId === filters.organizationId);
  return results;
}
export function approveCreditNotePreview(id, approverName, requestedBy) {
  const note = findCreditNoteReference(id);
  if (!note) return { error: "Credit note not found." };
  const check = createSeparationOfDutiesCheck({ action: "credit_notes.approve_preview", requester: requestedBy, requiredApprover: "Finance Manager", approverName });
  if (!check.eligible) return { error: check.reason, check };
  note.status = "Approved";
  return { note, check };
}

export function createLedgerMapping({ id, organizationId, crmCategory, ledgerAccount, providerKey }) {
  return { id, organizationId, crmCategory, ledgerAccount, providerKey };
}
export const LEDGER_MAPPINGS = [
  createLedgerMapping({ id: "lm_1", organizationId: ORG_HQ, crmCategory: "Product Sales", ledgerAccount: "Sales Revenue", providerKey: "quickbooks_online" }),
  createLedgerMapping({ id: "lm_2", organizationId: ORG_HQ, crmCategory: "Service Revenue", ledgerAccount: "Service Revenue", providerKey: "xero" }),
  createLedgerMapping({ id: "lm_3", organizationId: ORG_HQ, crmCategory: "Processing Fees", ledgerAccount: "Payment Fees", providerKey: "quickbooks_online" }),
];
export function queryLedgerMappingsLocal(filters = {}) {
  let results = LEDGER_MAPPINGS.slice();
  if (filters.organizationId) results = results.filter((m) => m.organizationId === filters.organizationId);
  return results;
}
export function overrideLedgerMapping(id, newLedgerAccount, requesterName, approverName) {
  const mapping = LEDGER_MAPPINGS.find((m) => m.id === id);
  if (!mapping) return { error: "Ledger mapping not found." };
  if (!LedgerAccounts.includes(newLedgerAccount)) return { error: "Unrecognized ledger account." };
  const check = createSeparationOfDutiesCheck({ action: "reconciliation.override", requester: requesterName, requiredApprover: "Finance Manager", approverName });
  if (!check.eligible) return { error: check.reason, check };
  mapping.ledgerAccount = newLedgerAccount;
  return { mapping, check };
}

// ---------------------------------------------------------------------------
// Subscriptions — billing lifecycle + deterministic recurring-revenue
// selectors. `previousRecurringAmountMinor` (nullable) is what makes
// New/Expansion/Contraction/Churned classification deterministic without a
// simulated time-series ledger.
// ---------------------------------------------------------------------------
const CYCLE_TO_MONTHLY_DIVISOR = { Monthly: 1, Quarterly: 3, Annual: 12, Weekly: 0.230137 };
export function normalizeToMonthlyMinor(amountMinor, billingCycle) {
  const divisor = CYCLE_TO_MONTHLY_DIVISOR[billingCycle] || 1;
  return Math.round(amountMinor / divisor);
}
export function createSubscriptionPreview({ id, providerKey, organizationId, companyId = null, contactId = null, contractId = null, planName, quantity = 1, billingCycle = "Monthly", recurringAmountMinor, previousRecurringAmountMinor = null, currency, status, trialEnd = null, currentPeriodStart = new Date().toISOString(), currentPeriodEnd = daysFromNow(30), renewalDate = daysFromNow(30), cancellationDate = null, dunningState = "None", syncStatus = "Synced" }) {
  return { id, providerKey, organizationId, companyId, contactId, contractId, planName, quantity, billingCycle, recurringAmountMinor, previousRecurringAmountMinor, currency, status, trialEnd, currentPeriodStart, currentPeriodEnd, renewalDate, cancellationDate, dunningState, syncStatus };
}
export const SUBSCRIPTION_PREVIEWS = [
  createSubscriptionPreview({ id: "sub_1", providerKey: "chargebee", organizationId: ORG_HQ, companyId: companies[0]?._id, contractId: contracts[0]?._id || null, planName: "Growth Plan", recurringAmountMinor: 29900, previousRecurringAmountMinor: null, currency: "USD", status: "Active" }),
  createSubscriptionPreview({ id: "sub_2", providerKey: "paddle", organizationId: ORG_HQ, companyId: companies[1]?._id, planName: "Pro Annual", billingCycle: "Annual", recurringAmountMinor: 240000, previousRecurringAmountMinor: 180000, currency: "USD", status: "Active" }),
  createSubscriptionPreview({ id: "sub_3", providerKey: "chargebee", organizationId: ORG_NIMBUS, companyId: companies[2]?._id, planName: "Starter", recurringAmountMinor: 9900, previousRecurringAmountMinor: 14900, currency: "GBP", status: "Past Due", dunningState: "First Notice" }),
  createSubscriptionPreview({ id: "sub_4", providerKey: "paddle", organizationId: ORG_HQ, companyId: companies[0]?._id, planName: "Legacy Plan", recurringAmountMinor: 19900, previousRecurringAmountMinor: 19900, currency: "USD", status: "Cancelled", cancellationDate: daysAgo(10) }),
  createSubscriptionPreview({ id: "sub_5", providerKey: "chargebee", organizationId: ORG_HQ, companyId: companies[1]?._id, planName: "Trial Plan", recurringAmountMinor: 0, currency: "USD", status: "Trialing", trialEnd: daysFromNow(7) }),
];
export function findSubscriptionPreview(id) { return SUBSCRIPTION_PREVIEWS.find((s) => s.id === id) || null; }
export function querySubscriptionPreviewsLocal(filters = {}) {
  let results = SUBSCRIPTION_PREVIEWS.slice();
  if (filters.organizationId) results = results.filter((s) => s.organizationId === filters.organizationId);
  return results;
}
export function pauseSubscriptionPreview(id) {
  const sub = findSubscriptionPreview(id);
  if (!sub) return { error: "Subscription preview not found." };
  sub.status = "Paused";
  return { sub };
}
export function cancelSubscriptionPreview(id, requesterName, approverName) {
  const sub = findSubscriptionPreview(id);
  if (!sub) return { error: "Subscription preview not found." };
  const check = createSeparationOfDutiesCheck({ action: "subscription_integrations.cancel_preview", requester: requesterName, requiredApprover: "Finance Manager", approverName });
  if (!check.eligible) return { error: check.reason, check };
  sub.status = "Cancelled";
  sub.cancellationDate = new Date().toISOString();
  return { sub, check };
}
export function linkSubscriptionContract(id, contractId) {
  const sub = findSubscriptionPreview(id);
  if (!sub) return { error: "Subscription preview not found." };
  if (!contracts.some((c) => c._id === contractId)) return { error: "Contract not found." };
  sub.contractId = contractId;
  return { sub };
}

// ---------------------------------------------------------------------------
// Banking — read-only account/transaction previews, reconciliation.
// ---------------------------------------------------------------------------
export function createBankAccountPreview({ id, providerKey, organizationId, institution, accountName, accountType = "Checking", maskedAccountNumber, currency, balanceAvailability = "Available", consentStatus = "Granted", lastPreviewSyncAt = null, transactionCount = 0 }) {
  return { id, providerKey, organizationId, institution, accountName, accountType, maskedAccountNumber, currency, balanceAvailability, consentStatus, lastPreviewSyncAt, transactionCount, health: health({}) };
}
export const BANK_ACCOUNTS = [
  createBankAccountPreview({ id: "bank_1", providerKey: "plaid", organizationId: ORG_HQ, institution: "First Regional Bank", accountName: "Operating Account", maskedAccountNumber: "•••• 1234", currency: "USD", lastPreviewSyncAt: hoursAgo(5), transactionCount: 4 }),
  createBankAccountPreview({ id: "bank_2", providerKey: "wise_business", organizationId: ORG_HQ, institution: "Wise Business", accountName: "EUR Balance", maskedAccountNumber: "•••• 5678", currency: "EUR", lastPreviewSyncAt: hoursAgo(12), transactionCount: 2 }),
];
export function queryBankAccountsLocal(filters = {}) {
  let results = BANK_ACCOUNTS.slice();
  if (filters.organizationId) results = results.filter((b) => b.organizationId === filters.organizationId);
  return results;
}

export function createBankTransactionPreview({ id, accountId, date = new Date().toISOString(), description, amountMinor, currency, direction, providerCategory = "Uncategorized", suggestedMatch = null, reconciliationStatus = "Unmatched", confidenceExplanation = null }) {
  return { id, accountId, date, description, amountMinor, currency, direction, providerCategory, suggestedMatch, reconciliationStatus, confidenceExplanation };
}
export const BANK_TRANSACTIONS = [
  createBankTransactionPreview({ id: "btx_1", accountId: "bank_1", description: "PAYOUT STRIPE 88213", amountMinor: 184320, currency: "USD", direction: "Credit", providerCategory: "Payment Processor", suggestedMatch: { type: "Payout", id: "payout_1" }, reconciliationStatus: "Suggested Match", confidenceExplanation: "Amount and date match Payout po_stripe_88213 exactly." }),
  createBankTransactionPreview({ id: "btx_2", accountId: "bank_2", description: "PAYPAL PAYOUT 11029", amountMinor: 42100, currency: "EUR", direction: "Credit", providerCategory: "Payment Processor", suggestedMatch: { type: "Payout", id: "payout_2" }, reconciliationStatus: "Matched" }),
  createBankTransactionPreview({ id: "btx_3", accountId: "bank_1", description: "WIRE TRANSFER UNKNOWN", amountMinor: 50000, currency: "USD", direction: "Credit", providerCategory: "Uncategorized", reconciliationStatus: "Unmatched" }),
  createBankTransactionPreview({ id: "btx_4", accountId: "bank_1", description: "REFUND ADJUSTMENT", amountMinor: -5000, currency: "USD", direction: "Debit", providerCategory: "Refund", suggestedMatch: { type: "Refund", id: "refund_1" }, reconciliationStatus: "Partial Match", confidenceExplanation: "Amount matches Refund refund_1 but transaction date is 3 days later." },
  ),
];
export function findBankTransaction(id) { return BANK_TRANSACTIONS.find((t) => t.id === id) || null; }
export function queryBankTransactionsLocal(filters = {}) {
  let results = BANK_TRANSACTIONS.slice();
  if (filters.reconciliationStatus) results = results.filter((t) => t.reconciliationStatus === filters.reconciliationStatus);
  return results;
}

// ---------------------------------------------------------------------------
// Reconciliation matches, and the one genuinely new mechanic:
// separation-of-duties enforcement.
// ---------------------------------------------------------------------------
export function createReconciliationMatch({ id, bankTransactionId, matchedRecordType, matchedRecordId, evidence, status }) {
  return { id, bankTransactionId, matchedRecordType, matchedRecordId, evidence, status };
}
let lastReconciliationUndo = null;
export function confirmReconciliationMatch(bankTransactionId, actorName = "Preview User") {
  const tx = findBankTransaction(bankTransactionId);
  if (!tx) return { error: "Bank transaction not found." };
  const previousStatus = tx.reconciliationStatus;
  tx.reconciliationStatus = "Matched";
  lastReconciliationUndo = { bankTransactionId, previousStatus };
  return { transaction: tx, confirmedBy: actorName };
}
export function rejectReconciliationSuggestion(bankTransactionId) {
  const tx = findBankTransaction(bankTransactionId);
  if (!tx) return { error: "Bank transaction not found." };
  tx.suggestedMatch = null;
  tx.reconciliationStatus = "Unmatched";
  return { transaction: tx };
}
export function markReconciliationReviewRequired(bankTransactionId) {
  const tx = findBankTransaction(bankTransactionId);
  if (!tx) return { error: "Bank transaction not found." };
  tx.reconciliationStatus = "Insufficient Data";
  return { transaction: tx };
}
export function undoLastReconciliationMatch() {
  if (!lastReconciliationUndo) return { error: "Nothing to undo in the current session." };
  const tx = findBankTransaction(lastReconciliationUndo.bankTransactionId);
  if (tx) tx.reconciliationStatus = lastReconciliationUndo.previousStatus;
  lastReconciliationUndo = null;
  return { undone: true };
}

// `requiredApprover` grants (`APPROVE_PREVIEW`/`OVERRIDE`) are looked up
// through the RBAC layer by the caller (mockApi.js), not duplicated here —
// this factory only expresses the self-approval rule, which is universal
// regardless of role.
export function createSeparationOfDutiesCheck({ action, requester, requiredApprover, approverName }) {
  const selfApproval = !!requester && !!approverName && requester === approverName;
  const eligible = !selfApproval;
  return {
    action, requester, requiredApprover, approverName,
    eligible,
    result: eligible ? "Allowed" : "Blocked",
    reason: eligible ? "Approver is different from the requester." : "The requester cannot approve their own financial action — organization policy requires separation of duties.",
  };
}

// ---------------------------------------------------------------------------
// Deterministic calculations — every amount grouped by currency unless the
// one documented EXCHANGE_RATES pair applies. Each function's doc comment
// states exactly what is and is not included, per the spec's own
// requirement to "clearly define whether taxes and shipping are included."
// ---------------------------------------------------------------------------
function groupByCurrency(items, currencyField, amountFn) {
  const groups = {};
  items.forEach((item) => {
    const currency = item[currencyField];
    groups[currency] = (groups[currency] || 0) + amountFn(item);
  });
  return groups;
}
function ordersInScope(organizationId) {
  return organizationId ? COMMERCE_ORDERS.filter((o) => o.organizationId === organizationId) : COMMERCE_ORDERS;
}

// Gross sales = order subtotal before discounts, taxes or shipping.
export function computeGrossSales(organizationId) {
  return groupByCurrency(ordersInScope(organizationId), "currency", (o) => o.subtotalMinor);
}
export function computeDiscounts(organizationId) {
  return groupByCurrency(ordersInScope(organizationId), "currency", (o) => o.discountMinor);
}
export function computeTaxes(organizationId) {
  return groupByCurrency(ordersInScope(organizationId), "currency", (o) => o.taxMinor);
}
export function computeShipping(organizationId) {
  return groupByCurrency(ordersInScope(organizationId), "currency", (o) => o.shippingMinor);
}
export function computeRefundsTotal(organizationId) {
  return groupByCurrency(ordersInScope(organizationId), "currency", (o) => o.refundMinor);
}
// Net sales = subtotal - discounts - refunds. Taxes and shipping are
// pass-through amounts collected on behalf of a third party and are
// deliberately excluded from this figure.
export function computeNetSales(organizationId) {
  return groupByCurrency(ordersInScope(organizationId), "currency", (o) => o.subtotalMinor - o.discountMinor - o.refundMinor);
}
export function computePaymentsReceived(organizationId) {
  const txs = organizationId ? PAYMENT_TRANSACTIONS.filter((t) => t.organizationId === organizationId) : PAYMENT_TRANSACTIONS;
  return groupByCurrency(txs.filter((t) => t.status === "Paid"), "currency", (t) => t.amountMinor);
}
export function computeFailedPayments(organizationId) {
  const txs = organizationId ? PAYMENT_TRANSACTIONS.filter((t) => t.organizationId === organizationId) : PAYMENT_TRANSACTIONS;
  return txs.filter((t) => t.status === "Failed").length;
}
export function computeProviderFees(organizationId) {
  const txs = organizationId ? PAYMENT_TRANSACTIONS.filter((t) => t.organizationId === organizationId) : PAYMENT_TRANSACTIONS;
  return groupByCurrency(txs, "currency", (t) => t.feeMinor);
}
export function computeNetPaymentAmount(organizationId) {
  const txs = organizationId ? PAYMENT_TRANSACTIONS.filter((t) => t.organizationId === organizationId) : PAYMENT_TRANSACTIONS;
  return groupByCurrency(txs, "currency", (t) => t.netAmountMinor);
}
// Outstanding/overdue invoice value comes from the real (but currently
// unseeded) Finance `invoices` array — see the file-level note above. If no
// Invoice has ever been created in the current session, both return {}.
export function computeOutstandingInvoiceValue() {
  return groupByCurrency(financeInvoices.filter((i) => i.status !== "Paid" && i.status !== "Void"), "currency", (i) => Math.round((i.amountDue || 0) * 100));
}
export function computeOverdueInvoiceValue() {
  return groupByCurrency(financeInvoices.filter((i) => i.status === "Overdue"), "currency", (i) => Math.round((i.amountDue || 0) * 100));
}
// Accounts-receivable aging — buckets by days past due date, real Invoices
// only (same honesty-over-fabrication rule as the mapping fixtures above).
export function computeARAging() {
  const now = Date.now();
  const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  financeInvoices.filter((i) => i.status !== "Paid" && i.status !== "Void").forEach((i) => {
    const daysPastDue = Math.floor((now - new Date(i.dueDate).getTime()) / DAY_MS);
    const amount = Math.round((i.amountDue || 0) * 100);
    if (daysPastDue <= 30) buckets["0-30"] += amount;
    else if (daysPastDue <= 60) buckets["31-60"] += amount;
    else if (daysPastDue <= 90) buckets["61-90"] += amount;
    else buckets["90+"] += amount;
  });
  return buckets;
}
export function computeProviderHealthCounts(connections, organizationId) {
  const providerKeys = new Set(PHASE5_PROVIDERS.map((p) => p.key));
  const scoped = connections.filter((c) => providerKeys.has(c.providerKey) && (!organizationId || c.organizationId === organizationId));
  const counts = {};
  scoped.forEach((c) => {
    const status = c.health?.status;
    if (!status) return;
    counts[status] = (counts[status] || 0) + 1;
  });
  return counts;
}
export function computeActiveSubscriptionCount(organizationId) {
  const subs = organizationId ? SUBSCRIPTION_PREVIEWS.filter((s) => s.organizationId === organizationId) : SUBSCRIPTION_PREVIEWS;
  return subs.filter((s) => s.status === "Active" || s.status === "Trialing").length;
}
export function computeTrialingSubscriptions(organizationId) {
  const subs = organizationId ? SUBSCRIPTION_PREVIEWS.filter((s) => s.organizationId === organizationId) : SUBSCRIPTION_PREVIEWS;
  return subs.filter((s) => s.status === "Trialing").length;
}
export function computePastDueSubscriptions(organizationId) {
  const subs = organizationId ? SUBSCRIPTION_PREVIEWS.filter((s) => s.organizationId === organizationId) : SUBSCRIPTION_PREVIEWS;
  return subs.filter((s) => s.status === "Past Due").length;
}
// MRR excludes one-time payments entirely — only recurring subscription
// amounts, normalized to a monthly figure via their own billing cycle.
export function computeMRR(organizationId) {
  const subs = (organizationId ? SUBSCRIPTION_PREVIEWS.filter((s) => s.organizationId === organizationId) : SUBSCRIPTION_PREVIEWS)
    .filter((s) => s.status === "Active" || s.status === "Past Due");
  return groupByCurrency(subs, "currency", (s) => normalizeToMonthlyMinor(s.recurringAmountMinor, s.billingCycle));
}
export function computeARR(organizationId) {
  const mrr = computeMRR(organizationId);
  const arr = {};
  Object.entries(mrr).forEach(([currency, amount]) => { arr[currency] = amount * 12; });
  return arr;
}
export function computeNewRecurringRevenue(organizationId) {
  const subs = (organizationId ? SUBSCRIPTION_PREVIEWS.filter((s) => s.organizationId === organizationId) : SUBSCRIPTION_PREVIEWS)
    .filter((s) => s.previousRecurringAmountMinor === null && (s.status === "Active" || s.status === "Trialing"));
  return groupByCurrency(subs, "currency", (s) => normalizeToMonthlyMinor(s.recurringAmountMinor, s.billingCycle));
}
export function computeExpansionRevenue(organizationId) {
  const subs = (organizationId ? SUBSCRIPTION_PREVIEWS.filter((s) => s.organizationId === organizationId) : SUBSCRIPTION_PREVIEWS)
    .filter((s) => s.previousRecurringAmountMinor != null && s.recurringAmountMinor > s.previousRecurringAmountMinor && s.status === "Active");
  return groupByCurrency(subs, "currency", (s) => normalizeToMonthlyMinor(s.recurringAmountMinor - s.previousRecurringAmountMinor, s.billingCycle));
}
export function computeContractionRevenue(organizationId) {
  const subs = (organizationId ? SUBSCRIPTION_PREVIEWS.filter((s) => s.organizationId === organizationId) : SUBSCRIPTION_PREVIEWS)
    .filter((s) => s.previousRecurringAmountMinor != null && s.recurringAmountMinor < s.previousRecurringAmountMinor && (s.status === "Active" || s.status === "Past Due"));
  return groupByCurrency(subs, "currency", (s) => normalizeToMonthlyMinor(s.previousRecurringAmountMinor - s.recurringAmountMinor, s.billingCycle));
}
export function computeChurnedRecurringRevenue(organizationId) {
  const subs = (organizationId ? SUBSCRIPTION_PREVIEWS.filter((s) => s.organizationId === organizationId) : SUBSCRIPTION_PREVIEWS)
    .filter((s) => s.status === "Cancelled" || s.status === "Expired");
  return groupByCurrency(subs, "currency", (s) => normalizeToMonthlyMinor(s.previousRecurringAmountMinor ?? s.recurringAmountMinor, s.billingCycle));
}
export function computeUpcomingRenewalValue(organizationId, withinDays = 30) {
  const cutoff = daysFromNow(withinDays);
  const subs = (organizationId ? SUBSCRIPTION_PREVIEWS.filter((s) => s.organizationId === organizationId) : SUBSCRIPTION_PREVIEWS)
    .filter((s) => s.status === "Active" && s.renewalDate && s.renewalDate <= cutoff);
  return groupByCurrency(subs, "currency", (s) => s.recurringAmountMinor);
}
export function computeReconciliationMatchRate() {
  const total = BANK_TRANSACTIONS.length;
  if (total === 0) return 0;
  const matched = BANK_TRANSACTIONS.filter((t) => t.reconciliationStatus === "Matched").length;
  return Math.round((matched / total) * 100);
}
export function computeMatchedTransactions() { return BANK_TRANSACTIONS.filter((t) => t.reconciliationStatus === "Matched").length; }
export function computeUnmatchedTransactions() { return BANK_TRANSACTIONS.filter((t) => t.reconciliationStatus === "Unmatched").length; }
export function computePartialMatches() { return BANK_TRANSACTIONS.filter((t) => t.reconciliationStatus === "Partial Match").length; }
export function computeFinancialSyncConflicts(organizationId) {
  return queryFinancialSyncConflictsLocal(organizationId ? { organizationId } : {}).filter((c) => c.resolutionState === "Open").length;
}
export function computeSynchronizedOrderPreviews(organizationId) {
  return ordersInScope(organizationId).filter((o) => o.syncStatus === "Synced").length;
}

export function computeCommerceFinanceOverviewMetrics({ organizationId, connections = [] } = {}) {
  const providerKeys = new Set(PHASE5_PROVIDERS.map((p) => p.key));
  const previewConnectedProviders = connections.filter(
    (c) => providerKeys.has(c.providerKey) && c.status === "Preview Connected" && (!organizationId || c.organizationId === organizationId)
  ).length;
  return {
    previewConnectedProviders,
    synchronizedOrderPreviews: computeSynchronizedOrderPreviews(organizationId),
    grossSales: computeGrossSales(organizationId),
    netSales: computeNetSales(organizationId),
    paymentsReceived: computePaymentsReceived(organizationId),
    refunds: computeRefundsTotal(organizationId),
    providerFees: computeProviderFees(organizationId),
    outstandingInvoices: computeOutstandingInvoiceValue(),
    overdueInvoices: computeOverdueInvoiceValue(),
    activeSubscriptions: computeActiveSubscriptionCount(organizationId),
    monthlyRecurringRevenue: computeMRR(organizationId),
    unmatchedTransactions: computeUnmatchedTransactions(),
    financialSyncConflicts: computeFinancialSyncConflicts(organizationId),
  };
}
