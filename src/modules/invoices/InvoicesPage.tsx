// src/modules/invoices/InvoicesPage.tsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import {
  fetchInvoices, fetchInvoice, createInvoiceFromQuote,
  markInvoicePaid, voidInvoice, updateInvoiceStatus,
  refreshOverdueInvoices, balanceDue,
  STATUS_LABELS, STATUS_COLORS,
  type Invoice, type InvoiceStatus,
} from '../../services/invoicesService'
import { fetchQuotes } from '../../services/quotesService'
import { supabase } from '../../lib/supabase'
import { createInvoice } from '../../services/invoicesService'

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

// ── Colorful tab config ───────────────────────────────────────
const FILTER_TABS: {
  key: InvoiceStatus | 'all'
  label: string
  icon: string
  color: string
  bg: string
  border: string
}[] = [
  { key: 'all',     label: 'All',     icon: '◈', color: '#e2e8f0', bg: 'rgba(226,232,240,0.1)',  border: 'rgba(226,232,240,0.2)' },
  { key: 'draft',   label: 'Draft',   icon: '✎', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.25)' },
  { key: 'sent',    label: 'Sent',    icon: '→', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.25)' },
  { key: 'paid',    label: 'Paid',    icon: '✓', color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  border: 'rgba(74,222,128,0.25)' },
  { key: 'overdue', label: 'Overdue', icon: '⚠', color: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.25)' },
  { key: 'partial', label: 'Partial', icon: '◑', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.25)' },
  { key: 'void',    label: 'Void',    icon: '○', color: '#71717a', bg: 'rgba(113,113,122,0.1)', border: 'rgba(113,113,122,0.25)' },
]

function Badge({ status }: { status: InvoiceStatus }) {
  const color = STATUS_COLORS[status]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 700, color, background: color + '22', border: `1px solid ${color}40`,
    }}>
      {STATUS_LABELS[status]}
    </span>
  )
}

/* ─── Invoice Drawer ──────────────────────────────────────────── */
function InvoiceDrawer({ invoice, onClose, onRefresh }: { invoice: Invoice; onClose: () => void; onRefresh: () => void }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const isAdmin = profile?.role === 'admin'
  const [busy, setBusy] = useState(false)
  const [payModal, setPayModal] = useState(false)
  const [payAmt, setPayAmt] = useState('')
  const [emailing, setEmailing] = useState(false)
  const [emailMsg, setEmailMsg] = useState('')
  const balance = balanceDue(invoice)
  const paidPct = invoice.total > 0 ? (invoice.amount_paid / invoice.total) * 100 : 0

  async function handleVoid() {
    if (!confirm('Void this invoice?')) return
    setBusy(true)
    try { await voidInvoice(invoice.id); onRefresh(); onClose() }
    catch (e: any) { alert(e.message) } finally { setBusy(false) }
  }
  async function handleMarkSent() {
    setBusy(true)
    try { await updateInvoiceStatus(invoice.id, 'sent'); onRefresh() }
    catch (e: any) { alert(e.message) } finally { setBusy(false) }
  }
  async function handlePay() {
    const amt = parseFloat(payAmt) || invoice.total
    setBusy(true)
    try { await markInvoicePaid(invoice.id, amt); setPayModal(false); onRefresh() }
    catch (e: any) { alert(e.message) } finally { setBusy(false) }
  }
  async function handleEmail() {
    setEmailing(true); setEmailMsg('')
    try {
      const res = await fetch('/api/email/send-invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id, senderEmail: profile?.email, senderName: profile?.full_name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send')
      await updateInvoiceStatus(invoice.id, 'sent')
      setEmailMsg('✓ Invoice emailed successfully'); onRefresh()
    } catch (e: any) { setEmailMsg(`✗ ${e.message}`) } finally { setEmailing(false) }
  }

  const inputStyle: React.CSSProperties = {
    background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8,
    color: '#e2e8f0', padding: '10px 14px', width: '100%', fontSize: 14, outline: 'none', boxSizing: 'border-box',
  }
  const btnPrimary: React.CSSProperties = {
    width: '100%', padding: '11px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: 700, color: '#fff', transition: 'opacity 0.15s',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex' }}>
      <div style={{ flex: 1, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div style={{ width: '100%', maxWidth: 480, background: '#162232', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #1e3a4f', background: '#0f1923' }}>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Invoice</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#e2e8f0' }}>{invoice.invoice_number}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Badge status={invoice.status} />
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>×</button>
          </div>
        </div>
        <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: '#0f1923', borderRadius: 10, padding: 16, border: '1px solid #1e3a4f' }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Bill To</div>
            <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 15 }}>{invoice.customer_name || '—'}</div>
            {invoice.customer_email && <div style={{ fontSize: 13, color: '#94a3b8' }}>{invoice.customer_email}</div>}
            {invoice.customer_phone && <div style={{ fontSize: 13, color: '#94a3b8' }}>{invoice.customer_phone}</div>}
            <button onClick={() => { onClose(); navigate(`/customers/${invoice.customer_id}`) }}
              style={{ background: 'none', border: 'none', color: '#22d3ee', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0, marginTop: 6 }}>
              View Customer →
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {[
              { label: 'Total', value: fmt(invoice.total), color: '#e2e8f0' },
              { label: 'Paid', value: fmt(invoice.amount_paid), color: '#4ade80' },
              { label: 'Balance', value: fmt(balance), color: balance > 0 ? '#f87171' : '#4ade80' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: '#0f1923', borderRadius: 10, padding: 12, textAlign: 'center', border: '1px solid #1e3a4f' }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
              </div>
            ))}
          </div>
          {invoice.total > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginBottom: 4 }}>
                <span>Payment progress</span><span>{Math.round(paidPct)}%</span>
              </div>
              <div style={{ width: '100%', height: 6, borderRadius: 3, background: '#1e3a4f', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 3, width: `${Math.min(100, paidPct)}%`, background: paidPct >= 100 ? '#4ade80' : '#f59e0b', transition: 'width 0.3s' }} />
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[['Created', fmtDate(invoice.created_at)], ['Due', fmtDate(invoice.due_date)], ['Sent', invoice.sent_at ? fmtDate(invoice.sent_at) : '—'], ['Paid', invoice.paid_at ? fmtDate(invoice.paid_at) : '—']].map(([l, v]) => (
              <div key={l as string}>
                <div style={{ fontSize: 11, color: '#64748b' }}>{l}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{v}</div>
              </div>
            ))}
          </div>
          {invoice.line_items_snapshot.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Line Items</div>
              <div style={{ border: '1px solid #1e3a4f', borderRadius: 10, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#0f1923', borderBottom: '1px solid #1e3a4f' }}>
                      {['Description', 'Qty', 'Unit', 'Total'].map((h, i) => (
                        <th key={h} style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.line_items_snapshot.map((li, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #1a2a3a' }}>
                        <td style={{ padding: '10px 12px', fontSize: 13, color: '#e2e8f0' }}>{li.description}</td>
                        <td style={{ padding: '10px 12px', fontSize: 13, color: '#94a3b8', textAlign: 'right' }}>{li.quantity}</td>
                        <td style={{ padding: '10px 12px', fontSize: 13, color: '#94a3b8', textAlign: 'right' }}>{fmt(li.unit_price)}</td>
                        <td style={{ padding: '10px 12px', fontSize: 13, color: '#e2e8f0', fontWeight: 600, textAlign: 'right' }}>{fmt(li.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '1px solid #1e3a4f' }}>
                      <td colSpan={3} style={{ padding: '6px 12px', fontSize: 11, color: '#64748b', textAlign: 'right' }}>Subtotal</td>
                      <td style={{ padding: '6px 12px', fontSize: 13, fontWeight: 600, color: '#e2e8f0', textAlign: 'right' }}>{fmt(invoice.subtotal)}</td>
                    </tr>
                    <tr>
                      <td colSpan={3} style={{ padding: '6px 12px', fontSize: 11, color: '#64748b', textAlign: 'right' }}>Tax (7%)</td>
                      <td style={{ padding: '6px 12px', fontSize: 13, fontWeight: 600, color: '#e2e8f0', textAlign: 'right' }}>{fmt(invoice.tax_amount)}</td>
                    </tr>
                    <tr style={{ borderTop: '1px solid #1e3a4f' }}>
                      <td colSpan={3} style={{ padding: '10px 12px', fontSize: 13, fontWeight: 700, color: '#e2e8f0', textAlign: 'right' }}>Total</td>
                      <td style={{ padding: '10px 12px', fontSize: 15, fontWeight: 800, color: '#22d3ee', textAlign: 'right' }}>{fmt(invoice.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
          {invoice.notes && (
            <div style={{ background: '#1a2a3a', borderRadius: 10, padding: 14, border: '1px solid #1e3a4f' }}>
              <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600, marginBottom: 4 }}>Notes</div>
              <div style={{ fontSize: 13, color: '#e2e8f0' }}>{invoice.notes}</div>
            </div>
          )}
          {emailMsg && <div style={{ fontSize: 13, fontWeight: 600, color: emailMsg.startsWith('✓') ? '#4ade80' : '#f87171' }}>{emailMsg}</div>}
        </div>
        {invoice.status !== 'void' && (
          <div style={{ padding: 20, borderTop: '1px solid #1e3a4f', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {isAdmin && invoice.status === 'draft' && (
              <button onClick={handleMarkSent} disabled={busy} style={{ ...btnPrimary, background: '#0d7ea3', opacity: busy ? 0.5 : 1 }}>Mark as Sent</button>
            )}
            {isAdmin && ['draft', 'sent', 'partial'].includes(invoice.status) && (
              <button onClick={() => { setPayAmt(balance.toFixed(2)); setPayModal(true) }} style={{ ...btnPrimary, background: '#16a34a' }}>Record Payment</button>
            )}
            <button onClick={handleEmail} disabled={emailing} style={{ ...btnPrimary, background: '#6366f1', opacity: emailing ? 0.5 : 1 }}>{emailing ? 'Sending…' : '✉ Email Invoice'}</button>
            {isAdmin && invoice.status !== 'paid' && (
              <button onClick={handleVoid} disabled={busy} style={{ ...btnPrimary, background: 'transparent', border: '1px solid #f8717140', color: '#f87171', opacity: busy ? 0.5 : 1 }}>Void Invoice</button>
            )}
          </div>
        )}
      </div>
      {payModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} onClick={() => setPayModal(false)} />
          <div style={{ position: 'relative', background: '#162232', borderRadius: 12, padding: 24, width: 320, border: '1px solid #1e3a4f' }}>
            <div style={{ fontWeight: 800, fontSize: 18, color: '#e2e8f0', marginBottom: 16 }}>Record Payment</div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 4 }}>Amount ($)</label>
              <input type="number" step="0.01" value={payAmt} onChange={e => setPayAmt(e.target.value)} style={inputStyle} />
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Balance due: {fmt(balance)}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={() => setPayModal(false)} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #1e3a4f', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={handlePay} disabled={busy} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: busy ? 0.5 : 1 }}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Create Invoice Modal ──────────────────────────────────── */
function CreateInvoiceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [customers, setCustomers] = useState<any[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState('')
  const [acceptedQuotes, setAcceptedQuotes] = useState<any[]>([])
  const [selectedQuote, setSelectedQuote] = useState('')
  const [mode, setMode] = useState<'from_quote' | 'manual'>('from_quote')
  const [busy, setBusy] = useState(false)
  const [desc, setDesc] = useState('')
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('')
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10))

  useEffect(() => {
    supabase.from('customers').select('id,full_name').order('full_name').then(({ data }) => setCustomers(data || []))
  }, [])
  useEffect(() => {
    if (!selectedCustomer) return setAcceptedQuotes([])
    fetchQuotes(selectedCustomer).then(qs => setAcceptedQuotes(qs.filter(q => q.status === 'accepted')))
  }, [selectedCustomer])

  async function handleSubmit() {
    if (!selectedCustomer) return alert('Select a customer')
    setBusy(true)
    try {
      if (mode === 'from_quote') {
        if (!selectedQuote) throw new Error('Select a quote')
        await createInvoiceFromQuote(selectedQuote)
      } else {
        const unitPrice = parseFloat(price)
        if (!desc || !unitPrice) throw new Error('Description and price required')
        const quantity = parseInt(qty) || 1
        const subtotal = quantity * unitPrice
        const tax = subtotal * 0.07
        await createInvoice({ customer_id: selectedCustomer, line_items: [{ description: desc, quantity, unit_price: unitPrice, total: subtotal }], subtotal, tax_amount: tax, total: subtotal + tax, due_date: dueDate, notes: notes || undefined })
      }
      onCreated(); onClose()
    } catch (e: any) { alert(e.message) } finally { setBusy(false) }
  }

  const inputStyle: React.CSSProperties = {
    background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8,
    color: '#e2e8f0', padding: '10px 14px', width: '100%', fontSize: 14, outline: 'none', boxSizing: 'border-box',
  }
  const selectStyle: React.CSSProperties = {
    ...inputStyle, appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div style={{ position: 'relative', background: '#162232', borderRadius: 14, border: '1px solid #1e3a4f', width: '100%', maxWidth: 440, padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 20, color: '#e2e8f0' }}>New Invoice</div>
        <div style={{ display: 'flex', gap: 4, background: '#0f1923', borderRadius: 8, padding: 3 }}>
          {(['from_quote', 'manual'] as const).map(v => (
            <button key={v} onClick={() => setMode(v)} style={{
              flex: 1, padding: '8px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
              background: mode === v ? '#162232' : 'transparent',
              color: mode === v ? '#e2e8f0' : '#64748b',
              boxShadow: mode === v ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
            }}>
              {v === 'from_quote' ? 'From Quote' : 'Manual'}
            </button>
          ))}
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>Customer *</label>
          <select value={selectedCustomer} onChange={e => setSelectedCustomer(e.target.value)} style={selectStyle}>
            <option value="">Select customer…</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
        </div>
        {mode === 'from_quote' ? (
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>Accepted Quote *</label>
            <select value={selectedQuote} onChange={e => setSelectedQuote(e.target.value)} style={selectStyle}>
              <option value="">Select quote…</option>
              {acceptedQuotes.length === 0 && selectedCustomer && <option disabled value="">No accepted quotes</option>}
              {acceptedQuotes.map(q => <option key={q.id} value={q.id}>{q.quote_number} — ${parseFloat(q.total).toFixed(2)}</option>)}
            </select>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>Description *</label>
              <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Monthly rental – RO System" style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>Qty</label>
                <input type="number" value={qty} onChange={e => setQty(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>Unit Price ($) *</label>
                <input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="29.99" style={inputStyle} />
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>Due Date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'none' }} />
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px 0', borderRadius: 8, border: '1px solid #1e3a4f', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Cancel</button>
          <button onClick={handleSubmit} disabled={busy} style={{ flex: 1, padding: '11px 0', borderRadius: 8, border: 'none', background: '#0d7ea3', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: busy ? 0.5 : 1 }}>
            {busy ? 'Creating…' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Main Page ─────────────────────────────────────────────── */
export function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Invoice | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [filter, setFilter] = useState<InvoiceStatus | 'all'>('all')
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    try { await refreshOverdueInvoices(); setInvoices(await fetchInvoices()) }
    catch (e) { console.error(e) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const filtered = invoices.filter(inv => {
    const mf = filter === 'all' || inv.status === filter
    const q = search.toLowerCase()
    return mf && (!q || (inv.customer_name || '').toLowerCase().includes(q) || inv.invoice_number.toLowerCase().includes(q))
  })

  const outstanding = invoices.filter(i => ['sent', 'partial', 'overdue'].includes(i.status)).reduce((a, i) => a + balanceDue(i), 0)
  const overdueCount = invoices.filter(i => i.status === 'overdue').length
  const now = new Date().toISOString().slice(0, 7)
  const paidMtd = invoices.filter(i => i.status === 'paid' && i.paid_at?.startsWith(now)).reduce((a, i) => a + i.amount_paid, 0)
  const countFor = (key: InvoiceStatus | 'all') => key === 'all' ? invoices.length : invoices.filter(i => i.status === key).length

  return (
    <div style={{ background: '#0f1923', minHeight: '100vh', color: '#e2e8f0', display: 'flex', flexDirection: 'column' }}>

      {/* ── Top bar ── */}
      <div style={{
        background: '#162232', borderBottom: '1px solid #1e3a4f',
        padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 20, color: '#e2e8f0', lineHeight: 1.2 }}>Invoices</div>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>Track billing, payments, and outstanding balances</div>
        </div>
        <input
          placeholder="Search customer or invoice #…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8,
            color: '#e2e8f0', padding: '9px 14px', fontSize: 13, outline: 'none',
            width: 240, flexShrink: 0,
          }}
        />
        <button
          onClick={() => setShowCreate(true)}
          style={{ padding: '10px 22px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          + New Invoice
        </button>
      </div>

      {/* ── Colorful filter tabs ── */}
      <div style={{
        background: '#0c1a26', borderBottom: '1px solid #1e3a4f',
        padding: '12px 24px', display: 'flex', gap: 8, flexShrink: 0,
      }}>
        {FILTER_TABS.map(f => {
          const count = countFor(f.key)
          const isActive = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                flex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '11px 8px', borderRadius: 10,
                border: `1px solid ${isActive ? f.color + '60' : f.border}`,
                background: isActive ? f.bg : 'rgba(255,255,255,0.02)',
                color: isActive ? f.color : '#475569',
                cursor: 'pointer', fontSize: 13, fontWeight: isActive ? 700 : 500,
                transition: 'all 0.12s',
                boxShadow: isActive ? `0 0 14px ${f.color}20` : 'none',
              }}
              onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = f.bg; e.currentTarget.style.color = f.color } }}
              onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.color = '#475569' } }}
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
          )
        })}
      </div>

      {/* ── Stats strip ── */}
      <div style={{
        display: 'flex', gap: 12, padding: '14px 24px',
        borderBottom: '1px solid #1e3a4f', background: '#0f1923',
        flexShrink: 0, overflowX: 'auto',
      }}>
        {[
          { label: 'Outstanding', val: fmt(outstanding), color: '#60a5fa', sub: `${invoices.filter(i => ['sent','partial','overdue'].includes(i.status)).length} invoices` },
          { label: 'Overdue',     val: String(overdueCount), color: overdueCount > 0 ? '#f87171' : '#94a3b8', sub: 'need attention' },
          { label: 'Paid MTD',    val: fmt(paidMtd), color: '#4ade80', sub: 'collected this month' },
        ].map(s => (
          <div key={s.label} style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 10, padding: '10px 18px', flexShrink: 0, minWidth: 130 }}>
            <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
            <div style={{ color: s.color, fontWeight: 800, fontSize: 20, marginTop: 3 }}>{s.val}</div>
            <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Table ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Loading invoices…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
            <div style={{ color: '#64748b', fontSize: 15 }}>No invoices found</div>
            <button onClick={() => setShowCreate(true)} style={{ marginTop: 16, padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#0d7ea3', color: '#fff', fontWeight: 700 }}>Create one →</button>
          </div>
        ) : (
          <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#0f1923', borderBottom: '1px solid #1e3a4f' }}>
                  {['Invoice #', 'Customer', 'Status', 'Total', 'Balance Due', 'Due Date', 'Created'].map((h, i) => (
                    <th key={h} style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: i >= 3 ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => (
                  <tr key={inv.id} onClick={() => setSelected(inv)}
                    style={{ borderBottom: '1px solid #1a2a3a', cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#1a2e42')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 700, color: '#60a5fa', fontFamily: 'monospace' }}>{inv.invoice_number}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{inv.customer_name || '—'}</td>
                    <td style={{ padding: '12px 14px' }}><Badge status={inv.status} /></td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{fmt(inv.total)}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: balanceDue(inv) > 0 ? '#f87171' : '#4ade80' }}>{fmt(balanceDue(inv))}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: 12, color: '#64748b' }}>{fmtDate(inv.due_date)}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: 12, color: '#64748b' }}>{fmtDate(inv.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <InvoiceDrawer invoice={selected} onClose={() => setSelected(null)}
          onRefresh={async () => { await load(); if (selected) { const u = await fetchInvoice(selected.id); if (u) setSelected(u) } }} />
      )}
      {showCreate && <CreateInvoiceModal onClose={() => setShowCreate(false)} onCreated={load} />}
    </div>
  )
}
