import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Plus, X, Trash2 } from "lucide-react";
import { fetchSegments, createSegment, deleteSegment, SEGMENT_FIELDS } from "../../../redux/marketing/segmentsSlice";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";

const emptyForm = { name: "", field: "industry", value: "" };

export default function SegmentsList() {
  const dispatch = useDispatch();
  const { items: segments, loading } = useSelector((s) => s.segments);
  const companies = useSelector((s) => s.companies.items);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    dispatch(fetchSegments());
    dispatch(fetchCompanies());
  }, [dispatch]);

  const valueOptions = form.field === "industry"
    ? [...new Set(companies.map((c) => c.industry))]
    : ["Prospect", "Customer", "Partner", "Vendor", "Former Customer"];

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name || !form.value) return;
    await dispatch(createSegment(form));
    setForm(emptyForm);
    setShowCreate(false);
  };

  return (
    <div className="p-6 text-white">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Segments</h1>
          <p className="text-sm text-gray-400 mt-1">{segments.length} segments · membership computed live from CRM data</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium">
          <Plus size={16} /> New Segment
        </button>
      </div>

      {loading ? (
        <div className="p-10 text-center text-gray-400">Loading segments...</div>
      ) : segments.length === 0 ? (
        <div className="p-10 text-center text-gray-400 bg-gray-900/40 border border-gray-800 rounded-xl">No segments yet.</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {segments.map((s) => (
            <div key={s._id} className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
              <div className="flex justify-between items-start mb-2">
                <h2 className="font-semibold">{s.name}</h2>
                <button onClick={() => dispatch(deleteSegment(s._id))} className="text-gray-500 hover:text-red-400"><Trash2 size={16} /></button>
              </div>
              <p className="text-xs text-gray-500 mb-3">{SEGMENT_FIELDS.find((f) => f.field === s.field)?.label} = {s.value}</p>
              <p className="text-2xl font-bold">{s.memberCount}</p>
              <p className="text-xs text-gray-400">contacts</p>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">New Segment</h2>
              <button type="button" onClick={() => setShowCreate(false)}><X size={20} /></button>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Name *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Filter By</label>
              <select value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value, value: "" })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {SEGMENT_FIELDS.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Value *</label>
              <select required value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Select...</option>
                {valueOptions.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Create Segment</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
