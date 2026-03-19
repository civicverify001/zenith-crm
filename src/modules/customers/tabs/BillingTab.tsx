// src/modules/customers/tabs/BillingTab.tsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import {
  fetchPaymentMethods, fetchPaymentTransactions,
  createSetupIntent, savePaymentMethod,
  updateStripeCustomerId, setDefaultPaymentMethod,
  removePaymentMethod, chargePaymentMethod, createInvoicePaymentLink,
  type PaymentMethod, type PaymentTransaction,
} from '../../../services/billingService'
import { useRentalContracts } from '../useCustomers'
import { supabase } from '../../../lib/supabase'
import { usePermissions } from '../../../hooks/usePermissions'

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)

interface Props {
  customerId: string
  customer: any
}

function fmt(n: number) {
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
}

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

// ─── Add Card Form ───────────────────────────────────────────
function AddCardForm({
  customerId, customer, onSuccess, onCancel,
}: {
  customerId: string; customer: any; onSuccess: () => void; onCancel: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [makeDefault, setMakeDefault] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!stripe || !elements) return
    const cardElement = elements.getElement(CardElement)
    if (!cardElement) return
    setLoading(true)
    setError('')
    try {
      const { client_secret, stripe_customer_id } = await createSetupIntent({
        stripe_customer_id: customer.stripe_customer_id || undefined,
        customer_name: customer.full_name,
        customer_email: customer.email || undefined,
      })
      if (!customer.stripe_customer_id) {
        await updateStripeCustomerId(customerId, stripe_customer_id)
      }
      const result = await stripe.confirmCardSetup(client_secret, {
        payment_method: { card: cardElement },
      })
      if (result.error) throw new Error(result.error.message)

      const pmId = typeof result.setupIntent.payment_method === 'string'
        ? result.setupIntent.payment_method
        : (result.setupIntent.payment_method as any)?.id

      const pmDetailsRes = await fetch('/api/stripe/get-payment-method', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_method_id: pmId }),
      })
      const pmDetails = await pmDetailsRes.json()

      await savePaymentMethod({
        customer_id: customerId,
        stripe_payment_method_id: pmId,
        last_four: pmDetails.last4 || '????',
        exp_month: pmDetails.exp_month || 0,
        exp_year: pmDetails.exp_year || 0,
        make_default: makeDefault,
      })
      onSuccess()
    } catch (e: any) {
      setError(e.message || 'Failed to save card')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl p-4 space-y-4" style={{ backgroundColor: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)' }}>
      <div className="text-sm font-semibold text-slate-200">💳 Add Credit / Debit Card</div>
      <div className="rounded-lg px-3 py-3" style={{ backgroundColor: '#0f172a', border: '1px solid rgba(148,163,184,0.2)' }}>
        <CardElement options={CARD_ELEMENT_OPTIONS} />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
        <input type="checkbox" checked={makeDefault} onChange={e => setMakeDefault(e.target.checked)} className="rounded" />
        Set as default payment method
      </label>
      {error && (
        <div className="text-xs rounded-lg px-3 py-2" style={{ color: '#f87171', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 transition-colors">Cancel</button>
        <button onClick={handleSubmit} disabled={loading || !stripe} className="text-xs px-4 py-1.5 rounded-lg font-semibold transition-colors disabled:opacity-50"
          style={{ backgroundColor: 'rgba(96,165,250,0.15)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.3)' }}>
          {loading ? 'Saving...' : 'Save Card'}
        </button>
      </div>
    </div>
  )
}

// ─── Add Bank Account Form ───────────────────────────────────
function AddBankAccountForm({
  customerId, customer, onSuccess, onCancel,
}: {
  customerId: string; customer: any; onSuccess: () => void; onCancel: () => void
}) {
  const stripe = useStripe()
  const [makeDefault, setMakeDefault] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'choose' | 'manual' | 'pending_verification'>('choose')

  const [routingNumber, setRoutingNumber] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountType, setAccountType] = useState<'checking' | 'savings'>('checking')
  const [accountHolderName, setAccountHolderName] = useState(customer.full_name || '')

  const [clientSecretForVerify, setClientSecretForVerify] = useState('')
  const [savedPmId, setSavedPmId] = useState('')
  const [amount1, setAmount1] = useState('')
  const [amount2, setAmount2] = useState('')

  async function getBankSetupIntent() {
    const res = await fetch('/api/stripe/setup-bank-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stripe_customer_id: customer.stripe_customer_id || undefined,
        customer_name: customer.full_name,
        customer_email: customer.email || undefined,
      }),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    return data
  }

  async function handleFinancialConnections() {
    if (!stripe) return
    setLoading(true)
    setError('')
    try {
      const { client_secret, stripe_customer_id } = await getBankSetupIntent()
      if (!customer.stripe_customer_id) {
        await updateStripeCustomerId(customerId, stripe_customer_id)
      }

      const result = await stripe.collectBankAccountForSetup({
        clientSecret: client_secret,
        params: {
          payment_method_type: 'us_bank_account',
          payment_method_data: {
            billing_details: {
              name: customer.full_name,
              email: customer.email || undefined,
            },
          },
        },
      })

      if (result.error) throw new Error(result.error.message)
      if (result.setupIntent?.status === 'requires_confirmation') {
        const confirmed = await stripe.confirmUsBankAccountSetup(client_secret)
        if (confirmed.error) throw new Error(confirmed.error.message)
      }

      const pmId = typeof result.setupIntent?.payment_method === 'string'
        ? result.setupIntent.payment_method
        : (result.setupIntent?.payment_method as any)?.id

      const detailsRes = await fetch('/api/stripe/get-payment-method', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_method_id: pmId }),
      })
      const details = await detailsRes.json()

      await savePaymentMethod({
        customer_id: customerId,
        stripe_payment_method_id: pmId,
        last_four: details.last4 || '????',
        exp_month: 0,
        exp_year: 0,
        make_default: makeDefault,
        type: 'us_bank_account',
      })
      onSuccess()
    } catch (e: any) {
      setError(e.message || 'Bank connection failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleManualSubmit() {
    if (!stripe) return
    if (!routingNumber || !accountNumber || !accountHolderName) {
      setError('Please fill in all fields')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { client_secret, stripe_customer_id } = await getBankSetupIntent()
      if (!customer.stripe_customer_id) {
        await updateStripeCustomerId(customerId, stripe_customer_id)
      }

      const result = await stripe.confirmUsBankAccountSetup(client_secret, {
        payment_method: {
          us_bank_account: {
            routing_number: routingNumber,
            account_number: accountNumber,
            account_holder_type: 'individual',
            account_type: accountType,
          },
          billing_details: {
            name: accountHolderName,
            email: customer.email || undefined,
          },
        },
      })

      if (result.error) throw new Error(result.error.message)

      const pmId = typeof result.setupIntent?.payment_method === 'string'
        ? result.setupIntent.payment_method
        : (result.setupIntent?.payment_method as any)?.id

      await savePaymentMethod({
        customer_id: customerId,
        stripe_payment_method_id: pmId,
        last_four: accountNumber.slice(-4),
        exp_month: 0,
        exp_year: 0,
        make_default: false,
        type: 'us_bank_account',
        status: 'pending_verification',
      })

      setClientSecretForVerify(client_secret)
      setSavedPmId(pmId)
      setMode('pending_verification')
    } catch (e: any) {
      setError(e.message || 'Failed to add bank account')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyMicrodeposits() {
    if (!amount1 || !amount2) { setError('Enter both deposit amounts'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/stripe/verify-microdeposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_secret: clientSecretForVerify,
          amounts: [parseInt(amount1), parseInt(amount2)],
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      onSuccess()
    } catch (e: any) {
      setError(e.message || 'Verification failed — check your amounts')
    } finally {
      setLoading(false)
    }
  }

  if (mode === 'pending_verification') {
    return (
      <div className="rounded-xl p-4 space-y-4" style={{ backgroundColor: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.25)' }}>
        <div className="text-sm font-semibold text-slate-200">🏦 Verify Bank Account</div>
        <div className="text-xs text-slate-400">
          Stripe sent 2 small deposits to your bank account (usually appear within 1–2 business days).
          Enter the exact amounts in <span className="text-yellow-400 font-semibold">cents</span> to verify.
        </div>
        <div className="text-xs rounded-lg px-3 py-2" style={{ color: '#fbbf24', backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
          Example: if you see $0.32 and $0.45, enter 32 and 45
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted uppercase tracking-wide block mb-1">First deposit (cents)</label>
            <input type="number" value={amount1} onChange={e => setAmount1(e.target.value)} placeholder="32"
              className="w-full text-sm rounded-lg px-3 py-2 outline-none"
              style={{ backgroundColor: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', color: '#e2e8f0' }} />
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wide block mb-1">Second deposit (cents)</label>
            <input type="number" value={amount2} onChange={e => setAmount2(e.target.value)} placeholder="45"
              className="w-full text-sm rounded-lg px-3 py-2 outline-none"
              style={{ backgroundColor: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', color: '#e2e8f0' }} />
          </div>
        </div>
        {error && (
          <div className="text-xs rounded-lg px-3 py-2" style={{ color: '#f87171', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={handleVerifyMicrodeposits} disabled={loading}
            className="text-xs px-4 py-1.5 rounded-lg font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>
            {loading ? 'Verifying...' : 'Verify Account'}
          </button>
        </div>
      </div>
    )
  }

  if (mode === 'choose') {
    return (
      <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.2)' }}>
        <div className="text-sm font-semibold text-slate-200">🏦 Add Bank Account (ACH)</div>
        <div className="text-xs text-slate-400 mb-2">Lower fees than cards — 0.8% capped at $5/transaction</div>

        <button
          onClick={handleFinancialConnections}
          disabled={loading}
          className="w-full rounded-xl p-4 text-left transition-all disabled:opacity-50"
          style={{ backgroundColor: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.25)' }}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white">🔗 Connect via Bank Login</div>
              <div className="text-xs text-slate-400 mt-0.5">Instant — log into Chase, Wells Fargo, BofA and 5,000+ banks. No waiting.</div>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold ml-3 flex-shrink-0" style={{ backgroundColor: 'rgba(74,222,128,0.15)', color: '#4ade80' }}>
              Recommended
            </span>
          </div>
        </button>

        <button
          onClick={() => setMode('manual')}
          className="w-full rounded-xl p-4 text-left transition-all"
          style={{ backgroundColor: 'rgba(148,163,184,0.05)', border: '1px solid rgba(148,163,184,0.15)' }}
        >
          <div className="text-sm font-semibold text-white">✏️ Enter Routing & Account Number</div>
          <div className="text-xs text-slate-400 mt-0.5">Manual entry — requires 1–2 day micro-deposit verification</div>
        </button>

        {error && (
          <div className="text-xs rounded-lg px-3 py-2" style={{ color: '#f87171', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-200">Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl p-4 space-y-4" style={{ backgroundColor: 'rgba(148,163,184,0.05)', border: '1px solid rgba(148,163,184,0.15)' }}>
      <div className="flex items-center gap-2">
        <button onClick={() => setMode('choose')} className="text-xs text-slate-400 hover:text-slate-200">← Back</button>
        <div className="text-sm font-semibold text-slate-200">✏️ Manual Bank Entry</div>
      </div>

      <div>
        <label className="text-xs text-muted uppercase tracking-wide block mb-1">Account Holder Name</label>
        <input type="text" value={accountHolderName} onChange={e => setAccountHolderName(e.target.value)}
          className="w-full text-sm rounded-lg px-3 py-2 outline-none"
          style={{ backgroundColor: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', color: '#e2e8f0' }} />
      </div>

      <div>
        <label className="text-xs text-muted uppercase tracking-wide block mb-1">Routing Number</label>
        <input type="text" value={routingNumber} onChange={e => setRoutingNumber(e.target.value)}
          placeholder="9 digits" maxLength={9}
          className="w-full text-sm rounded-lg px-3 py-2 outline-none"
          style={{ backgroundColor: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', color: '#e2e8f0' }} />
      </div>

      <div>
        <label className="text-xs text-muted uppercase tracking-wide block mb-1">Account Number</label>
        <input type="text" value={accountNumber} onChange={e => setAccountNumber(e.target.value)}
          className="w-full text-sm rounded-lg px-3 py-2 outline-none"
          style={{ backgroundColor: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', color: '#e2e8f0' }} />
      </div>

      <div>
        <label className="text-xs text-muted uppercase tracking-wide block mb-1">Account Type</label>
        <div className="flex gap-2">
          {(['checking', 'savings'] as const).map(t => (
            <button key={t} onClick={() => setAccountType(t)}
              className="text-xs px-4 py-1.5 rounded-lg font-medium capitalize transition-all"
              style={{
                backgroundColor: accountType === t ? 'rgba(96,165,250,0.15)' : 'rgba(148,163,184,0.05)',
                color: accountType === t ? '#60a5fa' : '#94a3b8',
                border: `1px solid ${accountType === t ? 'rgba(96,165,250,0.3)' : 'rgba(148,163,184,0.15)'}`,
              }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
        <input type="checkbox" checked={makeDefault} onChange={e => setMakeDefault(e.target.checked)} className="rounded" />
        Set as default after verification
      </label>

      <div className="text-xs rounded-lg px-3 py-2" style={{ color: '#fbbf24', backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
        ⏱ Stripe will send 2 small deposits to verify this account (1–2 business days)
      </div>

      {error && (
        <div className="text-xs rounded-lg px-3 py-2" style={{ color: '#f87171', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-200">Cancel</button>
        <button onClick={handleManualSubmit} disabled={loading || !stripe}
          className="text-xs px-4 py-1.5 rounded-lg font-semibold disabled:opacity-50"
          style={{ backgroundColor: 'rgba(96,165,250,0.15)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.3)' }}>
          {loading ? 'Saving...' : 'Save & Send Micro-Deposits'}
        </button>
      </div>
    </div>
  )
}

// ─── Charge Modal ────────────────────────────────────────────
function ChargeModal({
  customer, paymentMethods, contracts, onClose, onSuccess,
}: {
  customer: any; paymentMethods: PaymentMethod[]; contracts: any[]; onClose: () => void; onSuccess: () => void
}) {
  const defaultPM = paymentMethods.find(p => p.is_default) || paymentMethods[0]
  const activeContract = contracts.find(c => c.status === 'active')
  const [selectedPMId, setSelectedPMId] = useState(defaultPM?.id || '')
  const [selectedContractId, setSelectedContractId] = useState(activeContract?.id || '')
  const [amount, setAmount] = useState(activeContract ? String(activeContract.monthly_amount) : '')
  const [description, setDescription] = useState(activeContract ? `Monthly rental — Contract ${activeContract.contract_number}` : '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const selectedPM = paymentMethods.find(p => p.id === selectedPMId)

  async function handleCharge() {
    if (!selectedPM || !amount || !customer.stripe_customer_id) return
    setLoading(true)
    setError('')
    try {
      await chargePaymentMethod({
        stripe_customer_id: customer.stripe_customer_id,
        payment_method_id: selectedPM.external_id,
        amount_cents: Math.round(parseFloat(amount) * 100),
        description,
        customer_id: customer.id,
        contract_id: selectedContractId || undefined,
        supabase_pm_id: selectedPM.id,
      })
      onSuccess()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-md rounded-2xl p-6 space-y-4" style={{ backgroundColor: '#1e293b', border: '1px solid rgba(148,163,184,0.15)' }}>
        <div className="flex items-center justify-between">
          <div className="text-base font-bold text-white">Charge Payment</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-xl">×</button>
        </div>
        <div>
          <label className="text-xs text-muted uppercase tracking-wide block mb-1.5">Payment Method</label>
          <select value={selectedPMId} onChange={e => setSelectedPMId(e.target.value)}
            className="w-full text-sm rounded-lg px-3 py-2 outline-none"
            style={{ backgroundColor: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', color: '#e2e8f0' }}>
            {paymentMethods.map(pm => (
              <option key={pm.id} value={pm.id}>
                {pm.type === 'us_bank_account' ? '🏦' : '💳'} •••• {pm.last_four}
                {pm.type === 'us_bank_account' ? ' (ACH)' : ` — ${pm.exp_month}/${pm.exp_year}`}
                {pm.is_default ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </div>
        {contracts.length > 0 && (
          <div>
            <label className="text-xs text-muted uppercase tracking-wide block mb-1.5">Contract (optional)</label>
            <select value={selectedContractId}
              onChange={e => {
                setSelectedContractId(e.target.value)
                const c = contracts.find(x => x.id === e.target.value)
                if (c) { setAmount(String(c.monthly_amount)); setDescription(`Monthly rental — Contract ${c.contract_number}`) }
              }}
              className="w-full text-sm rounded-lg px-3 py-2 outline-none"
              style={{ backgroundColor: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', color: '#e2e8f0' }}>
              <option value="">No contract</option>
              {contracts.map(c => (
                <option key={c.id} value={c.id}>{c.contract_number} — ${c.monthly_amount}/mo ({c.status})</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="text-xs text-muted uppercase tracking-wide block mb-1.5">Amount ($)</label>
          <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
            className="w-full text-sm rounded-lg px-3 py-2 outline-none"
            style={{ backgroundColor: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', color: '#e2e8f0' }} />
        </div>
        <div>
          <label className="text-xs text-muted uppercase tracking-wide block mb-1.5">Description</label>
          <input type="text" value={description} onChange={e => setDescription(e.target.value)}
            className="w-full text-sm rounded-lg px-3 py-2 outline-none"
            style={{ backgroundColor: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', color: '#e2e8f0' }} />
        </div>
        {!customer.stripe_customer_id && (
          <div className="text-xs rounded-lg px-3 py-2" style={{ color: '#fbbf24', backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
            ⚠️ No Stripe customer ID — save a payment method first
          </div>
        )}
        {error && (
          <div className="text-xs rounded-lg px-3 py-2" style={{ color: '#f87171', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            {error}
          </div>
        )}
        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={handleCharge} disabled={loading || !selectedPMId || !amount || !customer.stripe_customer_id}
            className="text-xs px-4 py-1.5 rounded-lg font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'rgba(74,222,128,0.15)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)' }}>
            {loading ? 'Charging...' : `Charge ${amount ? fmt(parseFloat(amount)) : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Upcoming Charges Helper (Gap 11) ────────────────────────
function getNextBillingDateFromDay(billingDay: number): string {
  const now = new Date()
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), billingDay)
  if (thisMonth > now) {
    return thisMonth.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, billingDay)
  return nextMonth.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Main BillingTab ─────────────────────────────────────────
export function BillingTab({ customerId, customer }: Props) {
  const qc = useQueryClient()
  const { role } = usePermissions()
  const canEditMonthly = role === 'admin' || role === 'frontdesk'
  const [addMode, setAddMode] = useState<null | 'card' | 'bank'>(null)
  const [showChargeModal, setShowChargeModal] = useState(false)
  const [generatingLink, setGeneratingLink] = useState(false)
  const [paymentLinkUrl, setPaymentLinkUrl] = useState('')
  const [linkError, setLinkError] = useState('')
  const [editingMonthly, setEditingMonthly] = useState(false)
  const [monthlyDraft, setMonthlyDraft] = useState('')
  const [monthlyLoading, setMonthlyLoading] = useState(false)
  const [monthlyError, setMonthlyError] = useState('')
  const [editingDay, setEditingDay] = useState(false)
  const [dayDraft, setDayDraft] = useState('')
  const [dayLoading, setDayLoading] = useState(false)
  const [dayError, setDayError] = useState('')
  // ── NEW: Plan price editing ──
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [planPriceDraft, setPlanPriceDraft] = useState('')
  const [planPriceLoading, setPlanPriceLoading] = useState(false)
  const [planPriceError, setPlanPriceError] = useState('')

  const { data: paymentMethods = [], isLoading: pmLoading } = useQuery({
    queryKey: ['payment-methods', customerId],
    queryFn: () => fetchPaymentMethods(customerId),
  })
  const { data: transactions = [], isLoading: txLoading } = useQuery({
    queryKey: ['payment-transactions', customerId],
    queryFn: () => fetchPaymentTransactions(customerId),
  })
  const { data: contracts = [] } = useRentalContracts(customerId)
  const activeContract = (contracts as any[]).find((c: any) => c.status === 'active')

  // GAP 11: Fetch active service plans for upcoming charges
  const { data: activePlans = [] } = useQuery({
    queryKey: ['active-service-plans', customerId],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('customer_service_plans')
          .select('id, price, billing_cycle, next_billing_date, status, plan_id, service_plans(name)')
          .eq('customer_id', customerId)
          .eq('status', 'active')
          .order('next_billing_date', { ascending: true })
        if (error) throw error
        return (data || []).map((row: any) => ({
          id: row.id,
          name: row.service_plans?.name || 'Service Plan',
          price: Number(row.price) || 0,
          billing_cycle: row.billing_cycle || 'monthly',
          next_billing_date: row.next_billing_date,
        }))
      } catch (e) {
        console.error('Failed to fetch active plans:', e)
        return []
      }
    },
  })

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['payment-methods', customerId] })
    qc.invalidateQueries({ queryKey: ['payment-transactions', customerId] })
    qc.invalidateQueries({ queryKey: ['rental-contracts', customerId] })
    qc.invalidateQueries({ queryKey: ['active-service-plans', customerId] })
  }

  async function saveMonthlyAmount() {
    if (!activeContract) return
    const parsed = parseFloat(monthlyDraft)
    if (isNaN(parsed) || parsed <= 0) { setMonthlyError('Enter a valid amount'); return }
    setMonthlyLoading(true); setMonthlyError('')
    try {
      const { error: e1 } = await supabase
        .from('contracts')
        .update({ monthly_amount: parsed })
        .eq('id', activeContract.id)
      if (e1) throw e1

      await supabase
        .from('installed_systems')
        .update({ monthly_amount_snapshot: parsed })
        .eq('customer_id', customerId)
        .eq('is_active', true)

      setEditingMonthly(false)
      invalidate()
    } catch (e: any) {
      setMonthlyError(e.message || 'Failed to save')
    } finally {
      setMonthlyLoading(false)
    }
  }

  async function saveBillingDay() {
    if (!activeContract) return
    const parsed = parseInt(dayDraft, 10)
    if (isNaN(parsed) || parsed < 1 || parsed > 31) { setDayError('Enter a day between 1 and 31'); return }
    setDayLoading(true); setDayError('')
    try {
      const { error } = await supabase
        .from('contracts')
        .update({ billing_day: parsed })
        .eq('id', activeContract.id)
      if (error) throw error
      setEditingDay(false)
      invalidate()
    } catch (e: any) {
      setDayError(e.message || 'Failed to save')
    } finally {
      setDayLoading(false)
    }
  }

  // ── NEW: Save plan price ──────────────────────────────────
  async function savePlanPrice(planId: string) {
    const parsed = parseFloat(planPriceDraft)
    if (isNaN(parsed) || parsed < 0) { setPlanPriceError('Enter a valid amount'); return }
    setPlanPriceLoading(true); setPlanPriceError('')
    try {
      const { error } = await supabase
        .from('customer_service_plans')
        .update({ price: parsed })
        .eq('id', planId)
      if (error) throw error
      setEditingPlanId(null)
      invalidate()
    } catch (e: any) {
      setPlanPriceError(e.message || 'Failed to save')
    } finally {
      setPlanPriceLoading(false)
    }
  }

  async function handleGeneratePaymentLink() {
    if (!activeContract) return
    setGeneratingLink(true)
    setLinkError('')
    setPaymentLinkUrl('')
    try {
      const { url } = await createInvoicePaymentLink({
        amount_cents: Math.round(activeContract.monthly_amount * 100),
        description: `Monthly rental — Contract ${activeContract.contract_number}`,
        customer_name: customer.full_name,
        contract_number: activeContract.contract_number,
        customer_id: customerId,
        contract_id: activeContract.id,
      })
      setPaymentLinkUrl(url)
    } catch (e: any) {
      setLinkError(e.message)
    } finally {
      setGeneratingLink(false)
    }
  }

  const succeededTotal = transactions.filter(t => t.status === 'succeeded').reduce((sum, t) => sum + Number(t.amount), 0)
  const failedRecent = transactions.filter(t => t.status === 'failed').slice(0, 3)

  // GAP 11: Compute upcoming charges list — now with planId for editing
  const upcomingCharges: { label: string; amount: number; date: string; type: 'rental' | 'plan'; planId?: string }[] = []

  if (activeContract?.monthly_amount && activeContract?.billing_day) {
    upcomingCharges.push({
      label: `Rental — ${activeContract.contract_number}`,
      amount: activeContract.monthly_amount,
      date: getNextBillingDateFromDay(activeContract.billing_day),
      type: 'rental',
    })
  }

  for (const plan of activePlans) {
    if (plan.price > 0) {
      upcomingCharges.push({
        label: plan.name,
        amount: plan.price,
        date: plan.next_billing_date
          ? new Date(plan.next_billing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : 'TBD',
        type: 'plan',
        planId: plan.id,
      })
    }
  }

  upcomingCharges.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  const totalUpcoming = upcomingCharges.reduce((s, c) => s + c.amount, 0)

  return (
    <Elements stripe={stripePromise}>
      <div className="space-y-5">

        {/* ── Summary ─────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          <BillingStatCard label="Total Collected" value={fmt(succeededTotal)} color="#4ade80" />
          <BillingStatCard
            label="Payment Methods"
            value={String(paymentMethods.length)}
            color="#60a5fa"
            sub={paymentMethods.find(p => p.is_default) ? `•••• ${paymentMethods.find(p => p.is_default)!.last_four} default` : 'None on file'}
          />
          <BillingStatCard
            label="Failed (recent)"
            value={String(failedRecent.length)}
            color={failedRecent.length > 0 ? '#f87171' : '#4ade80'}
            sub={failedRecent.length > 0 ? 'Action required' : 'All clear'}
          />
        </div>

        {/* ── Failed alert ─────────────────────────────────── */}
        {failedRecent.length > 0 && (
          <div className="rounded-xl p-4 space-y-2" style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <div className="text-xs font-bold uppercase tracking-wide" style={{ color: '#f87171' }}>⚠️ Recent Failed Payments</div>
            {failedRecent.map(tx => (
              <div key={tx.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-300">{tx.description || 'Payment'}</span>
                <span style={{ color: '#f87171' }}>{fmt(tx.amount)} — {tx.failure_reason || 'failed'}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Billing Plan ─────────────────────────────────── */}
        {activeContract && (
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-bold text-slate-300 uppercase tracking-wide">Billing Plan</div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{
                  backgroundColor: activeContract.status === 'active' ? 'rgba(74,222,128,0.12)' : 'rgba(239,68,68,0.12)',
                  color: activeContract.status === 'active' ? '#4ade80' : '#f87171',
                  border: `1px solid ${activeContract.status === 'active' ? 'rgba(74,222,128,0.25)' : 'rgba(239,68,68,0.25)'}`,
                }}>
                  {activeContract.status === 'active' ? 'Active' : activeContract.status}
                </span>

                {canEditMonthly && (
                  activeContract.status === 'active' ? (
                    <button
                      onClick={async () => {
                        if (!confirm('Deactivate this contract? Autopay will stop.')) return
                        await supabase
                          .from('contracts')
                          .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
                          .eq('id', activeContract.id)
                        invalidate()
                      }}
                      className="text-xs px-2 py-0.5 rounded-lg font-semibold transition-colors"
                      style={{ backgroundColor: 'rgba(239,68,68,0.10)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>
                      Deactivate
                    </button>
                  ) : (
                    <button
                      onClick={async () => {
                        await supabase
                          .from('contracts')
                          .update({ status: 'active', signed_at: new Date().toISOString() })
                          .eq('id', activeContract.id)
                        invalidate()
                      }}
                      className="text-xs px-2 py-0.5 rounded-lg font-semibold transition-colors"
                      style={{ backgroundColor: 'rgba(74,222,128,0.10)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)' }}>
                      Activate
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Contract</span>
                <span className="text-slate-200 font-medium">{activeContract.contract_number}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Start date</span>
                <span className="text-slate-200 font-medium">
                  {activeContract.start_date
                    ? new Date(activeContract.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">End date</span>
                <span className="text-slate-200 font-medium">
                  {activeContract.end_date
                    ? new Date(activeContract.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : '—'}
                </span>
              </div>

              {/* Billing day */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Charges on</span>
                {editingDay ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min={1} max={31} value={dayDraft}
                      onChange={e => setDayDraft(e.target.value)} autoFocus
                      className="w-14 text-sm rounded-lg px-2 py-1 outline-none text-right"
                      style={{ backgroundColor: '#0f172a', border: '1px solid rgba(96,165,250,0.4)', color: '#e2e8f0' }}
                    />
                    <span className="text-slate-400">of month</span>
                    <button onClick={saveBillingDay} disabled={dayLoading}
                      className="text-xs px-2 py-1 rounded-lg font-semibold disabled:opacity-50"
                      style={{ backgroundColor: 'rgba(74,222,128,0.15)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)' }}>
                      {dayLoading ? '…' : 'Save'}
                    </button>
                    <button onClick={() => { setEditingDay(false); setDayError('') }}
                      className="text-xs text-slate-400 hover:text-slate-200">Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-200 font-medium">
                      {activeContract.billing_day
                        ? `${activeContract.billing_day === 1 ? '1st' : activeContract.billing_day === 2 ? '2nd' : activeContract.billing_day === 3 ? '3rd' : `${activeContract.billing_day}th`} of each month`
                        : 'Not set'}
                    </span>
                    {canEditMonthly && (
                      <button
                        onClick={() => { setDayDraft(String(activeContract.billing_day ?? '')); setEditingDay(true); setDayError('') }}
                        className="text-muted hover:text-slate-300 transition-colors" title="Edit billing day" style={{ lineHeight: 1 }}>
                        ✏️
                      </button>
                    )}
                  </div>
                )}
              </div>
              {dayError && (
                <div className="text-xs rounded-lg px-2 py-1" style={{ color: '#f87171', backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  {dayError}
                </div>
              )}

              {/* Monthly amount */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Monthly amount</span>
                {editingMonthly ? (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">$</span>
                    <input
                      type="number" step="0.01" value={monthlyDraft}
                      onChange={e => setMonthlyDraft(e.target.value)} autoFocus
                      className="w-20 text-sm rounded-lg px-2 py-1 outline-none text-right"
                      style={{ backgroundColor: '#0f172a', border: '1px solid rgba(96,165,250,0.4)', color: '#e2e8f0' }}
                    />
                    <button onClick={saveMonthlyAmount} disabled={monthlyLoading}
                      className="text-xs px-2 py-1 rounded-lg font-semibold disabled:opacity-50"
                      style={{ backgroundColor: 'rgba(74,222,128,0.15)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)' }}>
                      {monthlyLoading ? '…' : 'Save'}
                    </button>
                    <button onClick={() => { setEditingMonthly(false); setMonthlyError('') }}
                      className="text-xs text-slate-400 hover:text-slate-200">Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-white font-semibold">{fmt(activeContract.monthly_amount)}/mo</span>
                    {canEditMonthly && (
                      <button
                        onClick={() => { setMonthlyDraft(String(activeContract.monthly_amount)); setEditingMonthly(true); setMonthlyError('') }}
                        className="text-muted hover:text-slate-300 transition-colors" title="Edit monthly amount" style={{ lineHeight: 1 }}>
                        ✏️
                      </button>
                    )}
                  </div>
                )}
              </div>
              {monthlyError && (
                <div className="text-xs rounded-lg px-2 py-1" style={{ color: '#f87171', backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  {monthlyError}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── GAP 11: Upcoming Charges — with editable plan prices ── */}
        {upcomingCharges.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-bold text-slate-300 uppercase tracking-wide">Upcoming Charges</div>
              <div className="text-xs font-semibold" style={{ color: '#fbbf24' }}>
                {fmt(totalUpcoming)}/mo total
              </div>
            </div>
            <div className="space-y-2">
              {upcomingCharges.map((charge, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b last:border-0" style={{ borderColor: 'rgba(148,163,184,0.08)' }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs flex-shrink-0" style={{ color: charge.type === 'rental' ? '#0ea5e9' : '#a855f7' }}>
                      {charge.type === 'rental' ? '📄' : '🔧'}
                    </span>
                    <span className="text-xs truncate" style={{ color: '#e2e8f0' }}>{charge.label}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                    <span className="text-xs" style={{ color: '#64748b' }}>{charge.date}</span>
                    {charge.type === 'plan' && charge.planId && editingPlanId === charge.planId ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-slate-400">$</span>
                        <input
                          type="number" step="0.01" value={planPriceDraft}
                          onChange={e => setPlanPriceDraft(e.target.value)}
                          autoFocus
                          className="w-16 text-xs rounded px-1.5 py-0.5 outline-none text-right"
                          style={{ backgroundColor: '#0f172a', border: '1px solid rgba(168,85,247,0.4)', color: '#e2e8f0' }}
                        />
                        <button
                          onClick={() => savePlanPrice(charge.planId!)}
                          disabled={planPriceLoading}
                          className="text-xs px-1.5 py-0.5 rounded font-semibold disabled:opacity-50"
                          style={{ backgroundColor: 'rgba(74,222,128,0.15)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)' }}>
                          {planPriceLoading ? '…' : 'Save'}
                        </button>
                        <button onClick={() => { setEditingPlanId(null); setPlanPriceError('') }}
                          className="text-xs text-slate-400 hover:text-slate-200">✕</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold" style={{ color: charge.type === 'rental' ? '#0ea5e9' : '#a855f7' }}>
                          {fmt(charge.amount)}
                        </span>
                        {charge.type === 'plan' && charge.planId && canEditMonthly && (
                          <button
                            onClick={() => { setPlanPriceDraft(String(charge.amount)); setEditingPlanId(charge.planId!); setPlanPriceError('') }}
                            className="text-muted hover:text-slate-300 transition-colors"
                            title="Edit plan price" style={{ lineHeight: 1, fontSize: 11 }}>
                            ✏️
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {planPriceError && (
                <div className="text-xs rounded px-2 py-1 mt-1" style={{ color: '#f87171', backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  {planPriceError}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Payment methods ──────────────────────────────── */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-bold text-slate-300 uppercase tracking-wide">Payment Methods</div>
            <div className="flex gap-2">
              {paymentMethods.length > 0 && activeContract && (
                <button onClick={() => setShowChargeModal(true)}
                  className="text-xs px-3 py-1 rounded-lg font-semibold"
                  style={{ backgroundColor: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)' }}>
                  💳 Charge
                </button>
              )}
              {!addMode && (
                <>
                  <button onClick={() => setAddMode('bank')}
                    className="text-xs px-3 py-1 rounded-lg font-semibold"
                    style={{ backgroundColor: 'rgba(74,222,128,0.10)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.22)' }}>
                    + Bank (ACH)
                  </button>
                  <button onClick={() => setAddMode('card')}
                    className="text-xs px-3 py-1 rounded-lg font-semibold"
                    style={{ backgroundColor: 'rgba(96,165,250,0.12)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.25)' }}>
                    + Card
                  </button>
                </>
              )}
            </div>
          </div>

          {addMode === 'card' && (
            <div className="mb-3">
              <AddCardForm customerId={customerId} customer={customer}
                onSuccess={() => { setAddMode(null); invalidate() }}
                onCancel={() => setAddMode(null)} />
            </div>
          )}
          {addMode === 'bank' && (
            <div className="mb-3">
              <AddBankAccountForm customerId={customerId} customer={customer}
                onSuccess={() => { setAddMode(null); invalidate() }}
                onCancel={() => setAddMode(null)} />
            </div>
          )}

          {pmLoading ? (
            <div className="text-xs text-muted py-3">Loading...</div>
          ) : paymentMethods.length === 0 ? (
            <div className="text-xs text-muted italic py-2">No payment methods on file</div>
          ) : (
            <div className="space-y-2">
              {paymentMethods.map(pm => (
                <PaymentMethodRow key={pm.id} pm={pm}
                  onSetDefault={async () => { await setDefaultPaymentMethod(customerId, pm.id); invalidate() }}
                  onRemove={async () => { await removePaymentMethod(pm.id); invalidate() }} />
              ))}
            </div>
          )}
        </div>

        {/* ── Invoice payment link ─────────────────────────── */}
        {activeContract && (
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-xs font-bold text-slate-300 uppercase tracking-wide mb-3">Invoice Payment Link</div>
            <p className="text-xs text-slate-400 mb-3">
              Generate a Stripe-hosted payment link for {fmt(activeContract.monthly_amount)} — Contract {activeContract.contract_number}
            </p>
            {paymentLinkUrl ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}>
                  <span className="text-xs text-slate-300 truncate flex-1">{paymentLinkUrl}</span>
                  <button onClick={() => navigator.clipboard.writeText(paymentLinkUrl)} className="text-xs font-semibold flex-shrink-0" style={{ color: '#4ade80' }}>Copy</button>
                  <a href={paymentLinkUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold flex-shrink-0" style={{ color: '#60a5fa' }}>Open ↗</a>
                </div>
                <button onClick={() => setPaymentLinkUrl('')} className="text-xs text-muted hover:text-slate-300">Generate new link</button>
              </div>
            ) : (
              <>
                <button onClick={handleGeneratePaymentLink} disabled={generatingLink}
                  className="text-xs px-4 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                  style={{ backgroundColor: 'rgba(56,189,248,0.12)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.25)' }}>
                  {generatingLink ? 'Generating...' : '🔗 Generate Payment Link'}
                </button>
                {linkError && <p className="text-xs mt-2" style={{ color: '#f87171' }}>{linkError}</p>}
              </>
            )}
          </div>
        )}

        {/* ── Transaction history ──────────────────────────── */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-xs font-bold text-slate-300 uppercase tracking-wide mb-3">
            Transaction History {transactions.length > 0 && <span className="text-muted font-normal">({transactions.length})</span>}
          </div>
          {txLoading ? (
            <div className="text-xs text-muted py-3">Loading...</div>
          ) : transactions.length === 0 ? (
            <div className="text-xs text-muted italic">No transactions yet</div>
          ) : (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {transactions.map(tx => <TransactionRow key={tx.id} tx={tx} />)}
            </div>
          )}
        </div>
      </div>

      {showChargeModal && (
        <ChargeModal
          customer={customer}
          paymentMethods={paymentMethods}
          contracts={contracts as any[]}
          onClose={() => setShowChargeModal(false)}
          onSuccess={() => { setShowChargeModal(false); invalidate() }}
        />
      )}
    </Elements>
  )
}

// ─── Sub-components ──────────────────────────────────────────

function BillingStatCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="text-xs text-muted uppercase tracking-wide mb-1">{label}</div>
      <div className="text-lg font-bold" style={{ color }}>{value}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </div>
  )
}

function PaymentMethodRow({ pm, onSetDefault, onRemove }: {
  pm: PaymentMethod; onSetDefault: () => void; onRemove: () => void
}) {
  const isBank = pm.type === 'us_bank_account'
  const isPending = (pm as any).status === 'pending_verification'
  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg"
      style={{
        backgroundColor: pm.is_default ? 'rgba(96,165,250,0.08)' : 'rgba(148,163,184,0.05)',
        border: `1px solid ${isPending ? 'rgba(251,191,36,0.3)' : pm.is_default ? 'rgba(96,165,250,0.2)' : 'rgba(148,163,184,0.12)'}`,
      }}>
      <div className="flex items-center gap-3">
        <span className="text-base">{isBank ? '🏦' : '💳'}</span>
        <div>
          <div className="text-sm text-slate-200 font-medium">•••• {pm.last_four}</div>
          <div className="text-xs text-muted">
            {isBank ? 'ACH Bank Account' : `Expires ${pm.exp_month}/${pm.exp_year}`}
          </div>
        </div>
        {pm.is_default && !isPending && (
          <span className="text-xs px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: 'rgba(96,165,250,0.15)', color: '#60a5fa' }}>Default</span>
        )}
        {isPending && (
          <span className="text-xs px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>Pending Verification</span>
        )}
      </div>
      <div className="flex gap-2">
        {!pm.is_default && !isPending && (
          <button onClick={onSetDefault} className="text-xs text-muted hover:text-slate-200 transition-colors">Set default</button>
        )}
        <button onClick={onRemove} className="text-xs hover:text-red-400 transition-colors" style={{ color: '#64748b' }}>Remove</button>
      </div>
    </div>
  )
}

function TransactionRow({ tx }: { tx: PaymentTransaction }) {
  const statusColors: Record<string, string> = {
    succeeded: '#4ade80', failed: '#f87171', pending: '#fbbf24', refunded: '#94a3b8',
  }
  const color = statusColors[tx.status] || '#94a3b8'
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: 'rgba(148,163,184,0.1)' }}>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-slate-300 truncate">{tx.description || 'Payment'}</div>
        <div className="text-xs text-muted">{new Date(tx.attempted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
      </div>
      <div className="text-right flex-shrink-0 ml-4">
        <div className="text-sm font-semibold" style={{ color }}>{tx.status === 'refunded' ? '-' : ''}{fmt(tx.amount)}</div>
        <div className="text-xs capitalize" style={{ color }}>{tx.status}</div>
      </div>
    </div>
  )
}
