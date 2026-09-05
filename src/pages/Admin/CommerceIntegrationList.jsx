import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useSearchParams } from "react-router-dom";
import { RefreshCw, Pause, Play, AlertTriangle } from "lucide-react";
import {
  fetchOrganizations, fetchCommerceStores, pauseCommerceStore, previewCommerceStoreSyncRun,
  fetchCommerceCustomerMappings, fetchCommerceProductMappings, fetchCommerceOrders,
  previewCommerceOrderSyncRun, fetchCommerceReturns, selectIntegrations,
} from "../../redux/admin/integrationsSlice";
import { isSystemOwner, canManageCommerceStores, canSyncCommerceOrders } from "./commerceFinanceConfig";
import { findProvider } from "../../Helpers/mockIntegrationsData";
import { MAPPING_REVIEW_REQUIRED } from "../../Helpers/mockCommerceFinanceData";

const TABS = ["Stores", "Customers", "Products", "Orders", "Fulfilments", "Returns"];

function formatMoney(minor, currency) {
  if (minor == null) return "—";
  return `${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const CUSTOMER_STATE_COLOR = {
  Matched: "text-emerald-400", "Possible Match": "text-amber-300", "Multiple Matches": "text-amber-300",
  "No Match": "text-gray-400", "Restricted Match": "text-red-400", Conflict: "text-red-400", Ignored: "text-gray-500",
};

export default function CommerceIntegrationList() {
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();
  const role = useSelector((s) => s.auth.role);
  const {
    organizations, commerceStores, commerceCustomerMappings, commerceProductMappings,
    commerceOrders, commerceReturns, loading, error,
  } = useSelector(selectIntegrations);
  const owner = isSystemOwner(role);

  const [selectedOrgId, setSelectedOrgId] = useState("");
  const initialTab = TABS.map((t) => t.toLowerCase()).includes(searchParams.get("tab")) ? searchParams.get("tab") : "stores";
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => { dispatch(fetchOrganizations()); }, [dispatch]);

  useEffect(() => {
    const filters = owner ? (selectedOrgId ? { organizationId: selectedOrgId } : {}) : {};
    dispatch(fetchCommerceStores(filters));
    dispatch(fetchCommerceCustomerMappings(filters));
    dispatch(fetchCommerceProductMappings(filters));
    dispatch(fetchCommerceOrders(filters));
    dispatch(fetchCommerceReturns(filters));
  }, [dispatch, owner, selectedOrgId]);

  const orgLabel = useMemo(() => (owner ? null : organizations[0]?.name || "Your organization"), [owner, organizations]);
  const orderById = useMemo(() => Object.fromEntries(commerceOrders.map((o) => [o.id, o])), [commerceOrders]);

  const togglePause = (store) => dispatch(pauseCommerceStore({ storeId: store.id, paused: !store.paused }));
  const runStoreSync = (store) => dispatch(previewCommerceStoreSyncRun(store.id));
  const runOrderSync = (order) => dispatch(previewCommerceOrderSyncRun(order.id));

  return (
    <div className="p-4 md:p-6 space-y-5 text-white">
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>Administration</span> <span>/</span>{" "}
        <Link to="/admin/integrations/commerce-finance" className="hover:text-gray-300">Commerce & Finance</Link>{" "}
        <span>/</span> <span className="text-gray-300">Commerce</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">Commerce Integrations</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] border bg-blue-500/15 text-blue-300 border-blue-500/30">Frontend Preview</span>
          </div>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Stores, customer matching, Product mapping, Orders, fulfilments and returns — every record here links to a real Caspira Company,
            Contact, Product or Order. No independent duplicate is ever created.
          </p>
          {!owner && orgLabel && <p className="text-xs text-gray-500 mt-1">Organization: <span className="text-gray-300">{orgLabel}</span></p>}
        </div>
        {owner && (
          <select value={selectedOrgId} onChange={(e) => setSelectedOrgId(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" aria-label="Organization">
            <option value="">All organizations</option>
            {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-gray-800">
        {TABS.map((t) => (
          <button key={t} onClick={() => setActiveTab(t.toLowerCase())}
            className={`px-3 py-2 text-sm ${activeTab === t.toLowerCase() ? "text-white border-b-2 border-blue-500" : "text-gray-400"}`}>
            {t}
          </button>
        ))}
      </div>

      {loading && <div className="text-center text-gray-400 py-8 text-sm">Loading…</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && activeTab === "stores" && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Store</th>
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3">Region</th>
                <th className="px-4 py-3">Last Sync</th>
                <th className="px-4 py-3">Health</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {commerceStores.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500 text-xs">No stores are connected yet.</td></tr>
              ) : commerceStores.map((s) => (
                <tr key={s.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-gray-300">{findProvider(s.providerKey)?.name || s.providerKey}</td>
                  <td className="px-4 py-3 text-gray-300">{s.storeName}</td>
                  <td className="px-4 py-3 text-gray-300">{s.currency}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{s.region}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(s.lastPreviewSyncAt)}</td>
                  <td className="px-4 py-3 text-[11px]">{s.paused ? <span className="text-gray-500">Paused</span> : <span className="text-emerald-400">{s.health?.status}</span>}</td>
                  <td className="px-4 py-3 text-right">
                    {canManageCommerceStores(role) && (
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => runStoreSync(s)} title="Run preview synchronization" className="text-gray-400 hover:text-white"><RefreshCw size={15} /></button>
                        <button onClick={() => togglePause(s)} title={s.paused ? "Resume preview" : "Pause preview"} className="text-gray-400 hover:text-white">
                          {s.paused ? <Play size={15} /> : <Pause size={15} />}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeTab === "customers" && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Provider Customer</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Match State</th>
              </tr>
            </thead>
            <tbody>
              {commerceCustomerMappings.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500 text-xs">No customer mappings to preview yet.</td></tr>
              ) : commerceCustomerMappings.map((c) => (
                <tr key={c.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-gray-300">{findProvider(c.providerKey)?.name || c.providerKey}</td>
                  <td className="px-4 py-3 text-gray-300">{c.providerCustomerName}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{c.providerCustomerEmail}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] ${CUSTOMER_STATE_COLOR[c.state] || "text-gray-400"}`}>{c.state}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeTab === "products" && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">SKU / Variant</th>
                <th className="px-4 py-3">Provider Price</th>
                <th className="px-4 py-3">Inventory Policy</th>
                <th className="px-4 py-3">Mapping State</th>
                <th className="px-4 py-3">Conflict</th>
              </tr>
            </thead>
            <tbody>
              {commerceProductMappings.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500 text-xs">No Product mappings to preview yet.</td></tr>
              ) : commerceProductMappings.map((p) => (
                <tr key={p.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-gray-300">{findProvider(p.providerKey)?.name || p.providerKey}</td>
                  <td className="px-4 py-3 text-gray-300">{p.sku} <span className="text-[11px] text-gray-500">({p.variant})</span></td>
                  <td className="px-4 py-3 text-gray-300">{formatMoney(p.providerPriceMinor, p.currency)}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{p.inventoryPolicy}</td>
                  <td className="px-4 py-3">
                    <span className={p.mappingState === "Requires Review" ? "text-amber-300 text-[11px] flex items-center gap-1" : "text-emerald-400 text-[11px]"}>
                      {p.mappingState === "Requires Review" && <AlertTriangle size={12} />} {p.mappingState}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-amber-300">{p.conflictState || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeTab === "orders" && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">CRM Order</th>
                <th className="px-4 py-3">Sync</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {commerceOrders.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-500 text-xs">No Orders to preview yet.</td></tr>
              ) : commerceOrders.map((o) => (
                <tr key={o.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-gray-300">{findProvider(o.providerKey)?.name || o.providerKey}</td>
                  <td className="px-4 py-3 text-gray-300">{o.providerOrderId}</td>
                  <td className="px-4 py-3 text-gray-300">{formatMoney(o.totalMinor, o.currency)}</td>
                  <td className="px-4 py-3 text-[11px] text-gray-300">{o.canonicalStatus}</td>
                  <td className="px-4 py-3 text-[11px] text-gray-300">{o.paymentStatus}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{o.crmOrderId ? "Linked" : <Link to="/sales/orders" className="text-blue-400 hover:underline">Unlinked</Link>}</td>
                  <td className="px-4 py-3">
                    <span className={o.syncStatus === "Conflict" ? "text-amber-300 text-[11px]" : "text-emerald-400 text-[11px]"}>{o.syncStatus}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canSyncCommerceOrders(role) && (
                      <button onClick={() => runOrderSync(o)} title="Run preview synchronization" className="text-gray-400 hover:text-white"><RefreshCw size={15} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeTab === "fulfilments" && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Fulfilment Status</th>
              </tr>
            </thead>
            <tbody>
              {commerceOrders.length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-500 text-xs">No Orders to preview yet.</td></tr>
              ) : commerceOrders.map((o) => (
                <tr key={o.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-gray-300">{o.providerOrderId}</td>
                  <td className="px-4 py-3 text-gray-300">{findProvider(o.providerKey)?.name || o.providerKey}</td>
                  <td className="px-4 py-3 text-[11px] text-gray-300">{o.fulfilmentStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeTab === "returns" && (
        <div className="overflow-x-auto bg-gray-900/40 border border-gray-800 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b border-gray-800">
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Restocking</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {commerceReturns.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500 text-xs">No returns to preview yet.</td></tr>
              ) : commerceReturns.map((r) => (
                <tr key={r.id} className="border-b border-gray-800/60 last:border-0">
                  <td className="px-4 py-3 text-gray-300">{orderById[r.orderId]?.providerOrderId || r.orderId}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{r.reason}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{r.restockingStatus}</td>
                  <td className="px-4 py-3 text-[11px] text-emerald-400">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-gray-500">
        Unmapped provider values are always shown as <span className="text-amber-300">{MAPPING_REVIEW_REQUIRED}</span> — never a silent
        default.
      </p>
    </div>
  );
}
