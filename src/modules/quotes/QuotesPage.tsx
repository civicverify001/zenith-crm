// src/modules/quotes/QuotesPage.tsx

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import {
  fetchQuotes, sendQuote,
  STATUS_LABELS, STATUS_COLORS, TYPE_LABELS, TYPE_COLORS,
  type Quote, type QuoteStatus, type CommercialType,
} from '../../services/quotesService'
import { QuoteBuilder } from './QuoteBuilder'

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}
function timeAgo(iso: string) {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

type FilterStatus = 'all' | QuoteStatus
type View = 'list' | 'create' | 'edit'

// Tab config with colors
const STATUS_FILTERS: {
  key: FilterStatus
  label: string
  icon: string
  color: string
  bg: string
  border: string
}[] = [
  { key: 'all',       label: 'All',       icon: '◈', color: '#e2e8f0', bg: 'rgba(226,232,240,0.1)',  border: 'rgba(226,232,240,0.2)' },
  { key: 'draft',     label: 'Draft',     icon: '✎', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.25)' },
  { key: 'sent',      label: 'Sent',      icon: '→', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.25)' },
  { key: 'viewed',    label: 'Viewed',    icon: '👁', color: '#34d399', bg: 'rgba(52,211,153,0.1)',  border: 'rgba(52,211,153,0.25)' },
  { key: 'accepted',  label: 'Accepted',  icon: '✓', color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  border: 'rgba(74,222,128,0.25)' },
  { key: 'declined',  label: 'Declined',  icon: '✕', color: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.25)' },
  { key: 'expired',   label: 'Expired',   icon: '⏱', color: '#71717a', bg: 'rgba(113,113,122,0.1)', border: 'rgba(113,113,122,0.25)' },
]

export function QuotesPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const isAdmin = profile?.role === 'admin'

  const [view, setView]           = useState<View>('list')
  const [quotes, setQuotes]       = useState<Quote[]>([])
  const [loading, setLoading]     = useState(true)
  const [filterStatus, setFilter] = useState<FilterStatus>('all')
  const [search, setSearch]       = useState('')
  const [editQuote, setEditQuote] = useState<Quote | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [customers, setCustomers]       = useState<any[]>([])
  const [customerSearch, setCustSearch] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null)

  useEffect(() => { loadQuotes() }, [])

  async function loadQuotes() {
    setLoading(true)
    try { setQuotes(await fetchQuotes()) }
    catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function loadCustomers(q: string) {
    const { data } = await supabase.from('customers').select('*').ilike('full_name', `%${q}%`).order('full_name').limit(20)
    setCustomers(data || [])
  }

  useEffect(() => {
    if (customerSearch.length > 0) loadCustomers(customerSearch)
    else setCustomers([])
  }, [customerSearch])

  async function handleDelete(q: Quote, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete ${q.quote_number}?\n\nThis cannot be undone.`)) return
    setDeletingId(q.id)
    try {
      const { error } = await supabase.from('quotes').delete().eq('id', q.id)
      if (error) throw error
      setQuotes(prev => prev.filter(x => x.id !== q.id))
    } catch (err: any) {
      alert('Delete failed: ' + (err.message || err))
    } finally { setDeletingId(null) }
  }

  const filtered = quotes.filter(q => {
    if (filterStatus !== 'all' && q.status !== filterStatus) return false
    if (search) {
      const s = search.toLowerCase()
      return q.quote_number.toLowerCase().includes(s) || (q.customer_name || '').toLowerCase().includes(s)
    }
    return true
  })

  const countFor = (key: FilterStatus) => key === 'all' ? quotes.length : quotes.filter(q => q.status === key).length

  const stats = {
    total:    quotes.length,
    sent:     quotes.filter(q => q.status === 'sent' || q.status === 'viewed').length,
    accepted: quotes.filter(q => q.status === 'accepted').length,
    value:    quotes.filter(q => q.status === 'accepted').reduce((s, q) => s + q.total, 0),
  }

  // ── Create / Edit view ──────────────────────────────────────
  if (view === 'create' && !selectedCustomer) {
    return (
      <div style={{ background: '#0f1923', minHeight: '100vh', padding: 24 }}>
        <div style={{ maxWidth: 520, margin: '60px auto' }}>
          <button onClick={() => setView('list')} style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, marginBottom: 24 }}>← Back</button>
          <div style={{ background: '#162232', borderRadius: 12, border: '1px solid #1e3a4f', padding: 32 }}>
            <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 18, marginBottom: 6 }}>New Quote</div>
            <div style={{ color: '#64748b', fontSize: 13, marginBottom: 24 }}>Select a customer to begin</div>
            <input placeholder="Search customers…" value={customerSearch} onChange={e => setCustSearch(e.target.value)} autoFocus
              style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', width: '100%', fontSize: 14, outline: 'none', marginBottom: 8, boxSizing: 'border-box' }} />
            {customers.length > 0 && (
              <div style={{ border: '1px solid #1e3a4f', borderRadius: 8, overflow: 'hidden' }}>
                {customers.map(c => (
                  <button key={c.id} onClick={() => { setSelectedCustomer(c) }}
                    style={{ display: 'flex', flexDirection: 'column', width: '100%', padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #1a2a3a' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#1e3a5f')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                    <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 14 }}>{c.full_name}</span>
                    {c.email && <span style={{ color: '#64748b', fontSize: 12 }}>{c.email}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (view === 'create' || view === 'edit') {
    const cust = view === 'edit'
      ? { id: editQuote?.customer_id, full_name: editQuote?.customer_name, phone: editQuote?.customer_phone }
      : selectedCustomer
    return (
      <QuoteBuilder
        customerId={cust.id}
        customerName={cust.full_name}
        customerAddress={''}
        customerPhone={cust.phone || cust.mobile || ''}
        existingQuote={view === 'edit' ? editQuote : null}
        initialView={view === 'edit' ? 'preview' : 'form'}
        onSaved={() => { loadQuotes(); setView('list'); setSelectedCustomer(null); setEditQuote(null) }}
        onCancel={() => { setView('list'); setSelectedCustomer(null); setEditQuote(null) }}
      />
    )
  }

  // ── List view ───────────────────────────────────────────────
  return (
    <div style={{ background: '#0f1923', minHeight: '100vh', color: '#e2e8f0', display: 'flex', flexDirection: 'column' }}>

      {/* ── Top bar: title + search + new button ── */}
      <div style={{
        background: '#162232',
        borderBottom: '1px solid #1e3a4f',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 20, color: '#e2e8f0', lineHeight: 1.2 }}>Quotes</div>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{stats.total} total</div>
        </div>
        <input
          placeholder="Search quote # or customer…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8,
            color: '#e2e8f0', padding: '9px 14px', fontSize: 13, outline: 'none',
            width: 240, flexShrink: 0,
          }}
        />
        <button
          onClick={() => { setView('create'); setCustSearch(''); setSelectedCustomer(null) }}
          style={{
            padding: '10px 22px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 14,
            flexShrink: 0, whiteSpace: 'nowrap',
          }}
        >
          + New Quote
        </button>
      </div>

      {/* ── Colorful filter tabs ── */}
      <div style={{
        background: '#0c1a26',
        borderBottom: '1px solid #1e3a4f',
        padding: '12px 24px',
        display: 'flex',
        gap: 8,
        flexShrink: 0,
      }}>
        {STATUS_FILTERS.map(f => {
          const count = countFor(f.key)
          const isActive = filterStatus === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
                padding: '11px 8px',
                borderRadius: 10,
                border: `1px solid ${isActive ? f.color + '60' : f.border}`,
                background: isActive ? f.bg : 'rgba(255,255,255,0.02)',
                color: isActive ? f.color : '#475569',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: isActive ? 700 : 500,
                transition: 'all 0.12s',
                boxShadow: isActive ? `0 0 14px ${f.color}20` : 'none',
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  e.currentTarget.style.background = f.bg
                  e.currentTarget.style.color = f.color
                  e.currentTarget.style.borderColor = f.border
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = '#475569'
                  e.currentTarget.style.borderColor = f.border
                }
              }}
            >
              <span style={{ fontSize: 14 }}>{f.icon}</span>
              <span>{f.label}</span>
              {count > 0 && (
                <span style={{
                  background: isActive ? f.color + '30' : 'rgba(255,255,255,0.06)',
                  color: isActive ? f.color : '#64748b',
                  borderRadius: 20,
                  padding: '1px 7px',
                  fontSize: 11,
                  fontWeight: 700,
                  minWidth: 20,
                  textAlign: 'center',
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
        display: 'flex',
        gap: 12,
        padding: '14px 24px',
        borderBottom: '1px solid #1e3a4f',
        background: '#0f1923',
        flexShrink: 0,
        overflowX: 'auto',
      }}>
        {[
          { label: 'Total',     val: stats.total,      color: '#94a3b8' },
          { label: 'Open',      val: stats.sent,       color: '#60a5fa' },
          { label: 'Accepted',  val: stats.accepted,   color: '#4ade80' },
          { label: 'Value Won', val: fmt(stats.value), color: '#22d3ee' },
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

      {/* ── Table ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Loading quotes…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
            <div style={{ color: '#64748b', fontSize: 15 }}>No quotes found</div>
            <button onClick={() => setView('create')} style={{ marginTop: 16, padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#0d7ea3', color: '#fff', fontWeight: 700 }}>
              Create First Quote
            </button>
          </div>
        ) : (
          <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#0f1923', borderBottom: '1px solid #1e3a4f' }}>
                  {['Quote #', 'Customer', 'Type', 'Total', 'Status', 'Valid Until', 'Created', ''].map((h, i) => (
                    <th key={h} style={{
                      padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#64748b',
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                      textAlign: i >= 3 ? 'right' : 'left',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(q => {
                  const sc = STATUS_COLORS[q.status] || { bg: '#1e293b', text: '#94a3b8' }
                  const tc = TYPE_COLORS[q.commercial_type] || '#94a3b8'
                  const isDeleting = deletingId === q.id
                  return (
                    <tr
                      key={q.id}
                      style={{ borderBottom: '1px solid #1a2a3a', cursor: 'pointer', opacity: isDeleting ? 0.4 : 1, transition: 'background 0.1s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#1a2e42')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      onClick={() => { setEditQuote(q); setView('edit') }}
                    >
                      <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 700, color: '#60a5fa', fontFamily: 'monospace' }}>
                        {q.quote_number}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{q.customer_name || '—'}</div>
                        {q.customer_email && <div style={{ fontSize: 11, color: '#64748b' }}>{q.customer_email}</div>}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: tc, background: tc + '22', padding: '3px 8px', borderRadius: 6 }}>
                          {TYPE_LABELS[q.commercial_type]}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>
                        {fmt(q.total)}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: sc.text, background: sc.bg, padding: '3px 8px', borderRadius: 6 }}>
                          {STATUS_LABELS[q.status]}
                        </span>
                        {(q.view_count || 0) > 0 && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#60a5fa', background: 'rgba(96,165,250,0.15)', padding: '2px 6px', borderRadius: 6, marginLeft: 4 }}>
                            👁 {q.view_count}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: 12, color: '#64748b' }}>
                        {fmtDate(q.valid_until || null)}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: 12, color: '#64748b' }}>
                        {timeAgo(q.created_at)}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                          {q.status === 'draft' && (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation()
                                if (confirm('Mark this quote as sent?')) { await sendQuote(q.id); loadQuotes() }
                              }}
                              style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #0d7ea3', background: 'transparent', color: '#22d3ee', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                            >
                              Send
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              onClick={(e) => handleDelete(q, e)}
                              disabled={isDeleting}
                              style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #3f1a1a', background: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
                              onMouseEnter={e => { e.currentTarget.style.background = '#3f1a1a'; e.currentTarget.style.borderColor = '#ef4444' }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = '#3f1a1a' }}
                            >
                              🗑
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

