// QuoteReviewPage.tsx
// Public customer-facing page — no auth required
// Route: /q/:token
// Handles: Rental flow, Purchase flow, Finance flow

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
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
  signed_at: string | null
  finance_redirect_url: string | null
  customers: {
    first_name: string
    last_name: string
    email: string
    phone: string
    address: string
    city: string
    state: string
    zip: string
  }
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
  public_token: string
  status: string
  monthly_amount: number
  install_fee: number
  signed_at: string | null
}

interface Invoice {
  id: string
  invoice_number: string
  public_token: string
  status: string
  total: number
  deposit_amount: number
  deposit_percent: number
  signed_at: string | null
}

// ─── Step tracker ────────────────────────────────────────────────
type FlowStep =
  | 'loading'
  | 'error'
  | 'expired'
  | 'already_complete'
  | 'view_quote'
  | 'sign_quote'
  | 'view_agreement'
  | 'sign_agreement'
  | 'stripe_first_payment'
  | 'view_invoice'
  | 'sign_invoice'
  | 'stripe_purchase_payment'
  | 'hearth_redirect'
  | 'complete'

// ─── Helpers ─────────────────────────────────────────────────────
function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function ZenithLogo() {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#0a2540' }}>
        <span className="text-white font-black text-base">Z</span>
      </div>
      <div>
        <div className="font-bold text-gray-900 text-sm">Zenith Pure Solutions</div>
        <div className="text-xs text-gray-400">Indianapolis, IN · (317) 690-4172</div>
      </div>
    </div>
  )
}

function StepBar({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((label, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
              i < current ? 'bg-green-500 text-white' :
              i === current ? 'bg-blue-600 text-white' :
              'bg-gray-200 text-gray-400'
            }`}>
              {i < current ? '✓' : i + 1}
            </div>
            <span className={`text-xs font-medium hidden sm:block ${
              i === current ? 'text-blue-700' : i < current ? 'text-green-600' : 'text-gray-400'
            }`}>{label}</span>
          </div>
          {i < steps.length - 1 && <div className={`h-px w-8 flex-shrink-0 ${i < current ? 'bg-green-400' : 'bg-gray-200'}`} />}
        </div>
      ))}
    </div>
  )
}

// ─── Signature pad ───────────────────────────────────────────────
function SignaturePad({ onSign }: { onSign: (name: string) => void }) {
  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)

  return (
    <div className="border border-gray-200 rounded-xl p-5 bg-gray-50">
      <div className="text-sm font-semibold text-gray-700 mb-4">Sign this document</div>

      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-600 mb-1">Full Legal Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Type your full name to sign"
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {name.trim().length > 2 && (
        <div className="mb-4 p-3 bg-white border border-gray-200 rounded-lg">
          <div className="text-xs text-gray-400 mb-1">Signature preview</div>
          <div className="font-serif text-2xl text-gray-800" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
            {name}
          </div>
        </div>
      )}

      <label className="flex items-start gap-3 mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={agreed}
          onChange={e => setAgreed(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="text-xs text-gray-600">
          By typing my name above and clicking Sign, I agree that this constitutes my legal electronic signature, with the same legal effect as a handwritten signature.
        </span>
      </label>

      <button
        onClick={() => name.trim().length > 2 && agreed && onSign(name.trim())}
        disabled={name.trim().length < 2 || !agreed}
        className="w-full py-3 rounded-lg text-white font-semibold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ backgroundColor: '#0a2540' }}
      >
        Sign Document
      </button>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────
export function QuoteReviewPage() {
  const { token } = useParams<{ token: string }>()
  const [step, setStep] = useState<FlowStep>('loading')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [rentalTerms, setRentalTerms] = useState<TermBlock[]>([])
  const [purchaseTerms, setPurchaseTerms] = useState<TermBlock[]>([])
  const [agreement, setAgreement] = useState<Agreement | null>(null)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [error, setError] = useState('')
  const [signing, setSigning] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (token) loadQuote(token) }, [token])

  function scrollTop() {
    setTimeout(() => topRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  async function loadQuote(t: string) {
    try {
      // Load quote (no join — fetch customer separately)
      const { data: q, error: qErr } = await supabase
        .from('quotes')
        .select('*')
        .eq('public_token', t)
        .single()

      if (qErr || !q) { setStep('error'); setError('Quote not found.'); return }

      // Load customer separately
      if (q.customer_id) {
        const { data: cust } = await supabase
          .from('customers')
          .select('first_name, last_name, email, phone, address, city, state, zip')
          .eq('id', q.customer_id)
          .single()
        if (cust) q.customers = cust
      }

      // Check expired
      if (q.expires_at && new Date(q.expires_at) < new Date()) { setStep('expired'); return }

      // Check already completed
      if (['accepted', 'declined', 'void'].includes(q.status)) { setStep('already_complete'); setQuote(q); return }

      setQuote(q)

      // Load line items
      const { data: items } = await supabase
        .from('document_line_items')
        .select('*')
        .eq('document_id', q.id)
        .order('sort_order')
      setLineItems(items || [])

      // Load term blocks
      const { data: allTerms } = await supabase
        .from('term_blocks')
        .select('slug, display_title, content, version')
        .in('document_type', ['rental_agreement', 'purchase_invoice'])
        .eq('is_active', true)
        .order('sort_order')

      setRentalTerms((allTerms || []).filter(t => t.slug.startsWith('ra-')))
      setPurchaseTerms((allTerms || []).filter(t => t.slug.startsWith('purchase-')))

      // If quote already signed, check for existing agreement/invoice
      if (q.signed_at) {
        if (q.quote_type === 'rental') {
          const { data: ag } = await supabase
            .from('agreements')
            .select('*')
            .eq('quote_id', q.id)
            .single()
          if (ag) {
            setAgreement(ag)
            setStep(ag.signed_at ? 'complete' : 'view_agreement')
            return
          }
        } else {
          const { data: inv } = await supabase
            .from('invoices')
            .select('*')
            .eq('quote_id', q.id)
            .single()
          if (inv) {
            setInvoice(inv)
            setStep(inv.signed_at ? 'complete' : 'view_invoice')
            return
          }
        }
      }

      setStep('view_quote')
    } catch (e: any) {
      setStep('error')
      setError(e.message || 'Something went wrong.')
    }
  }

  async function handleSignQuote(signedName: string) {
    if (!quote) return
    setSigning(true)
    try {
      const ip = await fetch('https://api.ipify.org?format=json').then(r => r.json()).then(d => d.ip).catch(() => 'unknown')

      // Mark quote signed
      await supabase.from('quotes').update({
        status: 'signed',
        signed_at: new Date().toISOString(),
        signed_name: signedName,
        signed_ip: ip,
      }).eq('id', quote.id)

      setQuote(prev => prev ? { ...prev, status: 'signed', signed_at: new Date().toISOString() } : prev)

      if (quote.quote_type === 'rental') {
        // Generate rental agreement
        const agNum = await generateNumber('rental_agreement')
        const { data: ag } = await supabase.from('agreements').insert({
          agreement_number: agNum,
          quote_id: quote.id,
          customer_id: quote.customers ? (quote as any).customer_id : null,
          agreement_type: 'rental',
          status: 'pending_signature',
          monthly_amount: quote.monthly_amount,
          install_fee: quote.install_fee,
          term_months: 36,
          terms_snapshot: { blocks: rentalTerms, captured_at: new Date().toISOString() },
          line_items_snapshot: lineItems,
        }).select().single()
        if (ag) {
          setAgreement(ag)
          setStep('view_agreement')
          scrollTop()
        }
      } else if (quote.quote_type === 'purchase') {
        // Generate invoice
        const invNum = await generateNumber('invoice')
        const depositAmt = quote.deposit_type === '50_percent'
          ? Math.round(quote.total * 0.5 * 100) / 100
          : quote.total
        const { data: inv } = await supabase.from('invoices').insert({
          invoice_number: invNum,
          quote_id: quote.id,
          customer_id: (quote as any).customer_id,
          invoice_type: 'purchase',
          status: 'draft',
          subtotal: quote.subtotal,
          tax_amount: quote.tax_amount,
          total: quote.total,
          deposit_percent: quote.deposit_type === '50_percent' ? 50 : 100,
          deposit_amount: depositAmt,
          amount_due: depositAmt,
          terms_snapshot: { blocks: purchaseTerms, captured_at: new Date().toISOString() },
          line_items_snapshot: lineItems,
        }).select().single()
        if (inv) {
          setInvoice(inv)
          setStep('view_invoice')
          scrollTop()
        }
      } else if (quote.quote_type === 'finance') {
        // Redirect to Hearth
        setStep('hearth_redirect')
        if (quote.finance_redirect_url) {
          setTimeout(() => window.location.href = quote.finance_redirect_url!, 2000)
        }
      }
    } catch (e: any) {
      setError(e.message)
    }
    setSigning(false)
  }

  async function handleSignAgreement(signedName: string) {
    if (!agreement) return
    setSigning(true)
    try {
      const ip = await fetch('https://api.ipify.org?format=json').then(r => r.json()).then(d => d.ip).catch(() => 'unknown')
      await supabase.from('agreements').update({
        status: 'signed',
        signed_at: new Date().toISOString(),
        signed_name: signedName,
        signed_ip: ip,
      }).eq('id', agreement.id)
      setAgreement(prev => prev ? { ...prev, status: 'signed', signed_at: new Date().toISOString() } : prev)
      setStep('stripe_first_payment')
      scrollTop()
    } catch (e: any) {
      setError(e.message)
    }
    setSigning(false)
  }

  async function handleSignInvoice(signedName: string) {
    if (!invoice) return
    setSigning(true)
    try {
      const ip = await fetch('https://api.ipify.org?format=json').then(r => r.json()).then(d => d.ip).catch(() => 'unknown')
      await supabase.from('invoices').update({
        status: 'signed',
        signed_at: new Date().toISOString(),
        signed_name: signedName,
        signed_ip: ip,
      }).eq('id', invoice.id)
      setInvoice(prev => prev ? { ...prev, status: 'signed', signed_at: new Date().toISOString() } : prev)
      setStep('stripe_purchase_payment')
      scrollTop()
    } catch (e: any) {
      setError(e.message)
    }
    setSigning(false)
  }

  async function generateNumber(type: 'rental_quote' | 'purchase_order' | 'rental_agreement' | 'invoice') {
    const fnMap = {
      rental_quote: 'generate_rental_quote_number',
      purchase_order: 'generate_purchase_order_number',
      rental_agreement: 'generate_rental_agreement_number',
      invoice: 'generate_invoice_number',
    }
    const { data } = await supabase.rpc(fnMap[type])
    return data as string
  }

  const customer = quote?.customers
  const customerName = customer ? `${customer.first_name} ${customer.last_name}` : ''
  const customerAddress = customer
    ? `${customer.address}, ${customer.city}, ${customer.state} ${customer.zip}`
    : ''

  // ─── RENDER STATES ────────────────────────────────────────────

  if (step === 'loading') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-500 text-sm">Loading your document...</p>
      </div>
    </div>
  )

  if (step === 'error') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <h2 className="text-lg font-bold text-gray-800 mb-2">Document Not Found</h2>
        <p className="text-sm text-gray-500">{error || 'This link is invalid or has been removed.'}</p>
        <p className="text-xs text-gray-400 mt-4">Contact Zenith Pure Solutions: (317) 690-4172</p>
      </div>
    </div>
  )

  if (step === 'expired') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
        <div className="text-4xl mb-3">⏰</div>
        <h2 className="text-lg font-bold text-gray-800 mb-2">Quote Expired</h2>
        <p className="text-sm text-gray-500">This quote has expired. Please contact your sales rep for an updated quote.</p>
        <p className="text-xs text-gray-400 mt-4">(317) 690-4172 · info@zenithpuresolutions.com</p>
      </div>
    </div>
  )

  if (step === 'already_complete') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
        <div className="text-4xl mb-3">✅</div>
        <h2 className="text-lg font-bold text-gray-800 mb-2">Already Processed</h2>
        <p className="text-sm text-gray-500">This document has already been signed and processed.</p>
        <p className="text-xs text-gray-400 mt-4">Questions? Call (317) 690-4172</p>
      </div>
    </div>
  )

  if (step === 'hearth_redirect') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
        <div className="text-4xl mb-3">🏦</div>
        <h2 className="text-lg font-bold text-gray-800 mb-2">Redirecting to Hearth</h2>
        <p className="text-sm text-gray-500">You're being redirected to Hearth to complete your financing application...</p>
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mt-4" />
        <p className="text-xs text-gray-400 mt-4">No financing link set up yet. Contact (317) 690-4172</p>
      </div>
    </div>
  )

  if (step === 'stripe_first_payment') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Agreement Signed!</h2>
        <p className="text-sm text-gray-600 mb-6">
          Your Rental Agreement is signed. The final step is your first monthly payment of{' '}
          <strong>{fmt(agreement?.monthly_amount || 0)}</strong> to activate your service.
        </p>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-left">
          <div className="text-xs font-semibold text-blue-700 mb-2">What happens next</div>
          <div className="space-y-1 text-xs text-blue-600">
            <div>✓ Your card is securely saved for monthly autopay</div>
            <div>✓ Zenith schedules your installation</div>
            <div>✓ Monthly billing starts on your install date</div>
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 mb-6">
          <strong>Stripe payment coming soon.</strong> Your rep will contact you to collect your first payment securely.
        </div>
        <p className="text-xs text-gray-400">Questions? Call (317) 690-4172</p>
      </div>
    </div>
  )

  if (step === 'stripe_purchase_payment') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Invoice Signed!</h2>
        <p className="text-sm text-gray-600 mb-6">
          Your invoice is signed. Your deposit of{' '}
          <strong>{fmt(invoice?.deposit_amount || 0)}</strong> is due to schedule installation.
        </p>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-left">
          <div className="text-xs font-semibold text-blue-700 mb-2">What happens next</div>
          <div className="space-y-1 text-xs text-blue-600">
            <div>✓ Pay your deposit to lock in your installation date</div>
            <div>✓ Remaining balance due on installation day</div>
            <div>✓ Zenith contacts you to schedule</div>
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 mb-6">
          <strong>Stripe payment coming soon.</strong> Your rep will contact you to collect your deposit securely.
        </div>
        <p className="text-xs text-gray-400">Questions? Call (317) 690-4172</p>
      </div>
    </div>
  )

  if (step === 'complete') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">All Done!</h2>
        <p className="text-sm text-gray-600">Your documents are signed and on file. Zenith will be in touch to schedule your installation.</p>
        <p className="text-xs text-gray-400 mt-6">(317) 690-4172 · zenithpuresolutions.com</p>
      </div>
    </div>
  )

  // ─── SHARED HEADER ────────────────────────────────────────────
  const rentalSteps = ['Review Quote', 'Sign Quote', 'Sign Agreement', 'Payment']
  const purchaseSteps = ['Review Quote', 'Sign Quote', 'Sign Invoice', 'Payment']
  const currentStepIndex =
    step === 'view_quote' ? 0 :
    step === 'sign_quote' ? 1 :
    step === 'view_agreement' || step === 'sign_agreement' ? 2 :
    step === 'view_invoice' || step === 'sign_invoice' ? 2 :
    3

  return (
    <div className="min-h-screen bg-gray-50" ref={topRef}>

      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <ZenithLogo />
          <div className="text-xs text-gray-400">
            {quote?.quote_number}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">

        {/* Step bar */}
        <StepBar
          steps={quote?.quote_type === 'rental' ? rentalSteps : purchaseSteps}
          current={currentStepIndex}
        />

        {/* ── VIEW QUOTE ─────────────────────────────────────── */}
        {(step === 'view_quote' || step === 'sign_quote') && quote && (
          <div className="space-y-6">

            {/* Quote header card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-6 py-5 border-b border-gray-100" style={{ backgroundColor: '#0a2540' }}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-white font-bold text-xl">
                      {quote.quote_type === 'rental' ? 'Rental Quote' :
                       quote.quote_type === 'purchase' ? 'Purchase Order' : 'Finance Quote'}
                    </div>
                    <div className="text-blue-200 text-sm mt-0.5">{quote.quote_number}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-blue-200 text-xs">Expires</div>
                    <div className="text-white text-sm font-medium">
                      {quote.expires_at ? new Date(quote.expires_at).toLocaleDateString() : '—'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-6 py-5 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Bill To</div>
                  <div className="font-semibold text-gray-800">{customerName}</div>
                  <div className="text-gray-500 text-xs mt-0.5">{customerAddress}</div>
                  {customer?.phone && <div className="text-gray-500 text-xs">{customer.phone}</div>}
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">From</div>
                  <div className="font-semibold text-gray-800">Zenith Pure Solutions</div>
                  <div className="text-gray-500 text-xs mt-0.5">6951 E 30th St, Suite B</div>
                  <div className="text-gray-500 text-xs">Indianapolis, IN 46219</div>
                </div>
              </div>
            </div>

            {/* Estimation details */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Estimation Details</div>
              <p className="text-sm text-gray-600 leading-relaxed">
                This system has been recommended based on your home size, water usage, and water quality needs.
                It is designed to improve overall water quality, enhance efficiency, and protect your plumbing, appliances, and fixtures.
              </p>
            </div>

            {/* Line items */}
            {lineItems.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wide">Equipment & Services</div>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="text-xs font-semibold text-gray-400 border-b border-gray-100">
                      <th className="px-6 py-3 text-left">Description</th>
                      <th className="px-4 py-3 text-center">Qty</th>
                      <th className="px-4 py-3 text-right">Unit Price</th>
                      <th className="px-6 py-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map(item => (
                      <tr key={item.id} className="border-b border-gray-50">
                        <td className="px-6 py-4 text-sm text-gray-800">{item.description}</td>
                        <td className="px-4 py-4 text-sm text-gray-600 text-center">{item.quantity}</td>
                        <td className="px-4 py-4 text-sm text-gray-600 text-right">
                          {quote.quote_type === 'rental' ? `${fmt(item.unit_price)}/mo` : fmt(item.unit_price)}
                        </td>
                        <td className="px-6 py-4 text-sm font-semibold text-gray-800 text-right">
                          {quote.quote_type === 'rental' ? `${fmt(item.total)}/mo` : fmt(item.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Totals */}
                <div className="px-6 py-4 bg-gray-50">
                  {quote.quote_type === 'rental' ? (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm text-gray-600">
                        <span>Setup / Installation Fee (one-time)</span>
                        <span className="font-medium">{fmt(quote.install_fee || 0)}</span>
                      </div>
                      <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-200">
                        <span>Monthly Total</span>
                        <span style={{ color: '#0a2540' }}>{fmt(quote.monthly_amount || 0)}/mo</span>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-sm text-gray-600">
                        <span>Subtotal</span>
                        <span>{fmt(quote.subtotal || 0)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-gray-600">
                        <span>Tax</span>
                        <span>{fmt(quote.tax_amount || 0)}</span>
                      </div>
                      <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-200">
                        <span>Total</span>
                        <span style={{ color: '#0a2540' }}>{fmt(quote.total || 0)}</span>
                      </div>
                      {quote.deposit_type === '50_percent' && (
                        <div className="flex justify-between text-sm font-semibold text-blue-700 pt-1">
                          <span>Deposit Due Today (50%)</span>
                          <span>{fmt(quote.deposit_amount || quote.total * 0.5)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Rental notice */}
            {quote.quote_type === 'rental' && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="text-xs font-bold text-blue-700 mb-1">Rental Agreement Notice</div>
                <p className="text-xs text-blue-600">
                  Accepting this quote initiates a 36-month Residential Equipment Rental Agreement.
                  Monthly payments apply. Equipment remains property of Zenith Pure Solutions LLC.
                  50% of payments made apply toward buyout at any time.
                </p>
              </div>
            )}

            {/* Finance notice */}
            {quote.quote_type === 'finance' && (
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
                <div className="text-xs font-bold text-purple-700 mb-1">Financing via Hearth</div>
                <p className="text-xs text-purple-600">
                  After signing this quote, you will be redirected to Hearth to complete your financing application.
                  Once approved, Hearth funds your account and you pay Zenith directly.
                </p>
              </div>
            )}

            {/* T&C link */}
            <div className="text-center">
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline"
              >
                Click here to view Terms & Conditions (Version v1.0, Date 01/30/2026)
              </a>
            </div>

            {/* Customer authorization + sign */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Customer Authorization</div>
              <p className="text-xs text-gray-600 leading-relaxed mb-5">
                This is an estimate, not a final invoice or contract for services. The summary above is a good-faith
                estimate based on our evaluation of the work to be performed. I understand that the final cost may differ
                if extra materials or labor are required. By signing, I authorize Zenith Pure Solutions to proceed as
                outlined and agree to pay for all services rendered.
              </p>
              <SignaturePad onSign={handleSignQuote} />
              {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
            </div>

          </div>
        )}

        {/* ── VIEW AGREEMENT ─────────────────────────────────── */}
        {(step === 'view_agreement' || step === 'sign_agreement') && quote && agreement && (
          <div className="space-y-6">

            {/* Agreement header */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-6 py-5" style={{ backgroundColor: '#0a2540' }}>
                <div className="text-white font-bold text-xl">Residential Equipment Rental Agreement</div>
                <div className="text-blue-200 text-sm mt-0.5">{agreement.agreement_number}</div>
              </div>
              <div className="px-6 py-4 grid grid-cols-2 gap-4 text-sm border-b border-gray-100">
                <div>
                  <div className="text-xs text-gray-400 mb-0.5">Customer</div>
                  <div className="font-semibold text-gray-800">{customerName}</div>
                  <div className="text-gray-500 text-xs">{customerAddress}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-400 mb-0.5">Agreement Date</div>
                  <div className="font-semibold text-gray-800">{new Date().toLocaleDateString()}</div>
                </div>
              </div>
              <div className="px-6 py-4 bg-blue-50 flex gap-6 text-sm">
                <div>
                  <div className="text-xs text-blue-500">Monthly Payment</div>
                  <div className="font-bold text-blue-800">{fmt(agreement.monthly_amount)}/mo</div>
                </div>
                <div>
                  <div className="text-xs text-blue-500">Installation Fee</div>
                  <div className="font-bold text-blue-800">{fmt(agreement.install_fee)}</div>
                </div>
                <div>
                  <div className="text-xs text-blue-500">Initial Term</div>
                  <div className="font-bold text-blue-800">36 months</div>
                </div>
              </div>
            </div>

            {/* Agreement intro */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <p className="text-sm text-gray-700 leading-relaxed">
                This Residential Equipment Rental and Service Agreement is entered into between{' '}
                <strong>Zenith Pure Solutions LLC</strong>, an Indiana limited liability company, and{' '}
                <strong>{customerName}</strong> ("Customer").
              </p>
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-xs font-bold text-amber-700">
                  BY SIGNING BELOW, YOU ACKNOWLEDGE THAT YOU HAVE READ, UNDERSTOOD, AND AGREE TO BE BOUND BY
                  ALL TERMS AND CONDITIONS CONTAINED IN THIS AGREEMENT, INCLUDING THE BINDING ARBITRATION
                  AND CLASS ACTION WAIVER PROVISIONS IN ARTICLE IX.
                </p>
              </div>
            </div>

            {/* All articles */}
            {rentalTerms.map(block => (
              <div key={block.slug} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <h3 className="font-bold text-gray-800 mb-3 pb-2 border-b border-gray-100 text-sm">
                  {block.display_title}
                </h3>
                <div className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">
                  {block.content
                    .replace('[INSTALL_FEE]', fmt(agreement.install_fee))
                    .replace('[MONTHLY_AMOUNT]', fmt(agreement.monthly_amount))
                  }
                </div>
              </div>
            ))}

            {/* Sign agreement */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="text-sm font-bold text-gray-700 mb-2">IN WITNESS WHEREOF</div>
              <p className="text-xs text-gray-500 mb-5">
                The parties have executed this Agreement as of {new Date().toLocaleDateString()}.
              </p>
              <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
                <div className="p-3 bg-gray-50 rounded-lg">
                  <div className="text-xs text-gray-400 mb-1">Zenith Pure Solutions LLC</div>
                  <div className="font-semibold text-gray-700">Kuldeep Singh</div>
                  <div className="text-xs text-gray-400">{new Date().toLocaleDateString()}</div>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <div className="text-xs text-gray-400 mb-1">Customer</div>
                  <div className="font-semibold text-gray-700">{customerName}</div>
                  <div className="text-xs text-gray-400">Signing below...</div>
                </div>
              </div>
              <SignaturePad onSign={handleSignAgreement} />
              {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
            </div>

          </div>
        )}

        {/* ── VIEW INVOICE ───────────────────────────────────── */}
        {(step === 'view_invoice' || step === 'sign_invoice') && quote && invoice && (
          <div className="space-y-6">

            {/* Invoice header */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-6 py-5" style={{ backgroundColor: '#0a2540' }}>
                <div className="text-white font-bold text-xl">Purchase Invoice</div>
                <div className="text-blue-200 text-sm mt-0.5">{invoice.invoice_number}</div>
              </div>
              <div className="px-6 py-4 grid grid-cols-2 gap-4 text-sm border-b border-gray-100">
                <div>
                  <div className="text-xs text-gray-400 mb-0.5">Bill To</div>
                  <div className="font-semibold text-gray-800">{customerName}</div>
                  <div className="text-gray-500 text-xs">{customerAddress}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-400 mb-0.5">Invoice Date</div>
                  <div className="font-semibold text-gray-800">{new Date().toLocaleDateString()}</div>
                </div>
              </div>
            </div>

            {/* Line items */}
            {(invoice.line_items_snapshot as any[])?.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="text-xs font-semibold text-gray-400 border-b border-gray-100 bg-gray-50">
                      <th className="px-6 py-3 text-left">Description</th>
                      <th className="px-4 py-3 text-center">Qty</th>
                      <th className="px-4 py-3 text-right">Unit Price</th>
                      <th className="px-6 py-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(invoice.line_items_snapshot as LineItem[]).map((item, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="px-6 py-4 text-sm text-gray-800">{item.description}</td>
                        <td className="px-4 py-4 text-sm text-gray-600 text-center">{item.quantity}</td>
                        <td className="px-4 py-4 text-sm text-gray-600 text-right">{fmt(item.unit_price)}</td>
                        <td className="px-6 py-4 text-sm font-semibold text-gray-800 text-right">{fmt(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-6 py-4 bg-gray-50 space-y-1.5">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Subtotal</span><span>{fmt(invoice.total - (invoice as any).tax_amount || 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Tax</span><span>{fmt((invoice as any).tax_amount || 0)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-200">
                    <span>Total</span><span>{fmt(invoice.total)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold text-blue-700 pt-1">
                    <span>Deposit Due ({invoice.deposit_percent}%)</span>
                    <span>{fmt(invoice.deposit_amount)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* T&C link */}
            <div className="text-center">
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                Click here to view Terms & Conditions (Version v1.0, Date 01/30/2026)
              </a>
            </div>

            {/* Customer authorization + sign */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Customer Authorization</div>
              {purchaseTerms.map(t => (
                <p key={t.slug} className="text-xs text-gray-600 leading-relaxed mb-4">{t.content}</p>
              ))}
              <SignaturePad onSign={handleSignInvoice} />
              {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
            </div>

          </div>
        )}

        {/* Footer */}
        <div className="mt-10 text-center text-xs text-gray-400 pb-8">
          <p>Zenith Pure Solutions LLC · 6951 E 30th St, Suite B, Indianapolis, IN 46219</p>
          <p className="mt-1">(317) 690-4172 · info@zenithpuresolutions.com · zenithpuresolutions.com</p>
        </div>

      </div>
    </div>
  )
}
