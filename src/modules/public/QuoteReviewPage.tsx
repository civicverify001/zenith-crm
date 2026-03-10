// src/modules/public/QuoteReviewPage.tsx
// Public page — no auth required. Customer views and accepts/declines quote.

import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'

type QuoteData = {
  id: string
  quote_number: string
  status: string
  commercial_type: string
  subtotal: number
  tax_amount: number
  total: number
  notes: string | null
  valid_until: string | null
  sent_at: string | null
  accepted_at: string | null
  declined_at: string | null
  created_at: string
  line_items: any[]
  customer_name: string
  customer_email: string
  customer_address: string
}

export function QuoteReviewPage() {
  const { token } = useParams<{ token: string }>()
  const [quote, setQuote] = useState<QuoteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ status: string; message: string } | null>(null)
  const [showDecline, setShowDecline] = useState(false)
  const [declineReason, setDeclineReason] = useState('')

  useEffect(() => {
    if (!token) return
    fetch(`/api/quotes/review?token=${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) setError(data.error)
        else setQuote(data)
      })
      .catch(() => setError('Unable to load quote'))
      .finally(() => setLoading(false))
  }, [token])

  async function handleAction(action: 'accept' | 'decline') {
    setBusy(true)
    try {
      const res = await fetch(`/api/quotes/review?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action, decline_reason: declineReason || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setResult({ status: data.status, message: data.message })
      setQuote(prev => prev ? { ...prev, status: data.status } : null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // ─── Styles ──────────────────────────────────────────────
  const S = {
    page: {
      minHeight: '100vh', background: '#f8fafc',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    } as React.CSSProperties,
    header: {
      background: '#0f172a', padding: '20px 0', textAlign: 'center' as const,
    },
    logo: {
      display: 'inline-flex', alignItems: 'center', gap: 10,
    },
    logoIcon: {
      width: 36, height: 36, borderRadius: 8, background: '#3b82f6',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 900, fontSize: 16,
    },
    container: {
      maxWidth: 680, margin: '0 auto', padding: '32px 20px',
    },
    card: {
      background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' as const, marginBottom: 20,
    },
    cardHeader: {
      padding: '20px 24px', borderBottom: '1px solid #f1f5f9',
    },
    cardBody: { padding: '20px 24px' },
    label: {
      fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' as const,
      letterSpacing: '0.08em', marginBottom: 4,
    },
    value: { fontSize: 15, fontWeight: 600, color: '#1e293b' },
    btn: {
      padding: '14px 32px', borderRadius: 10, border: 'none', cursor: 'pointer',
      fontSize: 15, fontWeight: 700, transition: 'all 0.15s',
    } as React.CSSProperties,
  }

  // ─── Loading state ──────────────────────────────────────
  if (loading) {
    return (
      <div style={S.page}>
        <div style={S.header}>
          <div style={S.logo}>
            <div style={S.logoIcon}>Z</div>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>Zenith Pure Solutions</span>
          </div>
        </div>
        <div style={{ ...S.container, textAlign: 'center', paddingTop: 80 }}>
          <div style={{ fontSize: 18, color: '#64748b' }}>Loading your quote…</div>
        </div>
      </div>
    )
  }

  // ─── Error state ────────────────────────────────────────
  if (error && !quote) {
    return (
      <div style={S.page}>
        <div style={S.header}>
          <div style={S.logo}>
            <div style={S.logoIcon}>Z</div>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>Zenith Pure Solutions</span>
          </div>
        </div>
        <div style={{ ...S.container, textAlign: 'center', paddingTop: 80 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>😕</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>Quote Not Found</div>
          <div style={{ fontSize: 15, color: '#64748b' }}>{error}</div>
        </div>
      </div>
    )
  }

  if (!quote) return null

  const isActionable = ['sent', 'viewed'].includes(quote.status)
  const isExpired = quote.valid_until && new Date(quote.valid_until) < new Date()
  const typeLabel = quote.commercial_type === 'rental' ? 'Rental Agreement' : quote.commercial_type === 'financed' ? 'Financed Purchase' : 'Purchase'

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.logo}>
          <div style={S.logoIcon}>Z</div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>Zenith Pure Solutions</div>
            <div style={{ color: '#64748b', fontSize: 12 }}>Water Treatment Specialists — Indianapolis, IN</div>
          </div>
        </div>
      </div>

      <div style={S.container}>
        {/* Success/decline result banner */}
        {result && (
          <div style={{
            ...S.card, padding: '24px', textAlign: 'center',
            background: result.status === 'accepted' ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${result.status === 'accepted' ? '#bbf7d0' : '#fecaca'}`,
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{result.status === 'accepted' ? '✅' : '❌'}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: result.status === 'accepted' ? '#16a34a' : '#dc2626', marginBottom: 8 }}>
              {result.status === 'accepted' ? 'Quote Accepted!' : 'Quote Declined'}
            </div>
            <div style={{ fontSize: 15, color: '#64748b' }}>
              {result.status === 'accepted'
                ? 'Thank you! Our team will be in touch shortly to schedule your installation.'
                : 'Thank you for letting us know. Feel free to contact us if you change your mind.'}
            </div>
            {result.status === 'accepted' && quote.commercial_type === 'rental' && (
              <div style={{ marginTop: 16, padding: '12px 16px', background: '#ecfdf5', borderRadius: 8, border: '1px solid #a7f3d0', fontSize: 13, color: '#065f46' }}>
                A rental agreement has been prepared and our team will reach out for signature.
              </div>
            )}
          </div>
        )}

        {/* Quote header card */}
        <div style={S.card}>
          <div style={S.cardHeader}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>Quote</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>{quote.quote_number}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{
                  display: 'inline-block', padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                  background: quote.status === 'accepted' ? '#dcfce7' : quote.status === 'declined' ? '#fee2e2' : '#dbeafe',
                  color: quote.status === 'accepted' ? '#16a34a' : quote.status === 'declined' ? '#dc2626' : '#2563eb',
                }}>
                  {quote.status.charAt(0).toUpperCase() + quote.status.slice(1)}
                </span>
                <div style={{ marginTop: 6 }}>
                  <span style={{
                    display: 'inline-block', padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: '#f1f5f9', color: '#64748b',
                  }}>
                    {typeLabel}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div style={S.cardBody}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={S.label}>Prepared For</div>
                <div style={S.value}>{quote.customer_name}</div>
                {quote.customer_address && <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{quote.customer_address}</div>}
              </div>
              <div>
                <div style={S.label}>Date</div>
                <div style={S.value}>{fmtDate(quote.sent_at || quote.created_at)}</div>
                {quote.valid_until && (
                  <div style={{ fontSize: 13, color: isExpired ? '#dc2626' : '#64748b', marginTop: 2 }}>
                    {isExpired ? 'Expired' : 'Valid until'} {fmtDate(quote.valid_until)}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div style={S.card}>
          <div style={{ ...S.cardHeader, background: '#f8fafc' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>Itemized Quote</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                {['Description', 'Qty', 'Unit Price', 'Total'].map((h, i) => (
                  <th key={h} style={{
                    padding: '10px 20px', fontSize: 11, fontWeight: 700, color: '#94a3b8',
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                    textAlign: i === 0 ? 'left' : 'right',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quote.line_items.map((li: any, i: number) => (
                <tr key={i} style={{ borderBottom: '1px solid #f8fafc' }}>
                  <td style={{ padding: '14px 20px', fontSize: 14, color: '#1e293b', fontWeight: 500 }}>{li.description}</td>
                  <td style={{ padding: '14px 20px', fontSize: 14, color: '#64748b', textAlign: 'right' }}>{li.quantity}</td>
                  <td style={{ padding: '14px 20px', fontSize: 14, color: '#64748b', textAlign: 'right' }}>{fmt(li.unit_price)}</td>
                  <td style={{ padding: '14px 20px', fontSize: 14, color: '#1e293b', fontWeight: 600, textAlign: 'right' }}>{fmt(li.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '1px solid #e2e8f0' }}>
                <td colSpan={3} style={{ padding: '8px 20px', textAlign: 'right', fontSize: 13, color: '#94a3b8' }}>Subtotal</td>
                <td style={{ padding: '8px 20px', textAlign: 'right', fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{fmt(quote.subtotal)}</td>
              </tr>
              <tr>
                <td colSpan={3} style={{ padding: '8px 20px', textAlign: 'right', fontSize: 13, color: '#94a3b8' }}>Tax (7%)</td>
                <td style={{ padding: '8px 20px', textAlign: 'right', fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{fmt(quote.tax_amount)}</td>
              </tr>
              <tr style={{ borderTop: '2px solid #e2e8f0' }}>
                <td colSpan={3} style={{ padding: '14px 20px', textAlign: 'right', fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Total</td>
                <td style={{ padding: '14px 20px', textAlign: 'right', fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{fmt(quote.total)}</td>
              </tr>
              {quote.commercial_type === 'rental' && (
                <tr>
                  <td colSpan={4} style={{ padding: '12px 20px', textAlign: 'right' }}>
                    <span style={{ fontSize: 12, color: '#64748b', background: '#f1f5f9', padding: '4px 10px', borderRadius: 6 }}>
                      Monthly rental — equipment remains property of Zenith Pure Solutions
                    </span>
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>

        {/* Notes */}
        {quote.notes && (
          <div style={S.card}>
            <div style={{ padding: '16px 24px' }}>
              <div style={S.label}>Notes</div>
              <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{quote.notes}</div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        {isActionable && !result && !isExpired && (
          <div style={{ ...S.card, padding: '24px', textAlign: 'center' }}>
            <div style={{ fontSize: 15, color: '#475569', marginBottom: 20 }}>
              Ready to proceed? Accept this quote to get started.
            </div>

            {!showDecline ? (
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button
                  onClick={() => handleAction('accept')}
                  disabled={busy}
                  style={{
                    ...S.btn, background: '#16a34a', color: '#fff',
                    padding: '14px 48px', fontSize: 16,
                    opacity: busy ? 0.6 : 1,
                    boxShadow: '0 2px 8px rgba(22, 163, 74, 0.3)',
                  }}
                >
                  {busy ? 'Processing…' : '✓ Accept Quote'}
                </button>
                <button
                  onClick={() => setShowDecline(true)}
                  disabled={busy}
                  style={{
                    ...S.btn, background: '#fff', color: '#dc2626',
                    border: '1px solid #fecaca', padding: '14px 32px',
                  }}
                >
                  Decline
                </button>
              </div>
            ) : (
              <div style={{ maxWidth: 400, margin: '0 auto' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginBottom: 8 }}>
                  Would you like to tell us why? (optional)
                </div>
                <textarea
                  value={declineReason}
                  onChange={e => setDeclineReason(e.target.value)}
                  placeholder="e.g. Price too high, went with another provider, timing isn't right…"
                  rows={3}
                  style={{
                    width: '100%', borderRadius: 8, border: '1px solid #e2e8f0',
                    padding: '10px 14px', fontSize: 14, resize: 'none', outline: 'none',
                    boxSizing: 'border-box', marginBottom: 12,
                  }}
                />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setShowDecline(false)} style={{ ...S.btn, flex: 1, background: '#f1f5f9', color: '#64748b' }}>
                    Go Back
                  </button>
                  <button
                    onClick={() => handleAction('decline')}
                    disabled={busy}
                    style={{ ...S.btn, flex: 1, background: '#dc2626', color: '#fff', opacity: busy ? 0.6 : 1 }}
                  >
                    {busy ? 'Processing…' : 'Confirm Decline'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Expired notice */}
        {isExpired && !result && (
          <div style={{ ...S.card, padding: '24px', textAlign: 'center', background: '#fefce8', border: '1px solid #fde68a' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>This Quote Has Expired</div>
            <div style={{ fontSize: 14, color: '#a16207' }}>
              Please contact Zenith Pure Solutions at <strong>(317) 555-0100</strong> for an updated quote.
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ textAlign: 'center', padding: '32px 0 16px', color: '#94a3b8', fontSize: 12 }}>
          <div style={{ marginBottom: 4 }}>Zenith Pure Solutions — Indianapolis, IN</div>
          <div>Water Treatment Specialists</div>
          {error && <div style={{ color: '#dc2626', marginTop: 8 }}>{error}</div>}
        </div>
      </div>
    </div>
  )
}
