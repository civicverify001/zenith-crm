// src/modules/invoices/QuickInvoicePage.tsx
// Manual invoice builder — customer lookup OR ad-hoc (no customer record needed)
// Creates Stripe Payment Link → sends SMS + email → logs to invoices table

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

interface Product {
  id: string
  name: string
  sku: string
  retail_price: number | null
  category: string
}

interface LineItem {
  product: Product | null
  description: string
  qty: number
  unit_price: number
}

type Mode = 'customer' | 'adhoc'

export default function QuickInvoicePage() {
  const navigate = useNavigate()

  // Mode
  const [mode, setMode] = useState<Mode>('customer')

  // Customer mode
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<any[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null)

  // Ad-hoc mode
  const [adhocName, setAdhocName] = useState('')
  const [adhocPhone, setAdhocPhone] = useState('')
  const [adhocEmail, setAdhocEmail] = useState('')

  // Products
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [lineItems, setLineItems] = useState<LineItem[]>([])

  // Invoice meta
  const [invoiceNotes, setInvoiceNotes] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ paymentLink: string; invoiceNumber: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load products
  useEffect(() => {
    supabase.from('products').select('id, name, sku, retail_price, category')
      .eq('is_active', true).order('name')
      .then(({ data }) => setAllProducts(data || []))
  }, [])

  // Customer search
  useEffect(() => {
    if (mode !== 'customer' || customerSearch.length < 2) { setCustomerResults([]); return }
const t = setTimeout(async () => {
  try {
    const { data, error } = await supabase.from('customers')
      .select('id, full_name, phone, email, address')
      .or(`full_name.ilike.%${customerSearch}%,phone.ilike.%${customerSearch}%`)
      .limit(6)
    if (error) console.error('Customer search error:', error)
    setCustomerResults(data || [])
  } catch(e) { console.error('Search failed:', e) }
}, 300)
    return () => clearTimeout(t)
  }, [customerSearch, mode])

  function addLine(product?: Product) {
    setLineItems(prev => [...prev, {
      product: product || null,
      description: product?.name || '',
      qty: 1,
      unit_price: product?.retail_price || 0,
    }])
    setProductSearch('')
  }

  function removeLine(idx: number) {
    setLineItems(prev => prev.filter((_, i) => i !== idx))
  }

  function updateLine(idx: number, field: keyof LineItem, val: any) {
    setLineItems(prev => prev.map((l, i) => i === idx ? { ...l, [field]: val } : l))
  }

  const subtotal = lineItems.reduce((s, l) => s + l.qty * l.unit_price, 0)
  const tax      = subtotal * 0.07
  const total    = subtotal + tax

  // Recipient info
  const recipientName  = mode === 'customer' ? selectedCustomer?.full_name  : adhocName
  const recipientPhone = mode === 'customer' ? selectedCustomer?.phone       : adhocPhone
  const recipientEmail = mode === 'customer' ? selectedCustomer?.email       : adhocEmail
  const customerId     = mode === 'customer' ? selectedCustomer?.id          : null

  const canSend = lineItems.length > 0 && total > 0 && recipientName && (recipientPhone || recipientEmail)

  async function handleSend() {
    if (!canSend) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/stripe/create-payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id:   customerId,
          recipient_name:  recipientName,
          recipient_phone: recipientPhone,
          recipient_email: recipientEmail,
          line_items: lineItems.map(l => ({
            description: l.description,
            qty:         l.qty,
            unit_price:  l.unit_price,
          })),
          notes: invoiceNotes,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create invoice')
      setResult({ paymentLink: data.payment_link, invoiceNumber: data.invoice_number })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  const availableProducts = allProducts.filter(p =>
    productSearch.length >= 1 &&
    (p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.sku.toLowerCase().includes(productSearch.toLowerCase()))
  ).slice(0, 8)

  if (result) {
    return (
      <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 20, padding: 40, maxWidth: 480, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>🎉</div>
          <div style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 22, marginBottom: 8 }}>Invoice Sent!</div>
          <div style={{ color: '#475569', fontSize: 14, marginBottom: 24 }}>
            Invoice <span style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{result.invoiceNumber}</span> created for {recipientName}.
            {recipientPhone && ' SMS sent.'} {recipientEmail && ' Email sent.'}
          </div>
          <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 12, padding: 16, marginBottom: 24 }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Payment Link</div>
            <div style={{ fontSize: 13, color: '#22d3ee', wordBreak: 'break-all', marginBottom: 10, fontFamily: 'monospace' }}>{result.paymentLink}</div>
            <button onClick={() => { navigator.clipboard.writeText(result.paymentLink); }}
              style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid rgba(34,211,238,0.3)', background: 'rgba(34,211,238,0.1)', color: '#22d3ee', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              Copy Link
            </button>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button onClick={() => { setResult(null); setLineItems([]); setSelectedCustomer(null); setAdhocName(''); setAdhocPhone(''); setAdhocEmail('') }}
              style={{ padding: '10px 24px', borderRadius: 10, border: '1px solid #1e3a4f', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 14 }}>
              New Invoice
            </button>
            {customerId && (
              <button onClick={() => navigate(`/customers/${customerId}`)}
                style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                View Customer →
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100%', maxWidth: 860, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, marginBottom: 8 }}>
          ← Back
        </button>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0', margin: 0 }}>Quick Invoice</h1>
        <p style={{ fontSize: 13, color: '#475569', marginTop: 4, marginBottom: 0 }}>
          Create a Stripe payment link and send it via SMS + email
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>

        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Mode toggle */}
          <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Bill To</div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 4 }}>
              {([
                { id: 'customer', label: '👤 Existing Customer' },
                { id: 'adhoc',    label: '✏️ Ad-hoc (no record)' },
              ] as { id: Mode; label: string }[]).map(m => (
                <button key={m.id} onClick={() => setMode(m.id)}
                  style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', border: mode === m.id ? '1px solid rgba(13,126,163,0.4)' : '1px solid transparent', background: mode === m.id ? 'rgba(13,126,163,0.15)' : 'transparent', color: mode === m.id ? '#38bdf8' : '#64748b' }}>
                  {m.label}
                </button>
              ))}
            </div>

            {mode === 'customer' ? (
              <div style={{ position: 'relative' }}>
                {selectedCustomer ? (
                  <div style={{ background: '#0f1923', border: '1px solid rgba(13,126,163,0.4)', borderRadius: 10, padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>{selectedCustomer.full_name}</div>
                        <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{selectedCustomer.phone}{selectedCustomer.email && ` · ${selectedCustomer.email}`}</div>
                        {selectedCustomer.service_address && <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>{selectedCustomer.service_address}</div>}
                      </div>
                      <button onClick={() => { setSelectedCustomer(null); setCustomerSearch('') }}
                        style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16 }}>×</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
                      placeholder="Search customer name…"
                      style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                    {customerResults.length > 0 && (
                      <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 10, zIndex: 20, marginTop: 4 }}>
                        {customerResults.map(c => (
                          <div key={c.id} onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); setCustomerResults([]) }}
                            style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #0d1a26', fontSize: 13, color: '#e2e8f0' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1e3a4f' }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                            <div style={{ fontWeight: 600 }}>{c.full_name}</div>
                            <div style={{ fontSize: 11, color: '#64748b' }}>{c.phone}{c.email && ` · ${c.email}`}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Full Name *</label>
                  <input value={adhocName} onChange={e => setAdhocName(e.target.value)} placeholder="John Smith"
                    style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Phone</label>
                  <input value={adhocPhone} onChange={e => setAdhocPhone(e.target.value)} placeholder="(317) 555-0000"
                    style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Email</label>
                  <input value={adhocEmail} onChange={e => setAdhocEmail(e.target.value)} placeholder="john@example.com"
                    style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
              </div>
            )}
          </div>

          {/* Line Items */}
          <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Line Items</div>

            {/* Product search */}
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <input value={productSearch} onChange={e => setProductSearch(e.target.value)}
                placeholder="Search products to add… or type a custom item below"
                style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              {availableProducts.length > 0 && (
                <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 10, zIndex: 20, marginTop: 4, maxHeight: 220, overflowY: 'auto' }}>
                  {availableProducts.map(p => (
                    <div key={p.id} onClick={() => addLine(p)}
                      style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #0d1a26' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1e3a4f' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                      <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
                        {p.sku}
                        {p.retail_price != null && <span style={{ marginLeft: 10, color: '#4ade80' }}>${p.retail_price.toFixed(2)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Custom item button */}
            <button onClick={() => addLine()}
              style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(96,165,250,0.25)', background: 'rgba(96,165,250,0.08)', color: '#60a5fa', cursor: 'pointer', fontWeight: 600, marginBottom: 14 }}>
              + Add Custom Line Item
            </button>

            {/* Lines */}
            {lineItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#334155', fontSize: 13 }}>
                Search for a product above or add a custom line item
              </div>
            ) : (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 100px 32px', gap: 8, padding: '6px 0', borderBottom: '1px solid #1e3a4f', marginBottom: 8 }}>
                  {['Description', 'Qty', 'Unit Price', ''].map(h => (
                    <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
                  ))}
                </div>
                {lineItems.map((l, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 100px 32px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <input value={l.description} onChange={e => updateLine(idx, 'description', e.target.value)}
                      placeholder="Item description"
                      style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 7, color: '#e2e8f0', padding: '8px 10px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' }} />
                    <input type="number" min="1" value={l.qty} onChange={e => updateLine(idx, 'qty', parseInt(e.target.value) || 1)}
                      style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 7, color: '#e2e8f0', padding: '8px 10px', fontSize: 13, outline: 'none', textAlign: 'right', width: '100%', boxSizing: 'border-box' }} />
                    <input type="number" min="0" step="0.01" value={l.unit_price} onChange={e => updateLine(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                      style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 7, color: '#e2e8f0', padding: '8px 10px', fontSize: 13, outline: 'none', textAlign: 'right', width: '100%', boxSizing: 'border-box' }} />
                    <button onClick={() => removeLine(idx)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Notes (optional)</div>
            <textarea value={invoiceNotes} onChange={e => setInvoiceNotes(e.target.value)}
              placeholder="Internal notes or message for the customer…"
              rows={3}
              style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
        </div>

        {/* Right column — summary + send */}
        <div style={{ position: 'sticky', top: 20 }}>
          <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Invoice Summary</div>

            {/* Recipient */}
            <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #1e3a4f' }}>
              <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>Bill to</div>
              {recipientName ? (
                <div>
                  <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 14 }}>{recipientName}</div>
                  {recipientPhone && <div style={{ color: '#64748b', fontSize: 12 }}>{recipientPhone}</div>}
                  {recipientEmail && <div style={{ color: '#64748b', fontSize: 12 }}>{recipientEmail}</div>}
                </div>
              ) : (
                <div style={{ color: '#334155', fontSize: 13, fontStyle: 'italic' }}>No recipient yet</div>
              )}
            </div>

            {/* Totals */}
            <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #1e3a4f' }}>
              {[
                { label: 'Subtotal', value: subtotal },
                { label: 'Tax (7% Indiana)', value: tax },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: '#64748b' }}>{row.label}</span>
                  <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>${row.value.toFixed(2)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid #1e3a4f' }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>Total</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: '#4ade80' }}>${total.toFixed(2)}</span>
              </div>
            </div>

            {/* Delivery method */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#475569', marginBottom: 8 }}>Payment link will be sent via:</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {recipientPhone && (
                  <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)', fontWeight: 600 }}>
                    💬 SMS
                  </span>
                )}
                {recipientEmail && (
                  <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: 'rgba(96,165,250,0.12)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.25)', fontWeight: 600 }}>
                    ✉️ Email
                  </span>
                )}
                {!recipientPhone && !recipientEmail && (
                  <span style={{ fontSize: 11, color: '#334155', fontStyle: 'italic' }}>Add phone or email above</span>
                )}
              </div>
            </div>

            {error && (
              <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#f87171' }}>
                {error}
              </div>
            )}

            <button onClick={handleSend} disabled={!canSend || sending}
              style={{ width: '100%', padding: '14px 0', borderRadius: 10, border: 'none', background: canSend ? '#0d7ea3' : '#334155', color: '#fff', fontWeight: 700, fontSize: 15, cursor: canSend ? 'pointer' : 'not-allowed', opacity: sending ? 0.6 : 1, transition: 'background 0.2s' }}>
              {sending ? 'Creating invoice…' : '⚡ Send Invoice'}
            </button>

            {!canSend && (
              <div style={{ fontSize: 11, color: '#334155', textAlign: 'center', marginTop: 8 }}>
                {lineItems.length === 0 ? 'Add at least one item' : !recipientName ? 'Add recipient name' : 'Add phone or email to send'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
