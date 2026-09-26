import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Plus, X, Check, XCircle } from "lucide-react";
import { fetchExpenses, createExpense, reviewExpense, EXPENSE_CATEGORIES } from "../../../redux/finance/expensesSlice";

const STATUS_COLORS = {
  Pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Rejected: "bg-red-500/15 text-red-300 border-red-500/30",
};

const emptyForm = { description: "", category: "Travel", amount: "" };

export default function ExpensesList() {
  const dispatch = useDispatch();
  const { items: expenses, loading } = useSelector((s) => s.expenses);
  const currentUser = useSelector((s) => s.auth.data);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    dispatch(fetchExpenses());
  }, [dispatch]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.description || !form.amount) return;
    await dispatch(createExpense({ ...form, amount: Number(form.amount), submittedBy: currentUser?.name || currentUser?.username }));
    setForm(emptyForm);
    setShowCreate(false);
  };

  const reviewer = currentUser?.name || currentUser?.username;

  return (
    <div className="p-6 text-white">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Expenses</h1>
          <p className="text-sm text-gray-400 mt-1">{expenses.length} expenses</p>
        </div>
        <button data-tour="expenses-add" onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium">
          <Plus size={16} /> Submit Expense
        </button>
      </div>

      <div data-tour="expenses-table" className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading expenses...</div>
        ) : expenses.length === 0 ? (
          <div className="p-10 text-center text-gray-400">No expenses yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60 text-gray-400 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Submitted By</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e._id} className="border-t border-gray-800">
                  <td className="px-4 py-3 font-medium">{e.description}</td>
                  <td className="px-4 py-3 text-gray-300">{e.category}</td>
                  <td className="px-4 py-3 text-gray-300">${e.amount?.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-300">{e.submittedBy}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs border ${STATUS_COLORS[e.status]}`}>{e.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {e.status === "Pending" && (
                      <div className="flex gap-2">
                        <button onClick={() => dispatch(reviewExpense({ id: e._id, status: "Approved", reviewer }))} className="text-emerald-400 hover:text-emerald-300"><Check size={16} /></button>
                        <button onClick={() => dispatch(reviewExpense({ id: e._id, status: "Rejected", reviewer }))} className="text-red-400 hover:text-red-300"><XCircle size={16} /></button>
                      </div>
                    )}
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
              <h2 className="text-lg font-bold">Submit Expense</h2>
              <button type="button" onClick={() => setShowCreate(false)}><X size={20} /></button>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-300">Description *</label>
              <input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1 text-gray-300">Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                  {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-300">Amount *</label>
                <input required type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Submit</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
