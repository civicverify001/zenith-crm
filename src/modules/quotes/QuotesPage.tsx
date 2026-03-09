// src/modules/quotes/QuotesPage.tsx
// Sidebar quotes module — full list with filters, status badges, create flow

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

// ─── Helpers ─────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function timeAgo(iso: string) {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7)  return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Component ────────────────────────────────────────────────

type FilterStatus = 'all' | QuoteStatus
type View = 'list' | 'create' | 'edit'

export function QuotesPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [view, setView]           = useState<View>('list')
  const [quotes, setQuotes]       = useState<Quote[]>([])
  const [loading, setLoading]     = useState(true)
  const [filterStatus, setFilter] = useState<FilterStatus>('all')
  const [search, setSearch]       = useState('')
  const [editQuote, setEditQuote] = useState<Quote | null>(null)

  // For new quote — customer picker
  const [customers, setCustomers]     = useState<any[]>([])
  const [customerSearch, setCustSearch] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null)
  const [showCustPicker, setShowCustPicker] = useState(false)

  useEffect(() => { loadQuotes() }, [])

  async function loadQuotes() {
    setLoading(true)
    try {
      const data = await fetchQuotes()
      setQuotes(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function loadCustomers(q: string) {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .ilike('full_name', `%${q}%`)
      .order('full_name')
      .limit(20)
    if (error) console.error('Customer search error:', error)
    setCustomers(data || [])
  }

  useEffect(() => {
    if (customerSearch.length > 0) loadCustomers(customerSearch)
    else setCustomers([])
  }, [customerSearch])

  // ─── Filtered list ─────────────────────────────────────────
  const filtered = quotes.filter(q => {
    if (filterStatus !== 'all' && q.status !== filterStatus) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        q.quote_number.toLowerCase().includes(s) ||
        (q.customer_name || '').toLowerCase().includes(s)
      )
    }
    return true
  })

  // ─── Stats ────────────────────────────────────────────────
  const stats = {
    total:    quotes.length,
    draft:    quotes.filter(q => q.status === 'draft').length,
    sent:     quotes.filter(q => q.status === 'sent' || q.status === 'viewed').length,
    accepted: quotes.filter(q => q.status === 'accepted').length,
    value:    quotes.filter(q => q.status === 'accepted').reduce((s, q) => s + q.total, 0),
  }

  if (view === 'create' || view === 'edit') {
    if (!selectedCustomer && view === 'create') {
      return (
        <div style={{ background: '#0f1923', minHeight: '100vh', padding: 24 }}>
          <div style={{ maxWidth: 520, margin: '60px auto' }}>
            <button
              onClick={() => setView('list')}
              style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, marginBottom: 24 }}
            >
              ← Back
            </button>
            <div style={{ background: '#162232', borderRadius: 12, border: '1px solid #1e3a4f', padding: 32 }}>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 18, marginBottom: 6 }}>New Quote</div>
              <div style={{ color: '#64748b', fontSize: 13, marginBottom: 24 }}>Select a customer to begin</div>
              <input
                placeholder="Search customers…"
                value={customerSearch}
                onChange={e => setCustSearch(e.target.value)}
                autoFocus
                style={{
                  background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8,
                  color: '#e2e8f0', padding: '10px 14px', width: '100%', fontSize: 14,
                  outline: 'none', marginBottom: 8, boxSizing: 'border-box',
                }}
              />
              {customers.length > 0 && (
                <div style={{ border: '1px solid #1e3a4f', borderRadius: 8, overflow: 'hidden' }}>
                  {customers.map(c => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setSelectedCustomer(c)
                        setShowCustPicker(false)
                      }}
                      style={{
                        display: 'flex', flexDirection: 'column', width: '100%', padding: '12px 14px',
                        background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                        borderBottom: '1px solid #1a2a3a',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#1e3a5f')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
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

    const cust = view === 'edit'
      ? { id: editQuote?.customer_id, full_name: editQuote?.customer_name, service_address: editQuote?.customer_address, phone: editQuote?.customer_phone }
      : selectedCustomer

    return (
      <QuoteBuilder
        customerId={cust.id}
        customerName={cust.full_name}
        customerAddress={cust.service_address || cust.address || ''}
        customerPhone={cust.phone || ''}
        existingQuote={view === 'edit' ? editQuote : null}
        onSaved={(q) => {
          loadQuotes()
          setView('list')
          setSelectedCustomer(null)
          setEditQuote(null)
        }}
        onCancel={() => {
          setView('list')
          setSelectedCustomer(null)
          setEditQuote(null)
        }}
      />
    )
  }

  // ─── List View ─────────────────────────────────────────────
  const S = {
    page: { background: '#0f1923', minHeight: '100vh', color: '#e2e8f0' },
    header: {
      background: '#162232', borderBottom: '1px solid #1e3a4f',
      padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    } as React.CSSProperties,
    statCard: {
      background: '#162232', border: '1px solid #1e3a4f', borderRadius: 10,
      padding: '14px 18px', flex: 1, minWidth: 0,
    } as React.CSSProperties,
  }

  const STATUS_FILTERS: { key: FilterStatus; label: string }[] = [
    { key: 'all',      label: 'All' },
    { key: 'draft',    label: 'Draft' },
    { key: 'sent',     label: 'Sent' },
    { key: 'viewed',   label: 'Viewed' },
    { key: 'accepted', label: 'Accepted' },
    { key: 'declined', label: 'Declined' },
    { key: 'expired',  label: 'Expired' },
  ]

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 20, color: '#e2e8f0' }}>Quotes</div>
          <div style={{ color: '#64748b', fontSize: 13 }}>{stats.total} total quotes</div>
        </div>
        <button
          onClick={() => { setView('create'); setCustSearch(''); setSelectedCustomer(null) }}
          style={{
            padding: '10px 22px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 14,
          }}
        >
          + New Quote
        </button>
      </div>

      <div style={{ padding: 24 }}>
        {/* Stats row */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Total',    val: stats.total,                  color: '#94a3b8' },
            { label: 'Open',     val: stats.sent,                   color: '#60a5fa' },
            { label: 'Accepted', val: stats.accepted,               color: '#4ade80' },
            { label: 'Value Won',val: fmt(stats.value),             color: '#22d3ee' },
          ].map(s => (
            <div key={s.label} style={S.statCard}>
              <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
              <div style={{ color: s.color, fontWeight: 800, fontSize: 22, marginTop: 4 }}>{s.val}</div>
            </div>
          ))}
        </div>

        {/* Search + filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder="Search quote # or customer…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8,
              color: '#e2e8f0', padding: '9px 14px', fontSize: 13, outline: 'none', minWidth: 240,
            }}
          />
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {STATUS_FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                style={{
                  padding: '6px 14px', borderRadius: 20, border: '1px solid',
                  cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.12s',
                  borderColor: filterStatus === f.key ? '#0d7ea3' : '#1e3a4f',
                  background: filterStatus === f.key ? '#0a2a3a' : 'transparent',
                  color: filterStatus === f.key ? '#22d3ee' : '#64748b',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        {loading
          ? <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Loading quotes…</div>
          : filtered.length === 0
            ? (
              <div style={{ textAlign: 'center', padding: 60 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
                <div style={{ color: '#64748b', fontSize: 15 }}>No quotes found</div>
                <button
                  onClick={() => setView('create')}
                  style={{ marginTop: 16, padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#0d7ea3', color: '#fff', fontWeight: 700 }}
                >
                  Create First Quote
                </button>
              </div>
            )
            : (
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
                      return (
                        <tr
                          key={q.id}
                          style={{ borderBottom: '1px solid #1a2a3a', transition: 'background 0.1s', cursor: 'pointer' }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#1a2e42')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          onClick={() => {
                            setEditQuote(q)
                            setView('edit')
                          }}
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
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: 12, color: '#64748b' }}>
                            {fmtDate(q.valid_until || null)}
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: 12, color: '#64748b' }}>
                            {timeAgo(q.created_at)}
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                            {q.status === 'draft' && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation()
                                  if (confirm('Mark this quote as sent?')) {
                                    await sendQuote(q.id)
                                    loadQuotes()
                                  }
                                }}
                                style={{
                                  padding: '4px 12px', borderRadius: 6, border: '1px solid #0d7ea3',
                                  background: 'transparent', color: '#22d3ee', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                                }}
                              >
                                Send
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
        }
      </div>
    </div>
  )
}
