import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { fetchCampaigns, createCampaign, CAMPAIGN_CHANNELS } from "../../../redux/marketing/campaignsSlice";

const STATUS_COLORS = {
  Draft: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  Active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Paused: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Completed: "bg-blue-500/15 text-blue-300 border-blue-500/30",
};

const emptyForm = { name: "", channel: "Email", budget: "", goal: "" };

export default function CampaignsList() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { items: campaigns, loading } = useSelector((s) => s.campaigns);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    dispatch(fetchCampaigns());
  }, [dispatch]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name) return;
    await dispatch(createCampaign({ ...form, budget: Number(form.budget) || 0, goal: Number(form.goal) || 0 }));
    setForm(emptyForm);
    setShowCreate(false);
  };

  return (
    <div className="p-6 text-white">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Campaigns</h1>
          <p className="text-sm text-gray-400 mt-1">{campaigns.length} campaigns</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium">
          <Plus size={16} /> New Campaign
        </button>
      </div>

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading campaigns...</div>
        ) : campaigns.length === 0 ? (
          <div className="p-10 text-center text-gray-400">No campaigns yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60 text-gray-400 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Channel</th>
                <th className="px-4 py-3 font-medium">Leads Generated</th>
                <th className="px-4 py-3 font-medium">Converted</th>
                <th className="px-4 py-3 font-medium">Budget</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c._id} onClick={() => navigate(`/marketing/campaigns/${c._id}`)} className="border-t border-gray-800 hover:bg-gray-800/40 cursor-pointer">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-gray-300">{c.channel}</td>
                  <td className="px-4 py-3 text-gray-300">{c.leadsGenerated || 0} / {c.goal}</td>
                  <td className="px-4 py-3 text-gray-300">{c.converted || 0}</td>
                  <td className="px-4 py-3 text-gray-300">${c.budget?.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs border ${STATUS_COLORS[c.status]}`}>{c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">New Campaign</h2>
              <button type="button" onClick={() => setShowCreate(false)}><X size={20} /></button>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Name *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Channel</label>
              <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {CAMPAIGN_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1 text-gray-300">Budget</label>
                <input type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-300">Lead Goal</label>
                <input type="number" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Create Campaign</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
