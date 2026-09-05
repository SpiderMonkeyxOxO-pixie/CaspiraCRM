import { computeLineTotal, computeQuoteTotals } from "../../../Helpers/mockQuoteData";
import { formatMoney, formatDate } from "./quoteUtils";

// The customer-facing document — deliberately simpler than the internal
// Line Items tab. Internal notes, approval comments and cost previews must
// never appear here.
export default function QuoteDocumentPreview({ quote, company, contact, ownerName, layout = "Standard", id: domId }) {
  const totals = computeQuoteTotals(quote);
  const detailed = layout === "Detailed";
  const compact = layout === "Compact";
  const lines = (quote.lineItems || []).filter((l) => l.included !== false);

  return (
    <div id={domId} className={`bg-white text-gray-900 rounded-xl overflow-hidden ${compact ? "text-xs" : "text-sm"}`}>
      <div className={`${compact ? "p-4" : "p-8"} space-y-6`}>
        <div className="flex justify-between items-start border-b border-gray-200 pb-4">
          <div>
            <p className="text-xl font-bold tracking-tight">Caspira</p>
            <p className="text-gray-500 text-xs">123 Business Ave, Suite 100 (placeholder organization branding)</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold">QUOTE (Preview)</p>
            <p className="text-gray-500">{quote.quoteNumber} · Version {quote.version}</p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] uppercase text-gray-400 mb-1">Prepared for</p>
            <p className="font-semibold">{company?.name || "—"}</p>
            <p className="text-gray-500">{contact?.name || "No contact selected"}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-[10px] uppercase text-gray-400 mb-1">Prepared by</p>
            <p className="font-semibold">{ownerName || "Unassigned"}</p>
            <p className="text-gray-500">Issued {formatDate(quote.issueDate)} · Valid until {quote.validUntilDate ? formatDate(quote.validUntilDate) : "—"}</p>
          </div>
        </div>

        <div>
          <p className="font-semibold mb-2">{quote.title}</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-300 text-left text-gray-500">
                  <th className="py-2 pr-2 font-medium">Item</th>
                  <th className="py-2 pr-2 font-medium text-right">Qty</th>
                  {detailed && <th className="py-2 pr-2 font-medium text-right">List Price</th>}
                  <th className="py-2 pr-2 font-medium text-right">Unit Price</th>
                  <th className="py-2 pr-2 font-medium text-right">Discount</th>
                  <th className="py-2 pr-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l._id} className="border-b border-gray-100">
                    <td className="py-2 pr-2">
                      <p className="font-medium">{l.name}</p>
                      {!compact && l.description && <p className="text-gray-500 text-xs">{l.description}</p>}
                    </td>
                    <td className="py-2 pr-2 text-right">{l.quantity} {l.unit}</td>
                    {detailed && <td className="py-2 pr-2 text-right text-gray-500">{formatMoney(l.listPrice, quote.currency)}</td>}
                    <td className="py-2 pr-2 text-right">{formatMoney(l.unitPrice, quote.currency)}</td>
                    <td className="py-2 pr-2 text-right">{l.discountType ? (l.discountType === "Percentage" ? `${l.discountValue}%` : formatMoney(l.discountValue, quote.currency)) : "—"}</td>
                    <td className="py-2 pr-2 text-right font-medium">{formatMoney(computeLineTotal(l), quote.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end">
          <div className="w-full sm:w-72 space-y-1">
            <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatMoney(totals.subtotal, quote.currency)}</span></div>
            {totals.overallDiscountAmount > 0 && <div className="flex justify-between text-gray-600"><span>Discount</span><span>-{formatMoney(totals.overallDiscountAmount, quote.currency)}</span></div>}
            {totals.tax > 0 && <div className="flex justify-between text-gray-600"><span>Tax (preview estimate)</span><span>{formatMoney(totals.tax, quote.currency)}</span></div>}
            <div className="flex justify-between font-bold text-base pt-1 border-t border-gray-300"><span>Grand Total</span><span>{formatMoney(totals.grandTotal, quote.currency)}</span></div>
            {totals.oneTimeTotal > 0 && <div className="flex justify-between text-gray-500 text-xs"><span>One-time</span><span>{formatMoney(totals.oneTimeTotal, quote.currency)}</span></div>}
            {totals.monthlyRecurringTotal > 0 && <div className="flex justify-between text-gray-500 text-xs"><span>Monthly recurring</span><span>{formatMoney(totals.monthlyRecurringTotal, quote.currency)}</span></div>}
            {totals.annualRecurringTotal > 0 && <div className="flex justify-between text-gray-500 text-xs"><span>Annual recurring</span><span>{formatMoney(totals.annualRecurringTotal, quote.currency)}</span></div>}
            {totals.usageBasedEstimate > 0 && <div className="flex justify-between text-gray-500 text-xs"><span>Usage-based estimate</span><span>{formatMoney(totals.usageBasedEstimate, quote.currency)}</span></div>}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 border-t border-gray-200 pt-4">
          <div>
            <p className="text-[10px] uppercase text-gray-400 mb-1">Commercial terms</p>
            <p className="text-gray-600">Payment terms: {quote.paymentTerms}</p>
            <p className="text-gray-600">Billing: {quote.billingSchedule}</p>
            {quote.serviceStartEstimate && <p className="text-gray-600">Service start: {quote.serviceStartEstimate}</p>}
            {quote.deliveryEstimate && <p className="text-gray-600">Delivery: {quote.deliveryEstimate}</p>}
            {quote.minimumCommitment && <p className="text-gray-600">Minimum commitment: {quote.minimumCommitment}</p>}
            {quote.renewalSummary && <p className="text-gray-600">Renewal: {quote.renewalSummary}</p>}
          </div>
          {quote.customerNote && (
            <div>
              <p className="text-[10px] uppercase text-gray-400 mb-1">Note</p>
              <p className="text-gray-600 whitespace-pre-wrap">{quote.customerNote}</p>
            </div>
          )}
        </div>

        {detailed && (quote.assumptions || quote.exclusions) && (
          <div className="grid sm:grid-cols-2 gap-4">
            {quote.assumptions && <div><p className="text-[10px] uppercase text-gray-400 mb-1">Assumptions</p><p className="text-gray-600 whitespace-pre-wrap">{quote.assumptions}</p></div>}
            {quote.exclusions && <div><p className="text-[10px] uppercase text-gray-400 mb-1">Exclusions</p><p className="text-gray-600 whitespace-pre-wrap">{quote.exclusions}</p></div>}
          </div>
        )}

        <div className="border-t border-gray-200 pt-4">
          <p className="text-[10px] uppercase text-gray-400 mb-1">Terms and conditions</p>
          <p className="text-gray-500 text-xs whitespace-pre-wrap">{quote.termsAndConditions}</p>
        </div>

        <div className="border border-dashed border-gray-300 rounded-lg p-4">
          <p className="text-[10px] uppercase text-gray-400 mb-2">Acceptance (preview only — not a legally binding signature)</p>
          <div className="grid sm:grid-cols-3 gap-3 text-gray-500">
            <div><p className="text-[10px]">Customer Name</p><div className="border-b border-gray-300 h-6" /></div>
            <div><p className="text-[10px]">Job Title</p><div className="border-b border-gray-300 h-6" /></div>
            <div><p className="text-[10px]">Date</p><div className="border-b border-gray-300 h-6" /></div>
          </div>
        </div>

        <p className="text-center text-[10px] text-gray-400">This document is a frontend session preview and has not been sent, viewed, or accepted by a customer unless explicitly simulated.</p>
      </div>
    </div>
  );
}
