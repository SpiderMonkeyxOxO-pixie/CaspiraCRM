import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Plus, X, Send } from "lucide-react";
import { fetchForms, createForm, submitFormLead } from "../../../redux/marketing/formsSlice";
import { fetchCampaigns } from "../../../redux/marketing/campaignsSlice";

const emptyForm = { name: "", campaignId: "" };
const emptySubmission = { name: "", email: "", company: "" };

export default function FormsList() {
  const dispatch = useDispatch();
  const { items: forms, loading } = useSelector((s) => s.forms);
  const campaigns = useSelector((s) => s.campaigns.items);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [testingForm, setTestingForm] = useState(null);
  const [submission, setSubmission] = useState(emptySubmission);

  useEffect(() => {
    dispatch(fetchForms());
    dispatch(fetchCampaigns());
  }, [dispatch]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name) return;
    await dispatch(createForm({ ...form, fields: ["name", "email", "company"] }));
    setForm(emptyForm);
    setShowCreate(false);
  };

  const handleSubmitTest = async (e) => {
    e.preventDefault();
    if (!submission.name || !submission.email) return;
    await dispatch(submitFormLead({ id: testingForm, leadData: submission }));
    setSubmission(emptySubmission);
    setTestingForm(null);
  };

  return (
    <div className="p-6 text-white">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Lead-Capture Forms</h1>
          <p className="text-sm text-gray-400 mt-1">{forms.length} forms · submissions create real CRM leads</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium">
          <Plus size={16} /> New Form
        </button>
      </div>

      {loading ? (
        <div className="p-10 text-center text-gray-400">Loading forms...</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {forms.map((f) => (
            <div key={f._id} className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
              <h2 className="font-semibold mb-1">{f.name}</h2>
              <p className="text-xs text-gray-500 mb-3">Fields: {f.fields?.join(", ")}</p>
              <p className="text-2xl font-bold mb-3">{f.submissions || 0} <span className="text-sm text-gray-400 font-normal">submissions</span></p>
              <button onClick={() => setTestingForm(f._id)} className="flex items-center gap-2 text-sm text-blue-400 hover:underline">
                <Send size={14} /> Simulate Submission
              </button>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">New Form</h2>
              <button type="button" onClick={() => setShowCreate(false)}><X size={20} /></button>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Name *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Attribute to Campaign</label>
              <select value={form.campaignId} onChange={(e) => setForm({ ...form, campaignId: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">None</option>
                {campaigns.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Create Form</button>
            </div>
          </form>
        </div>
      )}

      {testingForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setTestingForm(null)}>
          <form onSubmit={handleSubmitTest} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold">Simulate Form Submission</h2>
            <p className="text-xs text-gray-500">This mimics a real visitor filling out the form — it creates an actual lead in the CRM.</p>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Name *</label>
              <input required value={submission.name} onChange={(e) => setSubmission({ ...submission, name: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Email *</label>
              <input required type="email" value={submission.email} onChange={(e) => setSubmission({ ...submission, email: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Company</label>
              <input value={submission.company} onChange={(e) => setSubmission({ ...submission, company: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setTestingForm(null)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-sm font-medium">Submit</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
