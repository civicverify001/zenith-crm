// QuoteReviewPage.tsx
// Public customer-facing page — no auth required
// Route: /q/:token

import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

// ─── Types ───────────────────────────────────────────────────────
interface LineItem {
  id: string
  description: string
  quantity: number
  unit_price: number
  total: number
  sort_order: number
}

interface Quote {
  id: string
  quote_number: string
  quote_type: 'rental' | 'purchase' | 'finance'
  status: string
  monthly_amount: number
  install_fee: number
  subtotal: number
  tax_amount: number
  total: number
  deposit_amount: number
  deposit_type: string
  notes: string
  expires_at: string
  created_at: string
  created_by_name: string | null
  signed_at: string | null
  finance_redirect_url: string | null
  customer_id: string
  customer?: Customer
}

interface Customer {
  full_name: string
  email: string
  phone: string
  address: string
  city: string
  state: string
  zip: string
}

interface TermBlock {
  slug: string
  display_title: string
  content: string
  version: number
}

interface Agreement {
  id: string
  agreement_number: string
  status: string
  monthly_amount: number
  install_fee: number
  signed_at: string | null
  terms_snapshot?: any
  line_items_snapshot?: any
}

interface Invoice {
  id: string
  invoice_number: string
  status: string
  total: number
  deposit_amount: number
  deposit_percent: number
  tax_amount: number
  signed_at: string | null
  terms_snapshot?: any
  line_items_snapshot?: any
}

type FlowStep =
  | 'loading' | 'error' | 'expired' | 'already_complete'
  | 'view_quote' | 'view_agreement' | 'view_invoice'
  | 'stripe_first_payment' | 'stripe_purchase_payment'
  | 'hearth_redirect' | 'complete'

// ─── Helpers ─────────────────────────────────────────────────────
function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)
}
function today() {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

// ─── Logo ────────────────────────────────────────────────────────
function ZenithLogo() {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#0a2540' }}>
        <span className="text-white font-black text-base">Z</span>
      </div>
      <div>
        <div className="font-bold text-gray-900 text-sm">Zenith Pure Solutions</div>
        <div className="text-xs text-gray-400">Indianapolis, IN · (317) 690-4172</div>
      </div>
    </div>
  )
}

// ─── Step bar ────────────────────────────────────────────────────
function StepBar({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-1">
      {steps.map((label, i) => (
        <div key={i} className="flex items-center gap-1 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i < current ? 'bg-green-500 text-white' : i === current ? 'text-white' : 'bg-gray-200 text-gray-400'}`}
              style={i === current ? { backgroundColor: '#0a2540' } : {}}
            >
              {i < current ? '✓' : i + 1}
            </div>
            <span className={`text-xs font-medium hidden sm:block whitespace-nowrap ${i === current ? 'text-gray-800 font-semibold' : i < current ? 'text-green-600' : 'text-gray-400'}`}>
              {label}
            </span>
          </div>
          {i < steps.length - 1 && <div className={`h-px w-6 flex-shrink-0 ${i < current ? 'bg-green-400' : 'bg-gray-200'}`} />}
        </div>
      ))}
    </div>
  )
}

// ─── Signature Pad ────────────────────────────────────────────────
function SignaturePad({ onSign, label = 'Sign Document', loading = false }: {
  onSign: (name: string, signatureDataUrl?: string) => void
  label?: string
  loading?: boolean
}) {
  const [mode, setMode] = useState<'type' | 'draw'>('type')
  const [typedName, setTypedName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasDrawn, setHasDrawn] = useState(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  function getPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if ('touches' in e) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY }
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current; if (!canvas) return
    e.preventDefault(); setIsDrawing(true); lastPos.current = getPos(e, canvas)
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!isDrawing) return
    const canvas = canvasRef.current; if (!canvas) return
    e.preventDefault()
    const ctx = canvas.getContext('2d'); if (!ctx || !lastPos.current) return
    const pos = getPos(e, canvas)
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = '#0a2540'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke()
    lastPos.current = pos; setHasDrawn(true)
  }

  function endDraw() { setIsDrawing(false); lastPos.current = null }

  function clearCanvas() {
    const canvas = canvasRef.current; if (!canvas) return
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height); setHasDrawn(false)
  }

  function handleSign() {
    if (!agreed) return
    if (mode === 'type') {
      if (typedName.trim().length < 2) return
      onSign(typedName.trim(), undefined)
    } else {
      if (!hasDrawn) return
      onSign('Drawn signature', canvasRef.current?.toDataURL('image/png'))
    }
  }

  const canSubmit = agreed && (mode === 'type' ? typedName.trim().length >= 2 : hasDrawn)

  return (
    <div className="border border-gray-200 rounded-xl p-5 bg-gray-50">
      <div className="text-sm font-semibold text-gray-700 mb-4">Sign this document</div>

      {/* Toggle */}
      <div className="flex gap-1 mb-4 bg-white border border-gray-200 rounded-lg p-1 w-fit">
        {(['type', 'draw'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className="px-4 py-1.5 rounded-md text-xs font-semibold transition-colors"
            style={mode === m ? { backgroundColor: '#0a2540', color: 'white' } : { color: '#64748b' }}
          >
            {m === 'type' ? '⌨️ Type' : '✏️ Draw'}
          </button>
        ))}
      </div>

      {mode === 'type' ? (
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">Full Legal Name</label>
          <input
            type="text" value={typedName} onChange={e => setTypedName(e.target.value)}
            placeholder="Type your full name to sign"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {typedName.trim().length >= 2 && (
            <div className="mt-3 p-3 bg-white border border-gray-200 rounded-lg">
              <div className="text-xs text-gray-400 mb-1">Signature preview</div>
              <div className="text-2xl text-gray-800" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>{typedName}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">Draw your signature</label>
          <div className="relative bg-white border-2 border-dashed border-gray-300 rounded-lg overflow-hidden" style={{ height: 120 }}>
            <canvas
              ref={canvasRef} width={600} height={120}
              className="w-full h-full cursor-crosshair touch-none"
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
            />
            {!hasDrawn && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-gray-300 text-sm">Sign here</span>
              </div>
            )}
            <div className="absolute bottom-3 left-4 right-4 border-b border-gray-300 pointer-events-none" />
          </div>
          {hasDrawn && <button onClick={clearCanvas} className="mt-1.5 text-xs text-red-400 hover:text-red-600">✕ Clear</button>}
        </div>
      )}

      <label className="flex items-start gap-3 mb-4 cursor-pointer">
        <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 w-4 h-4 rounded border-gray-300 flex-shrink-0" />
        <span className="text-xs text-gray-600">
          By signing, I agree this constitutes my legal electronic signature with the same effect as a handwritten signature.
        </span>
      </label>

      <button
        onClick={handleSign} disabled={!canSubmit || loading}
        className="w-full py-3 rounded-lg text-white font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        style={{ backgroundColor: '#0a2540' }}
      >
        {loading ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Processing...</> : label}
      </button>
    </div>
  )
}

// ─── Agreement Document ──────────────────────────────────────────
function AgreementDocument({ agreement, customer, terms, onSign, signing, error }: {
  agreement: Agreement; customer: Customer | undefined; terms: TermBlock[]
  onSign: (name: string, sig?: string) => void; signing: boolean; error: string
}) {
  return (
    <div className="space-y-4">
      {/* Cover */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-8 py-6 text-white text-center" style={{ backgroundColor: '#0a2540' }}>
          <div className="text-xl font-bold tracking-wide">ZENITH PURE SOLUTIONS LLC</div>
          <div className="text-sm text-blue-200 mt-1">6951 E 30th St, Suite B · Indianapolis, IN 46219</div>
          <div className="text-sm text-blue-200">(317) 690-4172 · zenithpuresolutions.com</div>
        </div>
        <div className="px-8 py-5 text-center bg-gray-50 border-b border-gray-200">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Legal Agreement</div>
          <div className="text-2xl font-bold text-gray-900">Residential Equipment Rental Agreement</div>
          <div className="text-sm font-semibold mt-2" style={{ color: '#0a2540' }}>{agreement.agreement_number}</div>
        </div>
        <div className="px-8 py-5 grid grid-cols-2 gap-8 border-b border-gray-100">
          <div>
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Company</div>
            <div className="font-bold text-gray-900">Zenith Pure Solutions LLC</div>
            <div className="text-sm text-gray-500">6951 E 30th St, Suite B</div>
            <div className="text-sm text-gray-500">Indianapolis, IN 46219</div>
          </div>
          <div>
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Customer</div>
            <div className="font-bold text-gray-900">{customer?.full_name}</div>
            <div className="text-sm text-gray-500">{customer?.address}</div>
            <div className="text-sm text-gray-500">{customer?.city}, {customer?.state} {customer?.zip}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 px-8 py-5 bg-blue-50 border-b border-blue-100 text-center">
          {[
            { label: 'Monthly Payment', value: `${fmt(agreement.monthly_amount)}/mo` },
            { label: 'Setup Fee (one-time)', value: fmt(agreement.install_fee) },
            { label: 'Initial Term', value: '36 months' },
          ].map(item => (
            <div key={item.label}>
              <div className="text-xs text-blue-500 font-semibold uppercase tracking-wide">{item.label}</div>
              <div className="text-lg font-bold text-blue-900 mt-1">{item.value}</div>
            </div>
          ))}
        </div>
        <div className="px-8 py-4 bg-amber-50 border-b border-amber-100">
          <p className="text-xs font-bold text-amber-700 text-center uppercase tracking-wide">
            By signing, you agree to all terms including the binding arbitration clause in Article IX.
          </p>
        </div>
        <div className="px-8 py-5">
          <p className="text-sm text-gray-700 leading-relaxed">
            This Agreement is entered into as of <strong>{today()}</strong> between{' '}
            <strong>Zenith Pure Solutions LLC</strong> ("Company") and <strong>{customer?.full_name}</strong> ("Customer").
          </p>
        </div>
      </div>

      {/* Articles */}
      {terms.map(block => (
        <div key={block.slug} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-6 py-3 bg-gray-50 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-800">{block.display_title}</h3>
          </div>
          <div className="px-6 py-5">
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
              {block.content
                .replace(/\[INSTALL_FEE\]/g, fmt(agreement.install_fee))
                .replace(/\[MONTHLY_AMOUNT\]/g, fmt(agreement.monthly_amount))
              }
            </p>
          </div>
        </div>
      ))}

      {/* Signature */}
      <div className="bg-white border-2 border-gray-200 rounded-2xl p-8 shadow-sm">
        <div className="font-bold text-gray-700 text-sm mb-1">IN WITNESS WHEREOF</div>
        <p className="text-xs text-gray-500 mb-6">Executed as of {today()}.</p>
        <div className="grid grid-cols-2 gap-6 mb-8">
          <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
            <div className="text-xs text-gray-400 font-semibold mb-2">ZENITH PURE SOLUTIONS LLC</div>
            <div className="h-10 border-b border-gray-400 mb-2 flex items-end">
              <span className="text-xl pb-1" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', color: '#0a2540' }}>Kuldeep Singh</span>
            </div>
            <div className="text-xs text-gray-500">Authorized Representative · {today()}</div>
          </div>
          <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
            <div className="text-xs text-gray-400 font-semibold mb-2">CUSTOMER</div>
            <div className="h-10 border-b border-gray-300 mb-2" />
            <div className="text-xs text-gray-500">{customer?.full_name}</div>
          </div>
        </div>
        {error && <p className="text-red-500 text-xs mb-4">{error}</p>}
        <SignaturePad onSign={onSign} label="Sign Rental Agreement" loading={signing} />
      </div>
    </div>
  )
}

// ─── Invoice Document ─────────────────────────────────────────────
function InvoiceDocument({ invoice, customer, terms, onSign, signing, error }: {
  invoice: Invoice; customer: Customer | undefined; terms: TermBlock[]
  onSign: (name: string, sig?: string) => void; signing: boolean; error: string
}) {
  const items: LineItem[] = invoice.line_items_snapshot || []
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-8 py-6 text-white" style={{ backgroundColor: '#0a2540' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-2xl font-bold">INVOICE</div>
              <div className="text-blue-200 text-sm">{invoice.invoice_number}</div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-black">{fmt(invoice.total)}</div>
              <div className="text-blue-200 text-xs mt-1">Total Amount</div>
            </div>
          </div>
        </div>
        <div className="px-8 py-5 grid grid-cols-2 gap-8 border-b border-gray-100">
          <div>
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Bill To</div>
            <div className="font-bold text-gray-900">{customer?.full_name}</div>
            <div className="text-sm text-gray-500">{customer?.address}</div>
            <div className="text-sm text-gray-500">{customer?.city}, {customer?.state} {customer?.zip}</div>
            <div className="text-sm text-gray-500">{customer?.phone}</div>
          </div>
          <div className="text-right">
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">From</div>
            <div className="font-bold text-gray-900">Zenith Pure Solutions LLC</div>
            <div className="text-sm text-gray-500">6951 E 30th St, Suite B</div>
            <div className="text-sm text-gray-500">Indianapolis, IN 46219</div>
            <div className="mt-3 text-xs text-gray-400">Invoice Date</div>
            <div className="font-semibold text-gray-700 text-sm">{today()}</div>
          </div>
        </div>
        {items.length > 0 && (
          <>
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-400 font-bold uppercase tracking-wide">
                  <th className="px-8 py-3 text-left">Description</th>
                  <th className="px-4 py-3 text-center">Qty</th>
                  <th className="px-4 py-3 text-right">Unit Price</th>
                  <th className="px-8 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="px-8 py-4 text-sm text-gray-800">{item.description}</td>
                    <td className="px-4 py-4 text-sm text-gray-600 text-center">{item.quantity}</td>
                    <td className="px-4 py-4 text-sm text-gray-600 text-right">{fmt(item.unit_price)}</td>
                    <td className="px-8 py-4 text-sm font-semibold text-gray-900 text-right">{fmt(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-8 py-5 bg-gray-50">
              <div className="max-w-xs ml-auto space-y-2">
                <div className="flex justify-between text-sm text-gray-600"><span>Subtotal</span><span>{fmt(invoice.total - (invoice.tax_amount || 0))}</span></div>
                <div className="flex justify-between text-sm text-gray-600"><span>Tax</span><span>{fmt(invoice.tax_amount || 0)}</span></div>
                <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-300"><span>Total</span><span>{fmt(invoice.total)}</span></div>
                <div className="flex justify-between text-sm font-bold pt-2 border-t border-gray-200" style={{ color: '#0a2540' }}>
                  <span>Deposit Due Today ({invoice.deposit_percent}%)</span><span>{fmt(invoice.deposit_amount)}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Balance at Installation</span><span>{fmt(invoice.total - invoice.deposit_amount)}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Terms & Conditions</div>
        <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline block mb-3">
          View full Terms & Conditions (v1.0, effective 01/30/2026) ↗
        </a>
        {terms.map(t => <p key={t.slug} className="text-xs text-gray-600 leading-relaxed mb-2">{t.content}</p>)}
      </div>

      <div className="bg-white border-2 border-gray-200 rounded-2xl p-8 shadow-sm">
        <div className="font-bold text-gray-700 text-sm mb-1">Customer Authorization</div>
        <p className="text-xs text-gray-500 mb-6">By signing, I authorize Zenith Pure Solutions to proceed and agree to the payment terms above.</p>
        <div className="grid grid-cols-2 gap-6 mb-8">
          <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
            <div className="text-xs text-gray-400 font-semibold mb-2">ZENITH PURE SOLUTIONS LLC</div>
            <div className="h-10 border-b border-gray-400 mb-2 flex items-end">
              <span className="text-xl pb-1" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', color: '#0a2540' }}>Kuldeep Singh</span>
            </div>
            <div className="text-xs text-gray-500">Authorized Representative · {today()}</div>
          </div>
          <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
            <div className="text-xs text-gray-400 font-semibold mb-2">CUSTOMER</div>
            <div className="h-10 border-b border-gray-300 mb-2" />
            <div className="text-xs text-gray-500">{customer?.full_name}</div>
          </div>
        </div>
        {error && <p className="text-red-500 text-xs mb-4">{error}</p>}
        <SignaturePad onSign={onSign} label="Sign Invoice" loading={signing} />
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────
export function QuoteReviewPage() {
  const { token } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const [step, setStep] = useState<FlowStep>('loading')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [rentalTerms, setRentalTerms] = useState<TermBlock[]>([])
  const [purchaseTerms, setPurchaseTerms] = useState<TermBlock[]>([])
  const [agreement, setAgreement] = useState<Agreement | null>(null)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [error, setError] = useState('')
  const [signing, setSigning] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)

  async function redirectToStripe(params: {
    amount_cents: number
    description: string
    quote_type: 'rental' | 'purchase'
    agreement_id?: string
    invoice_id?: string
  }) {
    if (!quote || !customer) return
    setRedirecting(true)
    try {
      const origin = window.location.origin
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
          body: JSON.stringify({
            customer_name: customer.full_name,
            customer_email: customer.email,
            amount_cents: params.amount_cents,
            description: params.description,
            quote_type: params.quote_type,
            agreement_id: params.agreement_id,
            invoice_id: params.invoice_id,
            quote_id: quote.id,
            customer_id: quote.customer_id,
            success_url: `${origin}/q/${token}?paid=1&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${origin}/q/${token}?cancelled=1`,
          }),
        }
      )
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      window.location.href = data.url
    } catch (e: any) {
      setError(e.message || 'Failed to start payment. Please call (317) 690-4172.')
      setRedirecting(false)
    }
  }

  useEffect(() => {
    if (searchParams.get('paid') === '1') { setStep('complete'); return }
    if (token) loadQuote(token)
  }, [token])
  function scrollTop() { setTimeout(() => topRef.current?.scrollIntoView({ behavior: 'smooth' }), 100) }

  async function loadQuote(t: string) {
    try {
      const { data: q, error: qErr } = await supabase.from('quotes').select('*').eq('public_token', t).single()
      if (qErr || !q) { setStep('error'); setError('Quote not found.'); return }
      if (q.expires_at && new Date(q.expires_at) < new Date()) { setStep('expired'); return }
      if (['accepted', 'declined', 'void'].includes(q.status)) { setStep('already_complete'); setQuote(q); return }

      if (q.customer_id) {
        const { data: cust } = await supabase.from('customers')
          .select('full_name, email, phone, address, city, state, zip').eq('id', q.customer_id).single()
        if (cust) q.customer = cust
      }

      // Fetch sales rep name
      if (q.created_by) {
        const { data: rep } = await supabase.from('profiles')
          .select('full_name').eq('id', q.created_by).single()
        q.created_by_name = rep?.full_name || null
      }

      setQuote(q)

      const { data: items } = await supabase.from('document_line_items')
        .select('*').eq('document_id', q.id).order('sort_order')
      setLineItems(items || [])

      const { data: allTerms } = await supabase.from('term_blocks')
        .select('slug, display_title, content, version')
        .in('document_type', ['rental_agreement', 'purchase_invoice'])
        .eq('is_active', true).order('sort_order')

      setRentalTerms((allTerms || []).filter((b: any) => b.slug?.startsWith('ra-')))
      setPurchaseTerms((allTerms || []).filter((b: any) =>
        b.slug?.startsWith('purchase-') || b.slug?.startsWith('inv-')
      ))

      if (q.signed_at) {
        if (q.quote_type === 'rental') {
          const { data: ag } = await supabase.from('agreements').select('*').eq('quote_id', q.id).single()
          if (ag) { setAgreement(ag); setStep(ag.signed_at ? 'complete' : 'view_agreement'); return }
        } else {
          const { data: inv } = await supabase.from('invoices').select('*').eq('quote_id', q.id).single()
          if (inv) { setInvoice(inv); setStep(inv.signed_at ? 'complete' : 'view_invoice'); return }
        }
      }
      setStep('view_quote')
    } catch (e: any) { setStep('error'); setError(e.message || 'Something went wrong.') }
  }

  async function getIp() {
    return fetch('https://api.ipify.org?format=json').then(r => r.json()).then(d => d.ip).catch(() => 'unknown')
  }

  async function handleSignQuote(signedName: string) {
    if (!quote) return
    setSigning(true); setError('')
    try {
      const ip = await getIp()
      const { error: upErr } = await supabase.from('quotes').update({
        status: 'signed', signed_at: new Date().toISOString(), signed_name: signedName, signed_ip: ip,
      }).eq('id', quote.id)
      if (upErr) throw upErr
      setQuote(prev => prev ? { ...prev, status: 'signed', signed_at: new Date().toISOString() } : prev)

      const year = new Date().getFullYear()
      if (quote.quote_type === 'rental') {
        const { data: last } = await supabase.from('agreements')
          .select('agreement_number').like('agreement_number', `RA-${year}-%`)
          .order('agreement_number', { ascending: false }).limit(1)
        const lastNum = last?.[0]?.agreement_number ? parseInt(last[0].agreement_number.split('-')[2]) : 0
        const agNum = `RA-${year}-${String(lastNum + 1).padStart(4, '0')}`
        const { data: ag, error: agErr } = await supabase.from('agreements').insert({
          agreement_number: agNum, quote_id: quote.id, customer_id: quote.customer_id,
          agreement_type: 'rental', status: 'pending_signature',
          monthly_amount: quote.monthly_amount, install_fee: quote.install_fee || 0, term_months: 36,
          terms_snapshot: { blocks: rentalTerms, captured_at: new Date().toISOString() },
          line_items_snapshot: lineItems,
        }).select().single()
        if (agErr) throw agErr
        setAgreement(ag); setStep('view_agreement'); scrollTop()
      } else if (quote.quote_type === 'purchase') {
        const { data: last } = await supabase.from('invoices')
          .select('invoice_number').like('invoice_number', `INV-${year}-%`)
          .order('invoice_number', { ascending: false }).limit(1)
        const lastNum = last?.[0]?.invoice_number ? parseInt(last[0].invoice_number.split('-')[2]) : 0
        const invNum = `INV-${year}-${String(lastNum + 1).padStart(4, '0')}`
        const depositAmt = quote.deposit_type === '50_percent' ? Math.round(quote.total * 0.5 * 100) / 100 : quote.total
        const { data: inv, error: invErr } = await supabase.from('invoices').insert({
          invoice_number: invNum, quote_id: quote.id, customer_id: quote.customer_id,
          invoice_type: 'purchase', status: 'draft',
          subtotal: quote.subtotal, tax_amount: quote.tax_amount, total: quote.total,
          deposit_percent: quote.deposit_type === '50_percent' ? 50 : 100,
          deposit_amount: depositAmt, amount_due: depositAmt,
          terms_snapshot: { blocks: purchaseTerms, captured_at: new Date().toISOString() },
          line_items_snapshot: lineItems,
        }).select().single()
        if (invErr) throw invErr
        setInvoice(inv); setStep('view_invoice'); scrollTop()
      } else {
        setStep('hearth_redirect')
        if (quote.finance_redirect_url) setTimeout(() => window.location.href = quote.finance_redirect_url!, 2000)
      }
    } catch (e: any) { setError(e.message) }
    setSigning(false)
  }

  async function handleSignAgreement(signedName: string) {
    if (!agreement) return
    setSigning(true); setError('')
    try {
      const ip = await getIp()
      const { error: e } = await supabase.from('agreements').update({
        status: 'signed', signed_at: new Date().toISOString(), signed_name: signedName, signed_ip: ip,
      }).eq('id', agreement.id)
      if (e) throw e
      setStep('stripe_first_payment'); scrollTop()
      await redirectToStripe({
        amount_cents: Math.round((agreement.monthly_amount || 0) * 100),
        description: `First Month Rental Payment — ${agreement.agreement_number}`,
        quote_type: 'rental',
        agreement_id: agreement.id,
      })
    } catch (e: any) { setError(e.message) }
    setSigning(false)
  }

  async function handleSignInvoice(signedName: string) {
    if (!invoice) return
    setSigning(true); setError('')
    try {
      const ip = await getIp()
      const { error: e } = await supabase.from('invoices').update({
        status: 'signed', signed_at: new Date().toISOString(), signed_name: signedName, signed_ip: ip,
      }).eq('id', invoice.id)
      if (e) throw e
      setStep('stripe_purchase_payment'); scrollTop()
      await redirectToStripe({
        amount_cents: Math.round((invoice.deposit_amount || 0) * 100),
        description: `Purchase Deposit (${invoice.deposit_percent}%) — ${invoice.invoice_number}`,
        quote_type: 'purchase',
        invoice_id: invoice.id,
      })
    } catch (e: any) { setError(e.message) }
    setSigning(false)
  }

  const customer = quote?.customer
  const rentalSteps = ['Review Quote', 'Sign Quote', 'Sign Agreement', 'Payment']
  const purchaseSteps = ['Review Quote', 'Sign Quote', 'Sign Invoice', 'Payment']
  const currentStep = step === 'view_quote' ? 0 : step === 'view_agreement' || step === 'view_invoice' ? 2 :
    step === 'stripe_first_payment' || step === 'stripe_purchase_payment' ? 3 : 0

  if (step === 'loading') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: '#0a2540', borderTopColor: 'transparent' }} />
        <p className="text-gray-500 text-sm">Loading your document...</p>
      </div>
    </div>
  )

  if (step === 'error') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <h2 className="text-lg font-bold mb-2">Document Not Found</h2>
        <p className="text-sm text-gray-500">{error}</p>
        <p className="text-xs text-gray-400 mt-4">(317) 690-4172</p>
      </div>
    </div>
  )

  if (step === 'expired') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
        <div className="text-4xl mb-3">⏰</div>
        <h2 className="text-lg font-bold mb-2">Quote Expired</h2>
        <p className="text-sm text-gray-500">Please contact your sales rep for a new quote.</p>
        <p className="text-xs text-gray-400 mt-4">(317) 690-4172</p>
      </div>
    </div>
  )

  if (step === 'already_complete') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
        <div className="text-4xl mb-3">✅</div>
        <h2 className="text-lg font-bold mb-2">Already Processed</h2>
        <p className="text-sm text-gray-500">This document has already been signed.</p>
        <p className="text-xs text-gray-400 mt-4">(317) 690-4172</p>
      </div>
    </div>
  )

  if (step === 'hearth_redirect') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
        <div className="text-4xl mb-4">🏦</div>
        <h2 className="text-xl font-bold mb-2">Redirecting to Hearth...</h2>
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mt-4" style={{ borderColor: '#0a2540', borderTopColor: 'transparent' }} />
      </div>
    </div>
  )

  if (step === 'stripe_first_payment') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
        {redirecting ? (
          <>
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#eff6ff' }}>
              <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#0a2540', borderTopColor: 'transparent' }} />
            </div>
            <h2 className="text-xl font-bold mb-2">Agreement Signed!</h2>
            <p className="text-sm text-gray-500">Taking you to secure payment...</p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4 text-3xl">✅</div>
            <h2 className="text-xl font-bold mb-2">Agreement Signed!</h2>
            <p className="text-sm text-gray-600 mb-4">Ready to collect your first payment of <strong>{fmt(agreement?.monthly_amount || 0)}</strong>.</p>
            {error && <p className="text-red-500 text-xs mb-4">{error}</p>}
            <button
              onClick={() => redirectToStripe({
                amount_cents: Math.round((agreement?.monthly_amount || 0) * 100),
                description: `First Month Rental Payment — ${agreement?.agreement_number}`,
                quote_type: 'rental',
                agreement_id: agreement?.id,
              })}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm"
              style={{ backgroundColor: '#0a2540' }}
            >
              Continue to Payment →
            </button>
            <p className="text-xs text-gray-400 mt-4">(317) 690-4172</p>
          </>
        )}
      </div>
    </div>
  )

  if (step === 'stripe_purchase_payment') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
        {redirecting ? (
          <>
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#eff6ff' }}>
              <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#0a2540', borderTopColor: 'transparent' }} />
            </div>
            <h2 className="text-xl font-bold mb-2">Invoice Signed!</h2>
            <p className="text-sm text-gray-500">Taking you to secure payment...</p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4 text-3xl">✅</div>
            <h2 className="text-xl font-bold mb-2">Invoice Signed!</h2>
            <p className="text-sm text-gray-600 mb-4">Ready to collect your deposit of <strong>{fmt(invoice?.deposit_amount || 0)}</strong>.</p>
            {error && <p className="text-red-500 text-xs mb-4">{error}</p>}
            <button
              onClick={() => redirectToStripe({
                amount_cents: Math.round((invoice?.deposit_amount || 0) * 100),
                description: `Purchase Deposit (${invoice?.deposit_percent}%) — ${invoice?.invoice_number}`,
                quote_type: 'purchase',
                invoice_id: invoice?.id,
              })}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm"
              style={{ backgroundColor: '#0a2540' }}
            >
              Continue to Payment →
            </button>
            <p className="text-xs text-gray-400 mt-4">(317) 690-4172</p>
          </>
        )}
      </div>
    </div>
  )

  if (step === 'complete') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-xl font-bold mb-2">All Done!</h2>
        <p className="text-sm text-gray-500">Documents signed. Zenith will be in touch soon.</p>
        <p className="text-xs text-gray-400 mt-5">(317) 690-4172</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50" ref={topRef}>
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <ZenithLogo />
          <div className="text-xs text-gray-400 font-mono">{quote?.quote_number}</div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <StepBar steps={quote?.quote_type === 'rental' ? rentalSteps : purchaseSteps} current={currentStep} />

        {/* ── VIEW QUOTE ────────────────────────────── */}
        {step === 'view_quote' && quote && (
          <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-5 text-white" style={{ backgroundColor: '#0a2540' }}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xl font-bold">
                      {quote.quote_type === 'rental' ? 'Rental Quote' : quote.quote_type === 'purchase' ? 'Purchase Order' : 'Finance Quote'}
                    </div>
                    <div className="text-blue-200 text-sm">{quote.quote_number}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-blue-300">Expires</div>
                    <div className="text-white font-medium text-sm">{quote.expires_at ? new Date(quote.expires_at).toLocaleDateString() : '—'}</div>
                  </div>
                </div>
                <div className="flex gap-8 mt-4 pt-4 border-t border-blue-800">
                  <div>
                    <div className="text-xs text-blue-300 uppercase tracking-wide">Quotation Date</div>
                    <div className="text-white text-sm font-medium">{quote.created_at ? new Date(quote.created_at).toLocaleDateString() : today()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-blue-300 uppercase tracking-wide">Expiration</div>
                    <div className="text-white text-sm font-medium">{quote.expires_at ? new Date(quote.expires_at).toLocaleDateString() : '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-blue-300 uppercase tracking-wide">Sales Consultant</div>
                    <div className="text-white text-sm font-medium">{quote.created_by_name || 'Zenith Pure Solutions'}</div>
                  </div>
                </div>
              </div>
              <div className="px-6 py-5 grid grid-cols-3 gap-4 text-sm border-b border-gray-100">
                <div>
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Bill To</div>
                  <div className="font-semibold text-gray-800">{customer?.full_name || '—'}</div>
                  <div className="text-gray-500 text-xs">{customer?.address}</div>
                  <div className="text-gray-500 text-xs">{customer?.city}, {customer?.state} {customer?.zip}</div>
                  <div className="text-gray-500 text-xs">{customer?.phone}</div>
                </div>
                <div>
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Installation Address</div>
                  <div className="font-semibold text-gray-800">{customer?.full_name || '—'}</div>
                  <div className="text-gray-500 text-xs">{customer?.address}</div>
                  <div className="text-gray-500 text-xs">{customer?.city}, {customer?.state} {customer?.zip}</div>
                  <div className="text-gray-500 text-xs">{customer?.phone}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">From</div>
                  <div className="font-semibold text-gray-800">Zenith Pure Solutions</div>
                  <div className="text-gray-500 text-xs">6951 E 30th St, Suite B</div>
                  <div className="text-gray-500 text-xs">Indianapolis, IN 46219</div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Estimation Details</div>
              <p className="text-sm text-gray-600 leading-relaxed">
                This system has been recommended based on your home size, water usage, and water quality needs.
                It is designed to improve overall water quality, enhance efficiency, and protect your plumbing, appliances, and fixtures.
              </p>
              {quote.notes && <p className="text-sm text-gray-600 mt-2">{quote.notes}</p>}
            </div>

            {lineItems.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-3 bg-gray-50 border-b border-gray-100 text-xs font-bold text-gray-400 uppercase tracking-wide">Equipment & Services</div>
                <table className="w-full">
                  <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="px-6 py-3 text-left font-semibold">Description</th>
                    <th className="px-4 py-3 text-center font-semibold">Qty</th>
                    <th className="px-4 py-3 text-right font-semibold">Price</th>
                    <th className="px-4 py-3 text-right font-semibold">Discount</th>
                    <th className="px-6 py-3 text-right font-semibold">Total</th>
                  </tr></thead>
                  <tbody>
                    {lineItems.map(item => (
                      <tr key={item.id} className="border-b border-gray-50">
                        <td className="px-6 py-4 text-sm text-gray-800">{item.description}</td>
                        <td className="px-4 py-4 text-sm text-gray-600 text-center">{item.quantity}</td>
                        <td className="px-4 py-4 text-sm text-gray-600 text-right">{quote.quote_type === 'rental' ? `${fmt(item.unit_price)}/mo` : fmt(item.unit_price)}</td>
                        <td className="px-4 py-4 text-sm text-gray-400 text-right">—</td>
                        <td className="px-6 py-4 text-sm font-semibold text-gray-900 text-right">{quote.quote_type === 'rental' ? `${fmt(item.total)}/mo` : fmt(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-6 py-4 bg-gray-50">
                  {quote.quote_type === 'rental' ? (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm text-gray-600"><span>Installation Fee (one-time)</span><span className="font-medium">{fmt(quote.install_fee || 0)}</span></div>
                      <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-200"><span>Monthly Total</span><span style={{ color: '#0a2540' }}>{fmt(quote.monthly_amount)}/mo</span></div>
                    </div>
                  ) : (
                    <div className="max-w-xs ml-auto space-y-1.5">
                      <div className="flex justify-between text-sm text-gray-600"><span>Subtotal</span><span>{fmt(quote.subtotal)}</span></div>
                      <div className="flex justify-between text-sm text-gray-600"><span>Tax</span><span>{fmt(quote.tax_amount)}</span></div>
                      <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-200"><span>Total</span><span>{fmt(quote.total)}</span></div>
                      {quote.deposit_type === '50_percent' && (
                        <div className="flex justify-between text-sm font-bold pt-1" style={{ color: '#0a2540' }}><span>Deposit Due (50%)</span><span>{fmt(quote.total * 0.5)}</span></div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {quote.quote_type === 'rental' && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="text-xs font-bold text-blue-700 mb-1">Rental Agreement Notice</div>
                <p className="text-xs text-blue-600">Accepting this quote initiates a 36-month Residential Equipment Rental Agreement. Equipment remains property of Zenith Pure Solutions LLC. 50% of payments apply toward buyout.</p>
              </div>
            )}

            {quote.quote_type === 'purchase' && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-3 bg-gray-50 border-b border-gray-100">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wide">Direct Transfer / ACH Details</div>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      ['Bank Name', 'Old National Bank'],
                      ['ACH ABA Number', '086300012'],
                      ['Account Number', '0127726846'],
                      ['Account Name', 'ZENITH PURE SOLUTIONS LLC'],
                      ['Email', 'accounts@zenithpuresolutions.com'],
                      ['Phone Number', '+1 (317) 690-4172'],
                    ].map(([label, value]) => (
                      <tr key={label} className="border-b border-gray-50">
                        <td className="px-6 py-3 font-semibold text-gray-700 w-48">{label}</td>
                        <td className="px-6 py-3 text-gray-600">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="text-center">
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                Click here to view Terms & Conditions (Version v1.0, Date 01/30/2026) ↗
              </a>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Customer Authorization</div>
              <p className="text-xs text-gray-600 leading-relaxed mb-5">
                This is a good-faith estimate. By signing, I authorize Zenith Pure Solutions to proceed as outlined and agree to pay for all services rendered.
              </p>
              <SignaturePad onSign={handleSignQuote} label="Sign & Accept Quote" loading={signing} />
              {error && <p className="text-red-500 text-xs mt-3">{error}</p>}
            </div>
          </div>
        )}

        {/* ── AGREEMENT ─────────────────────────────── */}
        {step === 'view_agreement' && quote && agreement && (
          <AgreementDocument agreement={agreement} customer={customer} terms={rentalTerms} onSign={handleSignAgreement} signing={signing} error={error} />
        )}

        {/* ── INVOICE ───────────────────────────────── */}
        {step === 'view_invoice' && quote && invoice && (
          <InvoiceDocument invoice={invoice} customer={customer} terms={purchaseTerms} onSign={handleSignInvoice} signing={signing} error={error} />
        )}

        <div className="mt-10 text-center text-xs text-gray-400 pb-8 space-y-1">
          <p>Zenith Pure Solutions LLC · 6951 E 30th St, Suite B, Indianapolis, IN 46219</p>
          <p>(317) 690-4172 · info@zenithpuresolutions.com · zenithpuresolutions.com</p>
        </div>
      </div>
    </div>
  )
}
