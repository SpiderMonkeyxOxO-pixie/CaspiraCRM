import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  Pencil, Copy, ShoppingCart, Archive, RotateCcw, MoreHorizontal, ArrowLeft,
  FileText, Package, PlusCircle, TrendingUp, Paperclip, Shield, AlertTriangle,
} from "lucide-react";
import { fetchProduct, updateProduct, archiveProduct, restoreProduct } from "../../../redux/sales/productsSlice";
import { fetchDeals } from "../../../redux/crm/dealsSlice";
import { fetchCompanies } from "../../../redux/crm/companiesSlice";
import {
  activeDealsUsingItem, allDealsUsingItem, computeMarginPreview,
  needsAttentionReasons, CATALOG_STATUSES,
} from "../../../Helpers/mockCatalogData";
import { quotes } from "../../../Helpers/mockSalesData";
import { computeQuoteTotals, getEffectiveStatus as getQuoteEffectiveStatus } from "../../../Helpers/mockQuoteData";
import useFocusTrap from "../../../hooks/useFocusTrap";
import { formatMoney, formatPricingLabel, formatDate, formatDateTime, TYPE_COLORS, STATUS_COLORS } from "./catalogUtils";
import ProductFormModal from "./ProductFormModal";
import AddToDealModal from "./AddToDealModal";

const TABS = ["overview", "pricing", "package", "addons", "deals", "quotes", "files", "activity", "audit"];

export default function ProductDetail() {
  const { productId } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const role = useSelector((s) => s.auth.role);
  const item = useSelector((s) => s.products.current);
  const currentNotFound = useSelector((s) => s.products.currentNotFound);
  const catalogItems = useSelector((s) => s.products.items);
  const deals = useSelector((s) => s.deals.items);
  const companies = useSelector((s) => s.companies.items);
  const canViewCost = role === "Super-Admin" || role === "Admin";

  const [tab, setTab] = useState("overview");
  const [formOpen, setFormOpen] = useState(null); // "edit" | "duplicate"
  const [showAddToDeal, setShowAddToDeal] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [rowMenuOpen, setRowMenuOpen] = useState(false);

  useEffect(() => { dispatch(fetchProduct(productId)); dispatch(fetchDeals()); dispatch(fetchCompanies()); }, [dispatch, productId]);

  // Package Contents only makes sense for a Package — every other tab
  // applies to all four record types.
  const availableTabs = TABS.filter((t) => t !== "package" || item?.type === "Package");

  if (currentNotFound) {
    return (
      <div className="p-6 text-white">
        <button onClick={() => navigate("/sales/products")} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white mb-4"><ArrowLeft size={15} /> Back to Products & Services</button>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-10 text-center text-gray-400">
          <p className="mb-1">This catalog item couldn&apos;t be found.</p>
          <p className="text-sm text-gray-500">It may have been part of an earlier session — this in-memory catalog resets on a full page reload.</p>
        </div>
      </div>
    );
  }
  if (!item) {
    return (
      <div className="p-6 text-white">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-40 bg-gray-800 rounded" />
          <div className="h-8 w-72 bg-gray-800 rounded" />
          <div className="h-32 bg-gray-900/40 border border-gray-800 rounded-xl" />
        </div>
      </div>
    );
  }

  const attention = needsAttentionReasons(item);
  const margin = canViewCost ? computeMarginPreview(item.standardPrice, item.costPreview) : null;

  return (
    <div className="p-6 text-white">
      <nav className="text-xs text-gray-500 mb-2" aria-label="Breadcrumb">
        <Link to="/sales/dashboard" className="hover:text-gray-300">Sales</Link> / <Link to="/sales/products" className="hover:text-gray-300">Products & Services</Link> / <span className="text-gray-300">{item.name}</span>
      </nav>

      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h1 className="text-2xl font-bold">{item.name}</h1>
            <span className={`px-2 py-1 rounded-full text-xs border ${TYPE_COLORS[item.type]}`}>{item.type}</span>
            <span className={`px-2 py-1 rounded-full text-xs border ${STATUS_COLORS[item.status]}`}>{item.status}</span>
            {attention.length > 0 && (
              <span title={attention.join(", ")} className="flex items-center gap-1 text-xs text-amber-400"><AlertTriangle size={13} /> Needs attention</span>
            )}
          </div>
          <p className="text-sm text-gray-400">
            {item.sku || "No SKU"} · {item.category || "Uncategorized"} · {formatPricingLabel(item)} · Owner: {item.ownerName || "Unassigned"} · Updated {formatDate(item.updatedAt)}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFormOpen("edit")} className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-medium"><Pencil size={15} /> Edit</button>
          <button onClick={() => setShowAddToDeal(true)} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><ShoppingCart size={15} /> Add to Deal</button>
          <button onClick={() => setFormOpen("duplicate")} className="flex items-center gap-2 border border-gray-700 hover:bg-gray-800 px-3 py-2 rounded-lg text-sm"><Copy size={15} /> Duplicate</button>
          <div className="relative">
            <button onClick={() => setRowMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={rowMenuOpen} aria-label="More actions" className="p-2 rounded-lg border border-gray-700 hover:bg-gray-800"><MoreHorizontal size={16} /></button>
            {rowMenuOpen && (
              <div role="menu" className="absolute right-0 mt-1 bg-gray-900 border border-gray-800 rounded-lg py-1 z-20 w-48 shadow-xl">
                <button role="menuitem" onClick={() => { setShowStatus(true); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800">Change Status</button>
                {item.status === "Archived" ? (
                  <button role="menuitem" onClick={() => { dispatch(restoreProduct(item._id)); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 flex items-center gap-1.5"><RotateCcw size={13} /> Restore</button>
                ) : (
                  <button role="menuitem" onClick={() => { setShowArchive(true); setRowMenuOpen(false); }} className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-800 flex items-center gap-1.5 text-red-300"><Archive size={13} /> Archive</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <nav className="flex gap-1 border-b border-gray-800 mb-4 overflow-x-auto" aria-label="Catalog item detail tabs">
        {availableTabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-current={tab === t ? "page" : undefined}
            className={`px-3 py-2 text-sm whitespace-nowrap rounded-t-lg ${tab === t ? "text-blue-400 border-b-2 border-blue-400 font-medium" : "text-gray-400 hover:text-gray-200"}`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </nav>

      {tab === "overview" && <OverviewTab item={item} />}
      {tab === "pricing" && <PricingTab item={item} margin={margin} canViewCost={canViewCost} />}
      {tab === "package" && item.type === "Package" && <PackageTab item={item} catalogItems={catalogItems} onEdit={() => setFormOpen("edit")} />}
      {tab === "addons" && <AddonsTab item={item} catalogItems={catalogItems} />}
      {tab === "deals" && <RelatedDealsTab item={item} deals={deals} companies={companies} />}
      {tab === "quotes" && <QuotesTab item={item} companies={companies} />}
      {tab === "files" && <FilesTab item={item} />}
      {tab === "activity" && <ActivityTab activity={item.activity || []} />}
      {tab === "audit" && <AuditTab auditLog={item.auditLog || []} />}

      {formOpen && (
        <ProductFormModal
          mode={formOpen}
          item={item}
          onClose={() => setFormOpen(null)}
          onSaved={() => dispatch(fetchProduct(productId))}
        />
      )}
      {showAddToDeal && <AddToDealModal item={item} onClose={() => setShowAddToDeal(false)} />}
      {showArchive && <ArchiveDetailDialog item={item} onClose={() => setShowArchive(false)} onDone={() => { setShowArchive(false); dispatch(fetchProduct(productId)); }} />}
      {showStatus && <StatusDetailDialog item={item} onClose={() => setShowStatus(false)} onDone={() => { setShowStatus(false); dispatch(fetchProduct(productId)); }} />}
    </div>
  );
}

const TAB_LABELS = {
  overview: "Overview", pricing: "Pricing", package: "Package Contents", addons: "Compatible Add-ons",
  deals: "Related Deals", quotes: "Quote Preview", files: "Files", activity: "Activity", audit: "Audit",
};

function EmptyPanel({ icon, text }) {
  const Icon = icon;
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-10 text-center text-gray-500">
      <Icon size={22} className="mx-auto mb-2 text-gray-600" />
      <p className="text-sm">{text}</p>
    </div>
  );
}

function OverviewTab({ item }) {
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Description</h3>
          <p className="text-sm text-gray-300 mb-2">{item.shortDescription || "—"}</p>
          <p className="text-sm text-gray-400 whitespace-pre-wrap">{item.description || "No full description provided."}</p>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Commercial configuration</h3>
          <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label="Billing Model" value={item.billingModel} />
            <Field label="Unit" value={item.unit} />
            <Field label="Discount Eligible" value={item.discountEligible ? "Yes" : "No"} />
            <Field label="Tax Category" value={item.taxCategory} />
          </dl>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Quantity rules</h3>
          <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label="Minimum Quantity" value={item.minQuantity} />
            <Field label="Maximum Quantity" value={item.maxQuantity ?? "No maximum"} />
          </dl>
        </div>
      </div>
      <div className="space-y-4">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Availability</h3>
          <dl className="space-y-2 text-sm">
            <Field label="Status" value={item.status} />
            <Field label="Effective" value={formatDate(item.effectiveDate)} />
            <Field label="Expiration" value={formatDate(item.expirationDate)} />
          </dl>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Owner & tags</h3>
          <dl className="space-y-2 text-sm">
            <Field label="Owner" value={item.ownerName || "Unassigned"} />
            <Field label="Tags" value={(item.tags || []).join(", ") || "—"} />
          </dl>
        </div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">Record</h3>
          <dl className="space-y-2 text-sm">
            <Field label="Created" value={formatDateTime(item.createdAt)} />
            <Field label="Updated" value={formatDateTime(item.updatedAt)} />
          </dl>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-gray-200">{value ?? "—"}</dd>
    </div>
  );
}

function PricingTab({ item, margin, canViewCost }) {
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold">Standard pricing</h3>
        <p className="text-2xl font-bold">{formatPricingLabel(item)}</p>
        {item.alternativePrices?.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Also priced in</p>
            <ul className="text-sm text-gray-300 space-y-0.5">
              {item.alternativePrices.map((p) => <li key={p.currency}>{formatMoney(p.price, p.currency)}</li>)}
            </ul>
          </div>
        )}
        {item.tieredPricing?.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Tiered pricing preview</p>
            <table className="w-full text-sm">
              <thead className="text-gray-500 text-left"><tr><th className="font-medium">Quantity</th><th className="font-medium">Price</th></tr></thead>
              <tbody>
                {item.tieredPricing.map((t, i) => (
                  <tr key={i} className="border-t border-gray-800">
                    <td className="py-1">{t.minQty}{t.maxQty ? `–${t.maxQty}` : "+"}</td>
                    <td className="py-1">{formatMoney(t.price, item.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {item.promotionalPrice != null && (
          <div className="bg-emerald-900/15 border border-emerald-800/30 rounded-lg p-3 text-sm text-emerald-200">
            Promotional price {formatMoney(item.promotionalPrice, item.currency)} until {formatDate(item.promotionalUntil)}
          </div>
        )}
        {item.upcomingPriceChange && (
          <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-sm text-amber-200">
            Price scheduled to change to {formatMoney(item.upcomingPriceChange.newPrice, item.currency)} on {formatDate(item.upcomingPriceChange.effectiveDate)}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {item.billingModel === "Recurring" && item.recurringConfig && (
          <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-2">Recurring configuration</h3>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Field label="Billing Interval" value={item.billingInterval} />
              <Field label="Setup Fee" value={formatMoney(item.recurringConfig.setupFee, item.currency)} />
              <Field label="Minimum Commitment" value={item.recurringConfig.minimumCommitmentMonths ? `${item.recurringConfig.minimumCommitmentMonths} months` : "None"} />
              <Field label="Renewal Behavior" value={item.recurringConfig.renewalBehavior} />
            </dl>
          </div>
        )}
        {item.billingModel === "Usage Based" && item.usageConfig && (
          <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-2">Usage pricing</h3>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Field label="Billing Unit" value={item.usageConfig.billingUnit} />
              <Field label="Unit Price" value={formatMoney(item.usageConfig.unitPrice, item.currency)} />
              <Field label="Included Usage" value={item.usageConfig.includedUsage} />
              <Field label="Overage Price" value={formatMoney(item.usageConfig.overagePrice, item.currency)} />
            </dl>
          </div>
        )}
        {canViewCost && (
          <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-2">Margin preview</h3>
            {margin ? (
              <>
                <p className="text-sm text-gray-300">Cost: {formatMoney(item.costPreview, item.currency)}</p>
                <p className="text-lg font-semibold">{formatMoney(margin.marginAmount, item.currency)} <span className="text-sm text-gray-400">({margin.marginPercent.toFixed(1)}%)</span></p>
                <p className="text-[11px] text-gray-500 mt-1">Catalog estimate only — not confirmed profit.</p>
              </>
            ) : (
              <p className="text-sm text-gray-500">No cost preview available for this item.</p>
            )}
          </div>
        )}
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-1">Price Books</h3>
          <p className="text-sm text-gray-500">Region- and segment-specific Price Book overrides will appear here once /sales/price-books is built. This item currently uses its standard catalog price everywhere.</p>
        </div>
      </div>
    </div>
  );
}

function PackageTab({ item, catalogItems }) {
  const byId = new Map(catalogItems.map((c) => [c._id, c]));
  const rows = [...(item.includedItems || [])].sort((a, b) => a.order - b.order);
  if (rows.length === 0) return <EmptyPanel icon={Package} text="This Package has no items configured yet." />;
  const packagePrice = item.standardPrice || 0;
  const individualTotal = rows.reduce((sum, r) => {
    const c = byId.get(r.itemId);
    return sum + (c?.standardPrice || 0) * (r.quantity || 1);
  }, 0);
  const savings = individualTotal - packagePrice;
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3"><p className="text-xs text-gray-400 uppercase mb-1">Package Price</p><p className="text-xl font-bold">{formatMoney(packagePrice, item.currency)}</p></div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3"><p className="text-xs text-gray-400 uppercase mb-1">Individual Total</p><p className="text-xl font-bold">{formatMoney(individualTotal, item.currency)}</p></div>
        <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-3"><p className="text-xs text-gray-400 uppercase mb-1">Estimated Savings</p><p className={`text-xl font-bold ${savings > 0 ? "text-emerald-400" : ""}`}>{formatMoney(Math.max(savings, 0), item.currency)}</p></div>
      </div>
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
            <th className="px-4 py-3 font-medium">Order</th><th className="px-4 py-3 font-medium">Item</th><th className="px-4 py-3 font-medium">Quantity</th>
            <th className="px-4 py-3 font-medium">Included/Optional</th><th className="px-4 py-3 font-medium">Price Treatment</th><th className="px-4 py-3 font-medium text-right">Individual Price</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const c = byId.get(r.itemId);
              return (
                <tr key={r.itemId} className="border-t border-gray-800">
                  <td className="px-4 py-3 text-gray-400">{r.order}</td>
                  <td className="px-4 py-3 font-medium">{c ? <Link to={`/sales/products/${c._id}`} className="text-blue-400 hover:underline">{c.name}</Link> : "Item removed from catalog"}</td>
                  <td className="px-4 py-3 text-gray-300">{r.quantity}</td>
                  <td className="px-4 py-3 text-gray-300">{r.included ? "Included" : "Optional"}</td>
                  <td className="px-4 py-3 text-gray-300">{r.priceTreatment}</td>
                  <td className="px-4 py-3 text-gray-300 text-right">{c ? formatMoney(c.standardPrice, c.currency) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-800">Reorder, add or remove items from the Edit form.</p>
      </div>
    </div>
  );
}

function AddonsTab({ item, catalogItems }) {
  const addons = catalogItems.filter((c) => c.type === "Add-on" && (c.compatibleParentIds || []).includes(item._id));
  if (addons.length === 0) return <EmptyPanel icon={PlusCircle} text="No compatible Add-ons configured for this item." />;
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
          <th className="px-4 py-3 font-medium">Add-on</th><th className="px-4 py-3 font-medium">Price</th>
          <th className="px-4 py-3 font-medium">Billing Model</th><th className="px-4 py-3 font-medium">Compatibility</th><th className="px-4 py-3 font-medium">Status</th>
        </tr></thead>
        <tbody>
          {addons.map((a) => (
            <tr key={a._id} className="border-t border-gray-800">
              <td className="px-4 py-3 font-medium"><Link to={`/sales/products/${a._id}`} className="text-blue-400 hover:underline">{a.name}</Link></td>
              <td className="px-4 py-3 text-gray-300">{formatPricingLabel(a)}</td>
              <td className="px-4 py-3 text-gray-300">{a.billingModel}</td>
              <td className="px-4 py-3 text-gray-300">Compatible</td>
              <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs border ${STATUS_COLORS[a.status]}`}>{a.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RelatedDealsTab({ item, deals, companies }) {
  const related = allDealsUsingItem(item._id).length ? deals.filter((d) => (d.lineItems || []).some((li) => li.productId === item._id)) : [];
  const companyNameById = new Map(companies.map((c) => [c._id, c.name]));
  if (related.length === 0) return <EmptyPanel icon={TrendingUp} text="No Deals currently reference this catalog item." />;
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
          <th className="px-4 py-3 font-medium">Deal</th><th className="px-4 py-3 font-medium">Company</th><th className="px-4 py-3 font-medium">Stage</th>
          <th className="px-4 py-3 font-medium">Quantity</th><th className="px-4 py-3 font-medium">Deal Price</th><th className="px-4 py-3 font-medium">Discount</th>
          <th className="px-4 py-3 font-medium">Total</th><th className="px-4 py-3 font-medium">Owner</th>
        </tr></thead>
        <tbody>
          {related.map((d) => {
            const lines = (d.lineItems || []).filter((li) => li.productId === item._id);
            const qty = lines.reduce((s, li) => s + (li.quantity || 0), 0);
            const total = lines.reduce((s, li) => s + (li.lineTotal ?? li.quantity * li.unitPrice), 0);
            const avgDiscount = lines.length ? lines.reduce((s, li) => s + (li.discountPercent || 0), 0) / lines.length : 0;
            return (
              <tr key={d._id} className="border-t border-gray-800">
                <td className="px-4 py-3 font-medium"><Link to={`/crm/deals/${d._id}`} className="text-blue-400 hover:underline">{d.name}</Link></td>
                <td className="px-4 py-3 text-gray-300">{companyNameById.get(d.companyId) || "—"}</td>
                <td className="px-4 py-3 text-gray-300">{d.stage}</td>
                <td className="px-4 py-3 text-gray-300">{qty}</td>
                <td className="px-4 py-3 text-gray-300">{formatMoney(lines[0]?.unitPrice, d.currency)}</td>
                <td className="px-4 py-3 text-gray-300">{avgDiscount ? `${avgDiscount.toFixed(0)}%` : "—"}</td>
                <td className="px-4 py-3 text-gray-300">{formatMoney(total, d.currency)}</td>
                <td className="px-4 py-3 text-gray-300">{d.ownerName || "Unassigned"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-800">Uses the same shared Deal frontend state as the CRM Deals routes.</p>
    </div>
  );
}

function QuotesTab({ item, companies }) {
  const companyNameById = new Map(companies.map((c) => [c._id, c.name]));
  const related = quotes.filter((q) => (q.lineItems || []).some((li) => li.catalogItemId === item._id));
  if (related.length === 0) {
    return <EmptyPanel icon={FileText} text="No Quotes currently reference this catalog item." />;
  }
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-left"><tr><th className="px-4 py-3 font-medium">Quote</th><th className="px-4 py-3 font-medium">Company</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Total</th></tr></thead>
        <tbody>
          {related.map((q) => (
            <tr key={q._id} className="border-t border-gray-800">
              <td className="px-4 py-3 font-medium"><Link to={`/sales/quotes/${q._id}`} className="text-blue-400 hover:underline">{q.quoteNumber} (v{q.version})</Link></td>
              <td className="px-4 py-3 text-gray-300">{companyNameById.get(q.companyId) || "—"}</td>
              <td className="px-4 py-3 text-gray-300">{getQuoteEffectiveStatus(q)}</td>
              <td className="px-4 py-3 text-gray-300">{formatMoney(computeQuoteTotals(q).grandTotal, q.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-800">Uses the same shared Quote frontend state as the Sales Quotes routes.</p>
    </div>
  );
}

function FilesTab({ item }) {
  const files = item.files || [];
  if (files.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyPanel icon={Paperclip} text="No documents, specifications, service descriptions or pricing attachments yet." />
        <div className="border-2 border-dashed border-gray-700 rounded-xl p-6 text-center text-gray-500 text-sm">Drag and drop a file here, or browse (upload preview only)</div>
      </div>
    );
  }
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl divide-y divide-gray-800">
      {files.map((f) => (
        <div key={f._id} className="flex items-center justify-between p-3 text-sm">
          <span>{f.name}</span>
          <span className="text-gray-500 text-xs">{formatDate(f.uploadedAt)}</span>
        </div>
      ))}
    </div>
  );
}

function ActivityTab({ activity }) {
  if (activity.length === 0) return <EmptyPanel icon={Shield} text="No activity recorded yet." />;
  return (
    <ul className="space-y-2">
      {[...activity].reverse().map((a) => (
        <li key={a._id} className="bg-gray-900/40 border border-gray-800 rounded-xl p-3 text-sm flex justify-between">
          <span>{a.description}</span>
          <span className="text-gray-500 text-xs">{formatDateTime(a.at)} · {a.actor}</span>
        </li>
      ))}
    </ul>
  );
}

function AuditTab({ auditLog }) {
  if (auditLog.length === 0) return <EmptyPanel icon={Shield} text="No audit events yet." />;
  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded-xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-900/60 text-gray-400 text-left"><tr>
          <th className="px-4 py-3 font-medium">Actor</th><th className="px-4 py-3 font-medium">Action</th>
          <th className="px-4 py-3 font-medium">Field</th><th className="px-4 py-3 font-medium">Previous</th>
          <th className="px-4 py-3 font-medium">New</th><th className="px-4 py-3 font-medium">Time</th><th className="px-4 py-3 font-medium">Reason</th>
        </tr></thead>
        <tbody>
          {[...auditLog].reverse().map((e) => (
            <tr key={e._id} className="border-t border-gray-800">
              <td className="px-4 py-3 text-gray-300">{e.actor}</td>
              <td className="px-4 py-3 text-gray-300 capitalize">{e.action}</td>
              <td className="px-4 py-3 text-gray-300">{e.field || "—"}</td>
              <td className="px-4 py-3 text-gray-400">{String(e.before ?? "—")}</td>
              <td className="px-4 py-3 text-gray-300">{String(e.after ?? "—")}</td>
              <td className="px-4 py-3 text-gray-500">{formatDateTime(e.at)}</td>
              <td className="px-4 py-3 text-amber-300">{e.reason || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-800">Visual preview only — backend audit integration is a later phase.</p>
    </div>
  );
}

function ArchiveDetailDialog({ item, onClose, onDone }) {
  const dispatch = useDispatch();
  const [reason, setReason] = useState("");
  const containerRef = useFocusTrap(true, onClose);
  const activeDeals = activeDealsUsingItem(item._id);
  const submit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) return;
    await dispatch(archiveProduct({ id: item._id, reason }));
    onDone();
  };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Archive catalog item" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Archive &quot;{item.name}&quot;</h2>
        <p className="text-sm text-gray-400">Moves this item to the Archived view and prevents new Deal line items from selecting it. Existing Deal relationships are preserved.</p>
        {activeDeals.length > 0 && (
          <div className="bg-amber-900/15 border border-amber-800/30 rounded-lg p-3 text-xs text-amber-200">{activeDeals.length} active Deal{activeDeals.length === 1 ? "" : "s"} reference this item.</div>
        )}
        <textarea autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (required)" className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" disabled={!reason.trim()} className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-800 disabled:opacity-50 text-sm font-medium">Archive</button>
        </div>
      </form>
    </div>
  );
}

function StatusDetailDialog({ item, onClose, onDone }) {
  const dispatch = useDispatch();
  const [status, setStatus] = useState(item.status);
  const containerRef = useFocusTrap(true, onClose);
  const submit = async (e) => {
    e.preventDefault();
    await dispatch(updateProduct({ id: item._id, changes: { status } }));
    onDone();
  };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form ref={containerRef} role="dialog" aria-modal="true" aria-label="Change status" onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-lg font-bold">Change Status</h2>
        <select autoFocus value={status} onChange={(e) => setStatus(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
          {CATALOG_STATUSES.filter((s) => s !== "Archived").map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-700 text-sm">Cancel</button>
          <button type="submit" className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-sm font-medium">Save</button>
        </div>
      </form>
    </div>
  );
}
