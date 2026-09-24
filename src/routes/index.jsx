// src/routes/index.jsx
import { lazy } from 'react';

// Auth Components
export const Login = lazy(() => import('../pages/Login'));
export const NotRequireAuth = lazy(() => import('../components/Auth/NotRequireAuth'));
export const RequireAuth = lazy(() => import('../components/Auth/RequireAuth'));
export const Denied = lazy(() => import('../pages/404/Denied'));
export const InviteAcceptance = lazy(() => import('../pages/Invite/InviteAcceptance'));
export const JoinAcceptance = lazy(() => import('../pages/Invite/JoinAcceptance'));

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
export const AiOverview = lazy(() => import('../pages/AI/AiOverview'));
export const AiCopilot = lazy(() => import('../pages/AI/AiCopilot'));

// Administration: Roles & Permissions (frontend RBAC preview)
export const RolesList = lazy(() => import('../pages/Admin/RolesList'));
export const RoleDetail = lazy(() => import('../pages/Admin/RoleDetail'));
export const PermissionsMatrix = lazy(() => import('../pages/Admin/PermissionsMatrix'));

// Users & Access: Members / Invitations / Invite Links / Access Audit
// (frontend-only invitation preview — see mockAccessData.js's header comment)
export const MembersList = lazy(() => import('../pages/Admin/MembersList'));
export const InvitationsList = lazy(() => import('../pages/Admin/InvitationsList'));
export const InviteLinksList = lazy(() => import('../pages/Admin/InviteLinksList'));
export const AccessAudit = lazy(() => import('../pages/Admin/AccessAudit'));

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
export const AiProviderOverview = lazy(() => import('../pages/Admin/AiProviderOverview'));
export const AiProviderConnectionList = lazy(() => import('../pages/Admin/AiProviderConnectionList'));
export const AiModelCatalog = lazy(() => import('../pages/Admin/AiModelCatalog'));
export const AiRoutingPolicyConfig = lazy(() => import('../pages/Admin/AiRoutingPolicyConfig'));
export const AiPolicyConfig = lazy(() => import('../pages/Admin/AiPolicyConfig'));
export const AiPrivacyConfig = lazy(() => import('../pages/Admin/AiPrivacyConfig'));
export const AiUsageDashboard = lazy(() => import('../pages/Admin/AiUsageDashboard'));
export const AiEvaluationsList = lazy(() => import('../pages/Admin/AiEvaluationsList'));
export const AiAuditLog = lazy(() => import('../pages/Admin/AiAuditLog'));