// src/modules/quotes/QuoteBuilder.tsx
// Full quote creation form + live PDF preview in one flow

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import {
  createQuote, updateQuote, sendQuote, fetchProducts,
  type QuoteLineItem, type CommercialType, type Product, type Quote,
} from '../../services/quotesService'

// html2pdf loaded via CDN script tag injected at runtime
declare const html2pdf: any

// ─── Zenith brand colors ──────────────────────────────────────
const Z = {
  navy:    '#0c1e35',
  teal:    '#0d7ea3',
  tealDim: '#0a5f7a',
  gold:    '#d4a843',
  white:   '#ffffff',
  light:   '#f0f4f8',
  border:  '#e2e8f0',
  text:    '#1a2a3a',
  muted:   '#64748b',
}

// ─── ACH details (from PDF) ───────────────────────────────────
const ACH = {
  bankName:    'Old National Bank',
  abaNumber:   '086300012',
  accountNum:  '0127726846',
  accountName: 'ZENITH PURE SOLUTIONS LLC',
  email:       'accounts@zenithpuresolutions.com',
  phone:       '+1 (317) 690-4172',
}

const COMPANY = {
  name:    'Zenith Pure Solutions LLC',
  address: '6951 E 30th, Suite B',
  city:    'Indianapolis IN 46219',
  country: 'United States',
  phone:   '+1 (317) 690-4172',
  email:   'accounts@zenithpuresolutions.com',
  web:     'zenithpuresolutions.com',
}

const ESTIMATION_DEFAULT = `Why This System Is Recommended for Your Home\nThis system has been recommended based on your home size, water usage, and water quality needs. It is designed to improve overall water quality, enhance efficiency, and protect your plumbing, appliances, and fixtures. The configuration selected provides reliable performance, long-term durability, and a better water experience throughout your home.`

const AUTH_TEXT = `This is an estimate, not a final invoice or contract for services.\nThe summary above is a good-faith estimate based on our evaluation of the work to be performed at the installation address. It does not include potential material price changes or any additional labor or materials that may be required if unforeseen conditions arise during installation.\nI understand that the final cost of the work may differ from this estimate if extra materials, modifications, or labor are required. This estimate does not guarantee the final price of the work to be performed.\nBy approving this estimate, I authorize Zenith Pure Solutions to proceed as outlined and agree to pay the full amount for all services rendered.\nFor complete details, please refer to the Terms & Conditions link.`

// ─── Types ───────────────────────────────────────────────────

interface DraftLineItem extends Omit<QuoteLineItem, 'id' | 'quote_id'> {
  _key: string
  discount_pct: number
  original_unit_price: number
  sku?: string
}

interface Props {
  customerId: string
  customerName: string
  customerAddress?: string
  customerPhone?: string
  opportunityId?: string | null
  leadId?: string | null          // ← ADDED: links quote to lead
  existingQuote?: Quote | null
  onSaved?: (quote: Quote) => void
  onCancel?: () => void
}

// ─── Helpers ─────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

function expiryStr(days = 30) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

// ─── Main Component ───────────────────────────────────────────

export function QuoteBuilder({
  customerId, customerName, customerAddress = '', customerPhone = '',
  opportunityId = null, leadId = null, existingQuote = null, onSaved, onCancel,
}: Props) {
  const { profile } = useAuth()
  const [view, setView] = useState<'form' | 'preview'>('form')
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [showAgreement, setShowAgreement] = useState(false)
  const [quoteStatus, setQuoteStatus] = useState<string>(existingQuote?.status || 'draft')
  const previewRef = useRef<HTMLDivElement>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(true)

  // ─── Form state ────────────────────────────────────────────
  const [commercialType, setCommercialType] = useState<CommercialType>(
    existingQuote?.commercial_type || 'rental'
  )
  const [estimation, setEstimation] = useState(
    existingQuote?.notes || ESTIMATION_DEFAULT
  )
  const [validUntil, setValidUntil] = useState(
    existingQuote?.valid_until || expiryStr(30)
  )
  const [lineItems, setLineItems] = useState<DraftLineItem[]>(
    existingQuote?.line_items?.map((li, i) => ({
      ...li,
      _key: uid(),
      discount_pct: 0,
      original_unit_price: li.unit_price,
    })) || []
  )
  const [quoteNumber] = useState(existingQuote?.quote_number || '(auto-assigned)')
  const [savedQuoteId, setSavedQuoteId] = useState<string | null>(existingQuote?.id || null)
  const [serviceAddress, setServiceAddress] = useState(customerAddress || existingQuote?.customer_address || '')

  // Auto-fetch address from leads via customer.lead_id
  useEffect(() => {
    if (serviceAddress || !customerId) return
    import('../../lib/supabase').then(({ supabase }) => {
      supabase
        .from('customers')
        .select('lead_id')
        .eq('id', customerId)
        .single()
        .then(({ data: cust }) => {
          if (!cust?.lead_id) return
          supabase
            .from('leads')
            .select('address, city, state, zip')
            .eq('id', cust.lead_id)
            .single()
            .then(({ data: lead }) => {
              if (!lead) return
              const parts = [
                lead.address,
                lead.city,
                lead.state && lead.zip ? `${lead.state} ${lead.zip}` : lead.state || lead.zip,
              ].filter(Boolean)
              if (parts.length) setServiceAddress(parts.join(', '))
            })
        })
    })
  }, [customerId])

  // Load products
  useEffect(() => {
    fetchProducts()
      .then(setProducts)
      .catch(console.error)
      .finally(() => setLoadingProducts(false))
  }, [])

  // ─── Line item helpers ─────────────────────────────────────
  function addProduct(product: Product) {
    const unitPrice = commercialType === 'rental'
      ? (product.rental_price_monthly ?? product.retail_price ?? 0)
      : (product.retail_price ?? 0)

    const newItem: DraftLineItem = {
      _key: uid(),
      product_id: product.id,
      sku: product.sku || '',
      description: buildProductDescription(product),
      quantity: 1,
      unit_price: unitPrice,
      original_unit_price: unitPrice,
      total: unitPrice,
      item_type: 'product',
      sort_order: lineItems.length,
      discount_pct: 0,
    }
    setLineItems(prev => [...prev, newItem])

    // Auto-add install fee for non-rental if product has one
    if (commercialType !== 'rental' && product.install_fee && product.install_fee > 0) {
      setLineItems(prev => [...prev, newItem, {
        _key: uid(),
        product_id: product.id,
        sku: '',
        description: `Installation Fee — ${product.name}`,
        quantity: 1,
        unit_price: product.install_fee!,
        original_unit_price: product.install_fee!,
        total: product.install_fee!,
        item_type: 'install_fee',
        sort_order: prev.length + 1,
        discount_pct: 0,
      }])
      return
    }
  }

  function buildProductDescription(p: Product): string {
    let desc = p.name
    if (p.description) desc += `\n${p.description}`
    if (p.warranty_months) {
      const yrs = Math.floor(p.warranty_months / 12)
      desc += `\n\nWarranty – ${yrs > 0 ? `${yrs} year${yrs > 1 ? 's' : ''}` : `${p.warranty_months} months`}`
    }
    return desc
  }

  function addCustomLine() {
    setLineItems(prev => [...prev, {
      _key: uid(),
      product_id: null,
      sku: '',
      description: '',
      quantity: 1,
      unit_price: 0,
      original_unit_price: 0,
      total: 0,
      item_type: 'custom',
      sort_order: prev.length,
      discount_pct: 0,
    }])
  }

  function updateLine(key: string, field: keyof DraftLineItem, value: any) {
    setLineItems(prev => prev.map(li => {
      if (li._key !== key) return li
      const updated = { ...li, [field]: value }
      if (field === 'quantity' || field === 'unit_price' || field === 'discount_pct') {
        const disc = field === 'discount_pct' ? value : updated.discount_pct
        const qty  = field === 'quantity'    ? value : updated.quantity
        const up   = field === 'unit_price'  ? value : updated.unit_price
        const discounted = up * (1 - disc / 100)
        updated.total = parseFloat((qty * discounted).toFixed(2))
      }
      return updated
    }))
  }

  function removeLine(key: string) {
    setLineItems(prev => prev.filter(li => li._key !== key))
  }

  function moveLine(key: string, dir: 'up' | 'down') {
    setLineItems(prev => {
      const idx = prev.findIndex(li => li._key === key)
      if (idx < 0) return prev
      const next = [...prev]
      const swap = dir === 'up' ? idx - 1 : idx + 1
      if (swap < 0 || swap >= next.length) return prev
      ;[next[idx], next[swap]] = [next[swap], next[idx]]
      return next
    })
  }

  // ─── Totals ────────────────────────────────────────────────
  const subtotal  = lineItems.reduce((s, li) => s + li.total, 0)
  const taxAmount = parseFloat((subtotal * 0.07).toFixed(2))
  const total     = parseFloat((subtotal + taxAmount).toFixed(2))

  // ─── Save ──────────────────────────────────────────────────
  async function handleSave(): Promise<string | null> {
    if (!customerId) return null
    setSaving(true)
    try {
      const items = lineItems.map((li, i) => ({
        product_id:   li.product_id || null,
        description:  li.description,
        quantity:     li.quantity,
        unit_price:   li.unit_price,
        total:        li.total,
        item_type:    li.item_type,
        sort_order:   i,
        sku:          li.sku,
      }))

      if (savedQuoteId) {
        await updateQuote(savedQuoteId, {
          commercial_type: commercialType,
          notes: estimation,
          valid_until: validUntil,
          line_items: items,
        })
        const { data } = await supabase.from('quotes').select('*').eq('id', savedQuoteId).single()
        if (data && onSaved) onSaved(data)
        return savedQuoteId
      } else {
        const q = await createQuote({
          customer_id:     customerId,
          commercial_type: commercialType,
          opportunity_id:  opportunityId,
          lead_id:         leadId,             // ← FIXED: stores lead FK on quote
          created_by:      profile?.id || null,
          notes:           estimation,
          valid_until:     validUntil,
          line_items:      items,
        })
        setSavedQuoteId(q.id)
        if (onSaved) onSaved(q)
        return q.id
      }
    } catch (e: any) {
      alert(e.message || 'Save failed')
      return null
    } finally {
      setSaving(false)
    }
  }

  // ─── Send ──────────────────────────────────────────────────
  async function handleSend() {
    // Save first if not yet saved — handleSave now returns the ID directly
    let qId = savedQuoteId
    if (!qId) {
      qId = await handleSave()
    }
    if (!qId) return

    setSending(true)
    let emailTo = ''
    try {
      const res = await fetch('/api/email/send-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId: qId,
          senderEmail: profile?.email,
          senderName:  profile?.full_name,
        }),
      })
      const data = await res.json()
      if (res.ok) emailTo = data.to
    } catch (_) {
      // email failed — still mark sent and move lead
    }

    try {
      await sendQuote(qId)
      const { data: updatedQuote } = await supabase
        .from('quotes').select('*').eq('id', qId).single()
      if (updatedQuote) {
        setQuoteStatus(updatedQuote.status || 'sent')
        if (onSaved) onSaved(updatedQuote)
      } else {
        setQuoteStatus('sent')
      }
      alert(emailTo
        ? `✓ Quote emailed to ${emailTo}`
        : '✓ Quote marked as sent (email pending — verify domain at resend.com)'
      )
    } catch (e: any) {
      alert(e.message || 'Send failed')
    } finally {
      setSending(false)
    }

  async function handleAccept() {
    if (!savedQuoteId) { alert('Save the quote first.'); return }
    setAccepting(true)
    try {
      await supabase.from('quotes').update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
      }).eq('id', savedQuoteId)
      setQuoteStatus('accepted')
      if (commercialType === 'rental') {
        setShowAgreement(true)
      } else {
        alert('Quote accepted. Generate invoice from the quotes list.')
      }
    } catch (e: any) {
      alert(e.message || 'Accept failed')
    } finally {
      setAccepting(false)
    }
  }

  function handleDownloadPDF() {
    if (typeof html2pdf === 'undefined') {
      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
      script.onload = () => doDownload()
      document.head.appendChild(script)
    } else {
      doDownload()
    }
  }

  function doDownload() {
    const el = document.getElementById('zenith-quote-preview')
    if (!el) { alert('Switch to Preview tab first.'); return }
    const name = `${quoteNumber || 'Quote'}_${customerName.replace(/\s+/g,'-')}.pdf`
    html2pdf().set({
      margin: 0,
      filename: name,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    }).from(el).save()
  }

  // ─── Render ────────────────────────────────────────────────
  return (
    <div style={{ background: '#0f1923', minHeight: '100vh', fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      {/* ── Header ── */}
      <div style={{
        background: '#162232', borderBottom: '1px solid #1e3a4f',
        padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={onCancel} style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>
          ← Back
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 16 }}>
            {savedQuoteId ? quoteNumber : 'New Quote'}
          </div>
          <div style={{ color: '#64748b', fontSize: 12 }}>{customerName}</div>
        </div>
        {/* View toggle */}
        <div style={{ display: 'flex', background: '#0f1923', borderRadius: 8, padding: 2, gap: 2 }}>
          {(['form', 'preview'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
                background: view === v ? '#1e3a5f' : 'transparent',
                color: view === v ? '#60a5fa' : '#64748b',
              }}
            >
              {v === 'form' ? '⚙ Build' : '👁 Preview'}
            </button>
          ))}
        </div>
        {/* Actions */}
        <button
          onClick={handleDownloadPDF}
          title="Download PDF"
          style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid #1e3a4f', cursor: 'pointer',
            background: 'transparent', color: '#64748b', fontWeight: 600, fontSize: 13,
          }}
        >
          ⬇ PDF
        </button>
        <button
          onClick={handleSave}
          disabled={saving || quoteStatus !== 'draft'}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#1e3a5f', color: '#60a5fa', fontWeight: 600, fontSize: 13,
            opacity: quoteStatus !== 'draft' ? 0.4 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save Draft'}
        </button>
        <button
          onClick={handleSend}
          disabled={sending || lineItems.length === 0 || quoteStatus !== 'draft'}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: lineItems.length === 0 || quoteStatus !== 'draft' ? '#1a2a3a' : '#0d7ea3',
            color: lineItems.length === 0 || quoteStatus !== 'draft' ? '#334155' : '#fff',
            fontWeight: 700, fontSize: 13,
          }}
        >
          {sending ? 'Sending…' : 'Send Quote'}
        </button>
        {quoteStatus === 'sent' && (
          <button
            onClick={handleAccept}
            disabled={accepting}
            style={{
              padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: '#16a34a', color: '#fff', fontWeight: 700, fontSize: 13,
            }}
          >
            {accepting ? 'Accepting…' : '✓ Accept Quote'}
          </button>
        )}
        {quoteStatus === 'accepted' && (
          <div style={{ padding: '8px 14px', borderRadius: 8, background: '#14532d', color: '#86efac', fontWeight: 700, fontSize: 13 }}>
            ✓ Accepted
          </div>
        )}
      </div>

      {showAgreement && (
        <RentalAgreementModal
          quoteNumber={quoteNumber}
          customerName={customerName}
          customerAddress={serviceAddress}
          lineItems={lineItems}
          subtotal={subtotal}
          total={total}
          onClose={() => setShowAgreement(false)}
        />
      )}

      {view === 'form'
        ? <FormView
            commercialType={commercialType}
            setCommercialType={setCommercialType}
            serviceAddress={serviceAddress}
            setServiceAddress={setServiceAddress}
            estimation={estimation}
            setEstimation={setEstimation}
            validUntil={validUntil}
            setValidUntil={setValidUntil}
            lineItems={lineItems}
            products={products}
            loadingProducts={loadingProducts}
            onAddProduct={addProduct}
            onAddCustom={addCustomLine}
            onUpdateLine={updateLine}
            onRemoveLine={removeLine}
            onMoveLine={moveLine}
            subtotal={subtotal}
            taxAmount={taxAmount}
            total={total}
          />
        : <PreviewView
            quoteNumber={savedQuoteId ? quoteNumber : 'Q-DRAFT'}
            quoteDate={todayStr()}
            validUntil={validUntil}
            customerName={customerName}
            customerAddress={serviceAddress}
            customerPhone={customerPhone}
            salesConsultant={profile?.full_name || 'Zenith Pure Solutions'}
            estimation={estimation}
            lineItems={lineItems}
            subtotal={subtotal}
            taxAmount={taxAmount}
            total={total}
            commercialType={commercialType}
          />
      }
    </div>
  )
}

// ─── Form View ─────────────────────────────────────────────────

function FormView({
  commercialType, setCommercialType,
  serviceAddress, setServiceAddress,
  estimation, setEstimation,
  validUntil, setValidUntil,
  lineItems, products, loadingProducts,
  onAddProduct, onAddCustom, onUpdateLine, onRemoveLine, onMoveLine,
  subtotal, taxAmount, total,
}: any) {
  const [productSearch, setProductSearch] = useState('')
  const [showProductPicker, setShowProductPicker] = useState(false)

  const filtered = products.filter((p: Product) =>
    !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase())
      || (p.sku || '').toLowerCase().includes(productSearch.toLowerCase())
  )

  const S = {
    section: {
      background: '#162232', borderRadius: 12, border: '1px solid #1e3a4f',
      padding: 20, marginBottom: 16,
    } as React.CSSProperties,
    label: { color: '#94a3b8', fontSize: 12, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 6 },
    input: {
      background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8,
      color: '#e2e8f0', padding: '9px 12px', width: '100%', fontSize: 13, outline: 'none',
    } as React.CSSProperties,
    th: { color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, padding: '8px 10px', textAlign: 'left' as const },
    td: { padding: '8px 6px', borderTop: '1px solid #1a2e42', verticalAlign: 'top' as const },
  }

  return (
    <div style={{ padding: 24, maxWidth: 920, margin: '0 auto' }}>

      {/* Commercial Type */}
      <div style={S.section}>
        <div style={S.label}>Quote Type</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['rental', 'purchase', 'financed'] as CommercialType[]).map(t => (
            <button
              key={t}
              onClick={() => setCommercialType(t)}
              style={{
                padding: '8px 20px', borderRadius: 8, border: '2px solid',
                cursor: 'pointer', fontWeight: 700, fontSize: 13, transition: 'all 0.15s',
                borderColor: commercialType === t ? '#0d7ea3' : '#1e3a4f',
                background: commercialType === t ? '#0a2a3a' : 'transparent',
                color: commercialType === t ? '#22d3ee' : '#64748b',
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Service Address */}
      <div style={S.section}>
        <div style={S.label}>Service / Installation Address</div>
        <input
          type="text"
          value={serviceAddress}
          onChange={e => setServiceAddress(e.target.value)}
          placeholder="e.g. 123 Main St, Indianapolis, IN 46201"
          style={{ ...S.input }}
        />
      </div>

      {/* Estimation Details */}
      <div style={S.section}>
        <div style={S.label}>Estimation Details (shown on quote)</div>
        <textarea
          value={estimation}
          onChange={e => setEstimation(e.target.value)}
          rows={4}
          style={{ ...S.input, resize: 'vertical', lineHeight: 1.6 }}
        />
      </div>

      {/* Validity */}
      <div style={{ ...S.section, display: 'flex', gap: 16, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <div style={S.label}>Valid Until</div>
          <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} style={S.input} />
        </div>
      </div>

      {/* Line Items */}
      <div style={S.section}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={S.label}>Line Items</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setShowProductPicker(v => !v)}
              style={{
                padding: '7px 14px', borderRadius: 8, border: '1px solid #0d7ea3',
                background: showProductPicker ? '#0a2a3a' : 'transparent',
                color: '#22d3ee', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              }}
            >
              + From Catalog
            </button>
            <button
              onClick={onAddCustom}
              style={{
                padding: '7px 14px', borderRadius: 8, border: '1px solid #1e3a4f',
                background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 13,
              }}
            >
              + Custom Line
            </button>
          </div>
        </div>

        {/* Product picker */}
        {showProductPicker && (
          <div style={{ background: '#0f1923', borderRadius: 10, border: '1px solid #1e3a4f', marginBottom: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid #1e3a4f' }}>
              <input
                placeholder="Search products…"
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
                style={{ ...S.input, padding: '7px 10px' }}
                autoFocus
              />
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {loadingProducts
                ? <div style={{ padding: 16, color: '#64748b', fontSize: 13 }}>Loading…</div>
                : filtered.length === 0
                  ? <div style={{ padding: 16, color: '#64748b', fontSize: 13 }}>No products found</div>
                  : filtered.map((p: Product) => (
                    <button
                      key={p.id}
                      onClick={() => { onAddProduct(p); setShowProductPicker(false); setProductSearch('') }}
                      style={{
                        display: 'flex', width: '100%', padding: '10px 14px', gap: 12,
                        background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                        borderBottom: '1px solid #1a2a3a',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#162232')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                        {p.sku && <div style={{ color: '#64748b', fontSize: 11 }}>{p.sku}</div>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        {commercialType === 'rental' && p.rental_price_monthly != null && (
                          <div style={{ color: '#22d3ee', fontSize: 12, fontWeight: 700 }}>
                            {fmt(p.rental_price_monthly)}/mo
                          </div>
                        )}
                        {p.retail_price != null && (
                          <div style={{ color: '#94a3b8', fontSize: 12 }}>
                            {fmt(p.retail_price)} retail
                          </div>
                        )}
                      </div>
                    </button>
                  ))
              }
            </div>
          </div>
        )}

        {/* Line items table */}
        {lineItems.length === 0
          ? <div style={{ textAlign: 'center', padding: '32px 0', color: '#334155', fontSize: 13 }}>
              No line items yet. Add from catalog or create a custom line.
            </div>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={S.th}></th>
                  <th style={S.th}>Description</th>
                  <th style={{ ...S.th, textAlign: 'center' as const, width: 60 }}>Qty</th>
                  <th style={{ ...S.th, textAlign: 'right' as const, width: 100 }}>Unit Price</th>
                  <th style={{ ...S.th, textAlign: 'center' as const, width: 70 }}>Disc %</th>
                  <th style={{ ...S.th, textAlign: 'right' as const, width: 100 }}>Total</th>
                  <th style={{ ...S.th, width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li: DraftLineItem, idx: number) => (
                  <tr key={li._key}>
                    <td style={{ ...S.td, width: 28 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <button onClick={() => onMoveLine(li._key, 'up')} disabled={idx === 0}
                          style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? '#1e3a4f' : '#64748b', lineHeight: 1, padding: 0 }}>▲</button>
                        <button onClick={() => onMoveLine(li._key, 'down')} disabled={idx === lineItems.length - 1}
                          style={{ background: 'none', border: 'none', cursor: idx === lineItems.length - 1 ? 'default' : 'pointer', color: idx === lineItems.length - 1 ? '#1e3a4f' : '#64748b', lineHeight: 1, padding: 0 }}>▼</button>
                      </div>
                    </td>
                    <td style={S.td}>
                      {li.sku && <div style={{ color: '#0d7ea3', fontSize: 11, fontWeight: 700, marginBottom: 3 }}>{li.sku}</div>}
                      <textarea
                        value={li.description}
                        onChange={e => onUpdateLine(li._key, 'description', e.target.value)}
                        rows={3}
                        style={{ ...S.input, width: '100%', resize: 'vertical', fontSize: 12, padding: '6px 8px' }}
                      />
                      <div style={{ marginTop: 4 }}>
                        <select
                          value={li.item_type}
                          onChange={e => onUpdateLine(li._key, 'item_type', e.target.value)}
                          style={{ ...S.input, fontSize: 11, padding: '4px 8px', width: 'auto' }}
                        >
                          {['product','install_fee','maintenance','discount','custom'].map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td style={{ ...S.td, textAlign: 'center' as const }}>
                      <input
                        type="number" min={1} value={li.quantity}
                        onChange={e => onUpdateLine(li._key, 'quantity', Number(e.target.value))}
                        style={{ ...S.input, textAlign: 'center', width: 56 }}
                      />
                    </td>
                    <td style={{ ...S.td, textAlign: 'right' as const }}>
                      <input
                        type="number" step="0.01" min={0} value={li.unit_price}
                        onChange={e => onUpdateLine(li._key, 'unit_price', parseFloat(e.target.value) || 0)}
                        style={{ ...S.input, textAlign: 'right', width: 96 }}
                      />
                    </td>
                    <td style={{ ...S.td, textAlign: 'center' as const }}>
                      <input
                        type="number" min={0} max={100} step={0.5} value={li.discount_pct}
                        onChange={e => onUpdateLine(li._key, 'discount_pct', parseFloat(e.target.value) || 0)}
                        style={{ ...S.input, textAlign: 'center', width: 60 }}
                      />
                    </td>
                    <td style={{ ...S.td, textAlign: 'right' as const, color: '#e2e8f0', fontWeight: 700, fontSize: 13 }}>
                      {fmt(li.total)}
                    </td>
                    <td style={S.td}>
                      <button onClick={() => onRemoveLine(li._key)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 16, padding: 2 }}
                        title="Remove">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }

        {/* Totals */}
        {lineItems.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <div style={{ minWidth: 240 }}>
              {[
                { label: 'Subtotal', val: subtotal, color: '#94a3b8' },
                { label: 'Tax (7%)',  val: taxAmount, color: '#64748b' },
                { label: 'Total',    val: total,     color: '#e2e8f0', bold: true },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: row.label === 'Total' ? '1px solid #1e3a4f' : 'none' }}>
                  <span style={{ color: '#64748b', fontSize: 13 }}>{row.label}</span>
                  <span style={{ color: row.color, fontSize: 13, fontWeight: row.bold ? 700 : 400 }}>{fmt(row.val)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Preview View ─────────────────────────────────────────────

function PreviewView({
  quoteNumber, quoteDate, validUntil, customerName, customerAddress = '', customerPhone,
  salesConsultant, estimation, lineItems, subtotal, taxAmount, total, commercialType,
}: any) {
  const isRental = commercialType === 'rental'

  const previewStyle: React.CSSProperties = {
    background: '#fff',
    maxWidth: 860,
    margin: '24px auto',
    borderRadius: 4,
    boxShadow: '0 4px 40px rgba(0,0,0,0.5)',
    fontFamily: "'DM Sans', Arial, sans-serif",
    color: Z.text,
    fontSize: 13,
  }

  return (
    <div style={{ padding: '0 24px 40px', overflowY: 'auto' }}>
      <div id="zenith-quote-preview" style={previewStyle}>

        {/* ── Page 1: Header + Line Items ── */}
        <div style={{ padding: '32px 40px' }}>

          {/* Header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 4,
                background: Z.navy, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ color: Z.teal, fontWeight: 900, fontSize: 18 }}>ZE</span>
              </div>
              <div>
                <div style={{ fontWeight: 900, fontSize: 15, color: Z.navy }}>ZENITH</div>
                <div style={{ fontSize: 10, color: Z.teal, fontWeight: 600, letterSpacing: '0.15em' }}>PURE SOLUTIONS</div>
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, color: Z.muted, lineHeight: 1.7 }}>
              <div style={{ fontWeight: 600, color: Z.text }}>{COMPANY.name}</div>
              <div>{COMPANY.address}</div>
              <div>{COMPANY.city}</div>
              <div>{COMPANY.country}</div>
            </div>
          </div>

          {/* Bill To / Installation Address */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 28 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>BILL TO:</div>
              <div style={{ color: Z.text, lineHeight: 1.8, fontSize: 12 }}>
                <div>{customerName}</div>
                {customerAddress && <div>{customerAddress}</div>}
                <div>United States</div>
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>INSTALLATION ADDRESS</div>
              <div style={{ color: Z.text, lineHeight: 1.8, fontSize: 12 }}>
                <div>{customerName}</div>
                {customerAddress && <div>{customerAddress}</div>}
                <div>United States</div>
                {customerPhone && <div>{customerPhone}</div>}
              </div>
            </div>
          </div>

          {/* Quote title */}
          <div style={{ marginBottom: 20 }}>
            <h1 style={{ fontSize: 28, fontWeight: 900, color: Z.navy, margin: '0 0 14px' }}>
              QUOTATION # {quoteNumber}
            </h1>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[
                { label: 'QUOTATION DATE', val: fmtDate(quoteDate) },
                { label: 'EXPIRATION',     val: fmtDate(validUntil) },
                { label: 'SALES CONSULTANT', val: salesConsultant },
              ].map(col => (
                <div key={col.label}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: Z.teal, letterSpacing: '0.1em', marginBottom: 3 }}>{col.label}</div>
                  <div style={{ fontSize: 13 }}>{col.val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Estimation Details */}
          {estimation && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>ESTIMATION DETAILS</div>
              <div style={{ fontSize: 12, lineHeight: 1.7, color: Z.text, whiteSpace: 'pre-wrap' }}>{estimation}</div>
            </div>
          )}

          {/* Line items table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid ' + Z.navy }}>
                {['Code', 'Name and Description', 'Qty', 'Unit Price', 'Discount', 'Total'].map((h, i) => (
                  <th key={h} style={{
                    padding: '8px 8px', fontSize: 12, fontWeight: 700, color: Z.navy,
                    textAlign: i >= 2 ? 'right' : 'left',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lineItems.map((li: DraftLineItem) => {
                const discAmt = li.discount_pct > 0 ? parseFloat((li.unit_price * li.discount_pct / 100).toFixed(2)) : 0
                const lines = li.description.split('\n')
                const mainDesc = lines[0]
                const subDesc = lines.slice(1).join('\n')
                return (
                  <tr key={li._key} style={{ borderBottom: '1px solid ' + Z.border }}>
                    <td style={{ padding: '10px 8px', fontSize: 11, color: Z.muted, verticalAlign: 'top', whiteSpace: 'nowrap' }}>{li.sku || ''}</td>
                    <td style={{ padding: '10px 8px', verticalAlign: 'top', maxWidth: 340 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{mainDesc}</div>
                      {subDesc && (
                        <div style={{ fontSize: 11, color: Z.muted, marginTop: 4, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                          {subDesc}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', verticalAlign: 'top' }}>{li.quantity}.0</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', verticalAlign: 'top' }}>
                      $ {li.unit_price.toFixed(2)}{isRental && li.item_type === 'product' ? <span style={{fontSize:10,color:Z.teal,fontWeight:700}}>/mo</span> : ''}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', verticalAlign: 'top', color: Z.muted }}>
                      {discAmt > 0 ? `$ ${discAmt.toFixed(2)}` : '—'}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, verticalAlign: 'top' }}>
                      $ {li.total.toFixed(2)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Totals */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 28 }}>
            <div style={{ minWidth: 220 }}>
              {[
                { label: 'Subtotal', val: subtotal },
                { label: 'Taxes',    val: taxAmount },
              ].map(r => (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
                  <span style={{ color: Z.muted }}>{r.label}</span>
                  <span>$ {r.val.toFixed(2)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '2px solid ' + Z.navy, fontSize: 14, fontWeight: 900 }}>
                <span>{isRental ? 'Monthly Total' : 'Total'}</span>
                <span>$ {total.toFixed(2)}{isRental ? <span style={{fontSize:11,fontWeight:400,color:Z.teal}}> /mo</span> : ''}</span>
              </div>
            </div>
          </div>

          {/* Customer Authorization */}
          <div style={{ borderTop: '1px solid ' + Z.border, paddingTop: 20, marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>CUSTOMER AUTHORIZATION</div>
            <div style={{ fontSize: 11.5, lineHeight: 1.8, color: Z.text, whiteSpace: 'pre-wrap' }}>{AUTH_TEXT}</div>
            <div style={{ marginTop: 10, fontSize: 12 }}>
              <a href="#" style={{ color: Z.teal, textDecoration: 'underline', fontWeight: 600 }}>
                Click here to view Terms &amp; Conditions (Version v1.0, Date 01/30/2026)
              </a>
            </div>
          </div>

          {/* Rental-only callout */}
          {isRental && (
            <div style={{
              background: '#f0f8ff', border: '1px solid #b3d9ed', borderRadius: 6,
              padding: '12px 16px', marginBottom: 20, fontSize: 12,
            }}>
              <strong>Rental Agreement:</strong> Accepting this quote initiates a 36-month Residential Equipment Rental Agreement.
              Monthly payments of the rental amount apply. Equipment remains property of Zenith Pure Solutions LLC.
              50% of payments made apply toward buyout at any time.
            </div>
          )}

          {/* ACH / Payment Details */}
          <div style={{ borderTop: '1px solid ' + Z.border, paddingTop: 20, marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>DIRECT TRANSFER / ACH DETAILS</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <tbody>
                {[
                  ['Bank Name',        ACH.bankName],
                  ['ACH ABA Number',   ACH.abaNumber],
                  ['Account Number',   ACH.accountNum],
                  ['Account Name',     ACH.accountName],
                  ['Email',            ACH.email],
                  ['Phone Number',     ACH.phone],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ border: '1px solid ' + Z.border, padding: '7px 12px', fontWeight: 600, width: '40%', background: Z.light }}>{k}:</td>
                    <td style={{ border: '1px solid ' + Z.border, padding: '7px 12px' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: Z.muted, marginTop: 10, textAlign: 'right' }}>
              Quote Version: {new Date().toLocaleDateString('en-US')} {new Date().toLocaleTimeString('en-US')}
            </div>
          </div>

          {/* Signature line */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, paddingTop: 8 }}>
            <div>
              <div style={{ borderBottom: '1px solid ' + Z.text, marginBottom: 4, height: 36 }}></div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Sign here</div>
            </div>
            <div>
              <div style={{ borderBottom: '1px solid ' + Z.text, marginBottom: 4, height: 36 }}></div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Date</div>
            </div>
          </div>

        </div>

        {/* ── Footer ── */}
        <div style={{
          borderTop: '1px solid ' + Z.border, padding: '12px 40px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontSize: 11, color: Z.muted, fontStyle: 'italic' }}>
            Engineered for purity. Installed with care. Backed by Zenith Pure Solutions.
          </div>
          <div style={{ fontSize: 11, color: Z.muted }}>Page 1 / 1</div>
        </div>

      </div>
    </div>
  )
}

// ─── Rental Agreement Modal ───────────────────────────────────

function RentalAgreementModal({ quoteNumber, customerName, customerAddress, lineItems, subtotal, total, onClose }: any) {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const mainProduct = lineItems.find((li: any) => li.item_type === 'product') || lineItems[0]
  const monthlyAmount = lineItems
    .filter((li: any) => li.item_type !== 'discount')
    .reduce((s: number, li: any) => s + li.total, 0)

  function downloadAgreement() {
    if (typeof html2pdf === 'undefined') {
      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
      script.onload = () => doDownloadAgreement()
      document.head.appendChild(script)
    } else {
      doDownloadAgreement()
    }
  }

  function doDownloadAgreement() {
    const el = document.getElementById('zenith-agreement-content')
    if (!el) return
    html2pdf().set({
      margin: 10,
      filename: `Rental_Agreement_${customerName.replace(/\s+/g,'-')}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    }).from(el).save()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      overflowY: 'auto', padding: '24px 16px',
    }}>
      <div style={{ background: '#162232', borderRadius: 12, width: '100%', maxWidth: 800, boxShadow: '0 20px 60px rgba(0,0,0,0.7)' }}>
        {/* Modal header */}
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #1e3a4f', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 18 }}>Rental Agreement Generated</div>
            <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>
              Auto-generated from accepted quote {quoteNumber}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={downloadAgreement} style={{
              padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 13,
            }}>
              ⬇ Download PDF
            </button>
            <button onClick={onClose} style={{
              padding: '8px 18px', borderRadius: 8, border: '1px solid #334155', cursor: 'pointer',
              background: 'transparent', color: '#94a3b8', fontWeight: 600, fontSize: 13,
            }}>
              Close
            </button>
          </div>
        </div>

        {/* Agreement content */}
        <div style={{ padding: 28, overflowY: 'auto', maxHeight: '75vh' }}>
          <div id="zenith-agreement-content" style={{
            background: '#fff', color: '#1a2a3a', fontFamily: "'DM Sans', Arial, sans-serif",
            fontSize: 12, lineHeight: 1.6, padding: '40px 48px', borderRadius: 4,
          }}>
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 28, borderBottom: '2px solid #0c1e35', paddingBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 8 }}>
                <div style={{ width: 40, height: 40, background: '#0c1e35', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: '#0d7ea3', fontWeight: 900, fontSize: 16 }}>ZE</span>
                </div>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 16, color: '#0c1e35' }}>ZENITH PURE SOLUTIONS LLC</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>6951 E 30th, Suite B • Indianapolis, IN 46219</div>
                </div>
              </div>
              <div style={{ fontWeight: 800, fontSize: 18, color: '#0c1e35', letterSpacing: 1, marginTop: 12 }}>
                RESIDENTIAL EQUIPMENT RENTAL AGREEMENT
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                Generated: {today} • Ref: {quoteNumber}
              </div>
            </div>

            {/* Parties */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' as const, color: '#64748b', marginBottom: 6 }}>Company (Lessor)</div>
                <div style={{ fontWeight: 600 }}>Zenith Pure Solutions LLC</div>
                <div>6951 E 30th, Suite B</div>
                <div>Indianapolis, IN 46219</div>
                <div>Phone: +1 (317) 690-4172</div>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase' as const, color: '#64748b', marginBottom: 6 }}>Customer (Lessee)</div>
                <div style={{ fontWeight: 600 }}>{customerName}</div>
                {customerAddress && <div>{customerAddress}</div>}
              </div>
            </div>

            {/* Equipment */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#0c1e35', borderBottom: '1px solid #e2e8f0', paddingBottom: 6, marginBottom: 10 }}>
                APPENDIX A — EQUIPMENT SCHEDULE
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' as const }}>
                <thead>
                  <tr style={{ background: '#f0f4f8' }}>
                    {['Description','Monthly Rate','Term'].map(h => (
                      <th key={h} style={{ border: '1px solid #e2e8f0', padding: '8px 12px', textAlign: 'left' as const, fontSize: 11, fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li: any, i: number) => (
                    <tr key={i}>
                      <td style={{ border: '1px solid #e2e8f0', padding: '8px 12px' }}>{li.description}</td>
                      <td style={{ border: '1px solid #e2e8f0', padding: '8px 12px' }}>${li.total.toFixed(2)}/mo</td>
                      <td style={{ border: '1px solid #e2e8f0', padding: '8px 12px' }}>36 months</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 700, background: '#f8fafc' }}>
                    <td style={{ border: '1px solid #e2e8f0', padding: '8px 12px' }}>Total Monthly Payment</td>
                    <td style={{ border: '1px solid #e2e8f0', padding: '8px 12px', color: '#0c1e35' }}>${monthlyAmount.toFixed(2)}/mo</td>
                    <td style={{ border: '1px solid #e2e8f0', padding: '8px 12px' }}></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Key Terms */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#0c1e35', borderBottom: '1px solid #e2e8f0', paddingBottom: 6, marginBottom: 10 }}>
                KEY TERMS & CONDITIONS
              </div>
              {[
                ['Initial Term', '36 months from installation date. Automatically renews month-to-month after initial term.'],
                ['Monthly Payment', `$${monthlyAmount.toFixed(2)}/month, due on the same day each month. Autopay via ACH or card on file.`],
                ['Setup / Installation Fee', '$300.00 (credited 100% toward equipment buyout).'],
                ['Buyout Option', 'Current Retail Price minus 50% of payments made minus installation fee. Exercisable at any time after month 6.'],
                ['Late Fee', '1.75% per month (21% APR) on balances past due. NSF fee: $25.00.'],
                ['Annual Price Increase', 'Up to CPI-U + 3% annually, with 30-day written notice.'],
                ['Cancellation', 'Customer may cancel with 30 days written notice. Early termination fee applies if within initial 36-month term.'],
                ['Right of Rescission', 'Indiana Home Solicitation Sales Act — 3 business day cancellation right from date of signing.'],
                ['Equipment Ownership', 'Equipment remains property of Zenith Pure Solutions LLC until buyout is exercised and confirmed in writing.'],
                ['Dispute Resolution', 'Binding arbitration under AAA rules in Indianapolis, IN. Class action waiver applies.'],
              ].map(([term, detail]) => (
                <div key={term} style={{ marginBottom: 8, display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 11 }}>{term}:</div>
                  <div style={{ fontSize: 11 }}>{detail}</div>
                </div>
              ))}
            </div>

            {/* ACH */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#0c1e35', borderBottom: '1px solid #e2e8f0', paddingBottom: 6, marginBottom: 10 }}>
                PAYMENT — ACH DETAILS
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' as const, maxWidth: 400 }}>
                {[
                  ['Bank Name', 'Old National Bank'],
                  ['ABA / Routing', '086300012'],
                  ['Account Number', '0127726846'],
                  ['Account Name', 'ZENITH PURE SOLUTIONS LLC'],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ border: '1px solid #e2e8f0', padding: '7px 12px', fontWeight: 600, background: '#f0f4f8', width: '40%' }}>{k}:</td>
                    <td style={{ border: '1px solid #e2e8f0', padding: '7px 12px' }}>{v}</td>
                  </tr>
                ))}
              </table>
            </div>

            {/* Signatures */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, marginTop: 32 }}>
              {[
                ['Customer Signature', customerName, 'Date'],
                ['Authorized by Zenith', 'Kuldeep Singh, Zenith Pure Solutions LLC', 'Date'],
              ].map(([label, name, dateLabel]) => (
                <div key={label}>
                  <div style={{ borderBottom: '1px solid #1a2a3a', marginBottom: 4, height: 40 }}></div>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>{label}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>{name}</div>
                  <div style={{ borderBottom: '1px solid #1a2a3a', marginBottom: 4, height: 28, marginTop: 16 }}></div>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>{dateLabel}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 28, paddingTop: 16, borderTop: '1px solid #e2e8f0', fontSize: 10, color: '#94a3b8', textAlign: 'center' as const }}>
              Zenith Pure Solutions LLC • 6951 E 30th, Suite B, Indianapolis IN 46219 • +1 (317) 690-4172 • zenithpuresolutions.com
              <br/>Terms & Conditions: zenithpuresolutions.com/terms • Version v1.0 • {today}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
