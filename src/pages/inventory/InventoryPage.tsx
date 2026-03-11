// src/pages/inventory/InventoryPage.tsx
// Phase B/C — Full Inventory UI
// Tabs: Stock Levels | Reorder Requests | Purchase Orders | Receiving | Transactions

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface InventoryRow {
  id: string;
  product_id: string;
  quantity_on_hand: number;
quantity_reserved: number;
quantity_available: number;
  reorder_point: number;
  reorder_qty: number;
  products: {
    name: string;
    sku: string;
    category: string;
    vendor_sku?: string;
    vendor_cost?: number;
    product_categories?: { name: string };
    product_vendors?: { name: string };
  };
}

interface ReorderRequest {
  id: string;
  product_id: string;
  request_type: 'job_shortage' | 'stock_replenishment';
  qty_requested: number;
  status: 'open' | 'ordered' | 'received' | 'cancelled';
  job_id?: string;
  notes?: string;
  created_at: string;
  products: { name: string; sku: string };
  jobs?: { id: string };
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  vendor_id?: string;
  status: 'draft' | 'sent' | 'confirmed' | 'received' | 'cancelled';
  total_cost?: number;
  ordered_at?: string;
  expected_at?: string;
  received_at?: string;
  notes?: string;
  created_at: string;
  product_vendors?: { name: string };
  purchase_order_items?: { id: string; product_id: string; qty_ordered: number; unit_cost: number; products: { name: string; sku: string } }[];
}

interface InventoryTx {
  id: string;
  product_id: string;
  transaction_type: string;
  qty: number;
  reference_type?: string;
  reference_id?: string;
  notes?: string;
  created_at: string;
  products: { name: string; sku: string };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  open:            'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30',
  ordered:         'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  received:        'bg-green-500/20 text-green-300 border border-green-500/30',
  cancelled:       'bg-gray-500/20 text-gray-400 border border-gray-500/30',
  draft:           'bg-gray-500/20 text-gray-400 border border-gray-500/30',
  sent:            'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  confirmed:       'bg-purple-500/20 text-purple-300 border border-purple-500/30',
  short:           'bg-red-500/20 text-red-300 border border-red-500/30',
  ok:              'bg-green-500/20 text-green-300 border border-green-500/30',
  low:             'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30',
  job_shortage:    'bg-red-500/20 text-red-300 border border-red-500/30',
  stock_replenishment: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
};

const TX_LABELS: Record<string, string> = {
  receive:        '📦 Receive',
  reserve:        '🔒 Reserve',
  unreserve:      '🔓 Unreserve',
  fulfill:        '✅ Fulfill',
  adjustment:     '✏️ Adjust',
  return:         '↩️ Return',
};

function Badge({ val }: { val: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${STATUS_COLORS[val] || 'bg-gray-500/20 text-gray-400'}`}>
      {val.replace('_', ' ')}
    </span>
  );
}

function StockBadge({ available, reorderPoint }: { available: number; reorderPoint: number }) {
  if (available <= 0) return <Badge val="short" />;
  if (available <= reorderPoint) return <Badge val="low" />;
  return <Badge val="ok" />;
}

// ─── Tab: Stock Levels ────────────────────────────────────────────────────────

function StockLevelsTab() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'short'>('all');
  const [adjustModal, setAdjustModal] = useState<InventoryRow | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('inventory')
      .select(`
        *,
        products (
          name, sku, category, vendor_sku, vendor_cost,
          product_categories ( name ),
          product_vendors ( name )
        )
      `)
      .order('available', { ascending: true });
    setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r => {
    const matchSearch = !search ||
      r.products?.name?.toLowerCase().includes(search.toLowerCase()) ||
      r.products?.sku?.toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === 'all' ? true :
      filter === 'short' ? r.available <= 0 :
      filter === 'low' ? r.available > 0 && r.available <= r.reorder_point : true;
    return matchSearch && matchFilter;
  });

  async function handleAdjust() {
    if (!adjustModal || !adjustQty) return;
    setSaving(true);
    const delta = parseInt(adjustQty);
    await supabase.rpc('rpc_receive_stock', {
      p_product_id: adjustModal.product_id,
      p_qty: delta,
      p_reference_type: 'adjustment',
      p_reference_id: null,
      p_notes: adjustNote || 'Manual adjustment',
    });
    setAdjustModal(null);
    setAdjustQty('');
    setAdjustNote('');
    setSaving(false);
    load();
  }

  const shortCount  = rows.filter(r => r.available <= 0).length;
  const lowCount    = rows.filter(r => r.available > 0 && r.available <= r.reorder_point).length;

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total SKUs',      value: rows.length,  color: 'text-white' },
          { label: 'Short (0 stock)', value: shortCount,   color: 'text-red-400' },
          { label: 'Low Stock',       value: lowCount,     color: 'text-yellow-400' },
          { label: 'Healthy',         value: rows.length - shortCount - lowCount, color: 'text-green-400' },
        ].map(s => (
          <div key={s.label} className="bg-[#1a2535] rounded-lg p-3 border border-white/5">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search product or SKU..."
          className="flex-1 bg-[#1a2535] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
        />
        {(['all','low','short'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === f
                ? f === 'short' ? 'bg-red-500/30 text-red-300 border border-red-500/50'
                  : f === 'low'  ? 'bg-yellow-500/30 text-yellow-300 border border-yellow-500/50'
                  : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'bg-[#1a2535] text-gray-400 border border-white/10 hover:border-white/20'
            }`}
          >
            {f === 'all' ? 'All' : f === 'low' ? `⚠️ Low (${lowCount})` : `🔴 Short (${shortCount})`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-[#1a2535] rounded-xl border border-white/5 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-3">Product</th>
              <th className="text-left px-4 py-3">SKU</th>
              <th className="text-left px-4 py-3">Category</th>
              <th className="text-right px-4 py-3">On Hand</th>
              <th className="text-right px-4 py-3">Reserved</th>
              <th className="text-right px-4 py-3">Available</th>
              <th className="text-right px-4 py-3">Reorder At</th>
              <th className="text-center px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-10 text-gray-500">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-10 text-gray-500">No inventory rows found</td></tr>
            ) : filtered.map((r, i) => (
              <tr key={r.id} className={`border-b border-white/5 hover:bg-white/3 transition-colors ${i % 2 === 0 ? '' : 'bg-white/[0.02]'}`}>
                <td className="px-4 py-3 font-medium text-white">{r.products?.name}</td>
                <td className="px-4 py-3 text-gray-400 font-mono text-xs">{r.products?.sku}</td>
                <td className="px-4 py-3 text-gray-400 capitalize">{r.products?.product_categories?.name || r.products?.category}</td>
                <td className="px-4 py-3 text-right text-white">{r.quantity_on_hand}</td>
                <td className="px-4 py-3 text-right text-yellow-400">{r.quantity_reserved}</td>
                <td className="px-4 py-3 text-right font-bold text-white">{r.quantity_available}</td>
                <td className="px-4 py-3 text-right text-gray-400">{r.reorder_point}</td>
                <td className="px-4 py-3 text-center">
                  <StockBadge available={r.available} reorderPoint={r.reorder_point} />
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setAdjustModal(r)}
                    className="text-xs px-3 py-1 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-lg hover:bg-cyan-500/20 transition-colors"
                  >
                    Adjust
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Adjust Modal */}
      {adjustModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a2535] rounded-xl border border-white/10 p-6 w-full max-w-md">
            <h3 className="text-white font-semibold text-lg mb-1">Adjust Stock</h3>
            <p className="text-gray-400 text-sm mb-4">{adjustModal.products?.name} · Current available: <span className="text-white font-bold">{adjustModal.available}</span></p>
            <label className="block text-xs text-gray-400 mb-1">Quantity Change (+ to add, - to remove)</label>
            <input
              type="number"
              value={adjustQty}
              onChange={e => setAdjustQty(e.target.value)}
              placeholder="e.g. 5 or -2"
              className="w-full bg-[#0f1923] border border-white/10 rounded-lg px-3 py-2 text-white text-sm mb-3 focus:outline-none focus:border-cyan-500"
            />
            <label className="block text-xs text-gray-400 mb-1">Note (optional)</label>
            <input
              value={adjustNote}
              onChange={e => setAdjustNote(e.target.value)}
              placeholder="Reason for adjustment"
              className="w-full bg-[#0f1923] border border-white/10 rounded-lg px-3 py-2 text-white text-sm mb-4 focus:outline-none focus:border-cyan-500"
            />
            <div className="flex gap-2">
              <button onClick={() => setAdjustModal(null)} className="flex-1 py-2 bg-white/5 text-gray-300 rounded-lg text-sm hover:bg-white/10">Cancel</button>
              <button onClick={handleAdjust} disabled={saving || !adjustQty} className="flex-1 py-2 bg-cyan-600 text-white rounded-lg text-sm font-semibold hover:bg-cyan-700 disabled:opacity-40">
                {saving ? 'Saving...' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Reorder Requests ────────────────────────────────────────────────────

function ReorderTab() {
  const [rows, setRows] = useState<ReorderRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [createPO, setCreatePO] = useState<ReorderRequest[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('reorder_requests')
      .select('*, products(name, sku), jobs(id)')
      .order('created_at', { ascending: false });
    setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r => statusFilter === 'all' || r.status === statusFilter);

  async function updateStatus(id: string, status: string) {
    await supabase.from('reorder_requests').update({ status }).eq('id', id);
    load();
  }

  async function handleCreatePO() {
    if (createPO.length === 0) return;
    const poNumber = `PO-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const { data: po } = await supabase.from('purchase_orders').insert({
      po_number: poNumber,
      status: 'draft',
      notes: `Created from ${createPO.length} reorder request(s)`
    }).select().single();
    if (po) {
      await supabase.from('purchase_order_items').insert(
        createPO.map(r => ({
          purchase_order_id: po.id,
          product_id: r.product_id,
          qty_ordered: r.qty_requested,
          unit_cost: 0,
        }))
      );
      await supabase.from('reorder_requests').update({ status: 'ordered' })
        .in('id', createPO.map(r => r.id));
    }
    setCreatePO([]);
    load();
  }

  const tabs = ['open','ordered','received','all'];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {tabs.map(t => (
            <button key={t} onClick={() => setStatusFilter(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all ${
                statusFilter === t ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'bg-[#1a2535] text-gray-400 border border-white/10 hover:border-white/20'
              }`}
            >
              {t} {t !== 'all' && `(${rows.filter(r => r.status === t).length})`}
            </button>
          ))}
        </div>
        {createPO.length > 0 && (
          <button onClick={handleCreatePO} className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-semibold hover:bg-cyan-700">
            Create PO ({createPO.length} items)
          </button>
        )}
      </div>

      <div className="bg-[#1a2535] rounded-xl border border-white/5 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wide">
              <th className="w-8 px-4 py-3"></th>
              <th className="text-left px-4 py-3">Product</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-right px-4 py-3">Qty Needed</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Created</th>
              <th className="text-left px-4 py-3">Notes</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-10 text-gray-500">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-10 text-gray-500">No reorder requests</td></tr>
            ) : filtered.map((r, i) => (
              <tr key={r.id} className={`border-b border-white/5 hover:bg-white/3 ${i % 2 === 0 ? '' : 'bg-white/[0.02]'}`}>
                <td className="px-4 py-3">
                  {r.status === 'open' && (
                    <input
                      type="checkbox"
                      checked={createPO.some(c => c.id === r.id)}
                      onChange={e => setCreatePO(prev => e.target.checked ? [...prev, r] : prev.filter(c => c.id !== r.id))}
                      className="accent-cyan-500"
                    />
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-white">{r.products?.name}</div>
                  <div className="text-xs text-gray-500 font-mono">{r.products?.sku}</div>
                </td>
                <td className="px-4 py-3"><Badge val={r.request_type} /></td>
                <td className="px-4 py-3 text-right font-bold text-white">{r.qty_requested}</td>
                <td className="px-4 py-3"><Badge val={r.status} /></td>
                <td className="px-4 py-3 text-gray-400 text-xs">{new Date(r.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-gray-400 text-xs max-w-[200px] truncate">{r.notes || '—'}</td>
                <td className="px-4 py-3 text-right">
                  {r.status === 'open' && (
                    <button onClick={() => updateStatus(r.id, 'cancelled')} className="text-xs px-2 py-1 text-gray-400 hover:text-red-400 transition-colors">Cancel</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tab: Purchase Orders ─────────────────────────────────────────────────────

function PurchaseOrdersTab() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
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
      .order('created_at', { ascending: false });
    setOrders(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function updatePOStatus(id: string, status: string) {
    const updates: Record<string, unknown> = { status };
    if (status === 'sent') updates.ordered_at = new Date().toISOString();
    if (status === 'received') updates.received_at = new Date().toISOString();
    await supabase.from('purchase_orders').update(updates).eq('id', id);
    load();
  }

  const filtered = orders.filter(o => statusFilter === 'all' || o.status === statusFilter);
  const statuses = ['all','draft','sent','confirmed','received'];

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {statuses.map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all ${
              statusFilter === s ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'bg-[#1a2535] text-gray-400 border border-white/10 hover:border-white/20'
            }`}
          >
            {s} {s !== 'all' && `(${orders.filter(o => o.status === s).length})`}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-10 text-gray-500">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-gray-500">No purchase orders</div>
        ) : filtered.map(po => (
          <div key={po.id} className="bg-[#1a2535] rounded-xl border border-white/5 overflow-hidden">
            <div
              className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-white/3"
              onClick={() => setExpanded(expanded === po.id ? null : po.id)}
            >
              <span className="font-mono text-cyan-400 font-semibold text-sm">{po.po_number}</span>
              <Badge val={po.status} />
              {po.product_vendors && <span className="text-gray-400 text-sm">{po.product_vendors.name}</span>}
              <span className="text-gray-400 text-xs ml-auto">{new Date(po.created_at).toLocaleDateString()}</span>
              {po.total_cost != null && (
                <span className="text-white font-semibold text-sm">${po.total_cost.toFixed(2)}</span>
              )}
              <span className="text-gray-500 text-xs">{po.purchase_order_items?.length || 0} items</span>
              <span className="text-gray-500">{expanded === po.id ? '▲' : '▼'}</span>
            </div>

            {expanded === po.id && (
              <div className="border-t border-white/5 px-4 py-4">
                <table className="w-full text-sm mb-4">
                  <thead>
                    <tr className="text-gray-400 text-xs uppercase tracking-wide border-b border-white/10">
                      <th className="text-left pb-2">Product</th>
                      <th className="text-right pb-2">Qty</th>
                      <th className="text-right pb-2">Unit Cost</th>
                      <th className="text-right pb-2">Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(po.purchase_order_items || []).map(item => (
                      <tr key={item.id} className="border-b border-white/5">
                        <td className="py-2">
                          <div className="text-white">{item.products?.name}</div>
                          <div className="text-xs text-gray-500 font-mono">{item.products?.sku}</div>
                        </td>
                        <td className="py-2 text-right text-white">{item.qty_ordered}</td>
                        <td className="py-2 text-right text-gray-400">${item.unit_cost.toFixed(2)}</td>
                        <td className="py-2 text-right text-white">${(item.qty_ordered * item.unit_cost).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {po.notes && <p className="text-gray-400 text-xs mb-3">{po.notes}</p>}
                <div className="flex gap-2">
                  {po.status === 'draft' && (
                    <button onClick={() => updatePOStatus(po.id, 'sent')} className="px-4 py-2 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded-lg text-sm hover:bg-blue-500/30">
                      Mark Sent
                    </button>
                  )}
                  {po.status === 'sent' && (
                    <button onClick={() => updatePOStatus(po.id, 'confirmed')} className="px-4 py-2 bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-lg text-sm hover:bg-purple-500/30">
                      Mark Confirmed
                    </button>
                  )}
                  {(po.status === 'sent' || po.status === 'confirmed') && (
                    <button onClick={() => updatePOStatus(po.id, 'received')} className="px-4 py-2 bg-green-500/20 text-green-300 border border-green-500/30 rounded-lg text-sm hover:bg-green-500/30">
                      Mark Received
                    </button>
                  )}
                  {po.status !== 'received' && po.status !== 'cancelled' && (
                    <button onClick={() => updatePOStatus(po.id, 'cancelled')} className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-sm hover:bg-red-500/20">
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
  );
}

// ─── Tab: Receiving ───────────────────────────────────────────────────────────

function ReceivingTab() {
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);
  const [receiveQtys, setReceiveQtys] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('purchase_orders')
      .select(`*, purchase_order_items(id, product_id, qty_ordered, unit_cost, products(name, sku))`)
      .in('status', ['sent','confirmed'])
      .order('created_at', { ascending: false });
    setPos(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openPO(po: PurchaseOrder) {
    setSelected(po);
    setDone(false);
    const qtys: Record<string, string> = {};
    (po.purchase_order_items || []).forEach(item => {
      qtys[item.id] = String(item.qty_ordered);
    });
    setReceiveQtys(qtys);
  }

  async function handleReceive() {
    if (!selected) return;
    setSaving(true);
    for (const item of (selected.purchase_order_items || [])) {
      const qty = parseInt(receiveQtys[item.id] || '0');
      if (qty > 0) {
        await supabase.rpc('rpc_receive_stock', {
          p_product_id: item.product_id,
          p_qty: qty,
          p_reference_type: 'purchase_order',
          p_reference_id: selected.id,
          p_notes: `Received against ${selected.po_number}`,
        });
      }
    }
    await supabase.from('purchase_orders').update({ status: 'received', received_at: new Date().toISOString() }).eq('id', selected.id);
    setSaving(false);
    setDone(true);
    load();
  }

  return (
    <div className="max-w-2xl">
      <p className="text-gray-400 text-sm mb-4">Confirm receipt of stock from sent or confirmed purchase orders. Stock levels update automatically.</p>

      {loading ? (
        <div className="text-gray-500 py-10 text-center">Loading...</div>
      ) : pos.length === 0 ? (
        <div className="bg-[#1a2535] rounded-xl border border-white/5 p-8 text-center text-gray-500">
          No pending purchase orders to receive
        </div>
      ) : !selected ? (
        <div className="space-y-2">
          {pos.map(po => (
            <div key={po.id} className="bg-[#1a2535] rounded-xl border border-white/5 p-4 flex items-center justify-between hover:border-cyan-500/30 transition-colors cursor-pointer" onClick={() => openPO(po)}>
              <div>
                <span className="font-mono text-cyan-400 font-semibold">{po.po_number}</span>
                <Badge val={po.status} />
                <div className="text-gray-400 text-xs mt-1">{po.purchase_order_items?.length} items</div>
              </div>
              <button className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-semibold hover:bg-cyan-700">
                Receive
              </button>
            </div>
          ))}
        </div>
      ) : done ? (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-8 text-center">
          <div className="text-4xl mb-2">✅</div>
          <div className="text-green-400 font-semibold text-lg mb-1">Stock Received</div>
          <div className="text-gray-400 text-sm mb-4">{selected.po_number} marked as received. Inventory updated.</div>
          <button onClick={() => setSelected(null)} className="px-4 py-2 bg-[#1a2535] text-white rounded-lg text-sm border border-white/10">Back to List</button>
        </div>
      ) : (
        <div className="bg-[#1a2535] rounded-xl border border-white/5 p-5">
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white text-sm">← Back</button>
            <span className="font-mono text-cyan-400 font-semibold">{selected.po_number}</span>
            <Badge val={selected.status} />
          </div>
          <p className="text-gray-400 text-sm mb-3">Confirm quantities received:</p>
          <div className="space-y-3 mb-5">
            {(selected.purchase_order_items || []).map(item => (
              <div key={item.id} className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-white text-sm">{item.products?.name}</div>
                  <div className="text-xs text-gray-500 font-mono">{item.products?.sku} · Ordered: {item.qty_ordered}</div>
                </div>
                <input
                  type="number"
                  value={receiveQtys[item.id] || ''}
                  onChange={e => setReceiveQtys(prev => ({ ...prev, [item.id]: e.target.value }))}
                  className="w-20 bg-[#0f1923] border border-white/10 rounded-lg px-2 py-1.5 text-white text-sm text-right focus:outline-none focus:border-cyan-500"
                />
              </div>
            ))}
          </div>
          <button onClick={handleReceive} disabled={saving} className="w-full py-2.5 bg-cyan-600 text-white rounded-lg font-semibold text-sm hover:bg-cyan-700 disabled:opacity-40">
            {saving ? 'Processing...' : 'Confirm Receipt & Update Stock'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Transaction History ─────────────────────────────────────────────────

function TransactionsTab() {
  const [rows, setRows] = useState<InventoryTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('inventory_transactions')
        .select('*, products(name, sku)')
        .order('created_at', { ascending: false })
        .limit(200);
      setRows(data || []);
      setLoading(false);
    })();
  }, []);

  const types = ['all', ...Array.from(new Set(rows.map(r => r.transaction_type)))];
  const filtered = rows.filter(r => {
    const matchSearch = !search ||
      r.products?.name?.toLowerCase().includes(search.toLowerCase()) ||
      r.products?.sku?.toLowerCase().includes(search.toLowerCase());
    return matchSearch && (typeFilter === 'all' || r.transaction_type === typeFilter);
  });

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search product..."
          className="flex-1 bg-[#1a2535] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
        />
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="bg-[#1a2535] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-cyan-500"
        >
          {types.map(t => <option key={t} value={t}>{t === 'all' ? 'All Types' : (TX_LABELS[t] || t)}</option>)}
        </select>
      </div>

      <div className="bg-[#1a2535] rounded-xl border border-white/5 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Product</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-right px-4 py-3">Qty</th>
              <th className="text-left px-4 py-3">Reference</th>
              <th className="text-left px-4 py-3">Notes</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-500">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-500">No transactions found</td></tr>
            ) : filtered.map((r, i) => (
              <tr key={r.id} className={`border-b border-white/5 hover:bg-white/3 ${i % 2 === 0 ? '' : 'bg-white/[0.02]'}`}>
                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                  {new Date(r.created_at).toLocaleDateString()}<br/>
                  <span className="text-gray-600">{new Date(r.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="text-white">{r.products?.name}</div>
                  <div className="text-xs text-gray-500 font-mono">{r.products?.sku}</div>
                </td>
                <td className="px-4 py-3 text-gray-300">{TX_LABELS[r.transaction_type] || r.transaction_type}</td>
                <td className={`px-4 py-3 text-right font-bold ${r.qty > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {r.qty > 0 ? '+' : ''}{r.qty}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {r.reference_type && <span className="capitalize">{r.reference_type}</span>}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs max-w-[180px] truncate">{r.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'stock',        label: '📦 Stock Levels' },
  { id: 'reorder',      label: '⚠️ Reorder Requests' },
  { id: 'purchase',     label: '🛒 Purchase Orders' },
  { id: 'receiving',    label: '✅ Receiving' },
  { id: 'transactions', label: '📋 Transactions' },
];

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState('stock');

  return (
    <div className="min-h-screen bg-[#0f1923] text-white">
      <div className="max-w-[1400px] mx-auto px-6 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Inventory</h1>
            <p className="text-gray-400 text-sm mt-0.5">Stock levels, reorder requests, purchase orders, and receiving</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-[#1a2535] p-1 rounded-xl border border-white/5 w-fit">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-cyan-600 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'stock'        && <StockLevelsTab />}
        {activeTab === 'reorder'      && <ReorderTab />}
        {activeTab === 'purchase'     && <PurchaseOrdersTab />}
        {activeTab === 'receiving'    && <ReceivingTab />}
        {activeTab === 'transactions' && <TransactionsTab />}
      </div>
    </div>
  );
}
