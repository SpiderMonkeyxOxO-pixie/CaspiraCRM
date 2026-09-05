import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams, Link } from "react-router-dom";
import { jsPDF } from "jspdf";
import {
  ChevronRight, FileText, PenLine, RefreshCcw, Ban, XCircle, Archive, ArchiveRestore,
  Download, Printer, X, AlertTriangle, Check,
} from "lucide-react";
import {
  fetchContract, submitForInternalReview, sendForSignature, recordSignature,
  renewContract, terminateContract, cancelContract, expireContract, archiveContract, restoreContract,
} from "../../../redux/sales/contractsSlice";
import {
  computeContractTotals, computeLineTotal, getEffectiveStatus, isRenewalDue, isExpiringSoon,
  hasIncompleteSignatory, RELATED_RECORD_PREVIEWS,
} from "../../../Helpers/mockContractData";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { formatMoney, formatDate, formatDateTime, CONTRACT_STATUS_COLORS, CONTRACT_PROGRESSION, ALTERNATIVE_STATUSES } from "./contractUtils";
import ContractDocumentPreview from "./ContractDocumentPreview";
import ContractBuilder from "./ContractBuilder";

const TABS = ["overview", "items", "signatories", "renewal", "related", "activity", "document", "audit"];
const TAB_LABELS = { overview: "Overview", items: "Line Items", signatories: "Signatories", renewal: "Renewal & Amendments", related: "Related Records", activity: "Activity", document: "Document", audit: "Audit Preview" };

export default function ContractDetail() {
  const { id } = useParams();
  const dispatch = useDispatch();
  const { current: contract, currentNotFound } = useSelector((s) => s.contracts);
  const companies = useSelector((s) => s.companies.items);
  const allContacts = useSelector((s) => s.contacts.items);

  const [tab, setTab] = useState("overview");
  const [dialog, setDialog] = useState(null);
  const [builderState, setBuilderState] = useState(null);

  useEffect(() => {
    dispatch(fetchContract(id));
  }, [dispatch, id]);

  if (!contract && !currentNotFound) return <div className="p-10 text-center text-gray-400 text-sm">Loading contract…</div>;
  if (currentNotFound) {
    return (
      <div className="p-10 text-center">
        <p className="text-gray-300 mb-2">This Contract couldn't be found.</p>
        <p className="text-xs text-gray-500 mb-4">Frontend session state resets on a full page reload — a bookmarked Contract URL can 404 in a fresh session.</p>
        <Link to="/sales/contracts" className="text-sm text-blue-400 hover:underline">Back to Contracts</Link>
      </div>
    );
  }
  if (!contract) return null;

  const effStatus = getEffectiveStatus(contract);
  const totals = computeContractTotals(contract);
  const company = companies.find((c) => c._id === contract.companyId);
  const contact = allContacts.find((c) => c._id === contract.contactId);

  const downloadPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(14); doc.text(`Contract ${contract.contractNumber}`, 14, 16);
    doc.setFontSize(10);
    doc.text(`Company: ${company?.name || "—"}`, 14, 26);
    doc.text(`Status: ${effStatus}`, 14, 32);
    doc.text(`Effective: ${formatDate(contract.effectiveDate)}  End: ${contract.endDate ? formatDate(contract.endDate) : "—"}`, 14, 38);
    let y = 50;
    (contract.lineItems || []).forEach((l) => {
      doc.text(`${l.name} x${l.quantity} — ${formatMoney(computeLineTotal(l), contract.currency)}`, 14, y);
      y += 6;
    });
    doc.text(`Grand Total: ${formatMoney(totals.grandTotal, contract.currency)}`, 14, y + 6);
    doc.save(`${contract.contractNumber}.pdf`);
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <Link to="/sales/contracts" className="hover:text-gray-300">Sales / Contracts</Link> <ChevronRight size={12} /> <span className="text-gray-300">{contract.contractNumber}</span>
      </div>

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-2xl font-bold text-white">{contract.contractNumber}</h1>
              <span className={`px-2 py-0.5 rounded-full text-[11px] border ${CONTRACT_STATUS_COLORS[effStatus] || ""}`}>{effStatus}</span>
              {isRenewalDue(contract) && <span className="px-2 py-0.5 rounded-full text-[11px] border bg-amber-500/15 text-amber-300 border-amber-500/30">Renewal due</span>}
              {isExpiringSoon(contract) && <span className="px-2 py-0.5 rounded-full text-[11px] border bg-red-500/15 text-red-300 border-red-500/30">Expiring soon</span>}
              {hasIncompleteSignatory(contract) && <span className="px-2 py-0.5 rounded-full text-[11px] border bg-amber-500/15 text-amber-300 border-amber-500/30">Incomplete signatory</span>}
            </div>
            <p className="text-sm text-gray-400">{company?.name || "—"} · {contact?.name || "No contact"} · {contract.contractType}</p>
            <p className="text-sm text-gray-300 mt-1">{formatMoney(totals.grandTotal, contract.currency)} · {contract.currency}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {contract.status === "Draft" && !contract.archived && (
              <button onClick={() => setBuilderState({ mode: "edit", contract })} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm"><PenLine size={14} /> Edit Draft</button>
            )}
            <button onClick={() => setBuilderState({ mode: "duplicate", contract })} className="flex items-center gap-1.5 border border-gray-700 hover:bg-gray-800 text-gray-200 px-3 py-2 rounded-lg text-sm">Duplicate</button>
            {!contract.archived && contract.status !== "Terminated" && contract.status !== "Cancelled" && contract.status !== "Expired" && (
              <ContextualActions contract={contract} setDialog={setDialog} />
            )}
            {!contract.archived ? (
              <button onClick={() => setDialog("archive")} className="flex items-center gap-1.5 border border-gray-700 hover:bg-gray-800 text-red-400 px-3 py-2 rounded-lg text-sm"><Archive size={14} /> Archive</button>
            ) : (
              <button onClick={() => dispatch(restoreContract(contract._id)).then(() => dispatch(fetchContract(id)))} className="flex items-center gap-1.5 border border-gray-700 hover:bg-gray-800 text-gray-200 px-3 py-2 rounded-lg text-sm"><ArchiveRestore size={14} /> Restore</button>
            )}
          </div>
        </div>

        <StatusRail contract={contract} onStepClick={setDialog} />
      </div>

      <div className="border-b border-gray-800 flex gap-1 overflow-x-auto" role="tablist" aria-label="Contract detail sections">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === t ? "border-blue-500 text-white" : "border-transparent text-gray-400 hover:text-gray-200"}`}>{TAB_LABELS[t]}</button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab contract={contract} company={company} contact={contact} totals={totals} />}
      {tab === "items" && <LineItemsTab contract={contract} />}
      {tab === "signatories" && <SignatoriesTab contract={contract} setDialog={setDialog} />}
      {tab === "renewal" && <RenewalTab contract={contract} setDialog={setDialog} />}
      {tab === "related" && <RelatedRecordsTab contract={contract} />}
      {tab === "activity" && <ActivityTab contract={contract} />}
      {tab === "document" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <button onClick={downloadPdf} className="flex items-center gap-1.5 border border-gray-700 hover:bg-gray-800 text-gray-200 px-3 py-2 rounded-lg text-sm"><Download size={14} /> Download PDF</button>
            <button onClick={() => window.print()} className="flex items-center gap-1.5 border border-gray-700 hover:bg-gray-800 text-gray-200 px-3 py-2 rounded-lg text-sm"><Printer size={14} /> Print Preview</button>
          </div>
          <div id="contract-print-doc">
            <ContractDocumentPreview contract={contract} company={company} contact={contact} />
          </div>
          <style>{`@media print { body * { visibility: hidden; } #contract-print-doc, #contract-print-doc * { visibility: visible; } #contract-print-doc { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
        </div>
      )}
      {tab === "audit" && <AuditTab contract={contract} />}

      {dialog === "submit-review" && <ConfirmSimpleDialog title="Submit for Internal Review" description="Submit this Draft Contract for internal review before it can be sent for signature." confirmLabel="Submit" onClose={() => setDialog(null)} onConfirm={() => dispatch(submitForInternalReview(contract._id)).then(() => { setDialog(null); dispatch(fetchContract(id)); })} />}
      {dialog === "send-signature" && <ConfirmSimpleDialog title="Send for Signature" description="Send this Contract out for signature. Both an internal and a customer signature will be required before it's fully executed." confirmLabel="Send" onClose={() => setDialog(null)} onConfirm={() => dispatch(sendForSignature({ id: contract._id })).then(() => { setDialog(null); dispatch(fetchContract(id)); })} />}
      {dialog === "sign-internal" && <RecordSignatureDialog party="internal" contract={contract} onClose={() => setDialog(null)} onDone={() => { setDialog(null); dispatch(fetchContract(id)); }} />}
      {dialog === "sign-customer" && <RecordSignatureDialog party="customer" contract={contract} onClose={() => setDialog(null)} onDone={() => { setDialog(null); dispatch(fetchContract(id)); }} />}
      {dialog === "renew" && <RenewDialog contract={contract} onClose={() => setDialog(null)} onDone={() => { setDialog(null); dispatch(fetchContract(id)); }} />}
      {dialog === "terminate" && <ReasonDialog title="Terminate Contract" label="Termination reason" requireEffectiveDate onClose={() => setDialog(null)} onConfirm={(body) => dispatch(terminateContract({ id: contract._id, ...body })).then(() => { setDialog(null); dispatch(fetchContract(id)); })} />}
      {dialog === "cancel" && <ReasonDialog title="Cancel Contract" label="Cancellation reason" onClose={() => setDialog(null)} onConfirm={(body) => dispatch(cancelContract({ id: contract._id, reason: body.reason })).then(() => { setDialog(null); dispatch(fetchContract(id)); })} />}
      {dialog === "expire" && <ConfirmSimpleDialog title="Mark Expired" description="Mark this Contract as expired." confirmLabel="Mark Expired" onClose={() => setDialog(null)} onConfirm={() => dispatch(expireContract(contract._id)).then(() => { setDialog(null); dispatch(fetchContract(id)); })} />}
      {dialog === "archive" && <ReasonDialog title="Archive Contract" label="Archive reason" onClose={() => setDialog(null)} onConfirm={(body) => dispatch(archiveContract({ id: contract._id, reason: body.reason })).then(() => { setDialog(null); dispatch(fetchContract(id)); })} />}

      {builderState && (
        <ContractBuilder mode={builderState.mode} contract={builderState.contract} onClose={() => setBuilderState(null)} onSaved={() => dispatch(fetchContract(id))} />
      )}
    </div>
  );
}

function ContextualActions({ contract, setDialog }) {
  const status = contract.status;
  return (
    <>
      {status === "Draft" && <button onClick={() => setDialog("submit-review")} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm"><Check size={14} /> Submit for Review</button>}
      {status === "Pending Internal Review" && <button onClick={() => setDialog("send-signature")} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm"><FileText size={14} /> Send for Signature</button>}
      {status === "Sent for Signature" && (
        <>
          {!contract.signatories?.internal?.signedAt && <button onClick={() => setDialog("sign-internal")} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm"><PenLine size={14} /> Record Internal Signature</button>}
          {!contract.signatories?.customer?.signedAt && <button onClick={() => setDialog("sign-customer")} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm"><PenLine size={14} /> Record Customer Signature</button>}
        </>
      )}
      {status === "Signed" && <button onClick={() => setDialog("renew")} className="flex items-center gap-1.5 border border-gray-700 hover:bg-gray-800 text-gray-200 px-3 py-2 rounded-lg text-sm"><RefreshCcw size={14} /> Renew</button>}
      {["Draft", "Pending Internal Review", "Sent for Signature"].includes(status) && <button onClick={() => setDialog("cancel")} className="flex items-center gap-1.5 border border-gray-700 hover:bg-gray-800 text-red-400 px-3 py-2 rounded-lg text-sm"><Ban size={14} /> Cancel</button>}
      {status === "Signed" && <button onClick={() => setDialog("terminate")} className="flex items-center gap-1.5 border border-gray-700 hover:bg-gray-800 text-red-400 px-3 py-2 rounded-lg text-sm"><XCircle size={14} /> Terminate</button>}
      {status === "Signed" && <button onClick={() => setDialog("expire")} className="flex items-center gap-1.5 border border-gray-700 hover:bg-gray-800 text-gray-200 px-3 py-2 rounded-lg text-sm">Mark Expired</button>}
    </>
  );
}

function StatusRail({ contract, onStepClick }) {
  const effStatus = getEffectiveStatus(contract);
  const isAlternative = ALTERNATIVE_STATUSES.includes(contract.status);
  const idx = CONTRACT_PROGRESSION.indexOf(contract.status);
  const nextActionByStep = { Draft: "submit-review", "Pending Internal Review": "send-signature", "Sent for Signature": "sign-internal" };
  return (
    <div>
      <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Contract status progression">
        {CONTRACT_PROGRESSION.map((s, i) => {
          const isCurrent = contract.status === s;
          const isDone = idx > -1 && i < idx;
          const isClickableNext = idx > -1 && i === idx + 1 && !isAlternative && !contract.archived;
          return (
            <li key={s}>
              <button
                disabled={!isClickableNext}
                onClick={() => isClickableNext && onStepClick(nextActionByStep[contract.status])}
                className={`px-2.5 py-1 rounded-full border ${isCurrent ? "bg-blue-500/20 border-blue-500/40 text-blue-300" : isDone ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : isClickableNext ? "border-gray-600 text-gray-300 hover:bg-gray-800 cursor-pointer" : "border-gray-800 text-gray-600 cursor-default"}`}
              >
                {s}
              </button>
            </li>
          );
        })}
        {isAlternative && <li className="px-2.5 py-1 rounded-full border bg-red-500/15 border-red-500/30 text-red-300">{contract.status}</li>}
        {effStatus === "Archived" && <li className="px-2.5 py-1 rounded-full border bg-slate-500/15 border-slate-500/30 text-slate-300">Archived</li>}
      </ol>
      <p className="text-[11px] text-gray-500 mt-2">Clicking the next available step opens a confirmation dialog — status never changes immediately.</p>
    </div>
  );
}

function OverviewTab({ contract, company, contact, totals }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Panel title="Customer">
        <dl className="text-sm space-y-1">
          <Row label="Company" value={company?.name || "—"} />
          <Row label="Contact" value={contact?.name || "—"} />
          <Row label="Owner" value={contract.ownerName || "Unassigned"} />
          <Row label="Team" value={contract.assignedTeam} />
        </dl>
      </Panel>
      <Panel title="Term">
        <dl className="text-sm space-y-1">
          <Row label="Effective date" value={formatDate(contract.effectiveDate)} />
          <Row label="End date" value={contract.endDate ? formatDate(contract.endDate) : "—"} />
          <Row label="Renewal type" value={contract.renewalType} />
          <Row label="Renewal notice" value={`${contract.renewalNoticeDays || 0} days`} />
        </dl>
      </Panel>
      <Panel title="Pricing summary">
        <dl className="text-sm space-y-1">
          <Row label="One-time" value={formatMoney(totals.oneTimeTotal, contract.currency)} />
          <Row label="Recurring" value={formatMoney(totals.recurringTotal, contract.currency)} />
          <Row label="Tax" value={formatMoney(totals.tax, contract.currency)} />
          <Row label="Grand total" value={formatMoney(totals.grandTotal, contract.currency)} />
        </dl>
      </Panel>
      <Panel title="Billing">
        <dl className="text-sm space-y-1">
          <Row label="Payment terms" value={contract.paymentTerms} />
          <Row label="Billing schedule" value={contract.billingSchedule} />
        </dl>
      </Panel>
      {contract.internalNote && <Panel title="Internal note"><p className="text-sm text-gray-300 whitespace-pre-wrap">{contract.internalNote}</p></Panel>}
      <Panel title="Created / Updated">
        <dl className="text-sm space-y-1">
          <Row label="Created" value={formatDateTime(contract.createdAt)} />
          <Row label="Updated" value={formatDateTime(contract.updatedAt)} />
        </dl>
      </Panel>
    </div>
  );
}

function LineItemsTab({ contract }) {
  return (
    <div className="border border-gray-800 rounded-xl overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase">
          <tr><th scope="col" className="text-left px-4 py-2">Item</th><th scope="col" className="text-left px-4 py-2">Qty</th><th scope="col" className="text-left px-4 py-2">Unit Price</th><th scope="col" className="text-left px-4 py-2">Billing</th><th scope="col" className="text-left px-4 py-2">Total</th></tr>
        </thead>
        <tbody>
          {(contract.lineItems || []).map((l) => (
            <tr key={l._id} className="border-t border-gray-800">
              <td className="px-4 py-2 text-gray-200">{l.name}</td>
              <td className="px-4 py-2 text-gray-400">{l.quantity} {l.unit}</td>
              <td className="px-4 py-2 text-gray-400">{formatMoney(l.unitPrice, contract.currency)}</td>
              <td className="px-4 py-2 text-gray-400">{l.billingModel}{l.billingInterval ? ` (${l.billingInterval})` : ""}</td>
              <td className="px-4 py-2 text-gray-200">{formatMoney(computeLineTotal(l), contract.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-gray-500 px-4 py-2">Price Book and catalog changes never update an existing Contract's line snapshots.</p>
    </div>
  );
}

function SignatoriesTab({ contract, setDialog }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {["internal", "customer"].map((party) => {
        const sig = contract.signatories?.[party] || {};
        return (
          <Panel key={party} title={party === "internal" ? "Internal signatory" : "Customer signatory"}>
            <dl className="text-sm space-y-1">
              <Row label="Name" value={sig.name || "Pending"} />
              <Row label="Title" value={sig.title || "—"} />
              <Row label="Signed" value={sig.signedAt ? formatDateTime(sig.signedAt) : "Not yet signed"} />
            </dl>
            {!sig.signedAt && contract.status === "Sent for Signature" && (
              <button onClick={() => setDialog(party === "internal" ? "sign-internal" : "sign-customer")} className="mt-2 text-sm text-blue-400 hover:underline">Record signature</button>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

function RenewalTab({ contract, setDialog }) {
  return (
    <div className="space-y-4">
      <Panel title="Renewal settings">
        <dl className="text-sm space-y-1">
          <Row label="Renewal type" value={contract.renewalType} />
          <Row label="Renewal notice" value={`${contract.renewalNoticeDays || 0} days before end date`} />
          <Row label="Current end date" value={contract.endDate ? formatDate(contract.endDate) : "—"} />
        </dl>
        {contract.status === "Signed" && <button onClick={() => setDialog("renew")} className="mt-2 text-sm text-blue-400 hover:underline">Renew this Contract</button>}
      </Panel>
      <Panel title="Amendment history">
        {(contract.amendmentHistory || []).length === 0 ? (
          <p className="text-sm text-gray-500">No amendments recorded.</p>
        ) : (
          <ul className="text-sm space-y-2">
            {contract.amendmentHistory.map((a) => (
              <li key={a._id} className="border-l-2 border-gray-700 pl-3">
                <p className="text-gray-300">{formatDateTime(a.at)} — {a.actor}</p>
                <p className="text-gray-500 text-xs">{formatDate(a.previousEndDate)} → {formatDate(a.newEndDate)}{a.note ? `: ${a.note}` : ""}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function RelatedRecordsTab({ contract }) {
  return (
    <div className="space-y-3">
      <Panel title="Source records">
        <dl className="text-sm space-y-1">
          <Row label="Deal" value={contract.dealId ? <Link to={`/crm/deals/${contract.dealId}`} className="text-blue-400 hover:underline">View Deal</Link> : "None"} />
          <Row label="Source Quote" value={contract.sourceQuoteId ? <Link to={`/sales/quotes/${contract.sourceQuoteId}`} className="text-blue-400 hover:underline">View Quote</Link> : "None"} />
          <Row label="Source Order" value={contract.sourceOrderId ? <Link to={`/sales/orders/${contract.sourceOrderId}`} className="text-blue-400 hover:underline">View Order</Link> : "None"} />
        </dl>
      </Panel>
      <Panel title="Future previews">
        <ul className="text-sm text-gray-500 space-y-1">{RELATED_RECORD_PREVIEWS.map((p) => <li key={p}>{p} — route not yet implemented, no record created</li>)}</ul>
      </Panel>
    </div>
  );
}

function ActivityTab({ contract }) {
  return (
    <div className="space-y-2">
      {(contract.activity || []).slice().reverse().map((a) => (
        <div key={a._id} className="bg-gray-900/40 border border-gray-800 rounded-lg p-3 text-sm">
          <div className="flex justify-between text-xs text-gray-500 mb-1"><span>{a.actor}</span><span>{formatDateTime(a.at)}</span></div>
          <p className="text-gray-200">{a.description}</p>
        </div>
      ))}
    </div>
  );
}

function AuditTab({ contract }) {
  return (
    <div className="border border-gray-800 rounded-xl overflow-x-auto">
      {(contract.auditLog || []).length === 0 ? (
        <p className="text-sm text-gray-500 p-6 text-center">No audit entries recorded for this Contract.</p>
      ) : (
        <table className="min-w-full text-sm">
          <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase">
            <tr><th scope="col" className="text-left px-4 py-2">Actor</th><th scope="col" className="text-left px-4 py-2">Action</th><th scope="col" className="text-left px-4 py-2">Time</th><th scope="col" className="text-left px-4 py-2">Previous</th><th scope="col" className="text-left px-4 py-2">New</th><th scope="col" className="text-left px-4 py-2">Reason</th></tr>
          </thead>
          <tbody>
            {contract.auditLog.map((a) => (
              <tr key={a._id} className="border-t border-gray-800 text-xs">
                <td className="px-4 py-2 text-gray-200">{a.actor}</td><td className="px-4 py-2 text-gray-300">{a.action}</td><td className="px-4 py-2 text-gray-500">{formatDateTime(a.at)}</td>
                <td className="px-4 py-2 text-gray-500">{String(a.before ?? "—")}</td><td className="px-4 py-2 text-gray-500">{String(a.after ?? "—")}</td><td className="px-4 py-2 text-gray-500">{a.reason || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
      {children}
    </div>
  );
}
function Row({ label, value }) {
  return <div className="flex justify-between gap-2"><dt className="text-gray-500">{label}</dt><dd className="text-gray-200 text-right">{value}</dd></div>;
}

function DialogShell({ title, onClose, children }) {
  const containerRef = useFocusTrap(true, onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div ref={containerRef} className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button onClick={onClose} aria-label="Close"><X size={18} className="text-gray-400 hover:text-white" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmSimpleDialog({ title, description, confirmLabel, onClose, onConfirm }) {
  return (
    <DialogShell title={title} onClose={onClose}>
      <p className="text-sm text-gray-400">{description}</p>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">Cancel</button>
        <button onClick={onConfirm} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg">{confirmLabel}</button>
      </div>
    </DialogShell>
  );
}

function ReasonDialog({ title, label, requireEffectiveDate, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const submitDisabled = !reason.trim() || (requireEffectiveDate && !effectiveDate);
  return (
    <DialogShell title={title} onClose={onClose}>
      <label htmlFor="reason-textarea" className="block text-xs text-gray-400">{label}</label>
      <textarea id="reason-textarea" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
      {requireEffectiveDate && (
        <>
          <label htmlFor="effective-date-input" className="block text-xs text-gray-400">Effective date</label>
          <input id="effective-date-input" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
        </>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">Cancel</button>
        <button disabled={submitDisabled} onClick={() => onConfirm(requireEffectiveDate ? { reason, effectiveDate: new Date(effectiveDate).toISOString() } : { reason })} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-lg">Confirm</button>
      </div>
    </DialogShell>
  );
}

function RecordSignatureDialog({ party, onClose, onDone }) {
  const dispatch = useDispatch();
  const { id } = useParams();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const submitDisabled = !name.trim();
  return (
    <DialogShell title={`Record ${party === "internal" ? "Internal" : "Customer"} Signature`} onClose={onClose}>
      <label htmlFor="signatory-name" className="block text-xs text-gray-400">Name</label>
      <input id="signatory-name" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
      <label htmlFor="signatory-title" className="block text-xs text-gray-400">Title</label>
      <input id="signatory-title" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">Cancel</button>
        <button disabled={submitDisabled} onClick={() => dispatch(recordSignature({ id, party, name, title })).then(onDone)} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg">Record Signature</button>
      </div>
    </DialogShell>
  );
}

function RenewDialog({ contract, onClose, onDone }) {
  const dispatch = useDispatch();
  const [newEndDate, setNewEndDate] = useState("");
  const [note, setNote] = useState("");
  const submitDisabled = !newEndDate;
  return (
    <DialogShell title="Renew Contract" onClose={onClose}>
      <p className="text-xs text-gray-500">Current end date: {contract.endDate ? formatDate(contract.endDate) : "—"}</p>
      <label htmlFor="renew-end-date" className="block text-xs text-gray-400">New end date</label>
      <input id="renew-end-date" type="date" value={newEndDate} onChange={(e) => setNewEndDate(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
      <label htmlFor="renew-note" className="block text-xs text-gray-400">Note</label>
      <textarea id="renew-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">Cancel</button>
        <button disabled={submitDisabled} onClick={() => dispatch(renewContract({ id: contract._id, newEndDate: new Date(newEndDate).toISOString(), note })).then(onDone)} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg">Renew</button>
      </div>
    </DialogShell>
  );
}
