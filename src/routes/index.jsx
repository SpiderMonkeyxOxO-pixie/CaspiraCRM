// src/routes/index.jsx
import { lazy } from 'react';

// Auth Components
export const Login = lazy(() => import('../pages/Login'));
export const NotRequireAuth = lazy(() => import('../components/Auth/NotRequireAuth'));
export const RequireAuth = lazy(() => import('../components/Auth/RequireAuth'));
export const Denied = lazy(() => import('../pages/404/Denied'));
// With the backend sign-in mode on, Users & Access and the invitation pages
// use the live screens (pages/Admin/accessBackend, pages/Invite/AcceptBackend).
export const BACKEND_AUTH_LIVE = import.meta.env.VITE_BACKEND_AUTH_MODE === "true";
const acceptPage = (kind) => import('../pages/Invite/AcceptBackend').then(({ default: Accept }) => ({ default: () => <Accept kind={kind} /> }));
export const InviteAcceptance = lazy(() => (BACKEND_AUTH_LIVE ? acceptPage("invitation") : import('../pages/Invite/InviteAcceptance')));
export const JoinAcceptance = lazy(() => (BACKEND_AUTH_LIVE ? acceptPage("join") : import('../pages/Invite/JoinAcceptance')));

// Layout Components
export const Layout = lazy(() => import('../Layout/Layout'));

// Common Pages
export const Settings = lazy(() => import('../pages/Setting Page/Settings'));

// CRM Components
export const CrmLayout = lazy(() => import('../pages/CRM/CrmLayout'));
export const CrmDashboard = lazy(() => import('../pages/CRM/Dashboard/DashboardPage'));
export const LeadsList = lazy(() => import('../pages/CRM/Leads/LeadsList'));
export const LeadDetail = lazy(() => import('../pages/CRM/Leads/LeadDetail'));
export const CompaniesList = lazy(() => import('../pages/CRM/Companies/CompaniesList'));
export const CompanyDetail = lazy(() => import('../pages/CRM/Companies/CompanyDetail'));
export const ContactsList = lazy(() => import('../pages/CRM/Contacts/ContactsList'));
export const ContactDetail = lazy(() => import('../pages/CRM/Contacts/ContactDetail'));
export const DealsList = lazy(() => import('../pages/CRM/Deals/DealsList'));
export const DealDetail = lazy(() => import('../pages/CRM/Deals/DealDetail'));
export const Pipeline = lazy(() => import('../pages/CRM/Pipeline/PipelineBoard'));
export const ActivitiesPage = lazy(() => import('../pages/CRM/Activities/ActivitiesPage'));
export const ImportWizard = lazy(() => import('../pages/CRM/Import/ImportWizard'));
export const DuplicatesPage = lazy(() => import('../pages/CRM/Duplicates/DuplicatesPage'));

// Sales Components
export const SalesLayout = lazy(() => import('../pages/Sales/SalesLayout'));
export const SalesDashboard = lazy(() => import('../pages/Sales/SalesDashboard'));
export const ProductsList = lazy(() => import('../pages/Sales/Products/ProductsList'));
export const ProductDetail = lazy(() => import('../pages/Sales/Products/ProductDetail'));
export const PriceBooksList = lazy(() => import('../pages/Sales/PriceBooks/PriceBooksList'));
export const PriceBookDetail = lazy(() => import('../pages/Sales/PriceBooks/PriceBookDetail'));
export const QuotesList = lazy(() => import('../pages/Sales/Quotes/QuotesList'));
export const QuoteDetail = lazy(() => import('../pages/Sales/Quotes/QuoteDetail'));
export const OrdersList = lazy(() => import('../pages/Sales/Orders/OrdersList'));
export const OrderDetail = lazy(() => import('../pages/Sales/Orders/OrderDetail'));
export const ContractsList = lazy(() => import('../pages/Sales/Contracts/ContractsList'));
export const ContractDetail = lazy(() => import('../pages/Sales/Contracts/ContractDetail'));

// Support Components
export const SupportLayout = lazy(() => import('../pages/Support/SupportLayout'));
export const SupportDashboard = lazy(() => import('../pages/Support/SupportDashboard'));
export const TicketsList = lazy(() => import('../pages/Support/Tickets/TicketsList'));
export const TicketDetail = lazy(() => import('../pages/Support/Tickets/TicketDetail'));

// Projects Components
export const ProjectsList = lazy(() => import('../pages/Projects/ProjectsList'));
export const ProjectDetailLayout = lazy(() => import('../pages/Projects/ProjectDetailLayout'));
export const ProjectOverview = lazy(() => import('../pages/Projects/ProjectOverview'));
export const ProjectTasks = lazy(() => import('../pages/Projects/ProjectTasks'));
export const ProjectBoard = lazy(() => import('../pages/Projects/ProjectBoard'));
export const ProjectMilestones = lazy(() => import('../pages/Projects/ProjectMilestones'));
export const AllTasks = lazy(() => import('../pages/Projects/AllTasks'));

// Marketing Components
export const MarketingLayout = lazy(() => import('../pages/Marketing/MarketingLayout'));
export const MarketingDashboard = lazy(() => import('../pages/Marketing/MarketingDashboard'));
export const CampaignsList = lazy(() => import('../pages/Marketing/Campaigns/CampaignsList'));
export const CampaignDetail = lazy(() => import('../pages/Marketing/Campaigns/CampaignDetail'));
export const SegmentsList = lazy(() => import('../pages/Marketing/Segments/SegmentsList'));
export const FormsList = lazy(() => import('../pages/Marketing/Forms/FormsList'));
export const TemplatesList = lazy(() => import('../pages/Marketing/Templates/TemplatesList'));

// Finance Components
export const FinanceLayout = lazy(() => import('../pages/Finance/FinanceLayout'));
export const FinanceDashboard = lazy(() => import('../pages/Finance/FinanceDashboard'));
export const InvoicesList = lazy(() => import('../pages/Finance/Invoices/InvoicesList'));
export const InvoiceDetail = lazy(() => import('../pages/Finance/Invoices/InvoiceDetail'));
export const PaymentsList = lazy(() => import('../pages/Finance/Payments/PaymentsList'));
export const CreditNotesList = lazy(() => import('../pages/Finance/CreditNotes/CreditNotesList'));
export const ExpensesList = lazy(() => import('../pages/Finance/Expenses/ExpensesList'));
export const ApprovalsQueue = lazy(() => import('../pages/Finance/Approvals/ApprovalsQueue'));
export const FinanceReports = lazy(() => import('../pages/Finance/Reports/FinanceReports'));
export const FinanceSetup = lazy(() => import('../pages/Finance/Setup/FinanceSetup'));
export const RecurringInvoicesList = lazy(() => import('../pages/Finance/RecurringInvoices/RecurringInvoicesList'));

// AI Intelligence Center (frontend-only preview — no backend AI gateway yet)
export const AiLayout = lazy(() => import('../pages/AI/AiLayout'));
// Backend Phase 11 — AI Administration (backend AI mode; each page checks grants).
export const AiGovernancePage = lazy(() => import('../pages/AI/admin/GovernancePage'));
export const AiEvaluationsPage = lazy(() => import('../pages/AI/admin/EvaluationsPage'));
export const AiMonitoringPage = lazy(() => import('../pages/AI/admin/MonitoringPage'));
export const AiIncidentsPage = lazy(() => import('../pages/AI/admin/IncidentsPage'));
export const AiReleasesPage = lazy(() => import('../pages/AI/admin/ReleasesPage'));
export const AiUsagePage = lazy(() => import('../pages/AI/admin/UsagePage'));
// Backend Phase 12 — Analytics & Reports (pages gate themselves on grants)
export const AnalyticsDashboard = lazy(() => import('../pages/Analytics/AnalyticsDashboard'));
export const AnalyticsMetricsPage = lazy(() => import('../pages/Analytics/MetricsPage'));
export const AnalyticsWarehousePage = lazy(() => import('../pages/Analytics/WarehousePage'));
export const ReportsPage = lazy(() => import('../pages/Analytics/ReportsPage'));
export const ReportBuilder = lazy(() => import('../pages/Analytics/ReportBuilder'));
export const ReportSchedulesPage = lazy(() => import('../pages/Analytics/SchedulesPage'));
export const ReportExportsPage = lazy(() => import('../pages/Analytics/ExportsPage'));
export const AiOverview = lazy(() => import('../pages/AI/AiOverview'));
// Backend Phase 10: backend-driven Copilot when VITE_BACKEND_AI_MODE=true.
export const AiCopilot = lazy(() => (import.meta.env.VITE_BACKEND_AI_MODE === "true" ? import('../pages/AI/copilotBackend/AiCopilotBackend') : import('../pages/AI/AiCopilot')));

// Administration: Roles & Permissions (frontend RBAC preview)
const liveRoles = (name) => import('../pages/Admin/accessBackend/RolesBackend').then((m) => ({ default: m[name] }));
export const RolesList = lazy(() => (BACKEND_AUTH_LIVE ? liveRoles("RolesListBackend") : import('../pages/Admin/RolesList')));
export const RoleDetail = lazy(() => (BACKEND_AUTH_LIVE ? liveRoles("RoleDetailBackend") : import('../pages/Admin/RoleDetail')));
export const PermissionsMatrix = lazy(() => (BACKEND_AUTH_LIVE ? liveRoles("PermissionsMatrixBackend") : import('../pages/Admin/PermissionsMatrix')));

// Users & Access: Members / Invitations / Invite Links / Access Audit
// (frontend-only invitation preview — see mockAccessData.js's header comment)
export const MembersList = lazy(() => (BACKEND_AUTH_LIVE ? import('../pages/Admin/accessBackend/MembersBackend') : import('../pages/Admin/MembersList')));
export const InvitationsList = lazy(() => (BACKEND_AUTH_LIVE ? import('../pages/Admin/accessBackend/InvitationsBackend') : import('../pages/Admin/InvitationsList')));
export const InviteLinksList = lazy(() => (BACKEND_AUTH_LIVE ? import('../pages/Admin/accessBackend/InviteLinksBackend') : import('../pages/Admin/InviteLinksList')));
export const AccessAudit = lazy(() => (BACKEND_AUTH_LIVE ? import('../pages/Admin/accessBackend/AccessAuditBackend') : import('../pages/Admin/AccessAudit')));
// Backend Phase 13 — Platform Operations (System Owner and delegated platform roles).
export const PlatformOperations = lazy(() => import('../pages/Admin/platform/PlatformOperations'));

// Integration Center (frontend-only preview — see mockIntegrationsData.js's
// header comment: no real provider is ever contacted)
export const IntegrationsOverview = lazy(() => import('../pages/Admin/IntegrationsOverview'));
export const IntegrationMarketplace = lazy(() => import('../pages/Admin/IntegrationMarketplace'));
export const ProviderDetail = lazy(() => import('../pages/Admin/ProviderDetail'));
export const ConnectionDetail = lazy(() => import('../pages/Admin/ConnectionDetail'));
export const IntegrationActivity = lazy(() => import('../pages/Admin/IntegrationActivity'));
export const IntegrationWebhooks = lazy(() => import('../pages/Admin/IntegrationWebhooks'));

// Sales and Marketing Integrations (Phase 4, frontend-only preview — see
// mockSalesMarketingData.js's header comment). Routes added incrementally
// as each page ships, same convention Phase 3 used.
export const SalesMarketingOverview = lazy(() => import('../pages/Admin/SalesMarketingOverview'));
export const SalesLeadCapture = lazy(() => import('../pages/Admin/SalesLeadCapture'));
export const SalesAudienceSync = lazy(() => import('../pages/Admin/SalesAudienceSync'));
export const SalesSuppression = lazy(() => import('../pages/Admin/SalesSuppression'));
export const SalesEmailDelivery = lazy(() => import('../pages/Admin/SalesEmailDelivery'));
export const SalesAttribution = lazy(() => import('../pages/Admin/SalesAttribution'));
export const SalesFormsIntegration = lazy(() => import('../pages/Admin/SalesFormsIntegration'));

// Customer Support and Communication Integrations (Phase 3, frontend-only
// preview — see mockSupportCommunicationData.js's header comment).
export const SupportCommunicationOverview = lazy(() => import('../pages/Admin/SupportCommunicationOverview'));
export const SupportInbox = lazy(() => import('../pages/Admin/SupportInbox'));
export const SupportTicketsIntegration = lazy(() => import('../pages/Admin/SupportTicketsIntegration'));
export const SupportChannels = lazy(() => import('../pages/Admin/SupportChannels'));
export const SupportTelephony = lazy(() => import('../pages/Admin/SupportTelephony'));
export const SupportSLA = lazy(() => import('../pages/Admin/SupportSLA'));

// Projects and Development Integrations (Phase 4, frontend-only preview —
// see mockProjectsDevelopmentData.js's header comment).
export const ProjectsDevelopmentOverview = lazy(() => import('../pages/Admin/ProjectsDevelopmentOverview'));
export const ProjectsIntegrationList = lazy(() => import('../pages/Admin/ProjectsIntegrationList'));
export const TasksIntegrationList = lazy(() => import('../pages/Admin/TasksIntegrationList'));
export const ProjectMappingsConfig = lazy(() => import('../pages/Admin/ProjectMappingsConfig'));
export const DevelopmentIntegration = lazy(() => import('../pages/Admin/DevelopmentIntegration'));
export const DeliveryHealthDashboard = lazy(() => import('../pages/Admin/DeliveryHealthDashboard'));

// Commerce and Finance Integrations (Phase 5, frontend-only preview — see
// mockCommerceFinanceData.js's header comment).
export const CommerceFinanceOverview = lazy(() => import('../pages/Admin/CommerceFinanceOverview'));
export const CommerceIntegrationList = lazy(() => import('../pages/Admin/CommerceIntegrationList'));
export const PaymentsIntegrationList = lazy(() => import('../pages/Admin/PaymentsIntegrationList'));
export const AccountingMappingsConfig = lazy(() => import('../pages/Admin/AccountingMappingsConfig'));
export const SubscriptionsIntegrationList = lazy(() => import('../pages/Admin/SubscriptionsIntegrationList'));
export const BankingIntegrationList = lazy(() => import('../pages/Admin/BankingIntegrationList'));
export const ReconciliationWorkbench = lazy(() => import('../pages/Admin/ReconciliationWorkbench'));

// Documents, Storage and Electronic Signature Integrations (Phase 6,
// frontend-only preview — see mockDocumentsStorageData.js's header comment).
export const DocumentsStorageOverview = lazy(() => import('../pages/Admin/DocumentsStorageOverview'));
export const FilesIntegrationList = lazy(() => import('../pages/Admin/FilesIntegrationList'));
export const DocumentMappingsConfig = lazy(() => import('../pages/Admin/DocumentMappingsConfig'));
export const DocumentAccessReview = lazy(() => import('../pages/Admin/DocumentAccessReview'));
export const SignatureWorkflowList = lazy(() => import('../pages/Admin/SignatureWorkflowList'));
export const SignatureTemplatesList = lazy(() => import('../pages/Admin/SignatureTemplatesList'));
export const RetentionPolicyConfig = lazy(() => import('../pages/Admin/RetentionPolicyConfig'));

// AI Provider and Intelligence Integrations (Phase 7, final — frontend-only
// preview; the real AI gateway at src/pages/AI/* is untouched by this).
// Backend Phase 9: with VITE_BACKEND_AI_MODE=true the same routes render the
// backend-driven screens (pages/Admin/aiBackend); otherwise the frontend
// previews above keep working unchanged.
const BACKEND_AI = import.meta.env.VITE_BACKEND_AI_MODE === "true";
export const AiProviderOverview = lazy(() => (BACKEND_AI ? import('../pages/Admin/aiBackend/AiOverviewBackend') : import('../pages/Admin/AiProviderOverview')));
export const AiProviderConnectionList = lazy(() => (BACKEND_AI ? import('../pages/Admin/aiBackend/AiProvidersBackend') : import('../pages/Admin/AiProviderConnectionList')));
export const AiModelCatalog = lazy(() => (BACKEND_AI ? import('../pages/Admin/aiBackend/AiModelsBackend') : import('../pages/Admin/AiModelCatalog')));
export const AiRoutingPolicyConfig = lazy(() => (BACKEND_AI ? import('../pages/Admin/aiBackend/AiRoutingBackend') : import('../pages/Admin/AiRoutingPolicyConfig')));
export const AiPolicyConfig = lazy(() => (BACKEND_AI ? import('../pages/Admin/aiBackend/AiPoliciesBackend') : import('../pages/Admin/AiPolicyConfig')));
export const AiPrivacyConfig = lazy(() => (BACKEND_AI ? import('../pages/Admin/aiBackend/AiPrivacyBackend') : import('../pages/Admin/AiPrivacyConfig')));
export const AiUsageDashboard = lazy(() => (BACKEND_AI ? import('../pages/Admin/aiBackend/AiUsageBackend') : import('../pages/Admin/AiUsageDashboard')));
export const AiEvaluationsList = lazy(() => (BACKEND_AI ? import('../pages/Admin/aiBackend/AiEvaluationsBackend') : import('../pages/Admin/AiEvaluationsList')));
export const AiAuditLog = lazy(() => (BACKEND_AI ? import('../pages/Admin/aiBackend/AiAuditBackend') : import('../pages/Admin/AiAuditLog')));