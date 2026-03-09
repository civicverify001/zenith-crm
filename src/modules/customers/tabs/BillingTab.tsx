// src/modules/customers/tabs/BillingTab.tsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import {
  fetchPaymentMethods, fetchPaymentTransactions,
  createSetupIntent, confirmCardSetup, savePaymentMethod,
  updateStripeCustomerId, setDefaultPaymentMethod,
  removePaymentMethod, chargePaymentMethod, createInvoicePaymentLink,
  type PaymentMethod, type PaymentTransaction,
} from '../../../services/billingService'
import { useRentalContracts } from '../useCustomers'

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)

interface Props {
  customerId: string
  customer: any
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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

// ─── Add Card Form (inner, needs Stripe context) ─────────────
function AddCardForm({
  customerId,
  customer,
  onSuccess,
  onCancel,
}: {
  customerId: string
  customer: any
  onSuccess: () => void
  onCancel: () => void
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
      // 1. Create setup intent (creates Stripe customer if needed)
      const { client_secret, stripe_customer_id } = await createSetupIntent({
        stripe_customer_id: customer.stripe_customer_id || undefined,
        customer_name: customer.full_name,
        customer_email: customer.email || undefined,
      })

      // 2. Save stripe_customer_id to Supabase if new
      if (!customer.stripe_customer_id) {
        await updateStripeCustomerId(customerId, stripe_customer_id)
      }

      // 3. Confirm card setup with Stripe.js
      const setupIntent = await confirmCardSetup(client_secret, cardElement)

      // 4. Extract card details from payment method
      const pm = setupIntent?.payment_method as any
      const card = pm?.card || {}

      // 5. Save to Supabase payment_methods
      await savePaymentMethod({
        customer_id: customerId,
        stripe_payment_method_id: typeof pm === 'string' ? pm : pm?.id,
        last_four: card.last4 || '????',
        exp_month: card.exp_month || 0,
        exp_year: card.exp_year || 0,
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
      <div className="text-sm font-semibold text-slate-200">Add Payment Method</div>

      {/* Stripe Card Element */}
      <div className="rounded-lg px-3 py-3" style={{ backgroundColor: '#0f172a', border: '1px solid rgba(148,163,184,0.2)' }}>
        <CardElement options={CARD_ELEMENT_OPTIONS} />
      </div>

      {/* Make default */}
      <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
        <input
          type="checkbox"
          checked={makeDefault}
          onChange={e => setMakeDefault(e.target.checked)}
          className="rounded"
        />
        Set as default payment method
      </label>

      {error && (
        <div className="text-xs rounded-lg px-3 py-2" style={{ color: '#f87171', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={loading || !stripe}
          className="text-xs px-4 py-1.5 rounded-lg font-semibold transition-colors disabled:opacity-50"
          style={{ backgroundColor: 'rgba(96,165,250,0.15)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.3)' }}
        >
          {loading ? 'Saving...' : 'Save Card'}
        </button>
      </div>
    </div>
  )
}

// ─── Charge Modal ────────────────────────────────────────────
function ChargeModal({
  customer,
  paymentMethods,
  contracts,
  onClose,
  onSuccess,
}: {
  customer: any
  paymentMethods: PaymentMethod[]
  contracts: any[]
  onClose: () => void
  onSuccess: () => void
}) {
  const defaultPM = paymentMethods.find(p => p.is_default) || paymentMethods[0]
  const activeContract = contracts.find(c => c.status === 'active')

  const [selectedPMId, setSelectedPMId] = useState(defaultPM?.id || '')
  const [selectedContractId, setSelectedContractId] = useState(activeContract?.id || '')
  const [amount, setAmount] = useState(activeContract ? String(activeContract.monthly_amount) : '')
  const [description, setDescription] = useState(
    activeContract ? `Monthly rental — Contract ${activeContract.contract_number}` : ''
  )
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

        {/* Payment method select */}
        <div>
          <label className="text-xs text-muted uppercase tracking-wide block mb-1.5">Payment Method</label>
          <select
            value={selectedPMId}
            onChange={e => setSelectedPMId(e.target.value)}
            className="w-full text-sm rounded-lg px-3 py-2 outline-none"
            style={{ backgroundColor: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', color: '#e2e8f0' }}
          >
            {paymentMethods.map(pm => (
              <option key={pm.id} value={pm.id}>
                •••• {pm.last_four} — {pm.exp_month}/{pm.exp_year} {pm.is_default ? '(default)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Contract select */}
        {contracts.length > 0 && (
          <div>
            <label className="text-xs text-muted uppercase tracking-wide block mb-1.5">Contract (optional)</label>
            <select
              value={selectedContractId}
              onChange={e => {
                setSelectedContractId(e.target.value)
                const c = contracts.find(x => x.id === e.target.value)
                if (c) {
                  setAmount(String(c.monthly_amount))
                  setDescription(`Monthly rental — Contract ${c.contract_number}`)
                }
              }}
              className="w-full text-sm rounded-lg px-3 py-2 outline-none"
              style={{ backgroundColor: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', color: '#e2e8f0' }}
            >
              <option value="">No contract</option>
              {contracts.map(c => (
                <option key={c.id} value={c.id}>
                  {c.contract_number} — ${c.monthly_amount}/mo ({c.status})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Amount */}
        <div>
          <label className="text-xs text-muted uppercase tracking-wide block mb-1.5">Amount ($)</label>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="w-full text-sm rounded-lg px-3 py-2 outline-none"
            style={{ backgroundColor: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', color: '#e2e8f0' }}
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-xs text-muted uppercase tracking-wide block mb-1.5">Description</label>
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full text-sm rounded-lg px-3 py-2 outline-none"
            style={{ backgroundColor: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', color: '#e2e8f0' }}
          />
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
          <button
            onClick={handleCharge}
            disabled={loading || !selectedPMId || !amount || !customer.stripe_customer_id}
            className="text-xs px-4 py-1.5 rounded-lg font-semibold disabled:opacity-50"
            style={{ backgroundColor: 'rgba(74,222,128,0.15)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)' }}
          >
            {loading ? 'Charging...' : `Charge ${amount ? fmt(parseFloat(amount)) : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main BillingTab ─────────────────────────────────────────
export function BillingTab({ customerId, customer }: Props) {
  const qc = useQueryClient()
  const [showAddCard, setShowAddCard] = useState(false)
  const [showChargeModal, setShowChargeModal] = useState(false)
  const [generatingLink, setGeneratingLink] = useState(false)
  const [paymentLinkUrl, setPaymentLinkUrl] = useState('')
  const [linkError, setLinkError] = useState('')

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

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['payment-methods', customerId] })
    qc.invalidateQueries({ queryKey: ['payment-transactions', customerId] })
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

  const succeededTotal = transactions
    .filter(t => t.status === 'succeeded')
    .reduce((sum, t) => sum + Number(t.amount), 0)

  const failedRecent = transactions.filter(t => t.status === 'failed').slice(0, 3)

  return (
    <Elements stripe={stripePromise}>
      <div className="space-y-5">

        {/* ── Summary row ────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          <BillingStatCard
            label="Total Collected"
            value={fmt(succeededTotal)}
            color="#4ade80"
          />
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

        {/* ── Failed payment alert ───────────────────────── */}
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

        {/* ── Payment methods ────────────────────────────── */}
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-bold text-slate-300 uppercase tracking-wide">Payment Methods</div>
            <div className="flex gap-2">
              {paymentMethods.length > 0 && activeContract && (
                <button
                  onClick={() => setShowChargeModal(true)}
                  className="text-xs px-3 py-1 rounded-lg font-semibold"
                  style={{ backgroundColor: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)' }}
                >
                  💳 Charge
                </button>
              )}
              {!showAddCard && (
                <button
                  onClick={() => setShowAddCard(true)}
                  className="text-xs px-3 py-1 rounded-lg font-semibold"
                  style={{ backgroundColor: 'rgba(96,165,250,0.12)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.25)' }}
                >
                  + Add Card
                </button>
              )}
            </div>
          </div>

          {/* Add card form */}
          {showAddCard && (
            <div className="mb-3">
              <AddCardForm
                customerId={customerId}
                customer={customer}
                onSuccess={() => { setShowAddCard(false); invalidate() }}
                onCancel={() => setShowAddCard(false)}
              />
            </div>
          )}

          {/* Saved cards */}
          {pmLoading ? (
            <div className="text-xs text-muted py-3">Loading...</div>
          ) : paymentMethods.length === 0 ? (
            <div className="text-xs text-muted italic py-2">No payment methods on file</div>
          ) : (
            <div className="space-y-2">
              {paymentMethods.map(pm => (
                <PaymentMethodRow
                  key={pm.id}
                  pm={pm}
                  onSetDefault={async () => {
                    await setDefaultPaymentMethod(customerId, pm.id)
                    invalidate()
                  }}
                  onRemove={async () => {
                    await removePaymentMethod(pm.id)
                    invalidate()
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Invoice payment link ───────────────────────── */}
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
                  <button
                    onClick={() => { navigator.clipboard.writeText(paymentLinkUrl) }}
                    className="text-xs font-semibold flex-shrink-0"
                    style={{ color: '#4ade80' }}
                  >
                    Copy
                  </button>
                  <a href={paymentLinkUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs font-semibold flex-shrink-0" style={{ color: '#60a5fa' }}>
                    Open ↗
                  </a>
                </div>
                <button onClick={() => setPaymentLinkUrl('')} className="text-xs text-muted hover:text-slate-300">
                  Generate new link
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={handleGeneratePaymentLink}
                  disabled={generatingLink}
                  className="text-xs px-4 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                  style={{ backgroundColor: 'rgba(56,189,248,0.12)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.25)' }}
                >
                  {generatingLink ? 'Generating...' : '🔗 Generate Payment Link'}
                </button>
                {linkError && <p className="text-xs mt-2" style={{ color: '#f87171' }}>{linkError}</p>}
              </>
            )}
          </div>
        )}

        {/* ── Transaction history ────────────────────────── */}
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
              {transactions.map(tx => (
                <TransactionRow key={tx.id} tx={tx} />
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Charge modal */}
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
  pm: PaymentMethod
  onSetDefault: () => void
  onRemove: () => void
}) {
  return (
    <div
      className="flex items-center justify-between px-3 py-2.5 rounded-lg"
      style={{
        backgroundColor: pm.is_default ? 'rgba(96,165,250,0.08)' : 'rgba(148,163,184,0.05)',
        border: `1px solid ${pm.is_default ? 'rgba(96,165,250,0.2)' : 'rgba(148,163,184,0.12)'}`,
      }}
    >
      <div className="flex items-center gap-3">
        <span className="text-base">💳</span>
        <div>
          <div className="text-sm text-slate-200 font-medium">•••• {pm.last_four}</div>
          <div className="text-xs text-muted">Expires {pm.exp_month}/{pm.exp_year}</div>
        </div>
        {pm.is_default && (
          <span className="text-xs px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: 'rgba(96,165,250,0.15)', color: '#60a5fa' }}>
            Default
          </span>
        )}
      </div>
      <div className="flex gap-2">
        {!pm.is_default && (
          <button onClick={onSetDefault} className="text-xs text-muted hover:text-slate-200 transition-colors">
            Set default
          </button>
        )}
        <button onClick={onRemove} className="text-xs hover:text-red-400 transition-colors" style={{ color: '#64748b' }}>
          Remove
        </button>
      </div>
    </div>
  )
}

function TransactionRow({ tx }: { tx: PaymentTransaction }) {
  const statusColors: Record<string, string> = {
    succeeded: '#4ade80',
    failed: '#f87171',
    pending: '#fbbf24',
    refunded: '#94a3b8',
  }
  const color = statusColors[tx.status] || '#94a3b8'

  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: 'rgba(148,163,184,0.1)' }}>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-slate-300 truncate">{tx.description || 'Payment'}</div>
        <div className="text-xs text-muted">{new Date(tx.attempted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
      </div>
      <div className="text-right flex-shrink-0 ml-4">
        <div className="text-sm font-semibold" style={{ color }}>
          {tx.status === 'refunded' ? '-' : ''}{fmt(tx.amount)}
        </div>
        <div className="text-xs capitalize" style={{ color }}>{tx.status}</div>
      </div>
    </div>
  )
}
