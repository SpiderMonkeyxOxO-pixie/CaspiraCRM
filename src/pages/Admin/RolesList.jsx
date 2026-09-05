import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  Plus, Search, RefreshCw, Download, MoreHorizontal, Shield, Users, AlertTriangle,
  ChevronDown, Copy, Eye, Pencil, Archive, ArchiveRestore, Ban, X, ShieldAlert,
} from "lucide-react";
import {
  fetchRoles, archiveRole, restoreRole, disableRole, enableRole,
} from "../../redux/admin/rolesSlice";
import { usersForRole, isHighPrivilegeRole, detectRoleConflicts, SCOPES } from "../../Helpers/mockRbacData";
import { ROLE_TYPE_COLORS, ROLE_STATUS_COLORS, formatDate } from "./rbacUtils";
import RoleBuilder from "./RoleBuilder";
import CompareRolesDialog from "./CompareRolesDialog";

const CRM_DEPARTMENTS = ["Sales", "Support", "Marketing", "Finance", "HR"];

export default function RolesList() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { items, counts, loading, error } = useSelector((s) => s.adminRoles);

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const [showFiltersDrawer, setShowFiltersDrawer] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [openRowMenu, setOpenRowMenu] = useState(null);
  const [builderState, setBuilderState] = useState(null); // { mode, role } | null
  const [showCompare, setShowCompare] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveReason, setArchiveReason] = useState("");

  useEffect(() => {
    dispatch(fetchRoles());
  }, [dispatch]);

  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (searchInput) next.set("search", searchInput); else next.delete("search");
      setSearchParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const filters = useMemo(() => {
    const p = {};
    for (const [k, v] of searchParams.entries()) p[k] = v;
    return p;
  }, [searchParams]);

  const filtered = useMemo(() => {
    let list = items;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
    }
    if (filters.type) list = list.filter((r) => r.type === filters.type);
    if (filters.scope) list = list.filter((r) => r.defaultScope === filters.scope);
    if (filters.department) list = list.filter((r) => r.department === filters.department);
    if (filters.hasUsers === "yes") list = list.filter((r) => usersForRole(r.id).length > 0);
    if (filters.hasUsers === "no") list = list.filter((r) => usersForRole(r.id).length === 0);
    if (filters.highPrivilege === "yes") list = list.filter((r) => isHighPrivilegeRole(r));
    if (filters.builtin === "builtin") list = list.filter((r) => r.isBuiltIn);
    if (filters.builtin === "custom") list = list.filter((r) => !r.isBuiltIn);
    if (filters.status) list = list.filter((r) => r.status === filters.status);
    return list;
  }, [items, filters]);

  const applyFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next);
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearchParams({});
  };

  const cardFilters = {
    builtin: () => applyFilter("builtin", "builtin"),
    custom: () => applyFilter("builtin", "custom"),
    highPrivilege: () => applyFilter("highPrivilege", "yes"),
    withUsers: () => applyFilter("hasUsers", "yes"),
  };

  const exportPreview = () => {
    const rows = filtered.map((r) => ({
      Role: r.name,
      Type: r.type,
      "Default Scope": r.defaultScope,
      "Assigned Users": usersForRole(r.id).length,
      "Permission Count": r.permissionGrants.reduce((n, g) => n + g.actions.length, 0),
      "High Risk": isHighPrivilegeRole(r) ? "Yes" : "No",
      Status: r.status,
      "Last Updated": r.updatedAt ? formatDate(r.updatedAt) : "—",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Roles Preview");
    XLSX.writeFile(wb, "roles-preview.xlsx");
  };

  const handleDuplicate = (role) => {
    setBuilderState({ mode: "duplicate", role });
  };

  const confirmArchive = () => {
    if (!archiveReason.trim()) return;
    dispatch(archiveRole({ id: archiveTarget.id, reason: archiveReason })).then(() => {
      setArchiveTarget(null);
      setArchiveReason("");
      dispatch(fetchRoles());
    });
  };

  return (
      <div className="p-4 md:p-6 space-y-5">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Users &amp; Access</span> <span>/</span> <span className="text-gray-300">Roles &amp; Permissions</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Roles</h1>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Frontend preview of role-based access control — controls what navigation, records, fields and actions are
            visible in this app. This does not enforce authorization on any backend yet.
          </p>
          <p className="text-xs text-gray-500 mt-1">{items.length} role{items.length === 1 ? "" : "s"} visible</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => dispatch(fetchRoles())} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
            <RefreshCw size={15} /> Refresh
          </button>
          <button onClick={() => setShowCompare(true)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
            Compare Roles
          </button>
          <Link to="/admin/permissions" className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
            Permission Matrix
          </Link>
          <button onClick={exportPreview} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
            <Download size={15} /> Export Preview
          </button>
          <div className="relative">
            <button onClick={() => setShowCreateMenu((v) => !v)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium">
              <Plus size={15} /> Create Custom Role <ChevronDown size={14} />
            </button>
            {showCreateMenu && (
              <div role="menu" className="absolute right-0 mt-1 w-56 bg-[#12141c] border border-gray-800 rounded-xl shadow-xl z-20 py-1">
                <button role="menuitem" onClick={() => { setShowCreateMenu(false); setBuilderState({ mode: "create" }); }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-800">
                  Start from scratch
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard label="Built-in Roles" value={counts?.builtin ?? "—"} onClick={cardFilters.builtin} />
        <MetricCard label="Custom Roles" value={counts?.custom ?? "—"} onClick={cardFilters.custom} />
        <MetricCard label="High-Privilege Roles" value={counts?.highPrivilege ?? "—"} icon={<ShieldAlert size={14} className="text-red-400" />} onClick={cardFilters.highPrivilege} />
        <MetricCard label="Roles With Users" value={counts?.withUsers ?? "—"} icon={<Users size={14} />} onClick={cardFilters.withUsers} />
        <MetricCard label="Roles Needing Review" value={counts?.needingReview ?? "—"} icon={<AlertTriangle size={14} className="text-amber-400" />} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            aria-label="Search Roles"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search roles by name or description..."
            className="w-full bg-gray-900/60 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white"
          />
        </div>
        <button onClick={() => setShowFiltersDrawer(true)} className="border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">
          Filters {Object.keys(filters).length > 0 && `(${Object.keys(filters).length})`}
        </button>
        {Object.keys(filters).length > 0 && (
          <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-300">Clear all</button>
        )}
      </div>

      {loading && <div className="text-center text-gray-400 py-12 text-sm">Loading roles…</div>}
      {error && (
        <div className="text-center py-12">
          <p className="text-red-400 text-sm mb-3">{error}</p>
          <button onClick={() => dispatch(fetchRoles())} className="text-sm text-blue-400 hover:underline">Retry</button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-800 rounded-xl">
          <Shield size={28} className="mx-auto text-gray-600 mb-2" />
          <p className="text-gray-300 text-sm mb-1">{items.length === 0 ? "No roles yet" : "No roles match your search"}</p>
          <p className="text-gray-500 text-xs mb-4">{items.length === 0 ? "Create a Custom Role to get started." : "Try adjusting your filters."}</p>
          {items.length === 0 && (
            <button onClick={() => setBuilderState({ mode: "create" })} className="text-sm text-blue-400 hover:underline">Create Custom Role</button>
          )}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="overflow-x-auto border border-gray-800 rounded-xl">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase">
              <tr>
                <th scope="col" className="text-left px-4 py-3">Role</th>
                <th scope="col" className="text-left px-4 py-3">Type</th>
                <th scope="col" className="text-left px-4 py-3">Description</th>
                <th scope="col" className="text-left px-4 py-3">Default Scope</th>
                <th scope="col" className="text-left px-4 py-3">Users</th>
                <th scope="col" className="text-left px-4 py-3">Permissions</th>
                <th scope="col" className="text-left px-4 py-3">High-Risk</th>
                <th scope="col" className="text-left px-4 py-3">Status</th>
                <th scope="col" className="text-left px-4 py-3">Last Updated</th>
                <th scope="col" className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((role) => {
                const userCount = usersForRole(role.id).length;
                const permCount = role.permissionGrants.reduce((n, g) => n + g.actions.length, 0);
                const highRisk = isHighPrivilegeRole(role);
                const conflicts = detectRoleConflicts(role);
                return (
                  <tr key={role.id} className="border-t border-gray-800 hover:bg-gray-900/30">
                    <td className="px-4 py-3">
                      <Link to={`/admin/roles/${role.id}`} className="text-blue-400 hover:underline font-medium">{role.name}</Link>
                      {conflicts.length > 0 && <AlertTriangle size={13} className="inline ml-2 text-amber-400" aria-label="Has conflicts" />}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] border ${ROLE_TYPE_COLORS[role.type] || ""}`}>{role.type}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 max-w-xs truncate">{role.description}</td>
                    <td className="px-4 py-3 text-gray-300">{role.defaultScope}</td>
                    <td className="px-4 py-3 text-gray-300">{userCount}</td>
                    <td className="px-4 py-3 text-gray-300">{permCount}</td>
                    <td className="px-4 py-3">
                      {highRisk ? <span className="text-red-400 text-xs font-medium">High</span> : <span className="text-gray-500 text-xs">Standard</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] border ${ROLE_STATUS_COLORS[role.status] || ""}`}>{role.status}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{role.updatedAt ? formatDate(role.updatedAt) : "—"}</td>
                    <td className="px-4 py-3 relative">
                      <button aria-label={`Row actions for ${role.name}`} onClick={() => setOpenRowMenu(openRowMenu === role.id ? null : role.id)} className="text-gray-400 hover:text-white">
                        <MoreHorizontal size={16} />
                      </button>
                      {openRowMenu === role.id && (
                        <div role="menu" className="absolute right-4 mt-1 w-52 bg-[#12141c] border border-gray-800 rounded-xl shadow-xl z-20 py-1 text-sm">
                          <button role="menuitem" onClick={() => { setOpenRowMenu(null); navigate(`/admin/roles/${role.id}`); }} className="w-full flex items-center gap-2 text-left px-4 py-2 text-gray-200 hover:bg-gray-800"><Eye size={14} /> View</button>
                          {!role.isBuiltIn && (
                            <button role="menuitem" onClick={() => { setOpenRowMenu(null); setBuilderState({ mode: "edit", role }); }} className="w-full flex items-center gap-2 text-left px-4 py-2 text-gray-200 hover:bg-gray-800"><Pencil size={14} /> Edit Custom Role</button>
                          )}
                          <button role="menuitem" onClick={() => { setOpenRowMenu(null); handleDuplicate(role); }} className="w-full flex items-center gap-2 text-left px-4 py-2 text-gray-200 hover:bg-gray-800"><Copy size={14} /> Duplicate</button>
                          <button role="menuitem" onClick={() => { setOpenRowMenu(null); setShowCompare(true); }} className="w-full flex items-center gap-2 text-left px-4 py-2 text-gray-200 hover:bg-gray-800">Compare</button>
                          <button role="menuitem" onClick={() => { setOpenRowMenu(null); navigate(`/admin/permissions?role=${role.id}`); }} className="w-full flex items-center gap-2 text-left px-4 py-2 text-gray-200 hover:bg-gray-800"><Eye size={14} /> Preview Access</button>
                          {!role.isBuiltIn && role.status === "Active" && (
                            <button role="menuitem" onClick={() => { setOpenRowMenu(null); dispatch(disableRole(role.id)).then(() => dispatch(fetchRoles())); }} className="w-full flex items-center gap-2 text-left px-4 py-2 text-gray-200 hover:bg-gray-800"><Ban size={14} /> Disable Custom Role</button>
                          )}
                          {!role.isBuiltIn && role.status === "Inactive" && (
                            <button role="menuitem" onClick={() => { setOpenRowMenu(null); dispatch(enableRole(role.id)).then(() => dispatch(fetchRoles())); }} className="w-full flex items-center gap-2 text-left px-4 py-2 text-gray-200 hover:bg-gray-800">Enable Custom Role</button>
                          )}
                          {!role.isBuiltIn && role.status !== "Archived" && (
                            <button role="menuitem" onClick={() => { setOpenRowMenu(null); setArchiveTarget(role); }} className="w-full flex items-center gap-2 text-left px-4 py-2 text-red-400 hover:bg-gray-800"><Archive size={14} /> Archive Custom Role</button>
                          )}
                          {!role.isBuiltIn && role.status === "Archived" && (
                            <button role="menuitem" onClick={() => { setOpenRowMenu(null); dispatch(restoreRole(role.id)).then(() => dispatch(fetchRoles())); }} className="w-full flex items-center gap-2 text-left px-4 py-2 text-gray-200 hover:bg-gray-800"><ArchiveRestore size={14} /> Restore</button>
                          )}
                          {role.isBuiltIn && (
                            <p className="px-4 py-2 text-[11px] text-gray-500">Built-in roles can't be deleted — duplicate into a Custom Role to modify.</p>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showFiltersDrawer && (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Filters">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowFiltersDrawer(false)} />
          <div className="relative bg-[#12141c] border-l border-gray-800 w-full max-w-xs h-full p-5 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold">Filters</h3>
              <button onClick={() => setShowFiltersDrawer(false)} aria-label="Close filters"><X size={18} className="text-gray-400" /></button>
            </div>
            <FilterSelect label="Role type" value={filters.type} onChange={(v) => applyFilter("type", v)} options={["Built-in", "Custom", "Capability", "External"]} />
            <FilterSelect label="Scope" value={filters.scope} onChange={(v) => applyFilter("scope", v)} options={SCOPES} />
            <FilterSelect label="Department" value={filters.department} onChange={(v) => applyFilter("department", v)} options={CRM_DEPARTMENTS} />
            <FilterSelect label="Has assigned users" value={filters.hasUsers} onChange={(v) => applyFilter("hasUsers", v)} options={["yes", "no"]} />
            <FilterSelect label="High privilege" value={filters.highPrivilege} onChange={(v) => applyFilter("highPrivilege", v)} options={["yes", "no"]} />
            <FilterSelect label="Built-in / Custom" value={filters.builtin} onChange={(v) => applyFilter("builtin", v)} options={["builtin", "custom"]} />
            <FilterSelect label="Status" value={filters.status} onChange={(v) => applyFilter("status", v)} options={["Active", "Inactive", "Archived"]} />
          </div>
        </div>
      )}

      {builderState && (
        <RoleBuilder
          mode={builderState.mode}
          role={builderState.role}
          onClose={() => setBuilderState(null)}
          onSaved={(role) => { setBuilderState(null); dispatch(fetchRoles()); if (role?.id) navigate(`/admin/roles/${role.id}`); }}
        />
      )}

      {showCompare && <CompareRolesDialog onClose={() => setShowCompare(false)} />}

      {archiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Archive Custom Role">
          <div className="absolute inset-0 bg-black/60" onClick={() => setArchiveTarget(null)} />
          <div className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-white mb-2">Archive "{archiveTarget.name}"</h3>
            <p className="text-sm text-gray-400 mb-3">Archiving is reversible. Provide a reason for the record.</p>
            <label htmlFor="archive-reason" className="block text-xs text-gray-400 mb-1">Reason</label>
            <textarea id="archive-reason" value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white mb-4" rows={3} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setArchiveTarget(null)} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">Cancel</button>
              <button onClick={confirmArchive} disabled={!archiveReason.trim()} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-lg">Archive</button>
            </div>
          </div>
        </div>
      )}
      </div>
  );
}

function MetricCard({ label, value, icon, onClick }) {
  return (
    <button onClick={onClick} disabled={!onClick} className="text-left bg-gray-900/40 border border-gray-800 rounded-xl p-3 hover:border-gray-700 disabled:cursor-default transition">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 uppercase">{icon}{label}</div>
      <div className="text-xl font-bold text-white mt-1">{value}</div>
    </button>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <select aria-label={label} value={value || ""} onChange={(e) => onChange(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
        <option value="">All</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
