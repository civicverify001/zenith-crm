import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  getProducts,
  createProduct,
  updateProduct,
  deactivateProduct,
  reactivateProduct,
  canViewProcurementFields,
  canEditProcurementFields,
  CATEGORY_LABELS,
  BUYOUT_LABELS,
  Product,
  ProductInsert,
  ProductUpdate,
} from '../../services/productService';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
}

const EMPTY_FORM: ProductInsert = {
  name: '',
  sku: '',
  category: 'ro',
  description: '',
  retail_price: null,
  rental_price_monthly: null,
  install_fee: 0,
  maintenance_price_monthly: null,
  filter_interval_months: null,
  buyout_formula: 'retail_minus_payments',
  warranty_months: 12,
  requires_survey_type: null,
  is_active: true,
  vendor_sku: null,
  vendor_cost: null,
  vendor_id: null,
  subcategory: null,
  min_sell_price: null,
  vendor_name: null,
  vendor_description: null,
  parts_warranty: null,
  labour_warranty: null,
};

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  ro:                 { bg: 'rgba(6,182,212,0.15)',   text: '#22d3ee', border: 'rgba(6,182,212,0.3)' },
  softener:           { bg: 'rgba(59,130,246,0.15)',  text: '#60a5fa', border: 'rgba(59,130,246,0.3)' },
  whole_home_filter:  { bg: 'rgba(167,139,250,0.15)', text: '#a78bfa', border: 'rgba(167,139,250,0.3)' },
  replacement_filter: { bg: 'rgba(251,191,36,0.15)',  text: '#fbbf24', border: 'rgba(251,191,36,0.3)' },
  accessory:          { bg: 'rgba(148,163,184,0.15)', text: '#cbd5e1', border: 'rgba(148,163,184,0.3)' },
  uv:                 { bg: 'rgba(52,211,153,0.15)',  text: '#34d399', border: 'rgba(52,211,153,0.3)' },
  iron_filter:        { bg: 'rgba(251,146,60,0.15)',  text: '#fb923c', border: 'rgba(251,146,60,0.3)' },
  pfas:               { bg: 'rgba(244,114,182,0.15)', text: '#f472b6', border: 'rgba(244,114,182,0.3)' },
  salt_free:          { bg: 'rgba(34,197,94,0.15)',   text: '#4ade80', border: 'rgba(34,197,94,0.3)' },
  lead_filter:        { bg: 'rgba(239,68,68,0.15)',   text: '#f87171', border: 'rgba(239,68,68,0.3)' },
  well_water:         { bg: 'rgba(217,119,6,0.15)',   text: '#fbbf24', border: 'rgba(217,119,6,0.3)' },
};

const DEFAULT_CAT_COLOR = { bg: 'rgba(148,163,184,0.15)', text: '#cbd5e1', border: 'rgba(148,163,184,0.3)' };

const ALL_CATEGORY_LABELS: Record<string, string> = {
  ro:                 'Reverse Osmosis',
  softener:           'Water Softener',
  whole_home_filter:  'Whole Home Filter',
  replacement_filter: 'Replacement Filter',
  accessory:          'Accessory',
  uv:                 'UV Sterilization',
  iron_filter:        'Iron Filter',
  pfas:               'PFAS Filter',
  salt_free:          'Salt-Free',
  lead_filter:        'Lead Filter',
  well_water:         'Well Water',
};

const CATEGORY_TABS: {
  key: string; label: string; icon: string;
  color: string; bg: string; border: string;
}[] = [
  { key: 'all',                label: 'All',         icon: '◈', color: '#e2e8f0', bg: 'rgba(226,232,240,0.1)',  border: 'rgba(226,232,240,0.2)' },
  { key: 'ro',                 label: 'RO',          icon: '💧', color: '#22d3ee', bg: 'rgba(6,182,212,0.1)',   border: 'rgba(6,182,212,0.25)' },
  { key: 'softener',           label: 'Softener',    icon: '🔵', color: '#60a5fa', bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.25)' },
  { key: 'whole_home_filter',  label: 'Whole Home',  icon: '🏠', color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)' },
  { key: 'salt_free',          label: 'Salt-Free',   icon: '💚', color: '#4ade80', bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.25)' },
  { key: 'well_water',         label: 'Well Water',  icon: '🌊', color: '#fbbf24', bg: 'rgba(217,119,6,0.1)',   border: 'rgba(217,119,6,0.25)' },
  { key: 'uv',                 label: 'UV',          icon: '☀️', color: '#34d399', bg: 'rgba(52,211,153,0.1)',  border: 'rgba(52,211,153,0.25)' },
  { key: 'pfas',               label: 'PFAS',        icon: '🛡️', color: '#f472b6', bg: 'rgba(244,114,182,0.1)', border: 'rgba(244,114,182,0.25)' },
  { key: 'lead_filter',        label: 'Lead',        icon: '⚠️', color: '#f87171', bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.25)' },
  { key: 'replacement_filter', label: 'Filters',     icon: '🔄', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.25)' },
  { key: 'accessory',          label: 'Accessory',   icon: '🔧', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.25)' },
];

function fmt(val: number | null): string {
  if (val === null || val === undefined) return '—';
  return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function WarrantyBadge({ value, icon }: { value: string | null | undefined; icon: string }) {
  if (!value) return <span style={{ color: '#334155' }}>—</span>;
  const isMfr = value.toLowerCase().includes('manufacturer');
  const color = isMfr ? '#34d399' : '#38bdf8';
  return (
    <span style={{
      fontSize: 10, padding: '2px 7px', borderRadius: 20, fontWeight: 700,
      background: `${color}15`, border: `1px solid ${color}35`, color,
      whiteSpace: 'nowrap',
    }}>
      {icon} {value}
    </span>
  );
}

export default function ProductCatalog() {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const role = profile?.role ?? null;
  const showProcurement = canViewProcurementFields(role);
  const canEditProcurement = canEditProcurementFields(role);

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductInsert>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => { loadProducts(); }, [filterCategory, showInactive, role]);

  async function loadProducts() {
    setLoading(true);
    try {
      const data = await getProducts(
        { activeOnly: !showInactive, category: filterCategory === 'all' ? undefined : filterCategory },
        role === 'admin'
      );
      setProducts(data);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }

  function openAddForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
    setError(null);
  }

  function openEditForm(product: Product) {
    setForm({
      name: product.name,
      sku: product.sku || '',
      category: product.category,
      description: product.description || '',
      retail_price: product.retail_price,
      rental_price_monthly: product.rental_price_monthly,
      install_fee: product.install_fee,
      maintenance_price_monthly: product.maintenance_price_monthly,
      filter_interval_months: product.filter_interval_months,
      buyout_formula: product.buyout_formula,
      warranty_months: product.warranty_months,
      requires_survey_type: product.requires_survey_type,
      is_active: product.is_active,
      vendor_sku:  product.vendor_sku  ?? null,
      vendor_cost: product.vendor_cost ?? null,
      vendor_id:   product.vendor_id   ?? null,
      subcategory:        (product as any).subcategory        ?? null,
      min_sell_price:     (product as any).min_sell_price     ?? null,
      vendor_name:        (product as any).vendor_name        ?? null,
      vendor_description: (product as any).vendor_description ?? null,
      parts_warranty:     (product as any).parts_warranty     ?? null,
      labour_warranty:    (product as any).labour_warranty    ?? null,
    });
    setEditingId(product.id);
    setShowForm(true);
    setError(null);
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Product name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const payload: ProductUpdate = { ...form };
      if (!canEditProcurement) {
        delete payload.vendor_sku;
        delete payload.vendor_cost;
        delete payload.vendor_id;
        delete (payload as any).vendor_name;
        delete (payload as any).vendor_description;
        delete (payload as any).min_sell_price;
      }
      if (editingId) { await updateProduct(editingId, payload); }
      else { await createProduct(payload as ProductInsert); }
      setShowForm(false);
      setEditingId(null);
      await loadProducts();
    } catch (err: any) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function handleToggleActive(product: Product) {
    try {
      if (product.is_active) await deactivateProduct(product.id);
      else await reactivateProduct(product.id);
      await loadProducts();
    } catch (err: any) { setError(err.message); }
  }

  function updateField(field: string, value: any) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  const activeCount = products.filter(p => p.is_active).length;
  const categories = [...new Set(products.map(p => p.category))].length;

  const filteredProducts = products.filter(p => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.sku && p.sku.toLowerCase().includes(q)) ||
      (showProcurement && p.vendor_sku && p.vendor_sku.toLowerCase().includes(q)) ||
      (p.description && p.description.toLowerCase().includes(q)) ||
      ((p as any).subcategory && (p as any).subcategory.toLowerCase().includes(q))
    );
  });

  return (
    <div style={{ background: '#0f1923', minHeight: '100vh', color: '#e2e8f0', display: 'flex', flexDirection: 'column' }}>

      {/* Top bar */}
      <div style={{ background: '#162232', borderBottom: '1px solid #1e3a4f', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 20, color: '#e2e8f0', lineHeight: 1.2 }}>Product Catalog</div>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
            {products.length} product{products.length !== 1 ? 's' : ''} · Prices feed quotes, contracts, and billing.
          </div>
        </div>
        {!isMobile && (
          <input
            placeholder="Search name, SKU, subcategory…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '9px 14px', fontSize: 13, outline: 'none', width: 240 }}
          />
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} style={{ accentColor: '#0d7ea3' }} />
          <span style={{ fontSize: 13, color: '#94a3b8' }}>Inactive</span>
        </label>
        {role === 'admin' && (
          <button onClick={openAddForm} style={{ padding: '10px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap' }}>
            + Add Product
          </button>
        )}
      </div>

      {isMobile && (
        <div style={{ padding: '10px 16px', background: '#0f1923', borderBottom: '1px solid #1e3a4f' }}>
          <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' }} />
        </div>
      )}

      {/* Category tabs */}
      <div style={{ background: '#0c1a26', borderBottom: '1px solid #1e3a4f', padding: '10px 16px', display: 'flex', gap: 6, overflowX: 'auto' }}>
        {CATEGORY_TABS.map(f => {
          const count = f.key === 'all' ? products.length : products.filter(p => p.category === f.key).length;
          const isActive = filterCategory === f.key;
          if (f.key !== 'all' && count === 0) return null;
          return (
            <button key={f.key} onClick={() => setFilterCategory(f.key)} style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
              padding: isMobile ? '8px 10px' : '9px 12px', borderRadius: 10,
              border: `1px solid ${isActive ? f.color + '60' : f.border}`,
              background: isActive ? f.bg : 'rgba(255,255,255,0.02)',
              color: isActive ? f.color : '#475569', cursor: 'pointer',
              fontSize: isMobile ? 12 : 12, fontWeight: isActive ? 700 : 500,
              boxShadow: isActive ? `0 0 14px ${f.color}20` : 'none', whiteSpace: 'nowrap',
            }}>
              <span>{f.icon}</span>
              {!isMobile && <span>{f.label}</span>}
              <span style={{ background: isActive ? f.color + '30' : 'rgba(255,255,255,0.06)', color: isActive ? f.color : '#64748b', borderRadius: 20, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderBottom: '1px solid #1e3a4f', background: '#0f1923', overflowX: 'auto' }}>
        {[
          { label: 'Showing',    val: String(filteredProducts.length), color: '#94a3b8' },
          { label: 'Active',     val: String(activeCount),             color: '#4ade80' },
          { label: 'Categories', val: String(categories),              color: '#a78bfa' },
        ].map(s => (
          <div key={s.label} style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 10, padding: '8px 14px', flexShrink: 0, minWidth: 90 }}>
            <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
            <div style={{ color: s.color, fontWeight: 800, fontSize: 18, marginTop: 2 }}>{s.val}</div>
          </div>
        ))}
      </div>

      {error && !showForm && (
        <div style={{ margin: '12px 16px 0', padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '12px' : '16px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Loading products…</div>
        ) : filteredProducts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
            <div style={{ color: '#64748b', fontSize: 15 }}>{search ? 'No products matching your search' : 'No products found'}</div>
            {!search && role === 'admin' && <button onClick={openAddForm} style={{ marginTop: 16, padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#0d7ea3', color: '#fff', fontWeight: 700 }}>Add First Product</button>}
          </div>
        ) : isMobile ? (
          /* MOBILE CARDS */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredProducts.map(product => {
              const catColor = CATEGORY_COLORS[product.category] || DEFAULT_CAT_COLOR;
              const p = product as any;
              return (
                <div key={product.id} style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 12, padding: '14px 16px', opacity: product.is_active ? 1 : 0.5 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>{product.name}</div>
                      {product.sku && <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace', marginTop: 2 }}>{product.sku}</div>}
                      {p.subcategory && <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{p.subcategory}</div>}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: product.is_active ? '#4ade80' : '#f87171', background: product.is_active ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)', border: `1px solid ${product.is_active ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`, padding: '3px 8px', borderRadius: 6 }}>
                      {product.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div style={{ marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, color: catColor.text, background: catColor.bg, border: `1px solid ${catColor.border}` }}>
                      {ALL_CATEGORY_LABELS[product.category] || product.category}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    {[
                      { label: 'Retail', val: fmt(product.retail_price), color: '#e2e8f0' },
                      { label: 'Rental/mo', val: fmt(product.rental_price_monthly), color: product.rental_price_monthly ? '#22d3ee' : '#475569' },
                      { label: 'Install Fee', val: fmt(product.install_fee), color: '#e2e8f0' },
                      { label: 'Warranty', val: product.warranty_months ? `${product.warranty_months}mo` : '—', color: '#94a3b8' },
                    ].map(item => (
                      <div key={item.label} style={{ background: '#0f1923', borderRadius: 8, padding: '8px 10px', border: '1px solid #1a2a3a' }}>
                        <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>{item.label}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: item.color, marginTop: 2 }}>{item.val}</div>
                      </div>
                    ))}
                  </div>
                  {(p.parts_warranty || p.labour_warranty) && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      {p.parts_warranty && <WarrantyBadge value={p.parts_warranty} icon="🔩" />}
                      {p.labour_warranty && <WarrantyBadge value={p.labour_warranty} icon="👷" />}
                    </div>
                  )}
                  {role === 'admin' && (
                    <div style={{ display: 'flex', gap: 8, paddingTop: 10, borderTop: '1px solid #1e3a4f' }}>
                      <button onClick={() => openEditForm(product)} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid rgba(13,126,163,0.3)', background: 'transparent', color: '#22d3ee', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Edit</button>
                      <button onClick={() => handleToggleActive(product)} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${product.is_active ? 'rgba(248,113,113,0.25)' : 'rgba(74,222,128,0.25)'}`, background: 'transparent', color: product.is_active ? '#f87171' : '#4ade80', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                        {product.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* DESKTOP TABLE */
          <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#0f1923', borderBottom: '1px solid #1e3a4f' }}>
                  {[
                    { label: 'Product', align: 'left' },
                    { label: 'SKU', align: 'left' },
                    ...(showProcurement ? [{ label: 'Vendor SKU', align: 'left' }] : []),
                    { label: 'Category', align: 'left' },
                    { label: 'Retail', align: 'right' },
                    ...(showProcurement ? [{ label: 'Cost', align: 'right' }, { label: 'Min Sell', align: 'right' }] : []),
                    { label: 'Rental/mo', align: 'right' },
                    { label: 'Install', align: 'right' },
                    { label: 'Parts Warranty', align: 'left' },
                    { label: 'Labour Warranty', align: 'left' },
                    { label: 'Status', align: 'center' },
                    { label: 'Actions', align: 'right' },
                  ].map(h => (
                    <th key={h.label} style={{ padding: '10px 12px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: h.align as any, whiteSpace: 'nowrap' }}>{h.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map(product => {
                  const catColor = CATEGORY_COLORS[product.category] || DEFAULT_CAT_COLOR;
                  const p = product as any;
                  return (
                    <tr key={product.id} style={{ borderBottom: '1px solid #1a2a3a', opacity: product.is_active ? 1 : 0.45 }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#1a2e42'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                      <td style={{ padding: '10px 12px', maxWidth: 220 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.name}</div>
                        {p.subcategory && <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>{p.subcategory}</div>}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{product.sku || '—'}</td>
                      {showProcurement && (
                        <td style={{ padding: '10px 12px', fontSize: 11, fontFamily: 'monospace' }}>
                          {product.vendor_sku ? (
                            <span style={{ color: '#fbbf24', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 4, padding: '2px 6px' }}>{product.vendor_sku}</span>
                          ) : <span style={{ color: '#334155' }}>—</span>}
                        </td>
                      )}
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, color: catColor.text, background: catColor.bg, border: `1px solid ${catColor.border}`, whiteSpace: 'nowrap' }}>
                          {ALL_CATEGORY_LABELS[product.category] || product.category}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap' }}>{fmt(product.retail_price)}</td>
                      {showProcurement && (
                        <>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: product.vendor_cost ? '#4ade80' : '#334155', whiteSpace: 'nowrap' }}>
                            {product.vendor_cost != null ? fmt(product.vendor_cost) : '—'}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: p.min_sell_price ? '#fbbf24' : '#334155', whiteSpace: 'nowrap' }}>
                            {p.min_sell_price ? fmt(p.min_sell_price) : '—'}
                          </td>
                        </>
                      )}
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: product.rental_price_monthly ? '#22d3ee' : '#475569', whiteSpace: 'nowrap' }}>{fmt(product.rental_price_monthly)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: '#e2e8f0', whiteSpace: 'nowrap' }}>{fmt(product.install_fee)}</td>
                      <td style={{ padding: '10px 12px' }}><WarrantyBadge value={p.parts_warranty} icon="🔩" /></td>
                      <td style={{ padding: '10px 12px' }}><WarrantyBadge value={p.labour_warranty} icon="👷" /></td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, color: product.is_active ? '#4ade80' : '#f87171', background: product.is_active ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)', border: `1px solid ${product.is_active ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}` }}>
                          {product.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        {role === 'admin' && (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                            <button onClick={() => openEditForm(product)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(13,126,163,0.3)', background: 'transparent', color: '#22d3ee', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
                              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(13,126,163,0.15)'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>Edit</button>
                            <button onClick={() => handleToggleActive(product)} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${product.is_active ? 'rgba(248,113,113,0.25)' : 'rgba(74,222,128,0.25)'}`, background: 'transparent', color: product.is_active ? '#f87171' : '#4ade80', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
                              onMouseEnter={e => { e.currentTarget.style.background = product.is_active ? 'rgba(248,113,113,0.12)' : 'rgba(74,222,128,0.12)'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                              {product.is_active ? 'Deactivate' : 'Reactivate'}
                            </button>
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
      </div>

      {/* Add/Edit Modal */}
      {showForm && role === 'admin' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 12, width: '100%', maxWidth: 720, maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #1e3a4f' }}>
              <div>
                <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 18 }}>{editingId ? 'Edit Product' : 'Add New Product'}</div>
                <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>{editingId ? 'Update product details' : 'Fill in product information'}</div>
              </div>
              <button onClick={() => { setShowForm(false); setEditingId(null); }} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Basic info */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <MF label="Product Name" required><MI value={form.name} onChange={v => updateField('name', v)} placeholder="Zenith RO System" /></MF>
                <MF label="Internal SKU"><MI value={form.sku || ''} onChange={v => updateField('sku', v || null)} placeholder="ZPS-RO-100" /></MF>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <MF label="Category">
                  <MS value={form.category} onChange={v => updateField('category', v)} options={Object.entries(ALL_CATEGORY_LABELS).map(([k, l]) => ({ value: k, label: l }))} />
                </MF>
                <MF label="Subcategory"><MI value={(form as any).subcategory || ''} onChange={v => updateField('subcategory', v || null)} placeholder="e.g. Essential Series" /></MF>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <MF label="Requires Survey Type">
                  <MS value={form.requires_survey_type || ''} onChange={v => updateField('requires_survey_type', v || null)} options={[{ value: '', label: 'None' }, { value: 'ro', label: 'RO Survey' }, { value: 'softener', label: 'Softener Survey' }, { value: 'whole_home_filter', label: 'Whole Home Filter Survey' }]} />
                </MF>
              </div>
              <MF label="Description">
                <textarea value={form.description || ''} onChange={e => updateField('description', e.target.value || null)} rows={2} placeholder="Customer-facing product description — appears on quotes and invoices"
                  style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', color: '#e2e8f0', fontSize: 14, borderRadius: 8, padding: '10px 14px', outline: 'none', boxSizing: 'border-box', resize: 'none' }} />
              </MF>

              {/* Vendor / Admin only */}
              {canEditProcurement && (
                <div style={{ borderTop: '1px solid #1e3a4f', paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    🏭 VENDOR / ORDERING
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#92400e', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 4, padding: '2px 6px' }}>ADMIN ONLY</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
                    <MF label="Vendor Name"><MI value={(form as any).vendor_name || ''} onChange={v => updateField('vendor_name', v || null)} placeholder="e.g. NWS" /></MF>
                    <MF label="Vendor SKU / Part Number"><MI value={form.vendor_sku || ''} onChange={v => updateField('vendor_sku', v || null)} placeholder="e.g. NWS-32MB-C1517" /></MF>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
                    <MF label="Vendor Cost ($/unit)"><MI type="number" value={form.vendor_cost ?? ''} onChange={v => updateField('vendor_cost', v ? parseFloat(v) : null)} placeholder="0.00" /></MF>
                    <MF label="Min Sell Price ($)"><MI type="number" value={(form as any).min_sell_price ?? ''} onChange={v => updateField('min_sell_price', v ? parseFloat(v) : null)} placeholder="0.00" /></MF>
                  </div>
                  <MF label="Vendor Description">
                    <textarea value={(form as any).vendor_description || ''} onChange={e => updateField('vendor_description', e.target.value || null)} rows={2} placeholder="Supplier's product description"
                      style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', color: '#e2e8f0', fontSize: 14, borderRadius: 8, padding: '10px 14px', outline: 'none', boxSizing: 'border-box', resize: 'none' }} />
                  </MF>
                </div>
              )}

              {/* Pricing */}
              <div style={{ borderTop: '1px solid #1e3a4f', paddingTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', marginBottom: 12 }}>PRICING</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <MF label="Retail Price ($)"><MI type="number" value={form.retail_price ?? ''} onChange={v => updateField('retail_price', v ? parseFloat(v) : null)} placeholder="899.00" /></MF>
                  <MF label="Rental ($/month)"><MI type="number" value={form.rental_price_monthly ?? ''} onChange={v => updateField('rental_price_monthly', v ? parseFloat(v) : null)} placeholder="29.99" /></MF>
                  <MF label="Install Fee ($)"><MI type="number" value={form.install_fee ?? ''} onChange={v => updateField('install_fee', v ? parseFloat(v) : 0)} placeholder="150.00" /></MF>
                  <MF label="Maintenance ($/month)"><MI type="number" value={form.maintenance_price_monthly ?? ''} onChange={v => updateField('maintenance_price_monthly', v ? parseFloat(v) : null)} placeholder="9.99" /></MF>
                </div>
              </div>

              {/* Warranty & Filters */}
              <div style={{ borderTop: '1px solid #1e3a4f', paddingTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', marginBottom: 12 }}>WARRANTY & FILTERS</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
                  <MF label="Parts Warranty" tooltip="e.g. 5 years, 10 years, Manufacturers warranty. Shown on quotes and invoices.">
                    <MI value={(form as any).parts_warranty || ''} onChange={v => updateField('parts_warranty', v || null)} placeholder="e.g. 5 years" />
                  </MF>
                  <MF label="Labour Warranty" tooltip="e.g. 5 years, 1 years, Manufacturers warranty.">
                    <MI value={(form as any).labour_warranty || ''} onChange={v => updateField('labour_warranty', v || null)} placeholder="e.g. 5 years" />
                  </MF>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                  <MF label="Warranty (months)"><MI type="number" value={form.warranty_months ?? ''} onChange={v => updateField('warranty_months', v ? parseInt(v) : 0)} placeholder="12" /></MF>
                  <MF label="Filter Interval (months)"><MI type="number" value={form.filter_interval_months ?? ''} onChange={v => updateField('filter_interval_months', v ? parseInt(v) : null)} placeholder="12" /></MF>
                  <MF label="Buyout Formula">
                    <MS value={form.buyout_formula || ''} onChange={v => updateField('buyout_formula', v || null)} options={[{ value: '', label: 'N/A' }, ...Object.entries(BUYOUT_LABELS).map(([k, l]) => ({ value: k, label: l }))]} />
                  </MF>
                </div>
              </div>

              {error && <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 13 }}>{error}</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, padding: '16px 24px', borderTop: '1px solid #1e3a4f' }}>
              <button onClick={() => { setShowForm(false); setEditingId(null); }} style={{ padding: '8px 16px', fontSize: 13, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ padding: '10px 22px', borderRadius: 8, border: 'none', cursor: 'pointer', background: saving ? '#0d7ea350' : '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 14, opacity: saving ? 0.5 : 1 }}>
                {saving ? 'Saving…' : editingId ? 'Update Product' : 'Create Product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MF({ label, required, tooltip, children }: { label: string; required?: boolean; tooltip?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 6 }}>
        {label} {required && <span style={{ color: '#f87171' }}>*</span>}
        {tooltip && <span title={tooltip} style={{ cursor: 'help', marginLeft: 4, color: '#334155' }}>ⓘ</span>}
      </label>
      {children}
    </div>
  );
}

function MI({ value, onChange, placeholder, type = 'text' }: { value: any; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input type={type} step={type === 'number' ? '0.01' : undefined} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', color: '#e2e8f0', fontSize: 14, borderRadius: 8, padding: '10px 14px', outline: 'none', boxSizing: 'border-box' }} />
  );
}

function MS({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', color: '#e2e8f0', fontSize: 14, borderRadius: 8, padding: '10px 14px', outline: 'none', boxSizing: 'border-box' }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
