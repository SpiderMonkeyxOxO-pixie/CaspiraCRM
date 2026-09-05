import { useState } from "react";
import { useDispatch } from "react-redux";
import { useOutletContext } from "react-router-dom";
import { Plus, CheckCircle2, Circle } from "lucide-react";
import { addMilestone, toggleMilestone } from "../../redux/projects/projectsSlice";

export default function ProjectMilestones() {
  const { project } = useOutletContext();
  const dispatch = useDispatch();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");

  const handleAdd = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    dispatch(addMilestone({ id: project._id, name, dueDate }));
    setName("");
    setDueDate("");
    setShowAdd(false);
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-400">{project.milestones?.length || 0} milestones</p>
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-3 py-2 rounded-lg text-sm">
          <Plus size={16} /> Add Milestone
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 mb-4 flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-400 mb-1">Name</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Due Date</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button type="submit" className="bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm">Add</button>
        </form>
      )}

      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden">
        {(!project.milestones || project.milestones.length === 0) ? (
          <div className="p-10 text-center text-gray-400">No milestones yet.</div>
        ) : (
          <ul className="divide-y divide-gray-800">
            {project.milestones.map((m) => (
              <li key={m._id} className="flex items-center justify-between px-4 py-3">
                <button onClick={() => dispatch(toggleMilestone({ id: project._id, milestoneId: m._id }))} className="flex items-center gap-3 text-sm">
                  {m.completed ? <CheckCircle2 size={18} className="text-emerald-400" /> : <Circle size={18} className="text-gray-500" />}
                  <span className={m.completed ? "line-through text-gray-500" : ""}>{m.name}</span>
                </button>
                <span className="text-xs text-gray-500">{m.dueDate ? new Date(m.dueDate).toLocaleDateString() : "No due date"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
