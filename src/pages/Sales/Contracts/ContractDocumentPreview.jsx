import { computeLineTotal, computeContractTotals } from "../../../Helpers/mockContractData";
import { formatMoney, formatDate } from "./contractUtils";

// The customer-facing Contract preview. Internal notes must never appear
// here — only what a customer/counterparty would actually be shown.
export default function ContractDocumentPreview({ contract, company, contact, id: domId }) {
  const totals = computeContractTotals(contract);
  return (
    <div id={domId} className="bg-white text-gray-900 rounded-xl overflow-hidden text-sm">
      <div className="p-8 space-y-6">
        <div className="flex justify-between items-start border-b border-gray-200 pb-4">
          <div>
            <p className="text-xl font-bold tracking-tight">Caspira</p>
            <p className="text-gray-500 text-xs">123 Business Ave, Suite 100 (placeholder organization branding)</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold">CONTRACT (Preview)</p>
            <p className="text-gray-500">{contract.contractNumber}</p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] uppercase text-gray-400 mb-1">Customer</p>
            <p className="font-semibold">{company?.name || "—"}</p>
            <p className="text-gray-500">{contact?.name || "No contact selected"}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-[10px] uppercase text-gray-400 mb-1">Contract details</p>
            <p className="text-gray-600">{contract.contractType}</p>
            <p className="text-gray-600">Effective {formatDate(contract.effectiveDate)} — {contract.endDate ? formatDate(contract.endDate) : "—"}</p>
            <p className="text-gray-600">Renewal: {contract.renewalType}</p>
          </div>
        </div>

        <div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr className="border-b border-gray-300 text-left text-gray-500">
                <th className="py-2 pr-2 font-medium">Item</th><th className="py-2 pr-2 font-medium text-right">Qty</th>
                <th className="py-2 pr-2 font-medium text-right">Unit Price</th><th className="py-2 pr-2 font-medium text-right">Total</th>
              </tr></thead>
              <tbody>
                {(contract.lineItems || []).map((l) => (
                  <tr key={l._id} className="border-b border-gray-100">
                    <td className="py-2 pr-2"><p className="font-medium">{l.name}</p>{l.description && <p className="text-gray-500 text-xs">{l.description}</p>}</td>
                    <td className="py-2 pr-2 text-right">{l.quantity} {l.unit}</td>
                    <td className="py-2 pr-2 text-right">{formatMoney(l.unitPrice, contract.currency)}</td>
                    <td className="py-2 pr-2 text-right font-medium">{formatMoney(computeLineTotal(l), contract.currency)}</td>
                  </tr>
                ))}
                {(contract.lineItems || []).length === 0 && (
                  <tr><td colSpan={4} className="py-4 text-center text-gray-400">No line items yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end">
          <div className="w-full sm:w-72 space-y-1">
            <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatMoney(totals.subtotal, contract.currency)}</span></div>
            {totals.tax > 0 && <div className="flex justify-between text-gray-600"><span>Tax (preview estimate)</span><span>{formatMoney(totals.tax, contract.currency)}</span></div>}
            <div className="flex justify-between font-bold text-base pt-1 border-t border-gray-300"><span>Grand Total</span><span>{formatMoney(totals.grandTotal, contract.currency)}</span></div>
            {totals.oneTimeTotal > 0 && <div className="flex justify-between text-gray-500 text-xs"><span>One-time</span><span>{formatMoney(totals.oneTimeTotal, contract.currency)}</span></div>}
            {totals.recurringTotal > 0 && <div className="flex justify-between text-gray-500 text-xs"><span>Recurring</span><span>{formatMoney(totals.recurringTotal, contract.currency)}</span></div>}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 border-t border-gray-200 pt-4">
          <div>
            <p className="text-[10px] uppercase text-gray-400 mb-1">Signatories</p>
            <p className="text-gray-600">Internal: {contract.signatories?.internal?.name || "Pending"} {contract.signatories?.internal?.signedAt ? `(${formatDate(contract.signatories.internal.signedAt)})` : ""}</p>
            <p className="text-gray-600">Customer: {contract.signatories?.customer?.name || "Pending"} {contract.signatories?.customer?.signedAt ? `(${formatDate(contract.signatories.customer.signedAt)})` : ""}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase text-gray-400 mb-1">Billing</p>
            <p className="text-gray-600">Payment terms: {contract.paymentTerms}</p>
            <p className="text-gray-600">Billing: {contract.billingSchedule}</p>
          </div>
        </div>

        {contract.customerNote && (
          <div>
            <p className="text-[10px] uppercase text-gray-400 mb-1">Note</p>
            <p className="text-gray-600 whitespace-pre-wrap">{contract.customerNote}</p>
          </div>
        )}


      </div>
    </div>
  );
}
