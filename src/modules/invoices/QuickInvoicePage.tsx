// src/modules/invoices/QuickInvoicePage.tsx
import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { supabase } from '../../lib/supabase'

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      color: '#e2e8f0',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      '::placeholder': { color: '#475569' },
    },
    invalid: { color: '#f87171' },
  },
}

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
type PaymentMode = 'link' | 'card' | 'terminal' | 'cash'

function QuickInvoiceInner() {
  const navigate = useNavigate()
  const stripe = useStripe()
  const elements = useElements()
  const [searchParams] = useSearchParams()
  const preloadCustomerId = searchParams.get('customerId')

  const [mode, setMode] = useState<Mode>('customer')
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<any[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null)
  const [adhocName, setAdhocName] = useState('')
  const [adhocPhone, setAdhocPhone] = useState('')
  const [adhocEmail, setAdhocEmail] = useState('')
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [invoiceNotes, setInvoiceNotes] = useState('')
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('link')
  const [defaultPaymentMethod, setDefaultPaymentMethod] = useState<any>(null)
  const [saveCardForFuture, setSaveCardForFuture] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ paymentLink?: string; invoiceNumber: string; mode: PaymentMode } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!preloadCustomerId) return
    supabase.from('customers').select('id, full_name, phone, email, address, stripe_customer_id')
      .eq('id', preloadCustomerId).single()
      .then(({ data }) => { if (data) { setSelectedCustomer(data); setMode('customer') } })
  }, [preloadCustomerId])

  useEffect(() => {
    if (!selectedCustomer?.id) { setDefaultPaymentMethod(null); return }
    supabase.from('payment_methods').select('id, external_id, last_four, type, exp_month, exp_year')
      .eq('customer_id', selectedCustomer.id).eq('is_default', true).eq('status', 'active').maybeSingle()
      .then(({ data }) => setDefaultPaymentMethod(data || null))
  }, [selectedCustomer?.id])

  useEffect(() => {
    supabase.from('products').select('id, name, sku, retail_price, category').eq('is_active', true).order('name')
      .then(({ data }) => setAllProducts(data || []))
  }, [])

  useEffect(() => {
    if (mode !== 'customer' || customerSearch.length < 2) { setCustomerResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('customers')
        .select('id, full_name, phone, email, address, stripe_customer_id')
        .or(`full_name.ilike.%${customerSearch}%,phone.ilike.%${customerSearch}%`).limit(6)
      setCustomerResults(data || [])
    }, 300)
    return () => clearTimeout(t)
  }, [customerSearch, mode])

  function addLine(product?: Product) {
    setLineItems(prev => [...prev, { product: product || null, description: product?.name || '', qty: 1, unit_price: product?.retail_price || 0 }])
    setProductSearch('')
  }
  function removeLine(idx: number) { setLineItems(prev => prev.filter((_, i) => i !== idx)) }
  function updateLine(idx: number, field: keyof LineItem, val: any) {
    setLineItems(prev => prev.map((l, i) => i === idx ? { ...l, [field]: val } : l))
  }

  const subtotal = lineItems.reduce((s, l) => s + l.qty * l.unit_price, 0)
  const tax = subtotal * 0.07
  const total = subtotal + tax
  const totalCents = Math.round(total * 100)

  const recipientName  = mode === 'customer' ? selectedCustomer?.full_name  : adhocName
  const recipientPhone = mode === 'customer' ? selectedCustomer?.phone       : adhocPhone
  const recipientEmail = mode === 'customer' ? selectedCustomer?.email       : adhocEmail
  const customerId     = mode === 'customer' ? selectedCustomer?.id          : null

  const canSend = lineItems.length > 0 && total > 0 && !!recipientName
    && lineItems.every(l => l.description.trim())
    && (
      paymentMode === 'cash'
      || paymentMode === 'terminal'
      || (paymentMode === 'card' && !!defaultPaymentMethod)
      || (paymentMode === 'link' && (!!recipientPhone || !!recipientEmail))
    )

  async function generateInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear()
    const { count } = await supabase.from('invoices').select('id', { count: 'exact', head: true }).gte('created_at', `${year}-01-01`)
    return `INV-${year}-${String((count || 0) + 1).padStart(4, '0')}`
  }

  async function logInvoiceAndTx(invoiceNumber: string, type: string, externalId: string | null, notesSuffix?: string) {
    const description = lineItems.map(l => `${l.qty}x ${l.description}`).join(', ')
    await supabase.from('invoices').insert({
      customer_id: customerId, invoice_number: invoiceNumber, status: 'paid',
      subtotal, tax, total, paid_at: new Date().toISOString(),
      notes: notesSuffix ? (invoiceNotes ? `${invoiceNotes} ${notesSuffix}` : notesSuffix) : invoiceNotes,
    })
    await supabase.from('payment_transactions').insert({
      customer_id: customerId, amount: total, status: 'succeeded', type,
      external_id: externalId, description: `${notesSuffix || ''} Invoice ${invoiceNumber} — ${description}`.trim(),
      attempted_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    })
    fetch('/api/automations/trigger', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'payment_receipt_email', to: recipientPhone || '', entity_type: 'customer', entity_id: customerId, variables: { name: (recipientName || '').split(' ')[0], amount: `$${total.toFixed(2)}`, invoice: invoiceNumber } }),
    }).catch(() => {})
  }

  async function handleSendLink() {
    const res = await fetch('/api/stripe/create-payment-link', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_id: customerId, recipient_name: recipientName, recipient_phone: recipientPhone, recipient_email: recipientEmail, line_items: lineItems.map(l => ({ description: l.description, qty: l.qty, unit_price: l.unit_price })), notes: invoiceNotes }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to create payment link')
    return { paymentLink: data.payment_link, invoiceNumber: data.invoice_number }
  }

  async function handleChargeCard() {
    if (!defaultPaymentMethod || !selectedCustomer?.stripe_customer_id) throw new Error('No default payment method on file')
    const invoiceNumber = await generateInvoiceNumber()
    const chargeRes = await fetch('/api/stripe/charge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stripe_customer_id: selectedCustomer.stripe_customer_id, payment_method_id: defaultPaymentMethod.external_id, amount_cents: totalCents, description: `Invoice ${invoiceNumber}`, metadata: { customer_id: customerId, invoice_number: invoiceNumber } }),
    })
    const chargeData = await chargeRes.json()
    if (!chargeRes.ok) throw new Error(chargeData.error || 'Card charge failed')
    await logInvoiceAndTx(invoiceNumber, 'manual', chargeData.payment_intent_id || null)
    return { invoiceNumber }
  }

  async function handleTerminalCharge() {
    if (!stripe || !elements) throw new Error('Stripe not loaded')
    const cardElement = elements.getElement(CardElement)
    if (!cardElement) throw new Error('Card element not found')
    const invoiceNumber = await generateInvoiceNumber()

    // Ensure Stripe customer exists
    let stripeCustomerId = selectedCustomer?.stripe_customer_id || null
    if (customerId && !stripeCustomerId) {
      const setupRes = await fetch('/api/stripe/setup-intent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_name: recipientName, customer_email: recipientEmail || undefined }),
      })
      const setupData = await setupRes.json()
      if (!setupRes.ok) throw new Error(setupData.error || 'Could not create Stripe customer')
      stripeCustomerId = setupData.stripe_customer_id
      await supabase.from('customers').update({ stripe_customer_id: stripeCustomerId }).eq('id', customerId)
      setSelectedCustomer((prev: any) => prev ? { ...prev, stripe_customer_id: stripeCustomerId } : prev)
    }

    // Create PaymentMethod from card input
    const { error: pmError, paymentMethod } = await stripe.createPaymentMethod({
      type: 'card', card: cardElement,
      billing_details: { name: recipientName || undefined, email: recipientEmail || undefined },
    })
    if (pmError) throw new Error(pmError.message)

    // Charge
    const chargeRes = await fetch('/api/stripe/charge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stripe_customer_id: stripeCustomerId, payment_method_id: paymentMethod!.id, amount_cents: totalCents, description: `Invoice ${invoiceNumber} [WALK-IN]`, metadata: { customer_id: customerId || '', invoice_number: invoiceNumber } }),
    })
    const chargeData = await chargeRes.json()
    if (!chargeRes.ok) throw new Error(chargeData.error || 'Card charge failed')

    // Optionally save card
    if (saveCardForFuture && customerId) {
      await supabase.from('payment_methods').update({ is_default: false }).eq('customer_id', customerId)
      await supabase.from('payment_methods').insert({
        customer_id: customerId, type: 'card', provider: 'stripe',
        external_id: paymentMethod!.id, last_four: paymentMethod!.card?.last4 || '????',
        exp_month: paymentMethod!.card?.exp_month || 0, exp_year: paymentMethod!.card?.exp_year || 0,
        is_default: true, status: 'active',
      })
    }

    await logInvoiceAndTx(invoiceNumber, 'manual', chargeData.payment_intent_id || null, '[WALK-IN]')
    return { invoiceNumber }
  }

  async function handleCash() {
    const invoiceNumber = await generateInvoiceNumber()
    await logInvoiceAndTx(invoiceNumber, 'cash', null, '[CASH]')
    return { invoiceNumber }
  }

  async function handleSend() {
    if (!canSend) return
    setSending(true); setError(null)
    try {
      if (paymentMode === 'link') {
        const r = await handleSendLink()
        setResult({ paymentLink: r.paymentLink, invoiceNumber: r.invoiceNumber, mode: 'link' })
      } else if (paymentMode === 'card') {
        const r = await handleChargeCard()
        setResult({ invoiceNumber: r.invoiceNumber, mode: 'card' })
      } else if (paymentMode === 'terminal') {
        const r = await handleTerminalCharge()
        setResult({ invoiceNumber: r.invoiceNumber, mode: 'terminal' })
      } else {
        const r = await handleCash()
        setResult({ invoiceNumber: r.invoiceNumber, mode: 'cash' })
      }
    } catch (e: any) { setError(e.message) }
    finally { setSending(false) }
  }

  const availableProducts = allProducts.filter(p =>
    productSearch.length >= 1 &&
    (p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.sku.toLowerCase().includes(productSearch.toLowerCase()))
  ).slice(0, 8)

  // ── Success screen ────────────────────────────────────────
  if (result) {
    const modeLabel = result.mode === 'cash' ? '💵 Cash recorded' : result.mode === 'link' ? '🔗 Payment link sent' : '💳 Card charged'
    const modeColor = result.mode === 'cash' ? '#4ade80' : result.mode === 'link' ? '#22d3ee' : '#60a5fa'
    return (
      <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 20, padding: 40, maxWidth: 480, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>{result.mode === 'cash' ? '💵' : result.mode === 'link' ? '🎉' : '💳'}</div>
          <div style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 22, marginBottom: 8 }}>
            {result.mode === 'cash' ? 'Cash Payment Recorded!' : result.mode === 'link' ? 'Invoice Sent!' : 'Payment Collected!'}
          </div>
          <div style={{ color: '#475569', fontSize: 14, marginBottom: 8 }}>
            Invoice <span style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{result.invoiceNumber}</span> for {recipientName}
          </div>
          <div style={{ display: 'inline-block', padding: '4px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700, color: modeColor, background: `${modeColor}18`, border: `1px solid ${modeColor}30`, marginBottom: 24 }}>
            {modeLabel} — ${total.toFixed(2)}
          </div>
          {result.paymentLink && (
            <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 12, padding: 16, marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Payment Link</div>
              <div style={{ fontSize: 13, color: '#22d3ee', wordBreak: 'break-all', marginBottom: 12, fontFamily: 'monospace' }}>{result.paymentLink}</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button onClick={() => navigator.clipboard.writeText(result.paymentLink!)} style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid rgba(34,211,238,0.3)', background: 'rgba(34,211,238,0.1)', color: '#22d3ee', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Copy Link</button>
                <a href={result.paymentLink} target="_blank" rel="noopener noreferrer" style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#0d7ea3', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Pay Now →</a>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button onClick={() => { setResult(null); setLineItems([]); if (!preloadCustomerId) setSelectedCustomer(null); setAdhocName(''); setAdhocPhone(''); setAdhocEmail(''); setError(null) }}
              style={{ padding: '10px 24px', borderRadius: 10, border: '1px solid #1e3a4f', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 14 }}>New Invoice</button>
            {customerId && (
              <button onClick={() => navigate(`/customers/${customerId}`)} style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>View Customer →</button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Main form ─────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100%', maxWidth: 860, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, marginBottom: 8 }}>← Back</button>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0', margin: 0 }}>Quick Invoice</h1>
        <p style={{ fontSize: 13, color: '#475569', marginTop: 4, marginBottom: 0 }}>Charge a card on file, enter a new card, record cash, or send a Stripe payment link</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Bill To */}
          <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Bill To</div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 4 }}>
              {([{ id: 'customer', label: '👤 Existing Customer' }, { id: 'adhoc', label: '✏️ Ad-hoc (no record)' }] as { id: Mode; label: string }[]).map(m => (
                <button key={m.id} onClick={() => setMode(m.id)} style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', border: mode === m.id ? '1px solid rgba(13,126,163,0.4)' : '1px solid transparent', background: mode === m.id ? 'rgba(13,126,163,0.15)' : 'transparent', color: mode === m.id ? '#38bdf8' : '#64748b' }}>{m.label}</button>
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
                        {selectedCustomer.address && <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>{selectedCustomer.address}</div>}
                        {defaultPaymentMethod && (
                          <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 20, background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)', fontSize: 11, color: '#60a5fa', fontWeight: 600 }}>
                            💳 •••• {defaultPaymentMethod.last_four} on file
                          </div>
                        )}
                      </div>
                      {!preloadCustomerId && (
                        <button onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); setDefaultPaymentMethod(null) }} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16 }}>×</button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} placeholder="Search customer name or phone…"
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
                  <input value={adhocName} onChange={e => setAdhocName(e.target.value)} placeholder="John Smith" style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Phone</label>
                  <input value={adhocPhone} onChange={e => setAdhocPhone(e.target.value)} placeholder="(317) 555-0000" style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Email</label>
                  <input value={adhocEmail} onChange={e => setAdhocEmail(e.target.value)} placeholder="john@example.com" style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
              </div>
            )}
          </div>

          {/* Line Items */}
          <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Line Items</div>
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <input value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="Search products to add… or add a custom item below"
                style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              {availableProducts.length > 0 && (
                <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 10, zIndex: 20, marginTop: 4, maxHeight: 220, overflowY: 'auto' }}>
                  {availableProducts.map(p => (
                    <div key={p.id} onClick={() => addLine(p)} style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #0d1a26' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1e3a4f' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                      <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{p.sku}{p.retail_price != null && <span style={{ marginLeft: 10, color: '#4ade80' }}>${p.retail_price.toFixed(2)}</span>}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => addLine()} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(96,165,250,0.25)', background: 'rgba(96,165,250,0.08)', color: '#60a5fa', cursor: 'pointer', fontWeight: 600, marginBottom: 14 }}>+ Add Custom Line Item</button>
            {lineItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#334155', fontSize: 13 }}>Search for a product above or add a custom line item</div>
            ) : (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 100px 32px', gap: 8, padding: '6px 0', borderBottom: '1px solid #1e3a4f', marginBottom: 8 }}>
                  {['Description', 'Qty', 'Unit Price', ''].map(h => <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>)}
                </div>
                {lineItems.map((l, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 100px 32px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <input value={l.description} onChange={e => updateLine(idx, 'description', e.target.value)} placeholder="Item description" style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 7, color: '#e2e8f0', padding: '8px 10px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' }} />
                    <input type="number" min="1" value={l.qty} onChange={e => updateLine(idx, 'qty', parseInt(e.target.value) || 1)} style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 7, color: '#e2e8f0', padding: '8px 10px', fontSize: 13, outline: 'none', textAlign: 'right', width: '100%', boxSizing: 'border-box' }} />
                    <input type="number" min="0" step="0.01" value={l.unit_price} onChange={e => updateLine(idx, 'unit_price', parseFloat(e.target.value) || 0)} style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 7, color: '#e2e8f0', padding: '8px 10px', fontSize: 13, outline: 'none', textAlign: 'right', width: '100%', boxSizing: 'border-box' }} />
                    <button onClick={() => removeLine(idx)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Notes (optional)</div>
            <textarea value={invoiceNotes} onChange={e => setInvoiceNotes(e.target.value)} placeholder="Internal notes or message for the customer…" rows={3}
              style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
        </div>

        {/* Right — summary + payment mode */}
        <div style={{ position: 'sticky', top: 20 }}>
          <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Invoice Summary</div>

            <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #1e3a4f' }}>
              <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>Bill to</div>
              {recipientName ? (
                <div>
                  <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 14 }}>{recipientName}</div>
                  {recipientPhone && <div style={{ color: '#64748b', fontSize: 12 }}>{recipientPhone}</div>}
                  {recipientEmail && <div style={{ color: '#64748b', fontSize: 12 }}>{recipientEmail}</div>}
                </div>
              ) : <div style={{ color: '#334155', fontSize: 13, fontStyle: 'italic' }}>No recipient yet</div>}
            </div>

            <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #1e3a4f' }}>
              {[{ label: 'Subtotal', value: subtotal }, { label: 'Tax (7% Indiana)', value: tax }].map(row => (
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

            {/* Payment Mode Selector */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>How to collect</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button onClick={() => setPaymentMode('link')} style={{ padding: '10px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', border: paymentMode === 'link' ? '1px solid rgba(34,211,238,0.4)' : '1px solid #1e3a4f', background: paymentMode === 'link' ? 'rgba(34,211,238,0.08)' : '#0f1923' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: paymentMode === 'link' ? '#22d3ee' : '#94a3b8' }}>🔗 Send Payment Link</div>
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>SMS + email with Stripe link</div>
                </button>

                <button onClick={() => defaultPaymentMethod && setPaymentMode('card')} style={{ padding: '10px 14px', borderRadius: 10, cursor: defaultPaymentMethod ? 'pointer' : 'not-allowed', textAlign: 'left', border: paymentMode === 'card' ? '1px solid rgba(96,165,250,0.4)' : '1px solid #1e3a4f', background: paymentMode === 'card' ? 'rgba(96,165,250,0.08)' : '#0f1923', opacity: !defaultPaymentMethod ? 0.4 : 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: paymentMode === 'card' ? '#60a5fa' : '#94a3b8' }}>
                    💳 Charge Card on File{defaultPaymentMethod && <span style={{ fontSize: 11, fontWeight: 400, color: '#64748b', marginLeft: 8 }}>•••• {defaultPaymentMethod.last_four}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{defaultPaymentMethod ? 'Charge default card immediately' : 'No card on file'}</div>
                </button>

                {/* ── NEW: Enter Card Now ── */}
                <button onClick={() => setPaymentMode('terminal')} style={{ padding: '10px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', border: paymentMode === 'terminal' ? '1px solid rgba(251,191,36,0.4)' : '1px solid #1e3a4f', background: paymentMode === 'terminal' ? 'rgba(251,191,36,0.08)' : '#0f1923' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: paymentMode === 'terminal' ? '#fbbf24' : '#94a3b8' }}>🖊️ Enter Card Now</div>
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>Walk-in customer with physical card</div>
                </button>

                <button onClick={() => setPaymentMode('cash')} style={{ padding: '10px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', border: paymentMode === 'cash' ? '1px solid rgba(74,222,128,0.4)' : '1px solid #1e3a4f', background: paymentMode === 'cash' ? 'rgba(74,222,128,0.08)' : '#0f1923' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: paymentMode === 'cash' ? '#4ade80' : '#94a3b8' }}>💵 Cash Payment</div>
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>Walk-in customer, paid now</div>
                </button>
              </div>
            </div>

            {/* Card Element — only shown in terminal mode */}
            {paymentMode === 'terminal' && (
              <div style={{ marginBottom: 16, padding: 14, borderRadius: 10, background: '#0f1923', border: '1px solid rgba(251,191,36,0.3)' }}>
                <div style={{ fontSize: 11, color: '#fbbf24', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Enter Card Details</div>
                <div style={{ padding: '10px 12px', borderRadius: 8, background: '#162232', border: '1px solid rgba(148,163,184,0.2)' }}>
                  <CardElement options={CARD_ELEMENT_OPTIONS} />
                </div>
                {customerId && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer', fontSize: 12, color: '#64748b' }}>
                    <input type="checkbox" checked={saveCardForFuture} onChange={e => setSaveCardForFuture(e.target.checked)} style={{ accentColor: '#fbbf24' }} />
                    Save card for future charges
                  </label>
                )}
              </div>
            )}

            {error && (
              <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#f87171' }}>{error}</div>
            )}

            <button onClick={handleSend} disabled={!canSend || sending} style={{ width: '100%', padding: '14px 0', borderRadius: 10, border: 'none', background: !canSend ? '#334155' : paymentMode === 'card' ? '#1d4ed8' : paymentMode === 'terminal' ? '#92400e' : paymentMode === 'cash' ? '#15803d' : '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 15, cursor: canSend ? 'pointer' : 'not-allowed', opacity: sending ? 0.6 : 1, transition: 'background 0.2s' }}>
              {sending ? 'Processing…' : paymentMode === 'card' ? '💳 Charge Card on File' : paymentMode === 'terminal' ? '🖊️ Charge This Card' : paymentMode === 'cash' ? '💵 Record Cash Payment' : '⚡ Send Invoice'}
            </button>

            {!canSend && (
              <div style={{ fontSize: 11, color: '#334155', textAlign: 'center', marginTop: 8 }}>
                {lineItems.length === 0 ? 'Add at least one item'
                  : !recipientName ? 'Add recipient name'
                  : !lineItems.every(l => l.description.trim()) ? 'Fill in all descriptions'
                  : paymentMode === 'card' && !defaultPaymentMethod ? 'No card on file — use Enter Card Now'
                  : paymentMode === 'link' && !recipientPhone && !recipientEmail ? 'Add phone or email to send link'
                  : ''}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function QuickInvoicePage() {
  return (
    <Elements stripe={stripePromise}>
      <QuickInvoiceInner />
    </Elements>
  )
}
