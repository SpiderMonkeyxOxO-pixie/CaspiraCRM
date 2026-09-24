// /ai/usage — AI cost governance: attributable usage, estimates (never shown
// as invoices), reconciliation against provider invoices, internal allocation
// and no customer charges.
import { useState } from "react";
import * as ai from "../../../Helpers/backendAiClient";
import { Panel, Table, ErrorBox, Loading, Badge } from "../../Admin/aiBackend/aiUi";
import { btn, fmtCost, fmtInt, useAiLoad } from "../../Admin/aiBackend/aiKit";
import { AdminPage, Stat, Tabs, ReasonDialog, StatusNote } from "./AdminShell";

export default function UsagePage() {
  return (
    <AdminPage title="AI Usage & Cost" requires={[["ai_usage_governance", "read"]]} description="Provider-reported usage and estimated cost by capability, provider, model, user, workflow, prompt and release. Estimates are not invoices; nothing is charged to customers.">
      {(access) => <Usage access={access} />}
    </AdminPage>
  );
}

const GROUPS = [["byCapability", "Capability"], ["byProvider", "Provider"], ["byModel", "Model"], ["byUser", "User"], ["byWorkflow", "Workflow"], ["byPromptVersion", "Prompt"], ["byRelease", "Release"], ["byBillingSource", "Billing source"]];

function Usage({ access }) {
  const { data, error, loading, reload } = useAiLoad(() => ai.costGovernance(), []);
  const [group, setGroup] = useState("byCapability");
  const [dialog, setDialog] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const c = data.cost;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Stat label="Estimated (month to date)" value={fmtCost(c.estimated.total)} hint={`${c.estimated.unknownCostRequests} requests with unknown cost`} />
        <Stat label="Forecast (month)" value={fmtCost(c.forecast.monthEstimate)} hint="linear estimate" />
        <Stat label="Tokens in / out" value={`${fmtInt(c.providerReported.inputTokens)} / ${fmtInt(c.providerReported.outputTokens)}`} hint={`${c.providerReported.requests} requests`} />
        <Stat label="Per successful response" value={fmtCost(c.unitCosts.perSuccessfulResponse)} hint={`n=${c.unitCosts.successfulResponses}`} />
        <Stat label="Per validated citation" value={fmtCost(c.unitCosts.perValidatedCitation)} hint={`n=${c.unitCosts.validatedCitations}`} />
        <Stat label="Per approved action" value={fmtCost(c.unitCosts.perApprovedAction)} hint={`n=${c.unitCosts.approvedActions}`} />
      </div>
      <Panel title="Usage">
        <Tabs label="Group usage by" tabs={GROUPS} value={group} onChange={setGroup} />
        <div className="mt-3">
          <Table rowKey={(r) => r.key} rows={c[group]} empty="No usage in this window." columns={[{ label: GROUPS.find((g) => g[0] === group)[1], render: (r) => r.key }, { label: "Requests", render: (r) => r.requests }, { label: "Tokens in / out", render: (r) => `${fmtInt(r.inputTokens)} / ${fmtInt(r.outputTokens)}` }, { label: "Estimated cost", render: (r) => fmtCost(r.estimatedCost) }, { label: "Unknown cost", render: (r) => r.unknownCost || "—" }]} />
        </div>
        <StatusNote>{c.labels.estimated}. Shadow-release usage ({fmtCost(c.estimated.shadow)}) is accounted separately.</StatusNote>
      </Panel>
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Internal allocation">
          <Table rowKey={(r) => r.capabilityKey} rows={c.allocation} columns={[{ label: "Capability", render: (r) => r.capabilityKey }, { label: "Share", render: (r) => `${r.share}%` }, { label: "Amount", render: (r) => fmtCost(r.amount) }]} />
          <StatusNote>{c.labels.allocation}</StatusNote>
        </Panel>
        <Panel title="Provider invoices (reconciliation)" actions={access.can("ai_budgets", "configure") && <button type="button" className={btn} onClick={() => setDialog(true)}>Record invoice</button>}>
          <Table rows={c.invoices} empty="No invoices recorded." columns={[{ label: "Provider", render: (i) => i.providerKey }, { label: "Month", render: (i) => i.periodKey }, { label: "Invoiced", render: (i) => `${i.invoicedAmount} ${i.currency}` }, { label: "Estimated", render: (i) => fmtCost(i.estimatedAmount) }, { label: "Difference", render: (i) => i.difference }, { label: "Status", render: (i) => <Badge tone={i.status === "Reconciled" ? "green" : "amber"}>{i.status}</Badge> }]} />
          <StatusNote>{c.labels.reconciled}. {c.byok.note}</StatusNote>
        </Panel>
      </div>
      <p className="text-sm text-gray-300 bg-gray-900/40 border border-gray-800 rounded-xl px-3 py-2">Customer charge: <b>{c.customerCharge.status}</b>. {c.labels.customerCharge}</p>
      {dialog && <ReasonDialog title="Record a provider invoice" requireReason={false} confirmLabel="Reconcile" fields={[{ name: "providerKey", label: "Provider", defaultValue: "openai" }, { name: "periodKey", label: "Month (YYYY-MM)", defaultValue: new Date().toISOString().slice(0, 7) }, { name: "invoicedAmount", label: "Invoiced amount", defaultValue: "0" }, { name: "currency", label: "Currency", defaultValue: "USD" }, { name: "notes", label: "Notes", type: "textarea" }]} onSubmit={(v) => ai.recordProviderInvoice({ ...v, invoicedAmount: Number(v.invoicedAmount) }).then(reload)} onClose={() => setDialog(false)} />}
    </div>
  );
}
