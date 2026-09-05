import { useState } from "react";
import { useDispatch } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import { fetchActivities } from "../../../redux/crm/activitiesSlice";
import { StageBadge } from "../Deals/DealBadges";
import { formatMoney, formatDate } from "../Deals/dealUtils";
import ActivityFormModal from "../Activities/ActivityFormModal";

export function AtRiskDealsTable({ items }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [activityFor, setActivityFor] = useState(null); // { deal, kind: "logActivity" | "followUp" }

  if (items.length === 0) {
    return (
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
        <h2 className="font-semibold text-sm mb-2">At-Risk &amp; Stale Deals</h2>
        <p className="text-sm text-gray-500">No at-risk or stale deals in the active filters. Good shape.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-sm">At-Risk &amp; Stale Deals</h2>
        <span className="text-xs text-gray-500">{items.length} flagged</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">Deals with at least one risk reason, why they were flagged, and next steps</caption>
          <thead className="text-gray-400 text-left"><tr>
            <th scope="col" className="py-1.5 pr-2">Deal</th><th scope="col" className="py-1.5 pr-2">Stage</th>
            <th scope="col" className="py-1.5 pr-2 text-right">Value</th><th scope="col" className="py-1.5 pr-2">Owner</th>
            <th scope="col" className="py-1.5 pr-2">Expected Close</th><th scope="col" className="py-1.5 pr-2">Risk Reason</th>
            <th scope="col" className="py-1.5 text-right">Actions</th>
          </tr></thead>
          <tbody>
            {items.slice(0, 8).map(({ deal, reasons, company }) => (
              <tr key={deal._id} className="border-t border-gray-800 align-top">
                <td className="py-1.5 pr-2">
                  <Link to={`/crm/deals/${deal._id}`} className="text-blue-400 hover:underline">{deal.name}</Link>
                  {company && <p className="text-gray-500">{company.name}</p>}
                </td>
                <td className="py-1.5 pr-2"><StageBadge stage={deal.stage} /></td>
                <td className="py-1.5 pr-2 text-right text-gray-300">{formatMoney(deal.value, deal.currency)}</td>
                <td className="py-1.5 pr-2 text-gray-300">{deal.ownerName || "Unassigned"}</td>
                <td className="py-1.5 pr-2 text-gray-300">{formatDate(deal.expectedClosingDate)}</td>
                <td className="py-1.5 pr-2 text-amber-300" title={reasons.join(" · ")}>{reasons[0]}{reasons.length > 1 && ` (+${reasons.length - 1} more)`}</td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  <button onClick={() => navigate(`/crm/deals/${deal._id}`)} className="text-blue-400 hover:underline mr-2">Open</button>
                  <button onClick={() => setActivityFor({ deal, kind: "logActivity" })} className="text-blue-400 hover:underline">Log Activity</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > 8 && <p className="text-[11px] text-gray-500 mt-2 text-center">Showing 8 of {items.length}</p>}
      {activityFor && (
        <ActivityFormModal
          prefill={{ relatedRecordType: "Deal", relatedRecordId: activityFor.deal._id, ownerId: activityFor.deal.ownerId }}
          onClose={() => setActivityFor(null)}
          onSaved={() => { setActivityFor(null); dispatch(fetchActivities()); }}
        />
      )}
    </div>
  );
}

export function CompaniesNeedingAttention({ items }) {
  if (items.length === 0) {
    return (
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
        <h2 className="font-semibold text-sm mb-2">Companies Needing Attention</h2>
        <p className="text-sm text-gray-500">No companies flagged in the active filters.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-sm">Companies Needing Attention</h2>
        <span className="text-xs text-gray-500">{items.length} flagged</span>
      </div>
      <ul className="space-y-2">
        {items.slice(0, 6).map(({ company, reasons, lastActivity }) => (
          <li key={company._id} className="bg-gray-800/40 rounded-lg p-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <Link to={`/crm/companies/${company._id}`} className="text-blue-400 hover:underline font-medium truncate">{company.name}</Link>
              <span className="text-gray-500 shrink-0">{company.ownerName || "Unassigned"}</span>
            </div>
            <p className="text-amber-300 mt-1" title={reasons.join(" · ")}>{reasons[0]}{reasons.length > 1 && ` (+${reasons.length - 1} more)`}</p>
            <p className="text-gray-500 mt-0.5">Last activity: {lastActivity ? formatDate(lastActivity) : "None recorded"}</p>
            <Link to={`/crm/companies/${company._id}`} className="text-blue-400 hover:underline mt-1 inline-block">Open Company</Link>
          </li>
        ))}
      </ul>
      {items.length > 6 && <p className="text-[11px] text-gray-500 mt-2 text-center">Showing 6 of {items.length}</p>}
    </div>
  );
}
