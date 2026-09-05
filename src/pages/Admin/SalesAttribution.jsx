import { Fragment, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronUp, TrendingUp, Link2 } from "lucide-react";
import { canViewAttribution, canConfigureAttribution } from "./salesMarketingConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { CAMPAIGN_REFERENCES, computeAttributionSummary, ROI_UNAVAILABLE_MESSAGE } from "../../Helpers/mockSalesMarketingData";
import { leads, deals } from "../../Helpers/mockCrmData";

export default function SalesAttribution() {
  const navigate = useNavigate();
  const role = useSelector((s) => s.auth.role);
  const [expandedId, setExpandedId] = useState(null);

  const canView = canViewAttribution(role);

  // Pure client-side compute, per campaign — the campaign-scoped summaries
  // shown here are never a single stored value, matching
  // computeAttributionSummary()'s own "never invents revenue" contract.
  const summaries = useMemo(
    () => Object.fromEntries(CAMPAIGN_REFERENCES.map((c) => [c.id, computeAttributionSummary({ campaignReference: c.id })])),
    []
  );
  const overallSummary = useMemo(() => computeAttributionSummary({}), []);

  const conversionMappings = useMemo(
    () => overallSummary.attributedDeals.map((dealId) => {
      const deal = deals.find((d) => d._id === dealId);
      const lead = leads.find((l) => l.convertedTo?.dealId === dealId);
      return { dealId, dealName: deal?.name || "Unknown Deal", leadName: lead?.name || "Unknown Lead", value: deal?.value || 0 };
    }),
    [overallSummary]
  );

  if (!canView) {
    return <div className="p-4 md:p-6"><p className="text-sm text-red-400">You do not have permission to view Attribution.</p></div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <button onClick={() => navigate("/admin/integrations/sales-marketing")} className="hover:text-gray-300">Administration</button>
        <span>/</span>
        <button onClick={() => navigate("/admin/integrations/sales-marketing")} className="hover:text-gray-300">Sales &amp; Marketing</button>
        <span>/</span>
        <span className="text-gray-300">Attribution</span>
      </div>

      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Attribution</h1>
        <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
      </div>
      <p className="text-sm text-gray-400 max-w-2xl">
        Walks real Lead → Deal relationships to show attributed pipeline and won value per campaign. ROI is only ever shown when a
        verified spend figure exists for that campaign — every other campaign correctly shows "{ROI_UNAVAILABLE_MESSAGE}" rather than a fabricated number.
      </p>

      <section className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-gray-500 uppercase border-b border-gray-800">
              <th className="p-3">Campaign</th>
              <th className="p-3">Provider</th>
              <th className="p-3">Attributed Pipeline</th>
              <th className="p-3">Attributed Won</th>
              <th className="p-3">ROI</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {CAMPAIGN_REFERENCES.map((c) => {
              const summary = summaries[c.id];
              const isOpen = expandedId === c.id;
              return (
                <Fragment key={c.id}>
                  <tr className="border-b border-gray-800/60 hover:bg-gray-800/30 cursor-pointer" onClick={() => setExpandedId(isOpen ? null : c.id)}>
                    <td className="p-3 text-gray-200">{c.name}</td>
                    <td className="p-3 text-gray-400">{findProvider(c.providerKey)?.name || c.providerKey}</td>
                    <td className="p-3 text-gray-300">${summary.attributedPipelineValue.toLocaleString()}</td>
                    <td className="p-3 text-emerald-400">${summary.attributedWonValue.toLocaleString()}</td>
                    <td className="p-3 text-[11px] text-gray-400">{summary.roi}</td>
                    <td className="p-3">{isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-gray-800/20">
                      <td colSpan={6} className="p-4 text-xs text-gray-400">
                        <p>Provider Campaign ID: {c.providerCampaignId}</p>
                        <p>UTM: {Object.entries(c.utm).map(([k, v]) => `${k}=${v}`).join(", ") || "—"}</p>
                        <p>{summary.touchpoints.length} touchpoint(s), {summary.unmappedUtmCount} with no UTM source recorded.</p>
                        {c.previewLabel && <p className="text-gray-500 mt-1">{c.previewLabel}</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>

      {canConfigureAttribution(role) && (
        <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><Link2 size={14} className="text-blue-400" /> Conversion Mapping</h2>
          <p className="text-[11px] text-gray-500 mb-3">
            Display-only — this reflects the real Lead → Deal <code>convertedTo</code> linkage already used to compute attribution above.
            There is no mapping-rule editor in this preview; nothing here can be reconfigured yet.
          </p>
          {conversionMappings.length === 0 ? (
            <p className="text-xs text-gray-500">No converted leads with attribution touchpoints yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {conversionMappings.map((m) => (
                <li key={m.dealId} className="flex items-center justify-between text-xs text-gray-300 bg-gray-800/40 rounded-lg px-3 py-1.5">
                  <span>{m.leadName} → {m.dealName}</span>
                  <span className="text-gray-500">${m.value.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><TrendingUp size={14} className="text-blue-400" /> Overall</h2>
        <p className="text-sm text-gray-300">${overallSummary.attributedPipelineValue.toLocaleString()} attributed pipeline, ${overallSummary.attributedWonValue.toLocaleString()} attributed won across all campaigns.</p>
      </section>
    </div>
  );
}
