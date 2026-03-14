// src/modules/inventory/InventoryPage.tsx

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

function useIsMobile() {
  const [v, setV] = useState(window.innerWidth < 768)
  useEffect(() => {
    const h = () => setV(window.innerWidth < 768)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return v
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: string
  name: string
  sku: string
  category: string
  is_active: boolean
  vendor_name?: string
  vendor_sku?: string
  vendor_cost?: number
}

interface InventoryRow {
  id: string
  product_id: string
  quantity_on_hand: number
  quantity_reserved: number
  quantity_available: number
  quantity_on_order: number
  reorder_point: number
}

interface MergedRow {
  product: Product
  inv: InventoryRow | null
}

interface ReorderRequest {
  id: string
  product_id: string
  request_type: string
  qty_requested: number
  status: string
  notes?: string
  created_at: string
  products: { name: string; sku: string }
}

interface POItem {
  id: string
  product_id: string
  qty_ordered: number
  unit_cost: number
  products: { name: string; sku: string }
}

interface PurchaseOrder {
  id: string
  po_number: string
  status: string
  total_cost?: number
  ordered_at?: string
  received_at?: string
  notes?: string
  created_at: string
  purchase_order_items?: POItem[]
}

interface InventoryTx {
  id: string
  product_id: string
  transaction_type: string
  qty: number
  reference_type?: string
  notes?: string
  created_at: string
  products: { name: string; sku: string }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CAT_LABELS: Record<string, string> = {
  ro: 'Reverse Osmosis', softener: 'Water Softener',
  whole_home_filter: 'Whole Home Filter', replacement_filter: 'Replacement Filter',
  accessory: 'Accessory', uv: 'UV Sterilization', iron_filter: 'Iron Filter',
  pfas: 'PFAS Filter', salt_free: 'Salt-Free', lead_filter: 'Lead Filter',
  well_water: 'Well Water',
}

const TX_LABELS: Record<string, string> = {
  receive: '📦 Receive', reserve: '🔒 Reserve', unreserve: '🔓 Unreserve',
  fulfill: '✅ Fulfill', adjustment: '✏️ Adjust', adjust: '✏️ Adjust',
  return: '↩️ Return',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${Number(n).toFixed(2)}`
}

function getStatusStyle(status: string): React.CSSProperties {
  const map: Record<string, [string, string]> = {
    open:                ['rgba(251,191,36,0.12)',  '#fbbf24'],
    ordered:             ['rgba(96,165,250,0.12)',  '#60a5fa'],
    received:            ['rgba(74,222,128,0.12)',  '#4ade80'],
    cancelled:           ['rgba(100,116,139,0.12)', '#64748b'],
    draft:               ['rgba(100,116,139,0.12)', '#94a3b8'],
    sent:                ['rgba(96,165,250,0.12)',  '#60a5fa'],
    confirmed:           ['rgba(167,139,250,0.12)', '#a78bfa'],
    job_shortage:        ['rgba(248,113,113,0.12)', '#f87171'],
    stock_replenishment: ['rgba(96,165,250,0.12)',  '#60a5fa'],
    low:                 ['rgba(251,191,36,0.12)',  '#fbbf24'],
    out_of_stock:        ['rgba(248,113,113,0.12)', '#f87171'],
    ok:                  ['rgba(74,222,128,0.12)',  '#4ade80'],
  }
  const [bg, color] = map[status] || ['rgba(100,116,139,0.12)', '#64748b']
  return { background: bg, color, border: `1px solid ${color}35`, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }
}

function Badge({ val, label }: { val: string; label?: string }) {
  return <span style={getStatusStyle(val)}>{label || val.replace(/_/g, ' ')}</span>
}

function StockBadge({ available, reorderPoint }: { available: number; reorderPoint: number }) {
  if (available <= 0)          return <Badge val="out_of_stock" label="Out of Stock" />
  if (available <= reorderPoint) return <Badge val="low" label="Low" />
  return <Badge val="ok" label="OK" />
}

function generatePONumber() {
  return `PO-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`
}

// ─── Opening Stock Modal ──────────────────────────────────────────────────────

function OpeningStockModal({
  rows, onClose, onDone
}: {
  rows: MergedRow[]
  onClose: () => void
  onDone: () => void
}) {
  const zeroRows = rows.filter(m => m.inv && m.inv.quantity_on_hand === 0)
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const visible = zeroRows.filter(m =>
    !search || m.product.name.toLowerCase().includes(search.toLowerCase()) || m.product.sku.toLowerCase().includes(search.toLowerCase())
  )

  async function handleSave() {
    const toUpdate = Object.entries(qtys).filter(([, v]) => v && parseInt(v) > 0)
    if (!toUpdate.length) { onClose(); return }
    setSaving(true)
    for (const [productId, qtyStr] of toUpdate) {
      const qty = parseInt(qtyStr)
      const invRow = rows.find(m => m.product.id === productId)?.inv
      if (!invRow) continue
      await supabase.from('inventory').update({
        quantity_on_hand: qty,
        quantity_available: Math.max(0, qty - invRow.quantity_reserved),
      }).eq('id', invRow.id)
    }
    setSaving(false)
    onDone()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
      <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 16, width: '100%', maxWidth: 600, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #1e3a4f', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 17 }}>Set Opening Stock</div>
            <div style={{ color: '#475569', fontSize: 12, marginTop: 3 }}>{zeroRows.length} products at zero — enter current quantities on hand</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '14px 24px', borderBottom: '1px solid #1e3a4f' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search product…"
            style={{ width: '100%', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {visible.map(m => (
            <div key={m.product.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 24px', borderBottom: '1px solid #0d1a26' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.product.name}</div>
                <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>{m.product.sku}</div>
              </div>
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#475569' }}>Qty on hand:</span>
                <input
                  type="number" min="0"
                  value={qtys[m.product.id] || ''}
                  onChange={e => setQtys(prev => ({ ...prev, [m.product.id]: e.target.value }))}
                  placeholder="0"
                  style={{ width: 72, background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '6px 10px', fontSize: 13, outline: 'none', textAlign: 'right' }}
                />
              </div>
            </div>
          ))}
          {visible.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: '#334155' }}>No products match your search</div>
          )}
        </div>
        <div style={{ padding: '16px 24px', borderTop: '1px solid #1e3a4f', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', fontSize: 13, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '10px 22px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 14, opacity: saving ? 0.5 : 1 }}>
            {saving ? 'Saving…' : `Save ${Object.values(qtys).filter(v => v && parseInt(v) > 0).length} quantities`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Quick Reorder Modal ──────────────────────────────────────────────────────

function QuickReorderModal({
  rows, onClose, onDone, onSwitchToPO
}: {
  rows: MergedRow[]
  onClose: () => void
  onDone: () => void
  onSwitchToPO: () => void
}) {
  const [qtys, setQtys] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    rows.forEach(m => { init[m.product.id] = '1' })
    return init
  })
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    setSaving(true)
    const items = rows.map(m => ({
      product: m.product,
      qty: parseInt(qtys[m.product.id] || '1'),
    })).filter(i => i.qty > 0)

    if (!items.length) { onClose(); return }

    const poNumber = generatePONumber()
    const { data: po } = await supabase
      .from('purchase_orders')
      .insert({ po_number: poNumber, status: 'draft', notes: notes || `Quick reorder — ${items.length} product(s)` })
      .select().single()

    if (po) {
      await supabase.from('purchase_order_items').insert(
        items.map(i => ({
          purchase_order_id: po.id,
          product_id: i.product.id,
          qty_ordered: i.qty,
          unit_cost: i.product.vendor_cost || 0,
        }))
      )
    }
    setSaving(false)
    onDone()
    onClose()
    onSwitchToPO()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
      <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #1e3a4f', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 17 }}>Quick Reorder — Draft PO</div>
            <div style={{ color: '#475569', fontSize: 12, marginTop: 3 }}>{rows.length} product{rows.length !== 1 ? 's' : ''} selected · Set quantities then create</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {rows.map(m => (
            <div key={m.product.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px', borderBottom: '1px solid #0d1a26' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.product.name}</div>
                <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace', marginTop: 2 }}>
                  {m.product.sku}
                  {m.product.vendor_name && <span style={{ marginLeft: 8, color: '#fbbf24' }}>· {m.product.vendor_name}</span>}
                  {m.product.vendor_sku && <span style={{ marginLeft: 6, color: '#64748b' }}>{m.product.vendor_sku}</span>}
                </div>
                {m.product.vendor_cost && (
                  <div style={{ fontSize: 11, color: '#4ade80', marginTop: 2 }}>Cost: {fmt$(m.product.vendor_cost)} · Line: {fmt$((m.product.vendor_cost || 0) * parseInt(qtys[m.product.id] || '1'))}</div>
                )}
              </div>
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#475569' }}>Qty:</span>
                <input
                  type="number" min="1"
                  value={qtys[m.product.id] || '1'}
                  onChange={e => setQtys(prev => ({ ...prev, [m.product.id]: e.target.value }))}
                  style={{ width: 64, background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '6px 10px', fontSize: 13, outline: 'none', textAlign: 'right' }}
                />
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: '14px 24px', borderTop: '1px solid #1e3a4f' }}>
          <input
            value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            style={{ width: '100%', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ padding: '12px 24px', borderTop: '1px solid #1e3a4f', display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#334155', marginRight: 'auto' }}>Creates a Draft PO — review before sending to vendor</span>
          <button onClick={onClose} style={{ padding: '8px 16px', fontSize: 13, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleCreate} disabled={saving} style={{ padding: '10px 22px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 14, opacity: saving ? 0.5 : 1 }}>
            {saving ? 'Creating…' : 'Create Draft PO'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Create PO Modal ──────────────────────────────────────────────────────────

function CreatePOModal({ allProducts, onClose, onDone }: {
  allProducts: Product[]
  onClose: () => void
  onDone: () => void
}) {
  const [search, setSearch] = useState('')
  const [lines, setLines] = useState<{ product: Product; qty: string; cost: string }[]>([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const available = allProducts.filter(p =>
    !lines.find(l => l.product.id === p.id) &&
    (p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase()))
  ).slice(0, 20)

  function addProduct(p: Product) {
    setLines(prev => [...prev, { product: p, qty: '1', cost: p.vendor_cost ? String(p.vendor_cost) : '' }])
    setSearch('')
  }

  function removeLine(id: string) {
    setLines(prev => prev.filter(l => l.product.id !== id))
  }

  function updateLine(id: string, field: 'qty' | 'cost', val: string) {
    setLines(prev => prev.map(l => l.product.id === id ? { ...l, [field]: val } : l))
  }

  const totalCost = lines.reduce((s, l) => s + (parseFloat(l.cost || '0') * parseInt(l.qty || '0')), 0)

  async function handleCreate() {
    if (!lines.length) return
    setSaving(true)
    const poNumber = generatePONumber()
    const { data: po } = await supabase
      .from('purchase_orders')
      .insert({ po_number: poNumber, status: 'draft', total_cost: totalCost, notes })
      .select().single()
    if (po) {
      await supabase.from('purchase_order_items').insert(
        lines.map(l => ({
          purchase_order_id: po.id,
          product_id: l.product.id,
          qty_ordered: parseInt(l.qty || '1'),
          unit_cost: parseFloat(l.cost || '0'),
        }))
      )
    }
    setSaving(false)
    onDone()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
      <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 16, width: '100%', maxWidth: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #1e3a4f', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 17 }}>Create Purchase Order</div>
            <div style={{ color: '#475569', fontSize: 12, marginTop: 3 }}>Search products → add lines → set quantities and costs</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        {/* Product search */}
        <div style={{ padding: '14px 24px', borderBottom: '1px solid #1e3a4f', position: 'relative' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search products to add…"
            style={{ width: '100%', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '9px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
          {search && available.length > 0 && (
            <div style={{ position: 'absolute', left: 24, right: 24, top: '100%', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, zIndex: 10, maxHeight: 220, overflowY: 'auto' }}>
              {available.map(p => (
                <div key={p.id} onClick={() => addProduct(p)}
                  style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #0d1a26' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1e3a4f' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                  <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>
                    {p.sku}
                    {p.vendor_name && <span style={{ marginLeft: 8, color: '#fbbf24' }}>· {p.vendor_name}</span>}
                    {p.vendor_cost && <span style={{ marginLeft: 6, color: '#4ade80' }}>{fmt$(p.vendor_cost)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Line items */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {lines.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#334155', fontSize: 13 }}>Search and add products above</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 36px', gap: 0, padding: '8px 24px', borderBottom: '1px solid #1e3a4f' }}>
                {['Product', 'Qty', 'Unit Cost', ''].map(h => (
                  <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
                ))}
              </div>
              {lines.map(l => (
                <div key={l.product.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 36px', gap: 8, padding: '10px 24px', borderBottom: '1px solid #0d1a26', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.product.name}</div>
                    <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>
                      {l.product.sku}
                      {l.product.vendor_sku && <span style={{ marginLeft: 6, color: '#64748b' }}>{l.product.vendor_sku}</span>}
                    </div>
                  </div>
                  <input type="number" min="1" value={l.qty} onChange={e => updateLine(l.product.id, 'qty', e.target.value)}
                    style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 6, color: '#e2e8f0', padding: '6px 8px', fontSize: 13, outline: 'none', textAlign: 'right', width: '100%', boxSizing: 'border-box' }} />
                  <input type="number" min="0" step="0.01" value={l.cost} onChange={e => updateLine(l.product.id, 'cost', e.target.value)}
                    placeholder="0.00"
                    style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 6, color: '#e2e8f0', padding: '6px 8px', fontSize: 13, outline: 'none', textAlign: 'right', width: '100%', boxSizing: 'border-box' }} />
                  <button onClick={() => removeLine(l.product.id)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 16 }}>×</button>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 24px', borderTop: '1px solid #1e3a4f' }}>
                <span style={{ fontSize: 13, color: '#94a3b8' }}>Total: <strong style={{ color: '#4ade80' }}>{fmt$(totalCost)}</strong></span>
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '12px 24px', borderTop: '1px solid #1e3a4f' }}>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)"
            style={{ width: '100%', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div style={{ padding: '12px 24px', borderTop: '1px solid #1e3a4f', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', fontSize: 13, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleCreate} disabled={saving || lines.length === 0}
            style={{ padding: '10px 22px', borderRadius: 8, border: 'none', cursor: 'pointer', background: lines.length ? '#0d7ea3' : '#334155', color: '#fff', fontWeight: 700, fontSize: 14, opacity: saving ? 0.5 : 1 }}>
            {saving ? 'Creating…' : `Create Draft PO (${lines.length} line${lines.length !== 1 ? 's' : ''})`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Stock Levels Tab ─────────────────────────────────────────────────────────

function StockLevelsTab({ onSwitchToPO }: { onSwitchToPO: () => void }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isMobile = useIsMobile()

  const [merged, setMerged] = useState<MergedRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<'all' | 'low' | 'short' | 'untracked'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [adjustModal, setAdjustModal] = useState<MergedRow | null>(null)
  const [adjustQty, setAdjustQty] = useState('')
  const [adjustNote, setAdjustNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [trackingAll, setTrackingAll] = useState(false)
  const [showOpeningStock, setShowOpeningStock] = useState(false)
  const [showReorderModal, setShowReorderModal] = useState(false)
  const [reorderRows, setReorderRows] = useState<MergedRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    const { data: products } = await supabase
      .from('products')
      .select('id, name, sku, category, is_active, vendor_name, vendor_sku, vendor_cost')
      .order('name')

    const { data: invRows } = await supabase.from('inventory').select('*')
    const invMap: Record<string, InventoryRow> = {}
    for (const row of (invRows || [])) invMap[row.product_id] = row

    const result: MergedRow[] = (products || []).map(p => ({
      product: p as Product,
      inv: invMap[p.id] || null,
    }))
    setMerged(result)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function startTracking(product: Product) {
    await supabase.from('inventory').insert({
      product_id: product.id, quantity_on_hand: 0, quantity_reserved: 0,
      quantity_available: 0, quantity_on_order: 0, reorder_point: 2,
    })
    load()
  }

  async function trackAllProducts() {
    setTrackingAll(true)
    const untracked = merged.filter(m => !m.inv)
    for (const m of untracked) {
      await supabase.from('inventory').insert({
        product_id: m.product.id, quantity_on_hand: 0, quantity_reserved: 0,
        quantity_available: 0, quantity_on_order: 0, reorder_point: 2,
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
      await supabase.from('inventory').update({
        quantity_on_hand:   Math.max(0, inv.quantity_on_hand   + delta),
        quantity_available: Math.max(0, inv.quantity_available + delta),
      }).eq('id', inv.id)
    }
    setAdjustModal(null); setAdjustQty(''); setAdjustNote('')
    setSaving(false); load()
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function openQuickReorder(rows: MergedRow[]) {
    setReorderRows(rows)
    setShowReorderModal(true)
  }

  const tracked   = merged.filter(m => m.inv)
  const untracked = merged.filter(m => !m.inv)
  const shortRows = tracked.filter(m => m.inv!.quantity_available <= 0)
  const lowRows   = tracked.filter(m => m.inv!.quantity_available > 0 && m.inv!.quantity_available <= m.inv!.reorder_point)
  const zeroQtyTracked = tracked.filter(m => m.inv!.quantity_on_hand === 0)

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
      || (m.product.vendor_name && m.product.vendor_name.toLowerCase().includes(q))
      || (m.product.vendor_sku && m.product.vendor_sku.toLowerCase().includes(q))
    if (activeFilter === 'untracked') return matchSearch && !m.inv
    if (!m.inv) return false
    const matchFilter =
      activeFilter === 'all'   ? true :
      activeFilter === 'short' ? m.inv.quantity_available <= 0 :
      activeFilter === 'low'   ? m.inv.quantity_available > 0 && m.inv.quantity_available <= m.inv.reorder_point
      : true
    return matchSearch && matchFilter
  })

  const selectedRows = filtered.filter(m => selected.has(m.product.id) && m.inv)

  return (
    <div>
      {/* Filter tabs */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${FILTER_TABS.length}, 1fr)`, gap: 3, marginBottom: 16 }}>
        {FILTER_TABS.map(tab => {
          const isActive = activeFilter === tab.id
          return (
            <button key={tab.id} onClick={() => setActiveFilter(tab.id as any)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 12, border: `1px solid ${isActive ? tab.color + '50' : 'rgba(255,255,255,0.06)'}`, background: isActive ? `${tab.color}18` : 'rgba(255,255,255,0.02)', cursor: 'pointer', boxShadow: isActive ? `0 0 18px ${tab.color}18` : 'none' }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: isActive ? tab.color : '#64748b', marginBottom: 4 }}>{tab.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: isActive ? tab.color : '#94a3b8' }}>{tab.count}</div>
              </div>
              {isActive && <div style={{ width: 8, height: 8, borderRadius: '50%', background: tab.color, boxShadow: `0 0 8px ${tab.color}` }} />}
            </button>
          )
        })}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Total On Hand',     value: tracked.reduce((s, m) => s + m.inv!.quantity_on_hand, 0),       color: '#60a5fa' },
          { label: 'Reserved for Jobs', value: tracked.reduce((s, m) => s + m.inv!.quantity_reserved, 0),      color: '#a78bfa' },
          { label: 'Available to Sell', value: tracked.reduce((s, m) => s + m.inv!.quantity_available, 0),     color: '#4ade80' },
          { label: 'On Order',          value: tracked.reduce((s, m) => s + (m.inv!.quantity_on_order || 0), 0), color: '#fbbf24' },
        ].map(s => (
          <div key={s.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '10px 14px' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product, vendor, SKU…"
          style={{ flex: 1, minWidth: 180, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#e2e8f0', padding: '9px 14px', fontSize: 13, outline: 'none' }} />
        {zeroQtyTracked.length > 0 && isAdmin && (
          <button onClick={() => setShowOpeningStock(true)}
            style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid rgba(167,139,250,0.3)', background: 'rgba(167,139,250,0.1)', color: '#a78bfa', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            📦 Set Opening Stock ({zeroQtyTracked.length})
          </button>
        )}
        {untracked.length > 0 && (
          <button onClick={trackAllProducts} disabled={trackingAll}
            style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.3)', background: 'rgba(96,165,250,0.1)', color: '#60a5fa', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', opacity: trackingAll ? 0.5 : 1 }}>
            {trackingAll ? 'Setting up…' : `Track All (${untracked.length})`}
          </button>
        )}
      </div>

      {/* Selection banner */}
      {selectedRows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', marginBottom: 12, background: 'rgba(13,126,163,0.1)', border: '1px solid rgba(13,126,163,0.3)', borderRadius: 10 }}>
          <span style={{ fontSize: 13, color: '#38bdf8' }}>
            {selectedRows.length} product{selectedRows.length !== 1 ? 's' : ''} selected
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setSelected(new Set())}
              style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #1e3a4f', background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 12 }}>Clear</button>
            <button onClick={() => openQuickReorder(selectedRows)}
              style={{ padding: '5px 14px', borderRadius: 8, border: 'none', background: '#0d7ea3', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
              🛒 Reorder Selected → Draft PO
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr style={{ background: '#0f1923', borderBottom: '1px solid #1e3a4f' }}>
                <th style={{ width: 36, padding: '10px 12px' }}></th>
                <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Product</th>
                <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>SKU</th>
                <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Category</th>
                <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Vendor</th>
                <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>On Hand</th>
                <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Reserved</th>
                <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Available</th>
                <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Reorder At</th>
                {isAdmin && <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Cost</th>}
                <th style={{ textAlign: 'center', padding: '10px 14px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Status</th>
                <th style={{ padding: '10px 14px' }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Loading inventory…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={12} style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>No products found</td></tr>
              ) : filtered.map((m, i) => (
                <tr key={m.product.id} style={{ borderBottom: '1px solid #0d1a26', background: selected.has(m.product.id) ? 'rgba(13,126,163,0.08)' : 'transparent' }}
                  onMouseEnter={e => { if (!selected.has(m.product.id)) (e.currentTarget as HTMLElement).style.background = 'rgba(96,165,250,0.04)' }}
                  onMouseLeave={e => { if (!selected.has(m.product.id)) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    {m.inv && (
                      <input type="checkbox" checked={selected.has(m.product.id)} onChange={() => toggleSelect(m.product.id)}
                        style={{ accentColor: '#0d7ea3', width: 14, height: 14, cursor: 'pointer' }} />
                    )}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{m.product.name}</div>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{m.product.sku}</td>
                  <td style={{ padding: '10px 14px', fontSize: 11, color: '#64748b' }}>{CAT_LABELS[m.product.category] || m.product.category}</td>
                  <td style={{ padding: '10px 14px' }}>
                    {m.product.vendor_name && (
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#fbbf24' }}>{m.product.vendor_name}</div>
                    )}
                    {m.product.vendor_sku && (
                      <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace', marginTop: 1 }}>{m.product.vendor_sku}</div>
                    )}
                    {!m.product.vendor_name && !m.product.vendor_sku && <span style={{ color: '#334155' }}>—</span>}
                  </td>
                  {m.inv ? (
                    <>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#e2e8f0' }}>{m.inv.quantity_on_hand}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#a78bfa' }}>{m.inv.quantity_reserved}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: '#e2e8f0' }}>{m.inv.quantity_available}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#64748b' }}>{m.inv.reorder_point}</td>
                      {isAdmin && <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, color: m.product.vendor_cost ? '#4ade80' : '#334155' }}>{fmt$(m.product.vendor_cost)}</td>}
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <StockBadge available={m.inv.quantity_available} reorderPoint={m.inv.reorder_point} />
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button onClick={() => setAdjustModal(m)}
                            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, border: '1px solid rgba(96,165,250,0.3)', background: 'rgba(96,165,250,0.1)', color: '#60a5fa', cursor: 'pointer', fontWeight: 600 }}>
                            Adjust
                          </button>
                          <button onClick={() => openQuickReorder([m])}
                            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, border: '1px solid rgba(13,126,163,0.3)', background: 'rgba(13,126,163,0.1)', color: '#0d7ea3', cursor: 'pointer', fontWeight: 600 }}>
                            🛒 Reorder
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      {[0,1,2,3].map(k => <td key={k} style={{ padding: '10px 14px', textAlign: 'right', color: '#334155' }}>—</td>)}
                      {isAdmin && <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, color: m.product.vendor_cost ? '#4ade80' : '#334155' }}>{fmt$(m.product.vendor_cost)}</td>}
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <span style={{ fontSize: 11, color: '#334155', fontStyle: 'italic' }}>not tracked</span>
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                        <button onClick={() => startTracking(m.product)}
                          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, border: '1px solid rgba(74,222,128,0.3)', background: 'rgba(74,222,128,0.1)', color: '#4ade80', cursor: 'pointer', fontWeight: 600 }}>
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
      {adjustModal?.inv && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
          <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 16, width: '100%', maxWidth: 360, padding: 24 }}>
            <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Adjust Stock</div>
            <div style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>
              {adjustModal.product.name}
              <span style={{ margin: '0 8px', color: '#334155' }}>·</span>
              Available: <strong style={{ color: '#e2e8f0' }}>{adjustModal.inv.quantity_available}</strong>
            </div>
            <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 6 }}>Quantity change (+ add · − remove)</label>
            <input type="number" value={adjustQty} onChange={e => setAdjustQty(e.target.value)} placeholder="e.g. 10 or -2"
              style={{ width: '100%', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '9px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 12 }} />
            <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 6 }}>Note</label>
            <input value={adjustNote} onChange={e => setAdjustNote(e.target.value)} placeholder="Reason for adjustment"
              style={{ width: '100%', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '9px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 16 }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setAdjustModal(null)} style={{ flex: 1, padding: '10px 0', borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={handleAdjust} disabled={saving || !adjustQty}
                style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: saving || !adjustQty ? 0.5 : 1 }}>
                {saving ? 'Saving…' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {showOpeningStock && (
        <OpeningStockModal rows={merged} onClose={() => setShowOpeningStock(false)} onDone={load} />
      )}
      {showReorderModal && (
        <QuickReorderModal rows={reorderRows} onClose={() => setShowReorderModal(false)} onDone={load} onSwitchToPO={onSwitchToPO} />
      )}
    </div>
  )
}

// ─── Reorder Requests Tab ─────────────────────────────────────────────────────

function ReorderTab() {
  const [rows, setRows] = useState<ReorderRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('open')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [productMap, setProductMap] = useState<Record<string, {name: string; sku: string}>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('reorder_requests').select('*').order('created_at', { ascending: false })
    setRows(data || [])
    // Fetch product names
    const ids = [...new Set((data || []).map((r: any) => r.product_id).filter(Boolean))]
    if (ids.length) {
      const { data: prods } = await supabase.from('products').select('id, name, sku').in('id', ids)
      const map: Record<string, {name: string; sku: string}> = {}
      for (const p of (prods || [])) map[p.id] = { name: p.name, sku: p.sku }
      setProductMap(map)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const STATUS_TABS = [
    { id: 'open', label: 'Open', color: '#fbbf24' }, { id: 'ordered', label: 'Ordered', color: '#60a5fa' },
    { id: 'received', label: 'Received', color: '#4ade80' }, { id: 'cancelled', label: 'Cancelled', color: '#64748b' },
    { id: 'all', label: 'All', color: '#94a3b8' },
  ]
  const filtered = rows.filter(r => activeTab === 'all' || r.status === activeTab)

  async function updateStatus(id: string, status: string) {
    await supabase.from('reorder_requests').update({ status }).eq('id', id); load()
  }
  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  async function handleCreatePO() {
    const items = rows.filter(r => selected.has(r.id))
    if (!items.length) return
    const poNumber = generatePONumber()
    const { data: po } = await supabase.from('purchase_orders').insert({ po_number: poNumber, status: 'draft', notes: `From ${items.length} reorder request(s)` }).select().single()
    if (po) {
      await supabase.from('purchase_order_items').insert(items.map(r => ({ purchase_order_id: po.id, product_id: r.product_id, qty_ordered: r.qty_requested, unit_cost: 0 })))
      await supabase.from('reorder_requests').update({ status: 'ordered' }).in('id', items.map(r => r.id))
    }
    setSelected(new Set()); load()
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, padding: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, overflowX: 'auto' }}>
        {STATUS_TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, border: activeTab === tab.id ? `1px solid ${tab.color}35` : '1px solid transparent', background: activeTab === tab.id ? `${tab.color}18` : 'transparent', color: activeTab === tab.id ? tab.color : '#64748b' }}>
            {tab.label} {tab.id !== 'all' && `(${rows.filter(r => r.status === tab.id).length})`}
          </button>
        ))}
      </div>
      {selected.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', marginBottom: 12, background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 10 }}>
          <span style={{ fontSize: 13, color: '#60a5fa' }}>{selected.size} selected</span>
          <button onClick={handleCreatePO} style={{ padding: '6px 16px', borderRadius: 8, border: 'none', background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Create Draft PO</button>
        </div>
      )}
      <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr style={{ background: '#0f1923', borderBottom: '1px solid #1e3a4f' }}>
                {['', 'Product', 'Type', 'Qty Needed', 'Status', 'Created', 'Notes', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: h === 'Qty Needed' ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Loading…</td></tr>
                : filtered.length === 0 ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>No reorder requests</td></tr>
                : filtered.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #0d1a26' }}>
                    <td style={{ padding: '10px 14px' }}>
                      {r.status === 'open' && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} style={{ accentColor: '#0d7ea3', cursor: 'pointer' }} />}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{productMap[r.product_id]?.name || r.product_id?.slice(0,8)}</div>
                      <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>{productMap[r.product_id]?.sku || '—'}</div>
                    </td>
                    <td style={{ padding: '10px 14px' }}><Badge val={r.request_type} /></td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: '#e2e8f0' }}>{r.qty_requested}</td>
                    <td style={{ padding: '10px 14px' }}><Badge val={r.status} /></td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: '#64748b' }}>{new Date(r.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: '#64748b', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.notes || '—'}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                      {r.status === 'open' && <button onClick={() => updateStatus(r.id, 'cancelled')} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(248,113,113,0.2)', background: 'transparent', color: '#f87171', cursor: 'pointer' }}>Cancel</button>}
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

// ─── Purchase Orders Tab ──────────────────────────────────────────────────────

function PurchaseOrdersTab({ allProducts }: { allProducts: Product[] }) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('all')
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('purchase_orders').select('*, purchase_order_items(id, product_id, qty_ordered, unit_cost)').order('created_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const STATUS_TABS = [
    { id: 'all', color: '#94a3b8' }, { id: 'draft', color: '#64748b' },
    { id: 'sent', color: '#60a5fa' }, { id: 'confirmed', color: '#a78bfa' }, { id: 'received', color: '#4ade80' },
  ]
  const filtered = orders.filter(o => activeTab === 'all' || o.status === activeTab)

  async function updatePOStatus(id: string, status: string) {
    const updates: Record<string, unknown> = { status }
    if (status === 'sent') updates.ordered_at = new Date().toISOString()
    if (status === 'received') updates.received_at = new Date().toISOString()
    await supabase.from('purchase_orders').update(updates).eq('id', id); load()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, overflowX: 'auto' }}>
          {STATUS_TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, border: activeTab === tab.id ? `1px solid ${tab.color}35` : '1px solid transparent', background: activeTab === tab.id ? `${tab.color}18` : 'transparent', color: activeTab === tab.id ? tab.color : '#64748b', textTransform: 'capitalize' }}>
              {tab.id} {tab.id !== 'all' && `(${orders.filter(o => o.status === tab.id).length})`}
            </button>
          ))}
        </div>
        <button onClick={() => setShowCreate(true)}
          style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          + Create PO
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Loading…</div>
          : filtered.length === 0 ? <div style={{ textAlign: 'center', padding: 60, color: '#64748b', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14 }}>No purchase orders</div>
          : filtered.map(po => (
            <div key={po.id} style={{ background: '#162232', border: `1px solid ${expanded === po.id ? 'rgba(96,165,250,0.3)' : '#1e3a4f'}`, borderRadius: 14, overflow: 'hidden' }}>
              <div onClick={() => setExpanded(expanded === po.id ? null : po.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', cursor: 'pointer', background: expanded === po.id ? 'rgba(96,165,250,0.04)' : 'transparent', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: '#60a5fa' }}>{po.po_number}</span>
                <Badge val={po.status} />
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#475569' }}>{new Date(po.created_at).toLocaleDateString()}</span>
                {po.total_cost != null && <span style={{ fontSize: 13, fontWeight: 700, color: '#4ade80' }}>{fmt$(po.total_cost)}</span>}
                <span style={{ fontSize: 12, color: '#475569' }}>{po.purchase_order_items?.length || 0} items</span>
                <span style={{ color: '#334155' }}>{expanded === po.id ? '▲' : '▼'}</span>
              </div>
              {expanded === po.id && (
                <div style={{ padding: '16px 18px', borderTop: '1px solid #1e3a4f' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #1e3a4f' }}>
                        {['Product', 'Qty', 'Unit Cost', 'Line Total'].map((h, i) => (
                          <th key={h} style={{ padding: '6px 10px', textAlign: i === 0 ? 'left' : 'right', fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(po.purchase_order_items || []).map(item => (
                        <tr key={item.id} style={{ borderBottom: '1px solid #0d1a26' }}>
                          <td style={{ padding: '8px 10px' }}>
                            <div style={{ fontSize: 13, color: '#e2e8f0' }}>{allProducts.find(p => p.id === item.product_id)?.name || item.product_id?.slice(0,8)}</div>
                            <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>{allProducts.find(p => p.id === item.product_id)?.sku || '—'}</div>
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', color: '#e2e8f0', fontWeight: 700 }}>{item.qty_ordered}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', color: '#64748b' }}>{fmt$(item.unit_cost)}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', color: '#e2e8f0' }}>{fmt$(item.qty_ordered * item.unit_cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {po.notes && <p style={{ fontSize: 12, color: '#475569', marginBottom: 12 }}>{po.notes}</p>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    {po.status === 'draft' && <button onClick={() => updatePOStatus(po.id, 'sent')} style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid rgba(96,165,250,0.25)', background: 'rgba(96,165,250,0.1)', color: '#60a5fa', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Mark Sent</button>}
                    {po.status === 'sent' && <button onClick={() => updatePOStatus(po.id, 'confirmed')} style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid rgba(167,139,250,0.25)', background: 'rgba(167,139,250,0.1)', color: '#a78bfa', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Mark Confirmed</button>}
                    {(po.status === 'sent' || po.status === 'confirmed') && <button onClick={() => updatePOStatus(po.id, 'received')} style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid rgba(74,222,128,0.25)', background: 'rgba(74,222,128,0.1)', color: '#4ade80', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Mark Received</button>}
                    {po.status !== 'received' && po.status !== 'cancelled' && <button onClick={() => updatePOStatus(po.id, 'cancelled')} style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.2)', background: 'rgba(248,113,113,0.08)', color: '#f87171', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Cancel PO</button>}
                  </div>
                </div>
              )}
            </div>
          ))}
      </div>

      {showCreate && <CreatePOModal allProducts={allProducts} onClose={() => setShowCreate(false)} onDone={load} />}
    </div>
  )
}

// ─── Receiving Tab ────────────────────────────────────────────────────────────

function ReceivingTab() {
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PurchaseOrder | null>(null)
  const [receiveQtys, setReceiveQtys] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const [productMap, setProductMap] = useState<Record<string, {name: string; sku: string}>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('purchase_orders').select('*, purchase_order_items(id, product_id, qty_ordered, unit_cost)').in('status', ['sent', 'confirmed']).order('created_at', { ascending: false })
    setPos(data || [])
    // Fetch product names for all items
    const ids = [...new Set((data || []).flatMap((po: any) => (po.purchase_order_items || []).map((i: any) => i.product_id)).filter(Boolean))]
    if (ids.length) {
      const { data: prods } = await supabase.from('products').select('id, name, sku').in('id', ids)
      const map: Record<string, {name: string; sku: string}> = {}
      for (const p of (prods || [])) map[p.id] = { name: p.name, sku: p.sku }
      setProductMap(map)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openPO(po: PurchaseOrder) {
    setSelected(po); setDone(false)
    const qtys: Record<string, string> = {}
    ;(po.purchase_order_items || []).forEach(item => { qtys[item.id] = String(item.qty_ordered) })
    setReceiveQtys(qtys)
  }

  async function handleReceive() {
    if (!selected) return
    setSaving(true)
    for (const item of (selected.purchase_order_items || [])) {
      const qty = parseInt(receiveQtys[item.id] || '0')
      if (qty > 0) {
        const { data: inv } = await supabase.from('inventory').select('id, quantity_on_hand, quantity_available').eq('product_id', item.product_id).single()
        if (inv) await supabase.from('inventory').update({ quantity_on_hand: inv.quantity_on_hand + qty, quantity_available: inv.quantity_available + qty }).eq('id', inv.id)
      }
    }
    await supabase.from('purchase_orders').update({ status: 'received', received_at: new Date().toISOString() }).eq('id', selected.id)
    setSaving(false); setDone(true); load()
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Loading…</div>

  if (done) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <div style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 20, marginBottom: 8 }}>Stock Received</div>
        <div style={{ color: '#475569', fontSize: 13, marginBottom: 24 }}>{selected?.po_number} marked received. Inventory updated.</div>
        <button onClick={() => setSelected(null)} style={{ padding: '10px 24px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer', fontSize: 13 }}>Back to List</button>
      </div>
    </div>
  )

  if (!selected) return (
    <div>
      <p style={{ color: '#475569', fontSize: 13, marginBottom: 16 }}>Select a purchase order to confirm receipt and update stock levels.</p>
      {pos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#475569', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14 }}>No pending purchase orders to receive</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pos.map(po => (
            <div key={po.id} onClick={() => openPO(po)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 12, cursor: 'pointer' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(96,165,250,0.3)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1e3a4f' }}>
              <div>
                <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: '#60a5fa' }}>{po.po_number}</span>
                <span style={{ marginLeft: 12 }}><Badge val={po.status} /></span>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>{po.purchase_order_items?.length} items</div>
              </div>
              <button style={{ padding: '8px 18px', borderRadius: 10, border: 'none', background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Receive</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div style={{ maxWidth: 500 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => setSelected(null)} style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>← Back</button>
        <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#60a5fa', fontSize: 13 }}>{selected.po_number}</span>
        <Badge val={selected.status} />
      </div>
      <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <p style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 14 }}>Confirm quantities received</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(selected.purchase_order_items || []).map(item => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: '#e2e8f0' }}>{productMap[item.product_id]?.name || item.product_id?.slice(0,8)}</div>
                <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>{productMap[item.product_id]?.sku || '—'} · Ordered: {item.qty_ordered}</div>
              </div>
              <input type="number" value={receiveQtys[item.id] || ''} onChange={e => setReceiveQtys(prev => ({ ...prev, [item.id]: e.target.value }))}
                style={{ width: 72, background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '7px 10px', fontSize: 13, outline: 'none', textAlign: 'right' }} />
            </div>
          ))}
        </div>
      </div>
      <button onClick={handleReceive} disabled={saving}
        style={{ width: '100%', padding: '12px 0', borderRadius: 12, border: 'none', background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: saving ? 0.5 : 1 }}>
        {saving ? 'Processing…' : 'Confirm Receipt & Update Stock'}
      </button>
    </div>
  )
}

// ─── Transactions Tab ─────────────────────────────────────────────────────────

function TransactionsTab() {
  const [rows, setRows] = useState<InventoryTx[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  const [productMap, setProductMap] = useState<Record<string, {name: string; sku: string}>>({})

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const { data } = await supabase.from('inventory_transactions').select('*').order('created_at', { ascending: false }).limit(200)
      setRows(data || [])
      const ids = [...new Set((data || []).map((r: any) => r.product_id).filter(Boolean))]
      if (ids.length) {
        const { data: prods } = await supabase.from('products').select('id, name, sku').in('id', ids)
        const map: Record<string, {name: string; sku: string}> = {}
        for (const p of (prods || [])) map[p.id] = { name: p.name, sku: p.sku }
        setProductMap(map)
      }
      setLoading(false)
    })()
  }, [])

  const types = ['all', ...Array.from(new Set(rows.map(r => r.transaction_type)))]
  const filtered = rows.filter(r => {
    const matchSearch = !search || productMap[r.product_id]?.name?.toLowerCase().includes(search.toLowerCase()) || productMap[r.product_id]?.sku?.toLowerCase().includes(search.toLowerCase())
    return matchSearch && (typeFilter === 'all' || r.transaction_type === typeFilter)
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product…"
          style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#e2e8f0', padding: '9px 14px', fontSize: 13, outline: 'none' }} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: '#94a3b8', padding: '9px 14px', fontSize: 13, outline: 'none' }}>
          {types.map(t => <option key={t} value={t} style={{ background: '#0f1923' }}>{t === 'all' ? 'All Types' : `${TX_LABELS[t] || ''} ${t}`}</option>)}
        </select>
      </div>
      <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead>
              <tr style={{ background: '#0f1923', borderBottom: '1px solid #1e3a4f' }}>
                {['Date', 'Product', 'Type', 'Change', 'Reference', 'Notes'].map((h, i) => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: i === 3 ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Loading…</td></tr>
                : filtered.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>No transactions found</td></tr>
                : filtered.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #0d1a26' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>{new Date(r.created_at).toLocaleDateString()}</div>
                      <div style={{ fontSize: 11, color: '#334155' }}>{new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontSize: 13, color: '#e2e8f0' }}>{productMap[r.product_id]?.name || r.product_id?.slice(0,8)}</div>
                      <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>{productMap[r.product_id]?.sku || '—'}</div>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13, color: '#94a3b8' }}>{TX_LABELS[r.transaction_type] || r.transaction_type}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 16, fontWeight: 800, color: r.qty > 0 ? '#4ade80' : '#f87171' }}>{r.qty > 0 ? '+' : ''}{r.qty}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: '#475569', textTransform: 'capitalize' }}>{r.reference_type || '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: '#475569', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.notes || '—'}</td>
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
  const [allProducts, setAllProducts] = useState<Product[]>([])

  useEffect(() => {
    supabase.from('products').select('id, name, sku, category, is_active, vendor_name, vendor_sku, vendor_cost').eq('is_active', true).order('name').then(({ data }) => setAllProducts(data || []))
  }, [])

  return (
    <div style={{ minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0', margin: 0 }}>Inventory</h1>
          <p style={{ fontSize: 13, color: '#475569', marginTop: 4, marginBottom: 0 }}>Stock levels, reorder requests, purchase orders, and receiving</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, padding: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, overflowX: 'auto' }}>
        {MAIN_TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, border: activeTab === tab.id ? '1px solid rgba(96,165,250,0.3)' : '1px solid transparent', background: activeTab === tab.id ? 'rgba(96,165,250,0.15)' : 'transparent', color: activeTab === tab.id ? '#60a5fa' : '#64748b' }}>
            <span>{tab.icon}</span><span>{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'stock'        && <StockLevelsTab onSwitchToPO={() => setActiveTab('purchase')} />}
      {activeTab === 'reorder'      && <ReorderTab />}
      {activeTab === 'purchase'     && <PurchaseOrdersTab allProducts={allProducts} />}
      {activeTab === 'receiving'    && <ReceivingTab />}
      {activeTab === 'transactions' && <TransactionsTab />}
    </div>
  )
}
