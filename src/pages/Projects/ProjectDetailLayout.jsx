import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams, NavLink, Outlet, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { fetchProject, updateProject, PROJECT_STATUSES } from "../../redux/projects/projectsSlice";
import { fetchTasks } from "../../redux/projects/tasksSlice";

const TABS = [
  { path: "overview", label: "Overview" },
  { path: "tasks", label: "Tasks" },
  { path: "board", label: "Board" },
  { path: "milestones", label: "Milestones" },
];

export default function ProjectDetailLayout() {
  const { id } = useParams();
  const dispatch = useDispatch();
  const project = useSelector((s) => s.projects.current);

  useEffect(() => {
    dispatch(fetchProject(id));
    dispatch(fetchTasks());
  }, [dispatch, id]);

  if (!project) return <div className="p-6 text-gray-400">Loading project...</div>;

  return (
    <div className="text-white">
      <div className="p-6 pb-0">
        <Link to="/projects" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4 w-fit">
          <ArrowLeft size={16} /> Back to Projects
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <p className="text-sm text-gray-400 mt-1">{project.companyName} · Owner: {project.owner}</p>
          </div>
          <select
            value={project.status}
            onChange={(e) => dispatch(updateProject({ id: project._id, changes: { status: e.target.value } }))}
            className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm"
          >
            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="flex gap-1 px-6 border-b border-gray-800 overflow-x-auto">
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              `px-3 py-2 text-sm rounded-t-lg whitespace-nowrap ${isActive ? "text-blue-400 border-b-2 border-blue-400 font-medium" : "text-gray-400 hover:text-gray-200"}`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      <Outlet context={{ project }} />
    </div>
  );
}
