import React, { useState, useEffect } from 'react';
import {
  getProducts,
  createProduct,
  updateProduct,
  deactivateProduct,
  reactivateProduct,
  CATEGORY_LABELS,
  BUYOUT_LABELS,
  Product,
  ProductInsert,
  ProductUpdate,
} from './productService';

const EMPTY_FORM: ProductInsert & { vendor_sku?: string; vendor_cost?: number | null } = {
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
  vendor_sku: '',
  vendor_cost: null,
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
};

const DEFAULT_CAT_COLOR = { bg: 'rgba(148,163,184,0.15)', text: '#cbd5e1', border: 'rgba(148,163,184,0.3)' };

const CATEGORY_TABS: {
  key: string; label: string; icon: string;
  color: string; bg: string; border: string;
}[] = [
  { key: 'all',                label: 'All',        icon: '◈', color: '#e2e8f0', bg: 'rgba(226,232,240,0.1)',  border: 'rgba(226,232,240,0.2)' },
  { key: 'ro',                 label: 'RO',         icon: '💧', color: '#22d3ee', bg: 'rgba(6,182,212,0.1)',   border: 'rgba(6,182,212,0.25)' },
  { key: 'softener',           label: 'Softener',   icon: '🔵', color: '#60a5fa', bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.25)' },
  { key: 'whole_home_filter',  label: 'Whole Home', icon: '🏠', color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)' },
  { key: 'replacement_filter', label: 'Filters',    icon: '🔄', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.25)' },
  { key: 'accessory',          label: 'Accessory',  icon: '🔧', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.25)' },
];

function fmt(val: number | null): string {
  if (val === null || val === undefined) return '—';
  return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ProductCatalog() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => { loadProducts(); }, [filterCategory, showInactive]);

  async function loadProducts() {
    setLoading(true);
    try {
      const data = await getProducts({
        activeOnly: !showInactive,
        category: filterCategory === 'all' ? undefined : filterCategory,
      });
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
      vendor_sku: (product as any).vendor_sku || '',
      vendor_cost: (product as any).vendor_cost ?? null,
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
      const payload = {
        ...form,
        vendor_sku: form.vendor_sku || null,
        vendor_cost: form.vendor_cost ?? null,
      };
      if (editingId) { await updateProduct(editingId, payload as ProductUpdate); }
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
      ((p as any).vendor_sku && (p as any).vendor_sku.toLowerCase().includes(q)) ||
      (p.description && p.description.toLowerCase().includes(q))
    );
  });

  return (
    <div style={{ background: '#0f1923', minHeight: '100vh', color: '#e2e8f0', display: 'flex', flexDirection: 'column' }}>

      {/* ── Top bar ── */}
      <div style={{
        background: '#162232', borderBottom: '1px solid #1e3a4f',
        padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 20, color: '#e2e8f0', lineHeight: 1.2 }}>Product Catalog</div>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
            {products.length} product{products.length !== 1 ? 's' : ''} · Prices feed quotes, contracts, and billing.
          </div>
        </div>
        <input
          placeholder="Search name, SKU, or vendor SKU…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8,
            color: '#e2e8f0', padding: '9px 14px', fontSize: 13, outline: 'none',
            width: 240, flexShrink: 0,
          }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexShrink: 0 }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} style={{ accentColor: '#0d7ea3' }} />
          <span style={{ fontSize: 13, color: '#94a3b8' }}>Show inactive</span>
        </label>
        <button
          onClick={openAddForm}
          style={{
            padding: '10px 22px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 14,
            flexShrink: 0, whiteSpace: 'nowrap',
          }}
        >
          + Add Product
        </button>
      </div>

      {/* ── Category filter tabs ── */}
      <div style={{
        background: '#0c1a26', borderBottom: '1px solid #1e3a4f',
        padding: '12px 24px', display: 'flex', gap: 8, flexShrink: 0, overflowX: 'auto',
      }}>
        {CATEGORY_TABS.map(f => {
          const count = f.key === 'all' ? products.length : products.filter(p => p.category === f.key).length;
          const isActive = filterCategory === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilterCategory(f.key)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                padding: '11px 8px', borderRadius: 10,
                border: `1px solid ${isActive ? f.color + '60' : f.border}`,
                background: isActive ? f.bg : 'rgba(255,255,255,0.02)',
                color: isActive ? f.color : '#475569',
                cursor: 'pointer', fontSize: 13, fontWeight: isActive ? 700 : 500,
                transition: 'all 0.12s',
                boxShadow: isActive ? `0 0 14px ${f.color}20` : 'none',
                whiteSpace: 'nowrap', minWidth: 0,
              }}
            >
              <span style={{ fontSize: 14 }}>{f.icon}</span>
              <span>{f.label}</span>
              {count > 0 && (
                <span style={{
                  background: isActive ? f.color + '30' : 'rgba(255,255,255,0.06)',
                  color: isActive ? f.color : '#64748b',
                  borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 700,
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Stats strip ── */}
      <div style={{
        display: 'flex', gap: 12, padding: '14px 24px',
        borderBottom: '1px solid #1e3a4f', background: '#0f1923', flexShrink: 0, overflowX: 'auto',
      }}>
        {[
          { label: 'Showing',    val: String(filteredProducts.length), color: '#94a3b8' },
          { label: 'Active',     val: String(activeCount),             color: '#4ade80' },
          { label: 'Categories', val: String(categories),              color: '#a78bfa' },
        ].map(s => (
          <div key={s.label} style={{
            background: '#162232', border: '1px solid #1e3a4f', borderRadius: 10,
            padding: '10px 18px', flexShrink: 0, minWidth: 110,
          }}>
            <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
            <div style={{ color: s.color, fontWeight: 800, fontSize: 20, marginTop: 3 }}>{s.val}</div>
          </div>
        ))}
      </div>

      {error && !showForm && (
        <div style={{
          margin: '12px 24px 0', padding: '10px 14px', borderRadius: 8,
          background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
          color: '#f87171', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      )}

      {/* ── Table ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Loading products…</div>
        ) : filteredProducts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
            <div style={{ color: '#64748b', fontSize: 15 }}>
              {search ? 'No products matching your search' : 'No products found'}
            </div>
            {!search && (
              <button onClick={openAddForm} style={{
                marginTop: 16, padding: '10px 24px', borderRadius: 8, border: 'none',
                cursor: 'pointer', background: '#0d7ea3', color: '#fff', fontWeight: 700,
              }}>
                Add First Product
              </button>
            )}
          </div>
        ) : (
          <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#0f1923', borderBottom: '1px solid #1e3a4f' }}>
                  {[
                    { label: 'Product',     align: 'left' },
                    { label: 'SKU',         align: 'left' },
                    { label: 'Vendor SKU',  align: 'left' },
                    { label: 'Category',    align: 'left' },
                    { label: 'Retail',      align: 'right' },
                    { label: 'Vendor Cost', align: 'right' },
                    { label: 'Rental/mo',   align: 'right' },
                    { label: 'Install Fee', align: 'right' },
                    { label: 'Maint/mo',    align: 'right' },
                    { label: 'Warranty',    align: 'center' },
                    { label: 'Status',      align: 'center' },
                    { label: 'Actions',     align: 'right' },
                  ].map(h => (
                    <th key={h.label} style={{
                      padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#64748b',
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                      textAlign: h.align as any,
                    }}>{h.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map(product => {
                  const catColor = CATEGORY_COLORS[product.category] || DEFAULT_CAT_COLOR;
                  const vendorSku  = (product as any).vendor_sku;
                  const vendorCost = (product as any).vendor_cost;
                  return (
                    <tr
                      key={product.id}
                      style={{ borderBottom: '1px solid #1a2a3a', opacity: product.is_active ? 1 : 0.45, transition: 'background 0.1s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#1a2e42'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      {/* Product name */}
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{product.name}</div>
                        {product.description && (
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {product.description}
                          </div>
                        )}
                      </td>

                      {/* Internal SKU */}
                      <td style={{ padding: '12px 14px', fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>
                        {product.sku || '—'}
                      </td>

                      {/* Vendor SKU / reorder code */}
                      <td style={{ padding: '12px 14px', fontSize: 12, fontFamily: 'monospace' }}>
                        {vendorSku ? (
                          <span style={{
                            color: '#fbbf24',
                            background: 'rgba(251,191,36,0.08)',
                            border: '1px solid rgba(251,191,36,0.2)',
                            borderRadius: 4, padding: '2px 7px',
                          }}>
                            {vendorSku}
                          </span>
                        ) : (
                          <span style={{ color: '#334155' }}>—</span>
                        )}
                      </td>

                      {/* Category */}
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{
                          display: 'inline-block', fontSize: 11, fontWeight: 700,
                          padding: '3px 10px', borderRadius: 6,
                          color: catColor.text, background: catColor.bg, border: `1px solid ${catColor.border}`,
                        }}>
                          {CATEGORY_LABELS[product.category] || product.category}
                        </span>
                      </td>

                      {/* Retail */}
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>
                        {fmt(product.retail_price)}
                      </td>

                      {/* Vendor cost */}
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: 13, color: vendorCost ? '#4ade80' : '#334155' }}>
                        {vendorCost != null ? fmt(vendorCost) : '—'}
                      </td>

                      {/* Rental/mo */}
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: 13, fontWeight: 600, color: product.rental_price_monthly ? '#22d3ee' : '#475569' }}>
                        {fmt(product.rental_price_monthly)}
                      </td>

                      {/* Install fee */}
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: 13, color: '#e2e8f0' }}>
                        {fmt(product.install_fee)}
                      </td>

                      {/* Maint/mo */}
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: 13, color: product.maintenance_price_monthly ? '#a78bfa' : '#475569' }}>
                        {fmt(product.maintenance_price_monthly)}
                      </td>

                      {/* Warranty */}
                      <td style={{ padding: '12px 14px', textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
                        {product.warranty_months ? `${product.warranty_months}mo` : '—'}
                      </td>

                      {/* Status */}
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block', fontSize: 11, fontWeight: 700,
                          padding: '3px 10px', borderRadius: 6,
                          color: product.is_active ? '#4ade80' : '#f87171',
                          background: product.is_active ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                          border: `1px solid ${product.is_active ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
                        }}>
                          {product.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                          <button
                            onClick={() => openEditForm(product)}
                            style={{
                              padding: '4px 12px', borderRadius: 6,
                              border: '1px solid rgba(13,126,163,0.3)', background: 'transparent',
                              color: '#22d3ee', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(13,126,163,0.15)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleToggleActive(product)}
                            style={{
                              padding: '4px 12px', borderRadius: 6,
                              border: `1px solid ${product.is_active ? 'rgba(248,113,113,0.25)' : 'rgba(74,222,128,0.25)'}`,
                              background: 'transparent',
                              color: product.is_active ? '#f87171' : '#4ade80',
                              cursor: 'pointer', fontSize: 12, fontWeight: 600,
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background = product.is_active ? 'rgba(248,113,113,0.12)' : 'rgba(74,222,128,0.12)';
                            }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            {product.is_active ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Add/Edit Modal ── */}
      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
        }}>
          <div style={{
            background: '#162232', border: '1px solid #1e3a4f', borderRadius: 12,
            width: '100%', maxWidth: 680, maxHeight: '92vh', overflowY: 'auto',
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '20px 24px', borderBottom: '1px solid #1e3a4f',
            }}>
              <div>
                <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 18 }}>
                  {editingId ? 'Edit Product' : 'Add New Product'}
                </div>
                <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>
                  {editingId ? 'Update product details' : 'Fill in product information'}
                </div>
              </div>
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}
              >×</button>
            </div>

            {/* Body */}
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Row 1: Name + SKU */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <ModalField label="Product Name" required>
                  <ModalInput value={form.name} onChange={v => updateField('name', v)} placeholder="Zenith RO System" />
                </ModalField>
                <ModalField label="Internal SKU">
                  <ModalInput value={form.sku || ''} onChange={v => updateField('sku', v || null)} placeholder="ZPS-RO-100" />
                </ModalField>
              </div>

              {/* Row 2: Category + Survey */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <ModalField label="Category">
                  <ModalSelect
                    value={form.category}
                    onChange={v => updateField('category', v)}
                    options={Object.entries(CATEGORY_LABELS).map(([k, l]) => ({ value: k, label: l }))}
                  />
                </ModalField>
                <ModalField label="Requires Survey Type">
                  <ModalSelect
                    value={form.requires_survey_type || ''}
                    onChange={v => updateField('requires_survey_type', v || null)}
                    options={[
                      { value: '', label: 'None' },
                      { value: 'ro', label: 'RO Survey' },
                      { value: 'softener', label: 'Softener Survey' },
                      { value: 'whole_home_filter', label: 'Whole Home Filter Survey' },
                    ]}
                  />
                </ModalField>
              </div>

              {/* Description */}
              <ModalField label="Description">
                <textarea
                  value={form.description || ''}
                  onChange={e => updateField('description', e.target.value || null)}
                  rows={2}
                  placeholder="Customer-facing product description"
                  style={{
                    width: '100%', background: '#0f1923', border: '1px solid #1e3a4f',
                    color: '#e2e8f0', fontSize: 14, borderRadius: 8, padding: '10px 14px',
                    outline: 'none', boxSizing: 'border-box', resize: 'none',
                  }}
                />
              </ModalField>

              {/* ── VENDOR section ── */}
              <div style={{ borderTop: '1px solid #1e3a4f', paddingTop: 16 }}>
                <div style={{
                  fontSize: 13, fontWeight: 700, color: '#fbbf24', marginBottom: 12,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span>🏭</span> VENDOR / ORDERING
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <ModalField label="Vendor Reorder Code / Vendor SKU">
                    <ModalInput
                      value={form.vendor_sku || ''}
                      onChange={v => updateField('vendor_sku', v || null)}
                      placeholder="e.g. KW-2056-B or MFR-PN-4412"
                    />
                  </ModalField>
                  <ModalField label="Vendor Cost ($/unit)">
                    <ModalInput
                      type="number"
                      value={form.vendor_cost ?? ''}
                      onChange={v => updateField('vendor_cost', v ? parseFloat(v) : null)}
                      placeholder="0.00"
                    />
                  </ModalField>
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: '#475569' }}>
                  Vendor SKU is your reorder code used when placing purchase orders. Vendor cost is your purchase price (not shown to customers).
                </div>
              </div>

              {/* ── PRICING section ── */}
              <div style={{ borderTop: '1px solid #1e3a4f', paddingTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', marginBottom: 12 }}>PRICING</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <ModalField label="Retail Price ($)">
                    <ModalInput type="number" value={form.retail_price ?? ''} onChange={v => updateField('retail_price', v ? parseFloat(v) : null)} placeholder="899.00" />
                  </ModalField>
                  <ModalField label="Rental ($/month)">
                    <ModalInput type="number" value={form.rental_price_monthly ?? ''} onChange={v => updateField('rental_price_monthly', v ? parseFloat(v) : null)} placeholder="29.99" />
                  </ModalField>
                  <ModalField label="Install Fee ($)">
                    <ModalInput type="number" value={form.install_fee ?? ''} onChange={v => updateField('install_fee', v ? parseFloat(v) : 0)} placeholder="150.00" />
                  </ModalField>
                  <ModalField label="Maintenance ($/month)">
                    <ModalInput type="number" value={form.maintenance_price_monthly ?? ''} onChange={v => updateField('maintenance_price_monthly', v ? parseFloat(v) : null)} placeholder="9.99" />
                  </ModalField>
                </div>
              </div>

              {/* ── WARRANTY & FILTERS section ── */}
              <div style={{ borderTop: '1px solid #1e3a4f', paddingTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', marginBottom: 12 }}>WARRANTY & FILTERS</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                  <ModalField label="Warranty (months)">
                    <ModalInput type="number" value={form.warranty_months ?? ''} onChange={v => updateField('warranty_months', v ? parseInt(v) : 0)} placeholder="12" />
                  </ModalField>
                  <ModalField label="Filter Interval (months)">
                    <ModalInput type="number" value={form.filter_interval_months ?? ''} onChange={v => updateField('filter_interval_months', v ? parseInt(v) : null)} placeholder="12" />
                  </ModalField>
                  <ModalField label="Buyout Formula">
                    <ModalSelect
                      value={form.buyout_formula || ''}
                      onChange={v => updateField('buyout_formula', v || null)}
                      options={[{ value: '', label: 'N/A' }, ...Object.entries(BUYOUT_LABELS).map(([k, l]) => ({ value: k, label: l }))]}
                    />
                  </ModalField>
                </div>
              </div>

              {error && (
                <div style={{
                  padding: '10px 14px', borderRadius: 8,
                  background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
                  color: '#f87171', fontSize: 13,
                }}>
                  {error}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12,
              padding: '16px 24px', borderTop: '1px solid #1e3a4f',
            }}>
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                style={{ padding: '8px 16px', fontSize: 13, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: '10px 22px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: saving ? '#0d7ea350' : '#0d7ea3',
                  color: '#fff', fontWeight: 700, fontSize: 14, opacity: saving ? 0.5 : 1,
                }}
              >
                {saving ? 'Saving…' : editingId ? 'Update Product' : 'Create Product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Modal helpers ──────────────────────────────────────────────────────────────

function ModalField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 6 }}>
        {label} {required && <span style={{ color: '#f87171' }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function ModalInput({ value, onChange, placeholder, type = 'text' }: {
  value: any; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input
      type={type}
      step={type === 'number' ? '0.01' : undefined}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', background: '#0f1923', border: '1px solid #1e3a4f',
        color: '#e2e8f0', fontSize: 14, borderRadius: 8, padding: '10px 14px',
        outline: 'none', boxSizing: 'border-box',
      }}
    />
  );
}

function ModalSelect({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%', background: '#0f1923', border: '1px solid #1e3a4f',
        color: '#e2e8f0', fontSize: 14, borderRadius: 8, padding: '10px 14px',
        outline: 'none', boxSizing: 'border-box',
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
