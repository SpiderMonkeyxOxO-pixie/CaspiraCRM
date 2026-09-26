import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Plus, X } from "lucide-react";
import { fetchTemplates, createTemplate } from "../../../redux/marketing/templatesSlice";

const emptyForm = { name: "", subject: "", body: "" };

export default function TemplatesList() {
  const dispatch = useDispatch();
  const { items: templates, loading } = useSelector((s) => s.templates);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    dispatch(fetchTemplates());
  }, [dispatch]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name || !form.subject) return;
    await dispatch(createTemplate(form));
    setForm(emptyForm);
    setShowCreate(false);
  };

  return (
    <div className="p-6 text-white">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Templates</h1>
          <p className="text-sm text-gray-400 mt-1">{templates.length} templates</p>
        </div>
        <button data-tour="templates-add" onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium">
          <Plus size={16} /> New Template
        </button>
      </div>

      {loading ? (
        <div className="p-10 text-center text-gray-400">Loading templates...</div>
      ) : templates.length === 0 ? (
        <div className="p-10 text-center text-gray-400 bg-gray-900/40 border border-gray-800 rounded-xl">No templates yet.</div>
      ) : (
        <div data-tour="templates-cards" className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <div key={t._id} className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
              <h2 className="font-semibold mb-1">{t.name}</h2>
              <p className="text-xs text-gray-500 mb-2">Subject: {t.subject}</p>
              <p className="text-sm text-gray-400 line-clamp-3">{t.body}</p>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">New Template</h2>
              <button type="button" onClick={() => setShowCreate(false)}><X size={20} /></button>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Name *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Subject *</label>
              <input required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Body</label>
              <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={4} placeholder="Use {{name}} for personalization" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Save Template</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
