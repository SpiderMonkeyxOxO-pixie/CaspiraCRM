import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { Search, Download, GitCompare, Eye, LayoutGrid, Columns3 } from "lucide-react";
import {
  MODULE_GROUPS, ACTIONS, ACTION_LABELS, allRoles, allModules, isHighRiskGrant,
} from "../../Helpers/mockRbacData";
import CompareRolesDialog from "./CompareRolesDialog";
import AccessPreviewPanel from "./AccessPreviewPanel";

const ALL_ACTIONS = Object.values(ACTIONS);

export default function PermissionsMatrix() {
  const [searchParams] = useSearchParams();
  const initialRole = searchParams.get("role") || "";

  const [view, setView] = useState("matrix"); // "matrix" | "preview"
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [diffOnly, setDiffOnly] = useState(false);
  const [focusedRoleId, setFocusedRoleId] = useState(initialRole);
  const [showCompare, setShowCompare] = useState(false);

  const roles = useMemo(() => (roleFilter ? allRoles().filter((r) => r.id === roleFilter) : allRoles()), [roleFilter]);
  const displayRoles = focusedRoleId ? roles.filter((r) => r.id === focusedRoleId) : roles;

  const modules = useMemo(() => {
    let mods = allModules();
    if (moduleFilter) mods = mods.filter((m) => m.groupId === moduleFilter);
    if (search.trim()) mods = mods.filter((m) => m.label.toLowerCase().includes(search.toLowerCase()));
    return mods;
  }, [moduleFilter, search]);

  const VIEW_VARIANTS = ["view_own", "view_team", "view_department", "view_organization"];

  const cellState = (role, moduleId, action) => {
    const grant = role.permissionGrants.find((g) => g.moduleId === moduleId);
    if (!grant) return "not_applicable";
    if (grant.actions.includes(action)) {
      if (role.duplicatedFrom) {
        const source = allRoles().find((r) => r.id === role.duplicatedFrom);
        const sourceGrant = source?.permissionGrants.find((g) => g.moduleId === moduleId);
        if (sourceGrant?.actions.includes(action)) return "inherited";
      }
      return "allowed";
    }
    // A role scoped to view_own/view_team/view_department instead of the
    // plain "view" row still has SOME view access — that's a scoped grant,
    // not a flat denial.
    if (action === "view" && VIEW_VARIANTS.some((v) => grant.actions.includes(v))) return "scoped";
    return "denied";
  };

  const rows = useMemo(() => {
    return modules
      .map((m) => ({
        module: m,
        actions: actionFilter ? [actionFilter] : ["view", "create", "edit", "approve", "export", "configure"].filter((a) =>
          allRoles().some((r) => r.permissionGrants.find((g) => g.moduleId === m.id)?.actions.includes(a))
        ),
      }))
      .filter((row) => row.actions.length > 0)
      .filter((row) => {
        if (!diffOnly) return true;
        return row.actions.some((action) => {
          const states = displayRoles.map((r) => cellState(r, row.module.id, action));
          return new Set(states).size > 1;
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modules, actionFilter, diffOnly, displayRoles]);

  const exportPreview = () => {
    const sheetRows = [];
    rows.forEach((row) => {
      row.actions.forEach((action) => {
        const entry = { Module: row.module.label, Action: ACTION_LABELS[action] };
        displayRoles.forEach((r) => { entry[r.name] = cellState(r, row.module.id, action); });
        sheetRows.push(entry);
      });
    });
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Permission Matrix");
    XLSX.writeFile(wb, "permission-matrix-preview.xlsx");
  };

  return (
      <div className="p-4 md:p-6 space-y-5">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Users &amp; Access</span> <span>/</span> <span className="text-gray-300">Roles &amp; Permissions</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Permission Matrix</h1>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Frontend preview of every role's granted permissions across every module. This does not enforce
            authorization on any backend.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex border border-gray-700 rounded-lg overflow-hidden">
            <button onClick={() => setView("matrix")} className={`flex items-center gap-1.5 px-3 py-2 text-sm ${view === "matrix" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-800"}`}>
              <Columns3 size={14} /> Matrix
            </button>
            <button onClick={() => setView("preview")} className={`flex items-center gap-1.5 px-3 py-2 text-sm ${view === "preview" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-800"}`}>
              <Eye size={14} /> Access Preview
            </button>
          </div>
          {view === "matrix" && (
            <>
              <button onClick={() => setShowCompare(true)} className="flex items-center gap-1.5 border border-gray-700 hover:bg-gray-800 text-gray-200 px-3 py-2 rounded-lg text-sm"><GitCompare size={14} /> Compare</button>
              <button onClick={exportPreview} className="flex items-center gap-1.5 border border-gray-700 hover:bg-gray-800 text-gray-200 px-3 py-2 rounded-lg text-sm"><Download size={14} /> Export Preview</button>
            </>
          )}
        </div>
      </div>

      {view === "preview" ? (
        <AccessPreviewPanel initialRoleId={focusedRoleId} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input aria-label="Search modules" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search modules..."
                className="w-full bg-gray-900/60 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white" />
            </div>
            <select aria-label="Filter by module group" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All module groups</option>
              {MODULE_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
            <select aria-label="Filter by action" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All actions</option>
              {ALL_ACTIONS.map((a) => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
            </select>
            <select aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">All roles</option>
              {allRoles().map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-gray-300">
              <input type="checkbox" checked={diffOnly} onChange={(e) => setDiffOnly(e.target.checked)} /> Show differences only
            </label>
          </div>

          <div className="flex items-center gap-2">
            <LayoutGrid size={14} className="text-gray-500" />
            <label htmlFor="focused-role" className="text-xs text-gray-400">Focused-role mode (keeps the matrix readable on small screens):</label>
            <select id="focused-role" value={focusedRoleId} onChange={(e) => setFocusedRoleId(e.target.value)} className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-white">
              <option value="">Show all roles</option>
              {allRoles().map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>

          <div className="border border-gray-800 rounded-xl overflow-auto max-h-[65vh]">
            <table className="min-w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-[#0d0f16]">
                <tr>
                  <th scope="col" className="text-left text-gray-400 font-medium px-3 py-2 sticky left-0 z-20 bg-[#0d0f16] min-w-[200px]">Module / Action</th>
                  {displayRoles.map((r) => (
                    <th scope="col" key={r.id} className="text-left text-gray-300 font-medium px-3 py-2 min-w-[130px] whitespace-nowrap">{r.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={displayRoles.length + 1} className="text-center py-10 text-gray-500">No permissions match your filters.</td></tr>
                )}
                {rows.map((row) =>
                  row.actions.map((action) => (
                    <tr key={`${row.module.id}-${action}`} className="border-t border-gray-800">
                      <th scope="row" className="text-left px-3 py-2 sticky left-0 bg-[#0d0f16] font-normal text-gray-300">
                        {row.module.label} <span className="text-gray-500">— {ACTION_LABELS[action]}</span>
                      </th>
                      {displayRoles.map((r) => {
                        const state = cellState(r, row.module.id, action);
                        const risky = state === "allowed" && isHighRiskGrant(row.module.id, action);
                        return (
                          <td key={r.id} className="px-3 py-2">
                            <span className={cellBadgeClass(state, risky)}>
                              {cellLabel(state)}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showCompare && <CompareRolesDialog onClose={() => setShowCompare(false)} />}
      </div>
  );
}

function cellLabel(state) {
  if (state === "allowed") return "Allowed";
  if (state === "inherited") return "Inherited";
  if (state === "scoped") return "Scoped";
  if (state === "denied") return "Denied";
  return "N/A";
}

function cellBadgeClass(state, risky) {
  if (state === "allowed") return `px-2 py-0.5 rounded-full text-[11px] border ${risky ? "bg-red-500/15 text-red-300 border-red-500/30" : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"}`;
  if (state === "inherited") return "px-2 py-0.5 rounded-full text-[11px] border bg-cyan-500/15 text-cyan-300 border-cyan-500/30";
  if (state === "scoped") return "px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30";
  if (state === "denied") return "px-2 py-0.5 rounded-full text-[11px] border bg-gray-800 text-gray-500 border-gray-700";
  return "px-2 py-0.5 rounded-full text-[11px] border bg-gray-900 text-gray-600 border-gray-800";
}
