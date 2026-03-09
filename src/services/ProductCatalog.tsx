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
// ============================================================
// PRODUCT CATALOG PAGE — Admin UI
// Place in: src/pages/products/ProductCatalog.tsx
// Add route + sidebar nav link for "Products" or nest under "Plans & Rentals"
// ============================================================

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
};

export default function ProductCatalog() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductInsert>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    loadProducts();
  }, [filterCategory, showInactive]);

  async function loadProducts() {
    setLoading(true);
    try {
      const data = await getProducts({
        activeOnly: !showInactive,
        category: filterCategory === 'all' ? undefined : filterCategory,
      });
      setProducts(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
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
    });
    setEditingId(product.id);
    setShowForm(true);
    setError(null);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError('Product name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await updateProduct(editingId, form as ProductUpdate);
      } else {
        await createProduct(form);
      }
      setShowForm(false);
      setEditingId(null);
      await loadProducts();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(product: Product) {
    try {
      if (product.is_active) {
        await deactivateProduct(product.id);
      } else {
        await reactivateProduct(product.id);
      }
      await loadProducts();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function updateField(field: string, value: any) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function formatCurrency(val: number | null): string {
    if (val === null || val === undefined) return '—';
    return `$${Number(val).toFixed(2)}`;
  }

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="p-6 max-w-full">
      {/* HEADER */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Product Catalog</h1>
          <p className="text-sm text-gray-400 mt-1">
            Manage systems, filters, and services. Prices here feed quotes, contracts, and billing.
          </p>
        </div>
        <button
          onClick={openAddForm}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + Add Product
        </button>
      </div>

      {/* FILTERS */}
      <div className="flex items-center gap-4 mb-4">
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="all">All Categories</option>
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            className="rounded bg-gray-700 border-gray-600 text-blue-600 focus:ring-blue-500"
          />
          Show inactive
        </label>
        <span className="text-sm text-gray-500 ml-auto">
          {products.length} product{products.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ERROR */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* PRODUCT TABLE */}
      {loading ? (
        <div className="text-gray-400 text-center py-12">Loading products...</div>
      ) : products.length === 0 ? (
        <div className="text-gray-500 text-center py-12">
          No products found. Click "+ Add Product" to create your first product.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-700">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-800 text-gray-300 uppercase text-xs">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Retail</th>
                <th className="px-4 py-3 text-right">Rental/mo</th>
                <th className="px-4 py-3 text-right">Install Fee</th>
                <th className="px-4 py-3 text-right">Maint/mo</th>
                <th className="px-4 py-3 text-center">Warranty</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {products.map(product => (
                <tr
                  key={product.id}
                  className={`hover:bg-gray-800/50 transition-colors ${!product.is_active ? 'opacity-50' : ''}`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{product.name}</div>
                    {product.description && (
                      <div className="text-xs text-gray-500 mt-0.5 max-w-xs truncate">
                        {product.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">{product.sku || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      product.category === 'ro' ? 'bg-cyan-900/50 text-cyan-300' :
                      product.category === 'softener' ? 'bg-blue-900/50 text-blue-300' :
                      product.category === 'whole_home_filter' ? 'bg-purple-900/50 text-purple-300' :
                      product.category === 'replacement_filter' ? 'bg-yellow-900/50 text-yellow-300' :
                      product.category === 'accessory' ? 'bg-gray-700 text-gray-300' :
                      'bg-green-900/50 text-green-300'
                    }`}>
                      {CATEGORY_LABELS[product.category] || product.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-200">{formatCurrency(product.retail_price)}</td>
                  <td className="px-4 py-3 text-right text-green-400 font-medium">
                    {formatCurrency(product.rental_price_monthly)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-200">{formatCurrency(product.install_fee)}</td>
                  <td className="px-4 py-3 text-right text-gray-200">
                    {formatCurrency(product.maintenance_price_monthly)}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-400">
                    {product.warranty_months ? `${product.warranty_months}mo` : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      product.is_active
                        ? 'bg-green-900/50 text-green-400'
                        : 'bg-red-900/50 text-red-400'
                    }`}>
                      {product.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEditForm(product)}
                        className="text-blue-400 hover:text-blue-300 text-xs font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggleActive(product)}
                        className={`text-xs font-medium ${
                          product.is_active
                            ? 'text-red-400 hover:text-red-300'
                            : 'text-green-400 hover:text-green-300'
                        }`}
                      >
                        {product.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ADD/EDIT MODAL */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-700">
              <h2 className="text-lg font-bold text-white">
                {editingId ? 'Edit Product' : 'Add New Product'}
              </h2>
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="text-gray-400 hover:text-white text-xl"
              >
                ×
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4">
              {/* Row 1: Name + SKU */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    Product Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => updateField('name', e.target.value)}
                    placeholder="Zenith RO System"
                    className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">SKU</label>
                  <input
                    type="text"
                    value={form.sku || ''}
                    onChange={e => updateField('sku', e.target.value || null)}
                    placeholder="ZPS-RO-100"
                    className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Row 2: Category + Survey Type */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Category</label>
                  <select
                    value={form.category}
                    onChange={e => updateField('category', e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Requires Survey Type</label>
                  <select
                    value={form.requires_survey_type || ''}
                    onChange={e => updateField('requires_survey_type', e.target.value || null)}
                    className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">None</option>
                    <option value="ro">RO Survey</option>
                    <option value="softener">Softener Survey</option>
                    <option value="whole_home_filter">Whole Home Filter Survey</option>
                  </select>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Description</label>
                <textarea
                  value={form.description || ''}
                  onChange={e => updateField('description', e.target.value || null)}
                  rows={2}
                  placeholder="Customer-facing product description for quotes and invoices"
                  className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                />
              </div>

              {/* PRICING SECTION */}
              <div className="border-t border-gray-700 pt-4">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">Pricing</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Retail Price ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.retail_price ?? ''}
                      onChange={e => updateField('retail_price', e.target.value ? parseFloat(e.target.value) : null)}
                      placeholder="899.00"
                      className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Rental Price ($/month)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.rental_price_monthly ?? ''}
                      onChange={e => updateField('rental_price_monthly', e.target.value ? parseFloat(e.target.value) : null)}
                      placeholder="29.99"
                      className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Install Fee ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.install_fee ?? ''}
                      onChange={e => updateField('install_fee', e.target.value ? parseFloat(e.target.value) : 0)}
                      placeholder="150.00"
                      className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Maintenance ($/month)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.maintenance_price_monthly ?? ''}
                      onChange={e => updateField('maintenance_price_monthly', e.target.value ? parseFloat(e.target.value) : null)}
                      placeholder="9.99"
                      className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* WARRANTY & FILTERS SECTION */}
              <div className="border-t border-gray-700 pt-4">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">Warranty & Filters</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Warranty (months)</label>
                    <input
                      type="number"
                      value={form.warranty_months ?? ''}
                      onChange={e => updateField('warranty_months', e.target.value ? parseInt(e.target.value) : 0)}
                      placeholder="12"
                      className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Filter Interval (months)</label>
                    <input
                      type="number"
                      value={form.filter_interval_months ?? ''}
                      onChange={e => updateField('filter_interval_months', e.target.value ? parseInt(e.target.value) : null)}
                      placeholder="12"
                      className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Buyout Formula</label>
                    <select
                      value={form.buyout_formula || ''}
                      onChange={e => updateField('buyout_formula', e.target.value || null)}
                      className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">N/A</option>
                      {Object.entries(BUYOUT_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Error in modal */}
              {error && (
                <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
                  {error}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-700">
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                {saving ? 'Saving...' : editingId ? 'Update Product' : 'Create Product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
