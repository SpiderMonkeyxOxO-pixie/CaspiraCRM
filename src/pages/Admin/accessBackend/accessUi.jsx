// Shared pieces for the live Users & Access screens (VITE_BACKEND_AUTH_MODE=
// true). They talk to /organizations/:id/{members,roles,invitations,
// invite-links,audit-events}; the server checks every permission again.
import { NavLink } from "react-router-dom";
import { Copy } from "lucide-react";
import toast from "react-hot-toast";

import { btn, input } from "./accessKit";

export { Badge, Empty, ErrorBox, Loading, Modal, Panel, Table } from "../aiBackend/aiUi";

const TABS = [
  ["/admin/users", "Members"],
  ["/admin/invitations", "Invitations"],
  ["/admin/invite-links", "Invite links"],
  ["/admin/roles", "Roles"],
  ["/admin/access-audit", "Access audit"],
];

export function AccessPage({ title, description, actions, children }) {
  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <nav aria-label="Breadcrumb" className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span> <span>Users &amp; Access</span> <span>/</span> <span className="text-gray-300">{title}</span>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && <p className="text-sm text-gray-400 mt-1 max-w-3xl">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      <nav aria-label="Users & Access sections" className="flex gap-1 overflow-x-auto border-b border-gray-800">
        {TABS.map(([to, label]) => (
          <NavLink key={to} to={to}
            className={({ isActive }) => `px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${isActive ? "border-blue-500 text-white" : "border-transparent text-gray-400 hover:text-gray-200"}`}>
            {label}
          </NavLink>
        ))}
      </nav>
      {children}
    </div>
  );
}

// Shown once after creating or rotating a link: the raw link is never
// stored or shown again.
export function LinkBox({ url, note }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy. Select the link and copy it yourself.");
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input readOnly value={url} aria-label="Link" className={`${input} font-mono text-xs`} onFocus={(e) => e.target.select()} />
        <button type="button" className={btn} onClick={copy} aria-label="Copy link"><Copy size={14} /></button>
      </div>
      {note && <p className="text-xs text-amber-300">{note}</p>}
    </div>
  );
}
