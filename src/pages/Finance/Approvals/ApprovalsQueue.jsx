// Approvals & Posting — everything in Finance waiting for a person, in one
// place, with only the actions the signed-in member's role allows. Nothing
// here happens automatically: each button is one explicit step, and posting
// steps can't run twice. Separation of duties is enforced by the backend;
// a record you created is flagged so you know someone else must act on it.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { RefreshCw, UserCheck } from "lucide-react";
import * as api from "../../../Helpers/backendFinanceClient";
import { orgId } from "../../../Helpers/crmBackendCommon";
import { useFinanceAccess, hasAnyFinance } from "../../../Helpers/financeAccess";
import { runQueueAction, NEEDS_REASON, NEEDS_FINANCIAL_ACCOUNT, errorText, errorCode } from "../../../Helpers/financeActions";
import { BackendOnly, NoAccess, Panel, PageHeader, StatusBadge, PromptDialog } from "../financeUi";
import { money, day, inputClass, buttonClass } from "../financeFormat";

const SECTIONS = [
  ["invoices", "Invoices", "Approve, then post to the ledger. Posting makes the invoice final."],
  ["payments", "Payments", "Recorded payments — no bank or payment-provider transfer was performed. They change what an invoice or bill owes only once posted."],
  ["creditNotes", "Credit notes", "Reduce what a customer owes once approved and posted."],
  ["bills", "Vendor bills", "Submit, approve, then post to Accounts Payable."],
  ["expenses", "Expenses", "Approve or reject submitted expenses; post approved ones; record reimbursements."],
  ["expenseReports", "Expense reports", "Reviewed and posted as one journal per report."],
  ["journals", "Journals", "Manual journals: submit, approve, post. The creator can't approve or post their own."],
  ["budgets", "Budget versions", "Approve, then activate. Activation posts nothing."],
  ["reconciliations", "Reconciliations", "Completed by someone other than the preparer."],
];

const ACTION_LABELS = { submit: "Submit", approve: "Approve", post: "Post", reject: "Reject", cancel: "Cancel", reimburse: "Record reimbursement", activate: "Activate", complete: "Complete" };
const ACTION_STYLE = { post: buttonClass.success, activate: buttonClass.success, complete: buttonClass.success, reject: buttonClass.danger, cancel: buttonClass.danger };
const LINKS = { invoice: (i) => `/finance/invoices/${i.id}` };

export default function ApprovalsQueue() {
  const access = useFinanceAccess();
  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [dialog, setDialog] = useState(null); // { item, action, reason, financialAccountId, overrideReason, sod }
  const [accounts, setAccounts] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { queue: q } = await api.getWorkQueue(orgId());
      setQueue(q);
    } catch (error) {
      toast.error(errorText(error, "Couldn't load the queue."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (api.BACKEND_FINANCE_MODE_ENABLED) load();
  }, [load]);

  if (!api.BACKEND_FINANCE_MODE_ENABLED) return <BackendOnly what="Approvals & Posting" />;
  if (!access.loading && !hasAnyFinance(access.data)) return <NoAccess what="Finance" />;

  const perform = async (item, action, body = {}) => {
    setBusy(`${item.kind}:${item.id}:${action}`);
    try {
      await runQueueAction(orgId(), item, action, body);
      toast.success(`${item.number}: ${ACTION_LABELS[action].toLowerCase()} done`);
      setDialog(null);
      await load();
    } catch (error) {
      // Separation of duties: offer the audited override only to people who hold it.
      if (errorCode(error) === "FINANCE_SEPARATION_OF_DUTIES" && access.can("finance_overrides", "override_controls")) {
        setDialog({ item, action, ...body, sod: errorText(error) });
      } else {
        toast.error(errorText(error));
      }
    } finally {
      setBusy(null);
    }
  };

  const start = async (item, action) => {
    if (NEEDS_REASON.has(action) || NEEDS_FINANCIAL_ACCOUNT.has(action)) {
      if (NEEDS_FINANCIAL_ACCOUNT.has(action) && !accounts.length) {
        try {
          const { financialAccounts } = await api.listFinancialAccounts(orgId());
          setAccounts(financialAccounts || []);
        } catch (error) {
          return toast.error(errorText(error));
        }
      }
      return setDialog({ item, action, reason: "", financialAccountId: "" });
    }
    return perform(item, action);
  };

  const total = queue ? Object.values(queue).reduce((s, rows) => s + rows.length, 0) : 0;
  const visible = queue ? SECTIONS.filter(([k]) => queue[k] && queue[k].length) : [];

  return (
    <div className="p-6 text-white max-w-6xl">
      <PageHeader
        title="Approvals & Posting"
        subtitle="Everything waiting for a person to act on. Only the steps your role allows are shown; the backend checks every one again."
        actions={<button onClick={load} disabled={loading} className={`${buttonClass.ghost} flex items-center gap-2`}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh</button>}
      />

      {queue === null ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : total === 0 ? (
        <Panel><p className="text-sm text-gray-400">Nothing is waiting. 🎉</p></Panel>
      ) : (
        <div className="space-y-6">
          {visible.map(([key, title, help]) => (
            <Panel key={key} title={`${title} (${queue[key].length})`} subtitle={help}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-gray-400 text-left">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Number</th>
                      <th className="py-2 pr-3 font-medium">Details</th>
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 font-medium text-right">Amount</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue[key].map((item) => (
                      <tr key={item.id} className="border-t border-gray-800 align-top">
                        <td className="py-2 pr-3 font-medium whitespace-nowrap">
                          {LINKS[item.kind] ? <Link to={LINKS[item.kind](item)} className="hover:underline">{item.number}</Link> : item.number}
                        </td>
                        <td className="py-2 pr-3 text-gray-300">
                          {item.title}
                          {item.ownRecord && <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-300"><UserCheck size={12} /> yours — someone else approves</span>}
                        </td>
                        <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">{day(item.date)}</td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap">{money(item.amount, item.currency)}</td>
                        <td className="py-2 pr-3"><StatusBadge status={item.status} /></td>
                        <td className="py-2 text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            {item.actions.length === 0 && <span className="text-xs text-gray-500">Waiting for another role</span>}
                            {item.actions.map((action) => (
                              <button key={action} disabled={!!busy} onClick={() => start(item, action)} className={ACTION_STYLE[action] || buttonClass.primary}>
                                {busy === `${item.kind}:${item.id}:${action}` ? "…" : ACTION_LABELS[action]}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ))}
        </div>
      )}

      {dialog && (
        <PromptDialog
          title={dialog.sod ? "Separation of duties" : `${ACTION_LABELS[dialog.action]} ${dialog.item.number}`}
          description={dialog.sod ? `${dialog.sod} As a holder of the emergency override you can proceed with a reason — it is recorded for auditors.` : NEEDS_FINANCIAL_ACCOUNT.has(dialog.action) ? "Records that the person was reimbursed outside the CRM. No money is moved." : null}
          confirmLabel={dialog.sod ? "Use override" : ACTION_LABELS[dialog.action]}
          busy={!!busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            if (dialog.sod && !dialog.overrideReason?.trim()) return toast.error("Give a reason for the override.");
            if (!dialog.sod && NEEDS_REASON.has(dialog.action) && !dialog.reason?.trim()) return toast.error("A reason is required.");
            if (!dialog.sod && NEEDS_FINANCIAL_ACCOUNT.has(dialog.action) && !dialog.financialAccountId) return toast.error("Choose the account it was paid from.");
            return perform(dialog.item, dialog.action, { reason: dialog.reason, financialAccountId: dialog.financialAccountId, overrideReason: dialog.overrideReason });
          }}
        >
          {dialog.sod ? (
            <textarea value={dialog.overrideReason || ""} onChange={(e) => setDialog({ ...dialog, overrideReason: e.target.value })} rows={3} placeholder="Why the override is needed" className={inputClass} />
          ) : (
            <>
              {NEEDS_REASON.has(dialog.action) && (
                <textarea value={dialog.reason} onChange={(e) => setDialog({ ...dialog, reason: e.target.value })} rows={3} placeholder="Reason" className={inputClass} />
              )}
              {NEEDS_FINANCIAL_ACCOUNT.has(dialog.action) && (
                <select value={dialog.financialAccountId} onChange={(e) => setDialog({ ...dialog, financialAccountId: e.target.value })} className={inputClass}>
                  <option value="">Paid from…</option>
                  {accounts.map((a) => <option key={a._id} value={a._id}>{a.name} ({a.currency})</option>)}
                </select>
              )}
            </>
          )}
        </PromptDialog>
      )}
    </div>
  );
}
