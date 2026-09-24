import "./App.css";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";

import {
  Login,
  Layout,
  NotRequireAuth,
  RequireAuth,
  Denied,
  InviteAcceptance,
  JoinAcceptance,
  Settings,
  CrmLayout,
  CrmDashboard,
  LeadsList,
  LeadDetail,
  CompaniesList,
  CompanyDetail,
  ContactsList,
  ContactDetail,
  DealsList,
  DealDetail,
  Pipeline,
  ActivitiesPage,
  ImportWizard,
  DuplicatesPage,
  SalesLayout,
  SalesDashboard,
  ProductsList,
  ProductDetail,
  PriceBooksList,
  PriceBookDetail,
  QuotesList,
  QuoteDetail,
  OrdersList,
  OrderDetail,
  ContractsList,
  ContractDetail,
  SupportLayout,
  SupportDashboard,
  TicketsList,
  TicketDetail,
  ProjectsList,
  ProjectDetailLayout,
  ProjectOverview,
  ProjectTasks,
  ProjectBoard,
  ProjectMilestones,
  AllTasks,
  MarketingLayout,
  MarketingDashboard,
  CampaignsList,
  CampaignDetail,
  SegmentsList,
  FormsList,
  TemplatesList,
  FinanceLayout,
  FinanceDashboard,
  InvoicesList,
  InvoiceDetail,
  PaymentsList,
  CreditNotesList,
  ExpensesList,
  RecurringInvoicesList,
  ApprovalsQueue,
  FinanceReports,
  FinanceSetup,
  RolesList,
  RoleDetail,
  PermissionsMatrix,
  MembersList,
  InvitationsList,
  InviteLinksList,
  AccessAudit,
  IntegrationsOverview,
  IntegrationMarketplace,
  ProviderDetail,
  ConnectionDetail,
  IntegrationActivity,
  IntegrationWebhooks,
  SalesMarketingOverview,
  SalesLeadCapture,
  SalesAudienceSync,
  SalesSuppression,
  SalesEmailDelivery,
  SalesAttribution,
  SalesFormsIntegration,
  SupportCommunicationOverview,
  SupportInbox,
  SupportTicketsIntegration,
  SupportChannels,
  SupportTelephony,
  SupportSLA,
  ProjectsDevelopmentOverview,
  ProjectsIntegrationList,
  TasksIntegrationList,
  ProjectMappingsConfig,
  DevelopmentIntegration,
  DeliveryHealthDashboard,
  CommerceFinanceOverview,
  CommerceIntegrationList,
  PaymentsIntegrationList,
  AccountingMappingsConfig,
  SubscriptionsIntegrationList,
  BankingIntegrationList,
  ReconciliationWorkbench,
  DocumentsStorageOverview,
  FilesIntegrationList,
  DocumentMappingsConfig,
  DocumentAccessReview,
  SignatureWorkflowList,
  SignatureTemplatesList,
  RetentionPolicyConfig,
  AiProviderOverview,
  AiProviderConnectionList,
  AiModelCatalog,
  AiRoutingPolicyConfig,
  AiPolicyConfig,
  AiPrivacyConfig,
  AiUsageDashboard,
  AiEvaluationsList,
  AiAuditLog,
  AiLayout,
  AiOverview,
  AiCopilot,
} from "./routes/index";
import { BACKEND_FINANCE_MODE_ENABLED } from "./Helpers/backendFinanceClient";

const NoLoader = () => null;

// Finance: with the real backend every signed-in role may open /finance —
// each page and the sidebar follow the member's Finance grants (a Finance
// Manager or Accountant usually has the login role "User"). Demo mode keeps
// the original role list.
const FINANCE_ROLES = BACKEND_FINANCE_MODE_ENABLED ? ["Super-Admin", "Admin", "Team-Leader", "User", "Checker"] : ["Super-Admin", "Admin", "Checker"];

function App() {
  const location = useLocation();
  return (
    <ErrorBoundary key={location.pathname}>
    <Suspense fallback={<NoLoader />}>
      <Routes>
        <Route path="/" element={<Navigate to="/login" />} />

        {/* PUBLIC ROUTES */}
        <Route element={<NotRequireAuth />}>
          <Route path="/login" element={<Login />} />
        </Route>

        {/* Invitation/invite-link acceptance — intentionally public (an
            invitee isn't logged in yet) and outside RequireAuth. Frontend
            preview only: no real token, account, or membership exists. */}
        <Route path="/invite/:token" element={<InviteAcceptance />} />
        <Route path="/join/:token" element={<JoinAcceptance />} />

        {/* SETTINGS (Super-Admin + Admin) */}
        <Route element={<RequireAuth allowedRoles={["Super-Admin", "Admin"]} />}>
          <Route path="/settings" element={<Layout />}>
            <Route index element={<Settings />} />
          </Route>
        </Route>

        {/* ADMINISTRATION: Users & Access — Members, Invitations, Invite Links,
            Roles & Permissions, Access Audit (Super-Admin + Admin). */}
        <Route element={<RequireAuth allowedRoles={["Super-Admin", "Admin"]} />}>
          <Route path="/admin" element={<Layout />}>
            <Route path="users" element={<MembersList />} />
            <Route path="invitations" element={<InvitationsList />} />
            <Route path="invite-links" element={<InviteLinksList />} />
            <Route path="access-audit" element={<AccessAudit />} />
            <Route path="roles" element={<RolesList />} />
            <Route path="roles/:roleId" element={<RoleDetail />} />
            <Route path="permissions" element={<PermissionsMatrix />} />
            {/* Integration Center (frontend-only preview). Static segments
                (marketplace/activity/webhooks/connections) are declared
                before the dynamic :providerKey route added in a later phase
                of this same package, matching React Router v6's own static-
                over-dynamic ranking. */}
            <Route path="integrations" element={<IntegrationsOverview />} />
            <Route path="integrations/marketplace" element={<IntegrationMarketplace />} />
            <Route path="integrations/activity" element={<IntegrationActivity />} />
            <Route path="integrations/webhooks" element={<IntegrationWebhooks />} />
            <Route path="integrations/connections/:connectionId" element={<ConnectionDetail />} />
            {/* Customer Support and Communication Integrations (Phase 3,
                frontend-only preview). Only the Overview page exists so
                far — the other 5 static segments are added one per phase,
                before the dynamic :providerKey catch-all below. */}
            <Route path="integrations/sales-marketing" element={<SalesMarketingOverview />} />
            <Route path="integrations/sales-marketing/lead-capture" element={<SalesLeadCapture />} />
            <Route path="integrations/sales-marketing/audiences" element={<SalesAudienceSync />} />
            <Route path="integrations/sales-marketing/suppression" element={<SalesSuppression />} />
            <Route path="integrations/sales-marketing/email-delivery" element={<SalesEmailDelivery />} />
            <Route path="integrations/sales-marketing/attribution" element={<SalesAttribution />} />
            <Route path="integrations/sales-marketing/forms" element={<SalesFormsIntegration />} />
            <Route path="integrations/support-communication" element={<SupportCommunicationOverview />} />
            <Route path="integrations/support-communication/inbox" element={<SupportInbox />} />
            <Route path="integrations/support-communication/tickets" element={<SupportTicketsIntegration />} />
            <Route path="integrations/support-communication/channels" element={<SupportChannels />} />
            <Route path="integrations/support-communication/telephony" element={<SupportTelephony />} />
            <Route path="integrations/support-communication/sla" element={<SupportSLA />} />
            {/* Projects and Development Integrations (Phase 4, frontend-only
                preview). */}
            <Route path="integrations/projects-development" element={<ProjectsDevelopmentOverview />} />
            <Route path="integrations/projects-development/projects" element={<ProjectsIntegrationList />} />
            <Route path="integrations/projects-development/tasks" element={<TasksIntegrationList />} />
            <Route path="integrations/projects-development/mappings" element={<ProjectMappingsConfig />} />
            <Route path="integrations/projects-development/development" element={<DevelopmentIntegration />} />
            <Route path="integrations/projects-development/delivery-health" element={<DeliveryHealthDashboard />} />
            {/* Commerce and Finance Integrations (Phase 5, frontend-only
                preview). */}
            <Route path="integrations/commerce-finance" element={<CommerceFinanceOverview />} />
            <Route path="integrations/commerce-finance/commerce" element={<CommerceIntegrationList />} />
            <Route path="integrations/commerce-finance/payments" element={<PaymentsIntegrationList />} />
            <Route path="integrations/commerce-finance/accounting" element={<AccountingMappingsConfig />} />
            <Route path="integrations/commerce-finance/subscriptions" element={<SubscriptionsIntegrationList />} />
            <Route path="integrations/commerce-finance/banking" element={<BankingIntegrationList />} />
            <Route path="integrations/commerce-finance/reconciliation" element={<ReconciliationWorkbench />} />
            {/* Documents, Storage and Electronic Signature Integrations
                (Phase 6, frontend-only preview). */}
            <Route path="integrations/documents-storage" element={<DocumentsStorageOverview />} />
            <Route path="integrations/documents-storage/files" element={<FilesIntegrationList />} />
            <Route path="integrations/documents-storage/mappings" element={<DocumentMappingsConfig />} />
            <Route path="integrations/documents-storage/access-review" element={<DocumentAccessReview />} />
            <Route path="integrations/documents-storage/signatures" element={<SignatureWorkflowList />} />
            <Route path="integrations/documents-storage/templates" element={<SignatureTemplatesList />} />
            <Route path="integrations/documents-storage/retention" element={<RetentionPolicyConfig />} />
            {/* AI Provider and Intelligence Integrations (Phase 7, final —
                frontend-only preview). This is entirely separate from the
                real, already-shipped AI gateway at /ai/overview and
                /ai/copilot below — no route here touches that gateway. */}
            <Route path="integrations/ai-providers" element={<AiProviderOverview />} />
            <Route path="integrations/ai-providers/providers" element={<AiProviderConnectionList />} />
            <Route path="integrations/ai-providers/models" element={<AiModelCatalog />} />
            <Route path="integrations/ai-providers/routing" element={<AiRoutingPolicyConfig />} />
            <Route path="integrations/ai-providers/policies" element={<AiPolicyConfig />} />
            <Route path="integrations/ai-providers/privacy" element={<AiPrivacyConfig />} />
            <Route path="integrations/ai-providers/usage" element={<AiUsageDashboard />} />
            <Route path="integrations/ai-providers/evaluations" element={<AiEvaluationsList />} />
            <Route path="integrations/ai-providers/audit" element={<AiAuditLog />} />
            <Route path="integrations/:providerKey" element={<ProviderDetail />} />
          </Route>
        </Route>

        {/* CRM (Super-Admin + Admin + Team-Leader + User) */}
        <Route element={<RequireAuth allowedRoles={["Super-Admin", "Admin", "Team-Leader", "User"]} />}>
          <Route path="/crm" element={<Layout />}>
            <Route element={<CrmLayout />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<CrmDashboard />} />
              <Route path="leads" element={<LeadsList />} />
              <Route path="leads/:id" element={<LeadDetail />} />
              <Route path="companies" element={<CompaniesList />} />
              <Route path="companies/:id" element={<CompanyDetail />} />
              <Route path="contacts" element={<ContactsList />} />
              <Route path="contacts/:id" element={<ContactDetail />} />
              <Route path="deals" element={<DealsList />} />
              <Route path="deals/:id" element={<DealDetail />} />
              <Route path="pipeline" element={<Pipeline />} />
              <Route path="activities" element={<ActivitiesPage />} />
              <Route path="import" element={<ImportWizard />} />
              <Route path="duplicates" element={<DuplicatesPage />} />
            </Route>
          </Route>
        </Route>

        {/* SALES (Super-Admin + Admin + Team-Leader + User) */}
        <Route element={<RequireAuth allowedRoles={["Super-Admin", "Admin", "Team-Leader", "User"]} />}>
          <Route path="/sales" element={<Layout />}>
            <Route element={<SalesLayout />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<SalesDashboard />} />
              <Route path="products" element={<ProductsList />} />
              <Route path="products/:productId" element={<ProductDetail />} />
              <Route path="price-books" element={<PriceBooksList />} />
              <Route path="price-books/:priceBookId" element={<PriceBookDetail />} />
              <Route path="quotes" element={<QuotesList />} />
              <Route path="quotes/:id" element={<QuoteDetail />} />
              <Route path="orders" element={<OrdersList />} />
              <Route path="orders/:id" element={<OrderDetail />} />
              <Route path="contracts" element={<ContractsList />} />
              <Route path="contracts/:id" element={<ContractDetail />} />
            </Route>
          </Route>
        </Route>

        {/* SUPPORT (Super-Admin + Admin + Team-Leader + User) */}
        <Route element={<RequireAuth allowedRoles={["Super-Admin", "Admin", "Team-Leader", "User"]} />}>
          <Route path="/support" element={<Layout />}>
            <Route element={<SupportLayout />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<SupportDashboard />} />
              <Route path="tickets" element={<TicketsList />} />
              <Route path="tickets/:id" element={<TicketDetail />} />
            </Route>
          </Route>
        </Route>

        {/* PROJECTS (Super-Admin + Admin + Team-Leader) */}
        <Route element={<RequireAuth allowedRoles={["Super-Admin", "Admin", "Team-Leader"]} />}>
          <Route path="/projects" element={<Layout />}>
            <Route index element={<ProjectsList />} />
            <Route path="tasks" element={<AllTasks />} />
            <Route path=":id" element={<ProjectDetailLayout />}>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<ProjectOverview />} />
              <Route path="tasks" element={<ProjectTasks />} />
              <Route path="board" element={<ProjectBoard />} />
              <Route path="milestones" element={<ProjectMilestones />} />
            </Route>
          </Route>
        </Route>

        {/* MARKETING (Super-Admin + Admin) */}
        <Route element={<RequireAuth allowedRoles={["Super-Admin", "Admin"]} />}>
          <Route path="/marketing" element={<Layout />}>
            <Route element={<MarketingLayout />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<MarketingDashboard />} />
              <Route path="campaigns" element={<CampaignsList />} />
              <Route path="campaigns/:id" element={<CampaignDetail />} />
              <Route path="segments" element={<SegmentsList />} />
              <Route path="forms" element={<FormsList />} />
              <Route path="templates" element={<TemplatesList />} />
            </Route>
          </Route>
        </Route>

        {/* FINANCE (Super-Admin + Admin + Checker) */}
        <Route element={<RequireAuth allowedRoles={FINANCE_ROLES} />}>
          <Route path="/finance" element={<Layout />}>
            <Route element={<FinanceLayout />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<FinanceDashboard />} />
              <Route path="invoices" element={<InvoicesList />} />
              <Route path="invoices/:id" element={<InvoiceDetail />} />
              <Route path="payments" element={<PaymentsList />} />
              <Route path="credit-notes" element={<CreditNotesList />} />
              <Route path="expenses" element={<ExpensesList />} />
              <Route path="recurring-invoices" element={<RecurringInvoicesList />} />
              <Route path="approvals" element={<ApprovalsQueue />} />
              <Route path="reports" element={<FinanceReports />} />
              <Route path="setup" element={<FinanceSetup />} />
            </Route>
          </Route>
        </Route>

        {/* AI Intelligence Center (frontend-only preview — every real role has
            defined behavior here, see aiConfig.js) */}
        <Route element={<RequireAuth allowedRoles={["Super-Admin", "Admin", "Team-Leader", "User", "Checker"]} />}>
          <Route path="/ai" element={<Layout />}>
            <Route element={<AiLayout />}>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<AiOverview />} />
              <Route path="copilot" element={<AiCopilot />} />
            </Route>
          </Route>
        </Route>

        {/* 404 */}
        <Route path="/denied" element={<Denied />} />
        <Route path="*" element={<Navigate to="/denied" />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}

export default App;