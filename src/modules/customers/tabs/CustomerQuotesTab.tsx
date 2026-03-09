// src/modules/customers/tabs/CustomerQuotesTab.tsx
// Quotes tab on the customer detail page — shows all quotes for this customer + inline builder

import { useState, useEffect } from 'react'
import {
  fetchQuotes, sendQuote,
  STATUS_LABELS, STATUS_COLORS, TYPE_LABELS, TYPE_COLORS,
  type Quote,
} from '../../../services/quotesService'
import { QuoteBuilder } from '../../quotes/QuoteBuilder'

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface Props {
  customerId: string
  customerName: string
  customerAddress?: string
  customerPhone?: string
}

export function CustomerQuotesTab({ customerId, customerName, customerAddress, customerPhone }: Props) {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView]     = useState<'list' | 'create' | 'edit'>('list')
  const [editQuote, setEdit]= useState<Quote | null>(null)

  useEffect(() => { loadQuotes() }, [customerId])

  async function loadQuotes() {
    setLoading(true)
    try {
      const data = await fetchQuotes(customerId)
      setQuotes(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  if (view === 'create' || view === 'edit') {
    return (
      <div style={{ margin: '-16px' }}>
        <QuoteBuilder
          customerId={customerId}
          customerName={customerName}
          customerAddress={customerAddress}
          customerPhone={customerPhone}
          existingQuote={view === 'edit' ? editQuote : null}
          onSaved={() => { loadQuotes(); setView('list'); setEdit(null) }}
          onCancel={() => { setView('list'); setEdit(null) }}
        />
      </div>
    )
  }

  const hasDraft    = quotes.some(q => q.status === 'draft')
  const hasAccepted = quotes.some(q => q.status === 'accepted')

  return (
    <div>
      {/* Sub-header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>{quotes.length} quote{quotes.length !== 1 ? 's' : ''}</span>
          {hasAccepted && (
            <span style={{ marginLeft: 10, fontSize: 12, color: '#4ade80', background: '#14532d', padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>
              ✓ Accepted
            </span>
          )}
        </div>
        <button
          onClick={() => setView('create')}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 13,
          }}
        >
          + New Quote
        </button>
      </div>

      {loading
        ? <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>Loading…</div>
        : quotes.length === 0
          ? (
            <div style={{
              textAlign: 'center', padding: '40px 20px',
              background: '#0f1923', borderRadius: 10, border: '1px dashed #1e3a4f',
            }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📄</div>
              <div style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>No quotes for this customer yet</div>
              <button
                onClick={() => setView('create')}
                style={{
                  padding: '9px 22px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 13,
                }}
              >
                Create Quote
              </button>
            </div>
          )
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {quotes.map(q => {
                const sc = STATUS_COLORS[q.status] || { bg: '#1e293b', text: '#94a3b8' }
                const tc = TYPE_COLORS[q.commercial_type] || '#94a3b8'
                const isEditable = q.status === 'draft'
                return (
                  <div
                    key={q.id}
                    style={{
                      background: '#0f1923', border: '1px solid',
                      borderColor: q.status === 'accepted' ? '#166534' : '#1e3a4f',
                      borderRadius: 10, padding: '14px 16px',
                      cursor: 'pointer', transition: 'border-color 0.15s',
                    }}
                    onClick={() => { setEdit(q); setView('edit') }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = '#0d7ea3')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = q.status === 'accepted' ? '#166534' : '#1e3a4f')}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ color: '#60a5fa', fontWeight: 700, fontSize: 13, fontFamily: 'monospace' }}>
                            {q.quote_number}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: tc, background: tc + '22', padding: '2px 7px', borderRadius: 5 }}>
                            {TYPE_LABELS[q.commercial_type]}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: sc.text, background: sc.bg, padding: '2px 7px', borderRadius: 5 }}>
                            {STATUS_LABELS[q.status]}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 16, color: '#64748b', fontSize: 12 }}>
                          <span>Expires {fmtDate(q.valid_until || null)}</span>
                          <span>Created {fmtDate(q.created_at)}</span>
                          {q.sent_at && <span>Sent {fmtDate(q.sent_at)}</span>}
                          {q.accepted_at && <span style={{ color: '#4ade80' }}>✓ Accepted {fmtDate(q.accepted_at)}</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 16 }}>{fmt(q.total)}</div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>incl. tax</div>
                      </div>
                    </div>

                    {/* Actions row */}
                    <div style={{ display: 'flex', gap: 6, marginTop: 10 }} onClick={e => e.stopPropagation()}>
                      {isEditable && (
                        <>
                          <button
                            onClick={() => { setEdit(q); setView('edit') }}
                            style={{
                              padding: '5px 12px', borderRadius: 6, border: '1px solid #1e3a4f',
                              background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 12,
                            }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={async () => {
                              if (confirm('Mark as sent? Snapshot will be frozen.')) {
                                await sendQuote(q.id)
                                loadQuotes()
                              }
                            }}
                            style={{
                              padding: '5px 12px', borderRadius: 6, border: '1px solid #0d7ea3',
                              background: 'transparent', color: '#22d3ee', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                            }}
                          >
                            Send
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => { setEdit(q); setView('edit') }}
                        style={{
                          padding: '5px 12px', borderRadius: 6, border: '1px solid #1e3a4f',
                          background: 'transparent', color: '#60a5fa', cursor: 'pointer', fontSize: 12,
                        }}
                      >
                        👁 Preview
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
      }
    </div>
  )
}
