import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  Plus, Search, RefreshCw, Download, ChevronUp, ChevronDown, Columns3,
  X, AlertCircle, ChevronLeft, ChevronRight, Bookmark, MoreHorizontal, FileSearch, ChevronDown as CaretDown,
} from "lucide-react";
import {
  fetchContracts, archiveContract, restoreContract, bulkAssignOwner, bulkArchiveContracts, CONTRACT_TYPES,
} from "../../../redux/sales/contractsSlice";
import { queryContractsLocal, getEffectiveStatus, isRenewalDue, isExpiringSoon, hasIncompleteSignatory, computeContractTotals, SETTABLE_STATUSES } from "../../../Helpers/mockContractData";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import { fetchContacts } from "../../../redux/crm/contactsSlice";
import { fetchDeals } from "../../../redux/crm/dealsSlice";
import { fetchOrders } from "../../../redux/sales/ordersSlice";
import { fetchQuotes } from "../../../redux/sales/quotesSlice";
import { CRM_TEAM, findTeamMember } from "../../../Helpers/mockUsersData";
import useDebounced from "../../../hooks/useDebounced";
import { formatMoney, formatDate, CONTRACT_STATUS_COLORS } from "./contractUtils";
import ContractBuilder from "./ContractBuilder";
import PrepareContractDialog from "./PrepareContractDialog";

const ALL_COLUMNS = [
  { key: "contact", label: "Contact", optional: false },
  { key: "contractType", label: "Contract Type", optional: false },
  { key: "total", label: "Total", optional: false },
  { key: "currency", label: "Currency", optional: false },
  { key: "status", label: "Status", optional: false },
  { key: "endDate", label: "End Date", optional: false },
  { key: "owner", label: "Owner", optional: false },
  { key: "updatedAt", label: "Last Updated", optional: false },
  { key: "sourceQuote", label: "Source Quote", optional: true },
  { key: "sourceOrder", label: "Source Order", optional: true },
  { key: "renewalType", label: "Renewal Type", optional: true },
  { key: "team", label: "Team", optional: true },
  { key: "createdAt", label: "Created Date", optional: true },
];
const DEFAULT_VISIBLE = ALL_COLUMNS.filter((c) => !c.optional).map((c) => c.key);
const COLUMN_PREF_KEY = "sales.contracts.visibleColumns";
const SAVED_VIEWS_KEY = "sales.contracts.savedViews";

function ownerName(id) {
  if (!id) return "Unassigned";
  return findTeamMember(id)?.name || id;
}

export default function ContractsList() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { items, loading, error } = useSelector((s) => s.contracts);
  const companies = useSelector((s) => s.companies.items);
  const allContacts = useSelector((s) => s.contacts.items);
  const allQuotes = useSelector((s) => s.quotes.items);
  const allOrders = useSelector((s) => s.orders.items);

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const debouncedSearch = useDebounced(searchInput, 350);

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [showFiltersDrawer, setShowFiltersDrawer] = useState(false);
  const [openRowMenu, setOpenRowMenu] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null);
  const [bulkValue, setBulkValue] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  const [exporting, setExporting] = useState(false);
  const [builderState, setBuilderState] = useState(null);
  const [prepareDialog, setPrepareDialog] = useState(null); // { sourceType, preselectedId } | null
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveReason, setArchiveReason] = useState("");

  const [visibleColumns, setVisibleColumns] = useState(() => {
    try { return JSON.parse(localStorage.getItem(COLUMN_PREF_KEY)) || DEFAULT_VISIBLE; } catch { return DEFAULT_VISIBLE; }
  });

  useEffect(() => {
    dispatch(fetchContracts()); dispatch(fetchCompanies()); dispatch(fetchContacts()); dispatch(fetchDeals()); dispatch(fetchOrders()); dispatch(fetchQuotes());
  }, [dispatch]);

  // Cross-page integration: a Quote/Order/Deal's "Prepare Contract" link
  // navigates here with ?fromQuote=/?fromOrder=/?fromDeal=<id>.
  useEffect(() => {
    const fromQuote = searchParams.get("fromQuote");
    const fromOrder = searchParams.get("fromOrder");
    const fromDeal = searchParams.get("fromDeal");
    if (fromQuote || fromOrder || fromDeal) {
      setPrepareDialog({ sourceType: fromQuote ? "quote" : fromOrder ? "order" : "deal", preselectedId: fromQuote || fromOrder || fromDeal });
      const next = new URLSearchParams(searchParams);
      next.delete("fromQuote"); next.delete("fromOrder"); next.delete("fromDeal");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const companyNameById = useMemo(() => new Map(companies.map((c) => [c._id, c.name])), [companies]);
  const contactNameById = useMemo(() => new Map(allContacts.map((c) => [c._id, c.name])), [allContacts]);
  const quoteById = useMemo(() => new Map(allQuotes.map((q) => [q._id, q])), [allQuotes]);
  const orderById = useMemo(() => new Map(allOrders.map((o) => [o._id, o])), [allOrders]);

  const params = useMemo(() => {
    const p = {};
    for (const [key, value] of searchParams.entries()) p[key] = value;
    if (debouncedSearch) p.search = debouncedSearch;
    else delete p.search;
    p.page = p.page || "1";
    p.pageSize = p.pageSize || "20";
    p.archived = p.archived || "false";
    p.sort = p.sort || "updatedAt";
    p.order = p.order || "desc";
    return p;
  }, [searchParams, debouncedSearch]);

  const { contracts: pagedContracts, total } = useMemo(() => queryContractsLocal(items, params), [items, params]);

  const metrics = useMemo(() => {
    const active = items.filter((c) => !c.archived);
    return {
      signed: active.filter((c) => c.status === "Signed").length,
      pendingSignature: active.filter((c) => c.status === "Sent for Signature").length,
      renewalDue: active.filter((c) => isRenewalDue(c)).length,
      expiringSoon: active.filter((c) => isExpiringSoon(c)).length,
      draft: active.filter((c) => c.status === "Draft").length,
    };
  }, [items]);

  const applyFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    next.delete("page");
    setSearchParams(next);
  };
  const applyMetricFilter = (key) => applyFilter(key, "true");

  const toggleSort = (key) => {
    const next = new URLSearchParams(searchParams);
    if (params.sort === key) next.set("order", params.order === "asc" ? "desc" : "asc");
    else { next.set("sort", key); next.set("order", "asc"); }
    setSearchParams(next);
  };

  const toggleSelectAll = () => {
    if (selected.size === pagedContracts.length) setSelected(new Set());
    else setSelected(new Set(pagedContracts.map((c) => c._id)));
  };
  const toggleSelect = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const runBulkAssign = async () => {
    if (!bulkValue) return;
    await dispatch(bulkAssignOwner({ contractIds: [...selected], ownerId: bulkValue }));
    setBulkAction(null); setBulkValue(""); setSelected(new Set());
    dispatch(fetchContracts());
  };
  const runBulkArchive = async () => {
    if (!bulkReason.trim()) return;
    await dispatch(bulkArchiveContracts({ contractIds: [...selected], reason: bulkReason }));
    setBulkAction(null); setBulkReason(""); setSelected(new Set());
    dispatch(fetchContracts());
  };

  const exportPreview = () => {
    setExporting(true);
    const rows = pagedContracts.map((c) => ({
      "Contract #": c.contractNumber, Company: companyNameById.get(c.companyId) || "—", Contact: contactNameById.get(c.contactId) || "—",
      "Contract Type": c.contractType, Total: computeContractTotals(c).grandTotal, Currency: c.currency, Status: getEffectiveStatus(c),
      "End Date": c.endDate ? formatDate(c.endDate) : "—", Owner: ownerName(c.ownerId), "Last Updated": formatDate(c.updatedAt),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contracts Preview");
    XLSX.writeFile(wb, "contracts-preview.xlsx");
    setExporting(false);
  };

  const totalPages = Math.max(1, Math.ceil(total / Number(params.pageSize)));

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Sales</span> <span>/</span> <span className="text-gray-300">Contracts</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Contracts</h1>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">Manage the legal agreements governing your customer relationships — prepared from Quotes, generated from Orders or Won Deals, or created manually.</p>
          <p className="text-xs text-gray-500 mt-1">{total} contract{total === 1 ? "" : "s"}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => dispatch(fetchContracts())} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300"><RefreshCw size={15} /> Refresh</button>
          <button onClick={exportPreview} disabled={exporting} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300"><Download size={15} /> Export Preview</button>
          <div className="relative">
            <button onClick={() => setShowAddMenu((v) => !v)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium">
              <Plus size={15} /> Create Contract <CaretDown size={14} />
            </button>
            {showAddMenu && (
              <div role="menu" className="absolute right-0 mt-1 w-64 bg-[#12141c] border border-gray-800 rounded-xl shadow-xl z-20 py-1">
                <button role="menuitem" onClick={() => { setShowAddMenu(false); setPrepareDialog({ sourceType: "quote" }); }} className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-800">Prepare from Quote</button>
                <button role="menuitem" onClick={() => { setShowAddMenu(false); setPrepareDialog({ sourceType: "order" }); }} className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-800">Generate from Order</button>
                <button role="menuitem" onClick={() => { setShowAddMenu(false); setPrepareDialog({ sourceType: "deal" }); }} className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-800">Generate from Won Deal</button>
                <button role="menuitem" onClick={() => { setShowAddMenu(false); setBuilderState({ mode: "manual" }); }} className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-800">Create Manual Contract</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard label="Signed / Active" value={metrics.signed} onClick={() => applyFilter("status", "Signed")} />
        <MetricCard label="Pending Signature" value={metrics.pendingSignature} onClick={() => applyFilter("status", "Sent for Signature")} />
        <MetricCard label="Renewal Due" value={metrics.renewalDue} onClick={() => applyMetricFilter("renewalDue")} />
        <MetricCard label="Expiring Soon" value={metrics.expiringSoon} onClick={() => applyMetricFilter("expiringSoon")} />
        <MetricCard label="Draft" value={metrics.draft} onClick={() => applyFilter("status", "Draft")} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input aria-label="Search Contracts" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search by contract number or company..." className="w-full bg-gray-900/60 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white" />
        </div>
        <button onClick={() => setShowFiltersDrawer(true)} className="border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300">Filters</button>
        <div className="relative">
          <button onClick={() => setShowColumns((v) => !v)} className="flex items-center gap-1.5 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm text-gray-300"><Columns3 size={14} /> Columns</button>
          {showColumns && (
            <div className="absolute right-0 mt-1 w-56 bg-[#12141c] border border-gray-800 rounded-xl shadow-xl z-20 p-2 space-y-1">
              {ALL_COLUMNS.filter((c) => c.optional).map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-xs text-gray-300 px-2 py-1">
                  <input type="checkbox" checked={visibleColumns.includes(c.key)} onChange={(e) => {
                    const next = e.target.checked ? [...visibleColumns, c.key] : visibleColumns.filter((k) => k !== c.key);
                    setVisibleColumns(next); localStorage.setItem(COLUMN_PREF_KEY, JSON.stringify(next));
                  }} /> {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-900/20 border border-blue-800/40 rounded-lg px-4 py-2 text-sm text-blue-200">
          <span>{selected.size} selected</span>
          <button onClick={() => setBulkAction("assign")} className="hover:underline">Assign Owner</button>
          <button onClick={() => setBulkAction("archive")} className="hover:underline">Archive</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-blue-300 hover:underline">Clear</button>
        </div>
      )}

      {loading && <div className="text-center text-gray-400 py-12 text-sm">Loading contracts…</div>}
      {error && (
        <div className="text-center py-12">
          <p className="text-red-400 text-sm mb-3">{error}</p>
          <button onClick={() => dispatch(fetchContracts())} className="text-sm text-blue-400 hover:underline">Retry</button>
        </div>
      )}

      {!loading && !error && pagedContracts.length === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-800 rounded-xl">
          <FileSearch size={28} className="mx-auto text-gray-600 mb-2" />
          <p className="text-gray-300 text-sm mb-1">{total === 0 && items.length === 0 ? "No contracts yet" : "No contracts match your filters"}</p>
          <div className="flex items-center justify-center gap-4 mt-3">
            <button onClick={() => setPrepareDialog({ sourceType: "quote" })} className="text-sm text-blue-400 hover:underline">Prepare from Quote</button>
            <button onClick={() => setBuilderState({ mode: "manual" })} className="text-sm text-blue-400 hover:underline">Create Manual Contract</button>
          </div>
        </div>
      )}

      {!loading && !error && pagedContracts.length > 0 && (
        <div className="overflow-x-auto border border-gray-800 rounded-xl">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-900/60 text-gray-400 text-xs uppercase">
              <tr>
                <th scope="col" className="px-4 py-3"><input type="checkbox" checked={selected.size === pagedContracts.length} onChange={toggleSelectAll} aria-label="Select all" /></th>
                <th scope="col" className="text-left px-4 py-3">Contract #</th>
                <th scope="col" className="text-left px-4 py-3">Company</th>
                {visibleColumns.includes("contact") && <th scope="col" className="text-left px-4 py-3">Contact</th>}
                {visibleColumns.includes("contractType") && <th scope="col" className="text-left px-4 py-3">Type</th>}
                {visibleColumns.includes("sourceQuote") && <th scope="col" className="text-left px-4 py-3">Source Quote</th>}
                {visibleColumns.includes("sourceOrder") && <th scope="col" className="text-left px-4 py-3">Source Order</th>}
                {visibleColumns.includes("total") && <th scope="col" className="text-left px-4 py-3 cursor-pointer" onClick={() => toggleSort("updatedAt")}>Total</th>}
                {visibleColumns.includes("currency") && <th scope="col" className="text-left px-4 py-3">Currency</th>}
                {visibleColumns.includes("status") && <th scope="col" className="text-left px-4 py-3">Status</th>}
                {visibleColumns.includes("renewalType") && <th scope="col" className="text-left px-4 py-3">Renewal</th>}
                {visibleColumns.includes("endDate") && <th scope="col" className="text-left px-4 py-3">End Date</th>}
                {visibleColumns.includes("team") && <th scope="col" className="text-left px-4 py-3">Team</th>}
                {visibleColumns.includes("owner") && <th scope="col" className="text-left px-4 py-3">Owner</th>}
                {visibleColumns.includes("updatedAt") && <th scope="col" className="text-left px-4 py-3 cursor-pointer" onClick={() => toggleSort("updatedAt")}>Last Updated {params.sort === "updatedAt" && (params.order === "asc" ? <ChevronUp size={12} className="inline" /> : <ChevronDown size={12} className="inline" />)}</th>}
                <th scope="col" className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedContracts.map((c) => {
                const effStatus = getEffectiveStatus(c);
                const totals = computeContractTotals(c);
                const sourceQuote = quoteById.get(c.sourceQuoteId);
                const sourceOrder = orderById.get(c.sourceOrderId);
                return (
                  <tr key={c._id} className="border-t border-gray-800 hover:bg-gray-900/30">
                    <td className="px-4 py-3"><input type="checkbox" checked={selected.has(c._id)} onChange={() => toggleSelect(c._id)} aria-label={`Select ${c.contractNumber}`} /></td>
                    <td className="px-4 py-3">
                      <Link to={`/sales/contracts/${c._id}`} className="text-blue-400 hover:underline font-medium">{c.contractNumber}</Link>
                      {hasIncompleteSignatory(c) && <AlertCircle size={13} className="inline ml-2 text-amber-400" aria-label="Incomplete signatory" />}
                    </td>
                    <td className="px-4 py-3 text-gray-300">{companyNameById.get(c.companyId) || "—"}</td>
                    {visibleColumns.includes("contact") && <td className="px-4 py-3 text-gray-400">{contactNameById.get(c.contactId) || "—"}</td>}
                    {visibleColumns.includes("contractType") && <td className="px-4 py-3 text-gray-400">{c.contractType}</td>}
                    {visibleColumns.includes("sourceQuote") && <td className="px-4 py-3 text-gray-400">{sourceQuote ? <Link to={`/sales/quotes/${sourceQuote._id}`} className="text-blue-400 hover:underline">{sourceQuote.quoteNumber}</Link> : "—"}</td>}
                    {visibleColumns.includes("sourceOrder") && <td className="px-4 py-3 text-gray-400">{sourceOrder ? <Link to={`/sales/orders/${sourceOrder._id}`} className="text-blue-400 hover:underline">{sourceOrder.orderNumber}</Link> : "—"}</td>}
                    {visibleColumns.includes("total") && <td className="px-4 py-3 text-gray-300">{formatMoney(totals.grandTotal, c.currency)}</td>}
                    {visibleColumns.includes("currency") && <td className="px-4 py-3 text-gray-400">{c.currency}</td>}
                    {visibleColumns.includes("status") && <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[11px] border ${CONTRACT_STATUS_COLORS[effStatus] || ""}`}>{effStatus}</span></td>}
                    {visibleColumns.includes("renewalType") && <td className="px-4 py-3 text-gray-400">{c.renewalType}</td>}
                    {visibleColumns.includes("endDate") && <td className="px-4 py-3 text-gray-400">{c.endDate ? formatDate(c.endDate) : "—"}{isRenewalDue(c) && <span className="ml-1 text-amber-400 text-[10px]">renewal due</span>}</td>}
                    {visibleColumns.includes("team") && <td className="px-4 py-3 text-gray-400">{c.assignedTeam}</td>}
                    {visibleColumns.includes("owner") && <td className="px-4 py-3 text-gray-400">{ownerName(c.ownerId)}</td>}
                    {visibleColumns.includes("updatedAt") && <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(c.updatedAt)}</td>}
                    <td className="px-4 py-3 relative">
                      <button aria-label={`Row actions for ${c.contractNumber}`} onClick={() => setOpenRowMenu(openRowMenu === c._id ? null : c._id)} className="text-gray-400 hover:text-white"><MoreHorizontal size={16} /></button>
                      {openRowMenu === c._id && (
                        <RowActionsMenu contract={c} onClose={() => setOpenRowMenu(null)} onEdit={() => setBuilderState({ mode: "edit", contract: c })} onDuplicate={() => setBuilderState({ mode: "duplicate", contract: c })} onArchive={() => setArchiveTarget(c)} onRestore={() => { dispatch(restoreContract(c._id)).then(() => dispatch(fetchContracts())); }} navigate={navigate} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > Number(params.pageSize) && (
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>Page {params.page} of {totalPages}</span>
          <div className="flex gap-2">
            <button disabled={Number(params.page) <= 1} onClick={() => applyFilter("page", String(Number(params.page) - 1))} className="p-1.5 rounded border border-gray-700 disabled:opacity-30"><ChevronLeft size={14} /></button>
            <button disabled={Number(params.page) >= totalPages} onClick={() => applyFilter("page", String(Number(params.page) + 1))} className="p-1.5 rounded border border-gray-700 disabled:opacity-30"><ChevronRight size={14} /></button>
          </div>
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
            <FilterSelect label="Status" value={params.status} onChange={(v) => applyFilter("status", v)} options={[...SETTABLE_STATUSES, "Archived"]} />
            <FilterSelect label="Contract type" value={params.contractType} onChange={(v) => applyFilter("contractType", v)} options={CONTRACT_TYPES} />
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={params.renewalDue === "true"} onChange={(e) => applyFilter("renewalDue", e.target.checked ? "true" : "")} /> Renewal due only
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={params.incompleteSignatory === "true"} onChange={(e) => applyFilter("incompleteSignatory", e.target.checked ? "true" : "")} /> Incomplete signatory only
            </label>
          </div>
        </div>
      )}

      {bulkAction === "assign" && (
        <BulkDialog title="Assign Owner" onClose={() => setBulkAction(null)} onConfirm={runBulkAssign} confirmDisabled={!bulkValue}>
          <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
            <option value="">Select owner</option>
            {CRM_TEAM.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </BulkDialog>
      )}
      {bulkAction === "archive" && (
        <BulkDialog title="Archive Contracts" onClose={() => setBulkAction(null)} onConfirm={runBulkArchive} confirmDisabled={!bulkReason.trim()}>
          <textarea value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} placeholder="Reason" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" rows={3} />
        </BulkDialog>
      )}

      {builderState && (
        <ContractBuilder mode={builderState.mode} contract={builderState.contract} onClose={() => setBuilderState(null)} onSaved={() => dispatch(fetchContracts())} />
      )}

      {archiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Archive Contract">
          <div className="absolute inset-0 bg-black/60" onClick={() => setArchiveTarget(null)} />
          <div className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-white mb-2">Archive "{archiveTarget.contractNumber}"</h3>
            <p className="text-sm text-gray-400 mb-3">Archiving is reversible. Provide a reason for the record.</p>
            <label htmlFor="contract-archive-reason" className="block text-xs text-gray-400 mb-1">Reason</label>
            <textarea id="contract-archive-reason" value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white mb-4" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setArchiveTarget(null)} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">Cancel</button>
              <button
                disabled={!archiveReason.trim()}
                onClick={() => { dispatch(archiveContract({ id: archiveTarget._id, reason: archiveReason })).then(() => { setArchiveTarget(null); setArchiveReason(""); dispatch(fetchContracts()); }); }}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-lg"
              >
                Archive
              </button>
            </div>
          </div>
        </div>
      )}

      {prepareDialog && (
        <PrepareContractDialog
          sourceType={prepareDialog.sourceType}
          preselectedId={prepareDialog.preselectedId}
          onClose={() => setPrepareDialog(null)}
          onUseSource={(id) => {
            setPrepareDialog(null);
            const mode = prepareDialog.sourceType === "quote" ? "fromQuote" : prepareDialog.sourceType === "order" ? "fromOrder" : "fromDeal";
            const key = prepareDialog.sourceType === "quote" ? "sourceQuoteId" : prepareDialog.sourceType === "order" ? "sourceOrderId" : "sourceDealId";
            setBuilderState({ mode, [key]: id });
          }}
        />
      )}
    </div>
  );
}

function MetricCard({ label, value, onClick }) {
  return (
    <button onClick={onClick} className="text-left bg-gray-900/40 border border-gray-800 rounded-xl p-3 hover:border-gray-700 transition">
      <div className="text-[11px] text-gray-500 uppercase">{label}</div>
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

function BulkDialog({ title, children, onClose, onConfirm, confirmDisabled }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[#12141c] border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-3">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        {children}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg">Cancel</button>
          <button onClick={onConfirm} disabled={confirmDisabled} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg">Confirm</button>
        </div>
      </div>
    </div>
  );
}

function RowActionsMenu({ contract, onClose, onEdit, onDuplicate, onArchive, onRestore, navigate }) {
  const canEdit = contract.status === "Draft" && !contract.archived;
  const canArchive = !contract.archived;
  const canRestore = contract.archived;
  return (
    <div role="menu" className="absolute right-4 mt-1 w-52 bg-[#12141c] border border-gray-800 rounded-xl shadow-xl z-20 py-1 text-sm">
      <button role="menuitem" onClick={() => { onClose(); navigate(`/sales/contracts/${contract._id}`); }} className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-800">View</button>
      {canEdit && <button role="menuitem" onClick={() => { onClose(); onEdit(); }} className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-800">Edit Draft</button>}
      <button role="menuitem" onClick={() => { onClose(); onDuplicate(); }} className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-800">Duplicate</button>
      {canArchive && <button role="menuitem" onClick={() => { onClose(); onArchive(); }} className="w-full text-left px-4 py-2 text-red-400 hover:bg-gray-800">Archive</button>}
      {canRestore && <button role="menuitem" onClick={() => { onClose(); onRestore(); }} className="w-full text-left px-4 py-2 text-gray-200 hover:bg-gray-800">Restore</button>}
    </div>
  );
}
