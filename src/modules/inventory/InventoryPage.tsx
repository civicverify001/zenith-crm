// src/pages/inventory/InventoryPage.tsx
// Matches QuotesPage / InvoicesPage / FollowUpsPage design pattern
// Correct column names: quantity_on_hand, quantity_reserved, quantity_available

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

// ─── Mobile hook ──────────────────────────────────────────────────────────────
function useIsMobile() {
  const [v, setV] = useState(window.innerWidth < 768)
  useEffect(() => { const h = () => setV(window.innerWidth < 768); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h) }, [])
  return v
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface InventoryRow {
  id: string
  product_id: string
  quantity_on_hand: number
  quantity_reserved: number
  quantity_available: number
  quantity_on_order: number
  reorder_point: number
  products: {
    name: string
    sku: string
    category: string
    vendor_sku?: string
    vendor_cost?: number
    product_categories?: { name: string }
    product_vendors?: { name: string }
  }
}

interface ReorderRequest {
  id: string
  product_id: string
  request_type: 'job_shortage' | 'stock_replenishment'
  qty_requested: number
  status: 'open' | 'ordered' | 'received' | 'cancelled'
  job_id?: string
  notes?: string
  created_at: string
  products: { name: string; sku: string }
  jobs?: { id: string }
}

interface PurchaseOrder {
  id: string
  po_number: string
  vendor_id?: string
  status: 'draft' | 'sent' | 'confirmed' | 'received' | 'cancelled'
  total_cost?: number
  ordered_at?: string
  expected_at?: string
  received_at?: string
  notes?: string
  created_at: string
  product_vendors?: { name: string }
  purchase_order_items?: {
    id: string
    product_id: string
    qty_ordered: number
    unit_cost: number
    products: { name: string; sku: string }
  }[]
}

interface InventoryTx {
  id: string
  product_id: string
  transaction_type: string
  qty: number
  reference_type?: string
  reference_id?: string
  notes?: string
  created_at: string
  products: { name: string; sku: string }
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

const TX_LABELS: Record<string, string> = {
  receive:     '📦 Receive',
  reserve:     '🔒 Reserve',
  unreserve:   '🔓 Unreserve',
  fulfill:     '✅ Fulfill',
  adjustment:  '✏️ Adjust',
  adjust:      '✏️ Adjust',
  return:      '↩️ Return',
}

function getStatusStyle(status: string): React.CSSProperties {
  const map: Record<string, [string, string]> = {
    open:                ['rgba(251,191,36,0.12)',  '#fbbf24'],
    ordered:             ['rgba(96,165,250,0.12)',  '#60a5fa'],
    received:            ['rgba(74,222,128,0.12)',  '#4ade80'],
    cancelled:           ['rgba(100,116,139,0.12)', '#64748b'],
    draft:               ['rgba(100,116,139,0.12)', '#64748b'],
    sent:                ['rgba(96,165,250,0.12)',  '#60a5fa'],
    confirmed:           ['rgba(167,139,250,0.12)', '#a78bfa'],
    job_shortage:        ['rgba(248,113,113,0.12)', '#f87171'],
    stock_replenishment: ['rgba(96,165,250,0.12)',  '#60a5fa'],
  }
  const [bg, color] = map[status] || ['rgba(100,116,139,0.12)', '#64748b']
  return { background: bg, color, border: `1px solid ${color}35` }
}

function StatusBadge({ val }: { val: string }) {
  const style = getStatusStyle(val)
  return (
    <span
      className="text-xs font-semibold px-2.5 py-1 rounded-full"
      style={style}
    >
      {val.replace(/_/g, ' ')}
    </span>
  )
}

function StockStatusBadge({ available, reorderPoint }: { available: number; reorderPoint: number }) {
  if (available <= 0) {
    return <StatusBadge val="out_of_stock" />
  }
  if (available <= reorderPoint) {
    return <StatusBadge val="low" />
  }
  return (
    <span
      className="text-xs font-semibold px-2.5 py-1 rounded-full"
      style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)' }}
    >
      OK
    </span>
  )
}

// ─── Types for merged product+inventory view ──────────────────────────────────

interface Product {
  id: string
  name: string
  sku: string
  category: string
  is_active: boolean
}

interface MergedRow {
  product: Product
  inv: InventoryRow | null
}

// ─── Tab: Stock Levels ────────────────────────────────────────────────────────

function StockLevelsTab() {
  const isMobile = useIsMobile()
  const [merged, setMerged] = useState<MergedRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<'all' | 'low' | 'short' | 'untracked'>('untracked')
  const [adjustModal, setAdjustModal] = useState<MergedRow | null>(null)
  const [adjustQty, setAdjustQty] = useState('')
  const [adjustNote, setAdjustNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [trackingAll, setTrackingAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)

    // Simple products query — no joins that could fail silently
    const { data: products, error: prodErr } = await supabase
      .from('products')
      .select('id, name, sku, category, is_active')
      .order('name')

    if (prodErr) console.error('Products query error:', prodErr)

    // Load all inventory rows
    const { data: invRows, error: invErr } = await supabase
      .from('inventory')
      .select('*')

    if (invErr) console.error('Inventory query error:', invErr)

    // Build lookup map: product_id → inventory row
    const invMap: Record<string, InventoryRow> = {}
    for (const row of (invRows || [])) {
      invMap[row.product_id] = row
    }

    // Merge: every product (active or not) gets a row
    const result: MergedRow[] = (products || []).map(p => ({
      product: p as Product,
      inv: invMap[p.id] || null,
    }))

    setMerged(result)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Create inventory row for a single product
  async function startTracking(product: Product) {
    await supabase.from('inventory').insert({
      product_id:          product.id,
      quantity_on_hand:    0,
      quantity_reserved:   0,
      quantity_available:  0,
      quantity_on_order:   0,
      reorder_point:       2,
    })
    load()
  }

  // Create inventory rows for ALL untracked products
  async function trackAllProducts() {
    setTrackingAll(true)
    const untracked = merged.filter(m => !m.inv)
    for (const m of untracked) {
      await supabase.from('inventory').insert({
        product_id:          m.product.id,
        quantity_on_hand:    0,
        quantity_reserved:   0,
        quantity_available:  0,
        quantity_on_order:   0,
        reorder_point:       2,
      })
    }
    setTrackingAll(false)
    load()
  }

  async function handleAdjust() {
    if (!adjustModal?.inv || !adjustQty) return
    setSaving(true)
    const delta = parseInt(adjustQty)

    if (delta !== 0) {
      const inv = adjustModal.inv
      const newOnHand    = Math.max(0, inv.quantity_on_hand   + delta)
      const newAvailable = Math.max(0, inv.quantity_available + delta)

      await supabase
        .from('inventory')
        .update({
          quantity_on_hand:   newOnHand,
          quantity_available: newAvailable,
        })
        .eq('id', inv.id)
    }

    setAdjustModal(null)
    setAdjustQty('')
    setAdjustNote('')
    setSaving(false)
    load()
  }

  const tracked   = merged.filter(m => m.inv)
  const untracked = merged.filter(m => !m.inv)
  const shortRows = tracked.filter(m => m.inv!.quantity_available <= 0)
  const lowRows   = tracked.filter(m => m.inv!.quantity_available > 0 && m.inv!.quantity_available <= m.inv!.reorder_point)

  const FILTER_TABS = [
    { id: 'all',       label: 'All Tracked',  count: tracked.length,    color: '#60a5fa' },
    { id: 'low',       label: 'Low Stock',    count: lowRows.length,    color: '#fbbf24' },
    { id: 'short',     label: 'Out of Stock', count: shortRows.length,  color: '#f87171' },
    { id: 'untracked', label: 'Not Tracked',  count: untracked.length,  color: '#64748b' },
  ] as const

  const filtered = merged.filter(m => {
    const q = search.toLowerCase()
    const matchSearch = !search
      || m.product.name.toLowerCase().includes(q)
      || m.product.sku.toLowerCase().includes(q)

    if (activeFilter === 'untracked') return matchSearch && !m.inv
    if (!m.inv) return false // hide untracked when not on untracked tab

    const matchFilter =
      activeFilter === 'all'   ? true :
      activeFilter === 'short' ? m.inv.quantity_available <= 0 :
      activeFilter === 'low'   ? m.inv.quantity_available > 0 && m.inv.quantity_available <= m.inv.reorder_point
      : true
    return matchSearch && matchFilter
  })

  return (
    <div>
      {/* Full-width colorful filter tabs */}
      <div
        className="grid mb-5"
        style={isMobile
          ? { display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' as const, marginBottom: 16 }
          : { gridTemplateColumns: `repeat(${FILTER_TABS.length}, 1fr)`, gap: '3px' }
        }
      >
        {FILTER_TABS.map(tab => {
          const isActive = activeFilter === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id as typeof activeFilter)}
              className="relative flex items-center justify-between px-5 py-3 rounded-xl transition-all duration-150 text-left"
              style={isMobile ? {
                flexShrink: 0,
                background: isActive ? `${tab.color}20` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isActive ? tab.color + '50' : 'rgba(255,255,255,0.06)'}`,
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 12px', borderRadius: 20,
                color: isActive ? tab.color : '#64748b',
                fontSize: 12, fontWeight: isActive ? 700 : 500,
              } : {
                background: isActive
                  ? `linear-gradient(135deg, ${tab.color}22, ${tab.color}0a)`
                  : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isActive ? tab.color + '50' : 'rgba(255,255,255,0.06)'}`,
                boxShadow: isActive ? `0 0 18px ${tab.color}18` : 'none',
              }}
            >
              {isMobile ? (
                <>
                  <span>{tab.label}</span>
                  <span style={{
                    background: isActive ? `${tab.color}30` : '#1e3a4f',
                    color: isActive ? tab.color : '#64748b',
                    borderRadius: 10, padding: '1px 6px', fontSize: 11, fontWeight: 700,
                  }}>{tab.count}</span>
                </>
              ) : (
                <>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: isActive ? tab.color : '#64748b' }}>
                      {tab.label}
                    </div>
                    <div className="text-2xl font-bold" style={{ color: isActive ? tab.color : '#94a3b8' }}>
                      {tab.count}
                    </div>
                  </div>
                  {isActive && (
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tab.color, boxShadow: `0 0 8px ${tab.color}` }} />
                  )}
                </>
              )}
            </button>
          )
        })}
      </div>

      {/* Stats strip */}
      <div className={`grid gap-3 mb-5 ${isMobile ? 'grid-cols-2' : 'grid-cols-4'}`}>
        {[
          { label: 'Total On Hand',     value: tracked.reduce((s, m) => s + m.inv!.quantity_on_hand, 0),       color: '#60a5fa' },
          { label: 'Reserved for Jobs', value: tracked.reduce((s, m) => s + m.inv!.quantity_reserved, 0),      color: '#a78bfa' },
          { label: 'Available to Sell', value: tracked.reduce((s, m) => s + m.inv!.quantity_available, 0),     color: '#4ade80' },
          { label: 'On Order',          value: tracked.reduce((s, m) => s + (m.inv!.quantity_on_order || 0), 0), color: '#fbbf24' },
        ].map(s => (
          <div key={s.label} className="rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="text-xl font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search + Track All */}
      <div className="flex gap-3 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search any product or SKU..."
          className="flex-1 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          onFocus={e => (e.target.style.borderColor = 'rgba(96,165,250,0.5)')}
          onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.08)')}
        />
        {untracked.length > 0 && (
          <button
            onClick={trackAllProducts}
            disabled={trackingAll}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white whitespace-nowrap disabled:opacity-50 transition-all"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
          >
            {trackingAll ? 'Setting up...' : `Track All Products (${untracked.length})`}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ overflowX: 'auto' }}>
        <table className="w-full text-sm" style={{ minWidth: 640 }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Product</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">SKU</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Category</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">On Hand</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Reserved</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Available</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Reorder At</th>
              <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="text-center py-16 text-slate-500">Loading inventory...</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-16">
                  <div className="text-4xl mb-3">📦</div>
                  <div className="text-slate-400 font-medium">
                    {activeFilter === 'all' ? 'No tracked products yet — click "Not Tracked" to connect your products' : 'No products found'}
                  </div>
                </td>
              </tr>
            ) : filtered.map((m, i) => (
              <tr
                key={m.product.id}
                className="transition-colors"
                style={{
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(96,165,250,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)')}
              >
                <td className="px-4 py-3 font-medium text-white">{m.product.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400">{m.product.sku}</td>
                <td className="px-4 py-3 text-slate-400 capitalize text-xs">
                  {m.product.category || '—'}
                </td>
                {m.inv ? (
                  <>
                    <td className="px-4 py-3 text-right text-white font-medium">{m.inv.quantity_on_hand}</td>
                    <td className="px-4 py-3 text-right" style={{ color: '#a78bfa' }}>{m.inv.quantity_reserved}</td>
                    <td className="px-4 py-3 text-right font-bold text-white">{m.inv.quantity_available}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{m.inv.reorder_point}</td>
                    <td className="px-4 py-3 text-center">
                      <StockStatusBadge available={m.inv.quantity_available} reorderPoint={m.inv.reorder_point} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setAdjustModal(m)}
                        className="text-xs px-3 py-1.5 rounded-lg font-medium"
                        style={{ background: 'rgba(96,165,250,0.1)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.2)' }}
                      >
                        Adjust
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-3 text-right text-slate-600">—</td>
                    <td className="px-4 py-3 text-right text-slate-600">—</td>
                    <td className="px-4 py-3 text-right text-slate-600">—</td>
                    <td className="px-4 py-3 text-right text-slate-600">—</td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs text-slate-600 italic">not tracked</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => startTracking(m.product)}
                        className="text-xs px-3 py-1.5 rounded-lg font-medium"
                        style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)' }}
                      >
                        + Track
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Adjust Modal */}
      {adjustModal && adjustModal.inv && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6"
            style={{ background: '#0f1923', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <h3 className="text-white font-semibold text-lg mb-1">Adjust Stock</h3>
            <p className="text-slate-400 text-sm mb-4">
              {adjustModal.product.name}
              <span className="mx-2 text-slate-600">·</span>
              Available: <span className="text-white font-bold">{adjustModal.inv.quantity_available}</span>
            </p>
            <label className="block text-xs text-slate-500 mb-1.5">
              Quantity change <span className="text-slate-600">(+ to add · - to remove)</span>
            </label>
            <input
              type="number"
              value={adjustQty}
              onChange={e => setAdjustQty(e.target.value)}
              placeholder="e.g. 10 or -2"
              className="w-full rounded-xl px-3 py-2.5 text-white text-sm mb-3 focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
              onFocus={e => (e.target.style.borderColor = 'rgba(96,165,250,0.5)')}
              onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
            />
            <label className="block text-xs text-slate-500 mb-1.5">Note</label>
            <input
              value={adjustNote}
              onChange={e => setAdjustNote(e.target.value)}
              placeholder="Reason for adjustment"
              className="w-full rounded-xl px-3 py-2.5 text-white text-sm mb-4 focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => setAdjustModal(null)}
                className="flex-1 py-2.5 rounded-xl text-sm text-slate-400 transition-colors hover:text-white"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleAdjust}
                disabled={saving || !adjustQty}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
              >
                {saving ? 'Saving...' : 'Apply Adjustment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Reorder Requests ────────────────────────────────────────────────────

function ReorderTab() {
  const [rows, setRows] = useState<ReorderRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('open')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('reorder_requests')
      .select('*, products(name, sku), jobs(id)')
      .order('created_at', { ascending: false })
    setRows(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const STATUS_TABS = [
    { id: 'open',      label: 'Open',      color: '#fbbf24' },
    { id: 'ordered',   label: 'Ordered',   color: '#60a5fa' },
    { id: 'received',  label: 'Received',  color: '#4ade80' },
    { id: 'cancelled', label: 'Cancelled', color: '#64748b' },
    { id: 'all',       label: 'All',       color: '#94a3b8' },
  ]

  const filtered = rows.filter(r => activeTab === 'all' || r.status === activeTab)

  async function updateStatus(id: string, status: string) {
    await supabase.from('reorder_requests').update({ status }).eq('id', id)
    load()
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleCreatePO() {
    const items = rows.filter(r => selected.has(r.id))
    if (!items.length) return
    const poNumber = `PO-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`
    const { data: po } = await supabase
      .from('purchase_orders')
      .insert({ po_number: poNumber, status: 'draft', notes: `Created from ${items.length} reorder request(s)` })
      .select()
      .single()
    if (po) {
      await supabase.from('purchase_order_items').insert(
        items.map(r => ({
          purchase_order_id: po.id,
          product_id: r.product_id,
          qty_ordered: r.qty_requested,
          unit_cost: 0,
        }))
      )
      await supabase
        .from('reorder_requests')
        .update({ status: 'ordered' })
        .in('id', items.map(r => r.id))
    }
    setSelected(new Set())
    load()
  }

  return (
    <div>
      {/* Tab bar */}
      <div
        className="flex gap-1 mb-5 p-1 rounded-xl"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto', scrollbarWidth: 'none' }}
      >
        {STATUS_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex-shrink-0"
            style={
              activeTab === tab.id
                ? { background: `${tab.color}18`, color: tab.color, border: `1px solid ${tab.color}35` }
                : { color: '#64748b', border: '1px solid transparent' }
            }
          >
            {tab.label}
            {tab.id !== 'all' && (
              <span className="ml-1.5 opacity-60">
                ({rows.filter(r => r.status === tab.id).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Create PO banner */}
      {selected.size > 0 && (
        <div
          className="flex items-center justify-between mb-4 px-4 py-3 rounded-xl"
          style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)' }}
        >
          <span className="text-sm text-blue-300">
            {selected.size} item{selected.size > 1 ? 's' : ''} selected
          </span>
          <button
            onClick={handleCreatePO}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
          >
            Create Purchase Order
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ overflowX: 'auto' }}>
        <table className="w-full text-sm" style={{ minWidth: 600 }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <th className="px-4 py-3 w-8"></th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Product</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Type</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Qty Needed</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Created</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Notes</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-16 text-slate-500">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-16 text-slate-500">No reorder requests</td></tr>
            ) : filtered.map((r, i) => (
              <tr
                key={r.id}
                className="transition-colors"
                style={{
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(96,165,250,0.03)')}
                onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)')}
              >
                <td className="px-4 py-3">
                  {r.status === 'open' && (
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                      className="accent-blue-500 w-4 h-4"
                    />
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-white">{r.products?.name}</div>
                  <div className="text-xs text-slate-500 font-mono">{r.products?.sku}</div>
                </td>
                <td className="px-4 py-3"><StatusBadge val={r.request_type} /></td>
                <td className="px-4 py-3 text-right font-bold text-white">{r.qty_requested}</td>
                <td className="px-4 py-3"><StatusBadge val={r.status} /></td>
                <td className="px-4 py-3 text-slate-400 text-xs">{new Date(r.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-slate-500 text-xs truncate max-w-[200px]">{r.notes || '—'}</td>
                <td className="px-4 py-3 text-right">
                  {r.status === 'open' && (
                    <button
                      onClick={() => updateStatus(r.id, 'cancelled')}
                      className="text-xs px-2 py-1 text-slate-400 hover:text-red-400 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}

// ─── Tab: Purchase Orders ─────────────────────────────────────────────────────

function PurchaseOrdersTab() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('purchase_orders')
      .select(`
        *,
        product_vendors(name),
        purchase_order_items(
          id, product_id, qty_ordered, unit_cost,
          products(name, sku)
        )
      `)
      .order('created_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const STATUS_TABS = [
    { id: 'all',       color: '#94a3b8' },
    { id: 'draft',     color: '#64748b' },
    { id: 'sent',      color: '#60a5fa' },
    { id: 'confirmed', color: '#a78bfa' },
    { id: 'received',  color: '#4ade80' },
  ]

  const filtered = orders.filter(o => activeTab === 'all' || o.status === activeTab)

  async function updatePOStatus(id: string, status: string) {
    const updates: Record<string, unknown> = { status }
    if (status === 'sent')     updates.ordered_at  = new Date().toISOString()
    if (status === 'received') updates.received_at = new Date().toISOString()
    await supabase.from('purchase_orders').update(updates).eq('id', id)
    load()
  }

  return (
    <div>
      {/* Tab bar */}
      <div
        className="flex gap-1 mb-5 p-1 rounded-xl"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto', scrollbarWidth: 'none' }}
      >
        {STATUS_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all whitespace-nowrap flex-shrink-0"
            style={
              activeTab === tab.id
                ? { background: `${tab.color}18`, color: tab.color, border: `1px solid ${tab.color}35` }
                : { color: '#64748b', border: '1px solid transparent' }
            }
          >
            {tab.id}
            {tab.id !== 'all' && (
              <span className="ml-1.5 opacity-60">
                ({orders.filter(o => o.status === tab.id).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* PO list */}
      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-16 text-slate-500">Loading...</div>
        ) : filtered.length === 0 ? (
          <div
            className="text-center py-16 rounded-2xl text-slate-500"
            style={{ border: '1px solid rgba(255,255,255,0.06)' }}
          >
            No purchase orders
          </div>
        ) : filtered.map(po => (
          <div
            key={po.id}
            className="rounded-2xl overflow-hidden transition-all"
            style={{ border: `1px solid ${expanded === po.id ? 'rgba(96,165,250,0.2)' : 'rgba(255,255,255,0.06)'}` }}
          >
            {/* PO header row */}
            <div
              className="flex items-center gap-4 px-5 py-3.5 cursor-pointer transition-colors"
              style={{ background: expanded === po.id ? 'rgba(96,165,250,0.04)' : 'rgba(255,255,255,0.02)' }}
              onClick={() => setExpanded(expanded === po.id ? null : po.id)}
            >
              <span className="font-mono font-bold text-sm" style={{ color: '#60a5fa' }}>
                {po.po_number}
              </span>
              <StatusBadge val={po.status} />
              {po.product_vendors && (
                <span className="text-slate-400 text-sm">{po.product_vendors.name}</span>
              )}
              <span className="ml-auto text-slate-500 text-xs">
                {new Date(po.created_at).toLocaleDateString()}
              </span>
              {po.total_cost != null && (
                <span className="text-white font-semibold text-sm">${po.total_cost.toFixed(2)}</span>
              )}
              <span className="text-slate-400 text-xs">
                {po.purchase_order_items?.length || 0} items
              </span>
              <span className="text-slate-600 text-xs">{expanded === po.id ? '▲' : '▼'}</span>
            </div>

            {/* PO expanded detail */}
            {expanded === po.id && (
              <div className="px-5 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <table className="w-full text-sm mb-4">
                  <thead>
                    <tr
                      className="text-slate-500 text-xs uppercase tracking-wider"
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      <th className="text-left pb-2">Product</th>
                      <th className="text-right pb-2">Qty</th>
                      <th className="text-right pb-2">Unit Cost</th>
                      <th className="text-right pb-2">Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(po.purchase_order_items || []).map(item => (
                      <tr key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td className="py-2">
                          <div className="text-white">{item.products?.name}</div>
                          <div className="text-xs text-slate-500 font-mono">{item.products?.sku}</div>
                        </td>
                        <td className="py-2 text-right text-white">{item.qty_ordered}</td>
                        <td className="py-2 text-right text-slate-400">${item.unit_cost.toFixed(2)}</td>
                        <td className="py-2 text-right text-white">
                          ${(item.qty_ordered * item.unit_cost).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {po.notes && <p className="text-slate-400 text-xs mb-3">{po.notes}</p>}

                <div className="flex gap-2">
                  {po.status === 'draft' && (
                    <button
                      onClick={() => updatePOStatus(po.id, 'sent')}
                      className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
                      style={{ background: 'rgba(96,165,250,0.1)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.25)' }}
                    >
                      Mark Sent
                    </button>
                  )}
                  {po.status === 'sent' && (
                    <button
                      onClick={() => updatePOStatus(po.id, 'confirmed')}
                      className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
                      style={{ background: 'rgba(167,139,250,0.1)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.25)' }}
                    >
                      Mark Confirmed
                    </button>
                  )}
                  {(po.status === 'sent' || po.status === 'confirmed') && (
                    <button
                      onClick={() => updatePOStatus(po.id, 'received')}
                      className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
                      style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)' }}
                    >
                      Mark Received
                    </button>
                  )}
                  {po.status !== 'received' && po.status !== 'cancelled' && (
                    <button
                      onClick={() => updatePOStatus(po.id, 'cancelled')}
                      className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
                      style={{ background: 'rgba(248,113,113,0.08)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}
                    >
                      Cancel PO
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Tab: Receiving ───────────────────────────────────────────────────────────

function ReceivingTab() {
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PurchaseOrder | null>(null)
  const [receiveQtys, setReceiveQtys] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('purchase_orders')
      .select(`*, purchase_order_items(id, product_id, qty_ordered, unit_cost, products(name, sku))`)
      .in('status', ['sent', 'confirmed'])
      .order('created_at', { ascending: false })
    setPos(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openPO(po: PurchaseOrder) {
    setSelected(po)
    setDone(false)
    const qtys: Record<string, string> = {}
    ;(po.purchase_order_items || []).forEach(item => {
      qtys[item.id] = String(item.qty_ordered)
    })
    setReceiveQtys(qtys)
  }

  async function handleReceive() {
    if (!selected) return
    setSaving(true)
    for (const item of (selected.purchase_order_items || [])) {
      const qty = parseInt(receiveQtys[item.id] || '0')
      if (qty > 0) {
        // Get current inventory row
        const { data: inv } = await supabase
          .from('inventory')
          .select('id, quantity_on_hand, quantity_available')
          .eq('product_id', item.product_id)
          .single()

        if (inv) {
          await supabase.from('inventory').update({
            quantity_on_hand:   inv.quantity_on_hand + qty,
            quantity_available: inv.quantity_available + qty,
          }).eq('id', inv.id)
        }
      }
    }
    await supabase
      .from('purchase_orders')
      .update({ status: 'received', received_at: new Date().toISOString() })
      .eq('id', selected.id)
    setSaving(false)
    setDone(true)
    load()
  }

  if (loading) {
    return <div className="text-center py-16 text-slate-500">Loading...</div>
  }

  if (done) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">✅</div>
          <div className="text-white font-bold text-xl mb-2">Stock Received</div>
          <div className="text-slate-400 text-sm mb-6">
            {selected?.po_number} marked received. Inventory updated.
          </div>
          <button
            onClick={() => setSelected(null)}
            className="px-6 py-2.5 rounded-xl text-sm font-medium text-slate-300 transition-colors"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            Back to List
          </button>
        </div>
      </div>
    )
  }

  if (!selected) {
    return (
      <div>
        <p className="text-slate-500 text-sm mb-4">
          Select a purchase order to confirm receipt and update stock levels.
        </p>
        {pos.length === 0 ? (
          <div
            className="text-center py-16 rounded-2xl text-slate-500"
            style={{ border: '1px solid rgba(255,255,255,0.06)' }}
          >
            No pending purchase orders to receive
          </div>
        ) : (
          <div className="space-y-2">
            {pos.map(po => (
              <div
                key={po.id}
                className="flex items-center justify-between px-5 py-4 rounded-2xl cursor-pointer transition-all"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(96,165,250,0.3)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)')}
                onClick={() => openPO(po)}
              >
                <div>
                  <span className="font-mono font-bold text-sm" style={{ color: '#60a5fa' }}>
                    {po.po_number}
                  </span>
                  <span className="ml-3"><StatusBadge val={po.status} /></span>
                  <div className="text-slate-500 text-xs mt-1">
                    {po.purchase_order_items?.length} items
                  </div>
                </div>
                <button
                  className="px-5 py-2 rounded-xl text-sm font-semibold text-white"
                  style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
                >
                  Receive
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-lg">
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => setSelected(null)}
          className="text-slate-400 hover:text-white text-sm transition-colors"
        >
          ← Back
        </button>
        <span className="font-mono font-bold" style={{ color: '#60a5fa' }}>{selected.po_number}</span>
        <StatusBadge val={selected.status} />
      </div>

      <div
        className="rounded-2xl p-5 mb-4"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <p className="text-slate-500 text-xs uppercase tracking-wider font-semibold mb-4">
          Confirm quantities received
        </p>
        <div className="space-y-3">
          {(selected.purchase_order_items || []).map(item => (
            <div key={item.id} className="flex items-center gap-3">
              <div className="flex-1">
                <div className="text-white text-sm">{item.products?.name}</div>
                <div className="text-slate-500 text-xs font-mono">
                  {item.products?.sku} · Ordered: {item.qty_ordered}
                </div>
              </div>
              <input
                type="number"
                value={receiveQtys[item.id] || ''}
                onChange={e => setReceiveQtys(prev => ({ ...prev, [item.id]: e.target.value }))}
                className="w-20 rounded-xl px-2 py-2 text-white text-sm text-right focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
              />
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={handleReceive}
        disabled={saving}
        className="w-full py-3 rounded-xl font-semibold text-white transition-all disabled:opacity-40"
        style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
      >
        {saving ? 'Processing...' : 'Confirm Receipt & Update Stock'}
      </button>
    </div>
  )
}

// ─── Tab: Transaction History ─────────────────────────────────────────────────

function TransactionsTab() {
  const [rows, setRows] = useState<InventoryTx[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('inventory_transactions')
        .select('*, products(name, sku)')
        .order('created_at', { ascending: false })
        .limit(200)
      setRows(data || [])
      setLoading(false)
    })()
  }, [])

  const types = ['all', ...Array.from(new Set(rows.map(r => r.transaction_type)))]

  const filtered = rows.filter(r => {
    const matchSearch = !search
      || r.products?.name?.toLowerCase().includes(search.toLowerCase())
      || r.products?.sku?.toLowerCase().includes(search.toLowerCase())
    return matchSearch && (typeFilter === 'all' || r.transaction_type === typeFilter)
  })

  return (
    <div>
      <div className="flex gap-3 mb-5">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search product..."
          className="flex-1 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          onFocus={e => (e.target.style.borderColor = 'rgba(96,165,250,0.5)')}
          onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.08)')}
        />
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="rounded-xl px-4 py-2.5 text-sm text-slate-300 focus:outline-none"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {types.map(t => (
            <option key={t} value={t} style={{ background: '#0f1923' }}>
              {t === 'all' ? 'All Types' : `${TX_LABELS[t] || ''} ${t}`}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ overflowX: 'auto' }}>
        <table className="w-full text-sm" style={{ minWidth: 560 }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Date</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Product</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Type</th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Change</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Reference</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Notes</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-16 text-slate-500">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-16 text-slate-500">No transactions found</td></tr>
            ) : filtered.map((r, i) => (
              <tr
                key={r.id}
                className="transition-colors"
                style={{
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(96,165,250,0.03)')}
                onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)')}
              >
                <td className="px-4 py-3 text-xs whitespace-nowrap">
                  <div className="text-slate-400">{new Date(r.created_at).toLocaleDateString()}</div>
                  <div className="text-slate-600">
                    {new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-white">{r.products?.name}</div>
                  <div className="text-xs text-slate-500 font-mono">{r.products?.sku}</div>
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {TX_LABELS[r.transaction_type] || r.transaction_type}
                </td>
                <td
                  className="px-4 py-3 text-right font-bold text-lg"
                  style={{ color: r.qty > 0 ? '#4ade80' : '#f87171' }}
                >
                  {r.qty > 0 ? '+' : ''}{r.qty}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs capitalize">
                  {r.reference_type || '—'}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs truncate max-w-[180px]">
                  {r.notes || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const MAIN_TABS = [
  { id: 'stock',        label: 'Stock Levels',     icon: '📦' },
  { id: 'reorder',      label: 'Reorder Requests', icon: '⚠️' },
  { id: 'purchase',     label: 'Purchase Orders',  icon: '🛒' },
  { id: 'receiving',    label: 'Receiving',         icon: '✅' },
  { id: 'transactions', label: 'Transactions',      icon: '📋' },
]

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState('stock')

  return (
    <div className="min-h-full">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Inventory</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Stock levels, reorder requests, purchase orders, and receiving
          </p>
        </div>
      </div>

      {/* Module nav — pill tabs matching FollowUpsPage */}
      <div
        className="flex gap-1 mb-6 p-1 rounded-xl"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto', scrollbarWidth: 'none' }}
      >
        {MAIN_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex-shrink-0"
            style={
              activeTab === tab.id
                ? { background: 'rgba(96,165,250,0.15)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.3)' }
                : { color: '#64748b', border: '1px solid transparent' }
            }
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'stock'        && <StockLevelsTab />}
      {activeTab === 'reorder'      && <ReorderTab />}
      {activeTab === 'purchase'     && <PurchaseOrdersTab />}
      {activeTab === 'receiving'    && <ReceivingTab />}
      {activeTab === 'transactions' && <TransactionsTab />}
    </div>
  )
}
