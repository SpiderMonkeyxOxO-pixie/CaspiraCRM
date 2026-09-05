import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { fetchCampaign, updateCampaignStatus, CAMPAIGN_STATUSES } from "../../../redux/marketing/campaignsSlice";
import { fetchLeads } from "../../../redux/crm/leadsSlice";

export default function CampaignDetail() {
  const { id } = useParams();
  const dispatch = useDispatch();
  const campaign = useSelector((s) => s.campaigns.current);
  const attributedLeads = useSelector((s) => s.leads.items.filter((l) => l.campaignId === id));

  useEffect(() => {
    dispatch(fetchCampaign(id));
    // Leads are now paginated; request a page large enough to cover
    // attribution lookups since there's no campaignId filter on the list API.
    dispatch(fetchLeads({ pageSize: 1000 }));
  }, [dispatch, id]);

  if (!campaign) return <div className="p-6 text-gray-400">Loading campaign...</div>;

  const progress = campaign.goal ? Math.min(100, Math.round(((campaign.leadsGenerated || 0) / campaign.goal) * 100)) : 0;

  return (
    <div className="p-6 text-white max-w-3xl">
      <Link to="/marketing/campaigns" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4 w-fit">
        <ArrowLeft size={16} /> Back to Campaigns
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">{campaign.name}</h1>
          <p className="text-sm text-gray-400 mt-1">{campaign.channel} · ${campaign.budget?.toLocaleString()} budget</p>
        </div>
        <select
          value={campaign.status}
          onChange={(e) => dispatch(updateCampaignStatus({ id: campaign._id, status: e.target.value }))}
          className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm"
        >
          {CAMPAIGN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase mb-1">Leads Generated</p>
          <p className="text-2xl font-bold">{campaign.leadsGenerated || 0}</p>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase mb-1">Converted</p>
          <p className="text-2xl font-bold">{campaign.converted || 0}</p>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase mb-1">Goal Progress</p>
          <p className="text-2xl font-bold">{progress}%</p>
        </div>
      </div>

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
        <h2 className="font-semibold mb-3">Attributed Leads</h2>
        {attributedLeads.length === 0 ? (
          <p className="text-sm text-gray-500">No leads attributed to this campaign yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {attributedLeads.map((l) => (
              <li key={l._id}>
                <Link to={`/crm/leads/${l._id}`} className="flex justify-between items-center py-1.5 hover:text-blue-300">
                  <span>{l.name}</span>
                  <span className="text-xs text-gray-500">{l.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
