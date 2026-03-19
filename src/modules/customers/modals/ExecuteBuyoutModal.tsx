// src/modules/customers/modals/ExecuteBuyoutModal.tsx
// Full buyout execution flow:
// 1. Buyout statement (read-only)
// 2. Service plans management (keep/cancel/add)
// 3. Generate invoice → payment link → email/SMS send

import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../hooks/useAuth'

interface Props {
  contract: any
  customerId: string
  calculation: any  // buyout_calculation record
  onClose: () => void
  onInvoiceGenerated?: () => void
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n))
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function ExecuteBuyoutModal({ contract, customerId, calculation, onClose, onInvoiceGenerated }: Props) {
  const { profile } = useAuth()

  // Data
  const [installedSystem, setInstalledSystem] = useState<any>(null)
  const [warranty, setWarranty] = useState<any>(null)
  const [activePlans, setActivePlans] = useState<any[]>([])
  const [catalogPlans, setCatalogPlans] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Plan management: which existing plans to keep (true) or cancel (false)
  const [planKeep, setPlanKeep] = useState<Record<string, boolean>>({})
  // New plans to add from catalog: { [plan_id]: { price, billing_cycle } }
  const [plansToAdd, setPlansToAdd] = useState<Record<string, { price: number; billing_cycle: string }>>({})

  // Invoice generation
  const [generating, setGenerating] = useState(false)
  const [invoiceResult, setInvoiceResult] = useState<{
    invoice_id: string
    invoice_number: string
    payment_link_url: string
  } | null>(null)
  const [genError, setGenError] = useState('')

  // Email/SMS sending
  const [sendingEmail, setSendingEmail] = useState(false)
  const [sendingSms, setSendingSms] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [smsSent, setSmsSent] = useState(false)
  const [copied, setCopied] = useState(false)

  // Load data
  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        // Installed system
        const { data: sys } = await supabase
          .from('installed_systems')
          .select('*')
          .eq('customer_id', customerId)
          .eq('ownership_type', 'rented')
          .eq('is_active', true)
          .limit(1)
          .maybeSingle()
        setInstalledSystem(sys)

        // Warranty
        if (sys?.id) {
          const { data: war } = await supabase
            .from('warranty_records')
            .select('*')
            .eq('installed_system_id', sys.id)
            .eq('warranty_status', 'valid')
            .limit(1)
            .maybeSingle()
          setWarranty(war)
        }

        // Active service plans
        const { data: plans } = await supabase
          .from('customer_service_plans')
          .select('id, price, billing_cycle, status, service_plans(name, fulfillment_type)')
          .eq('customer_id', customerId)
          .eq('status', 'active')
        const planList = plans || []
        setActivePlans(planList)
        // Default: keep all active plans
        const keepMap: Record<string, boolean> = {}
        planList.forEach((p: any) => { keepMap[p.id] = true })
        setPlanKeep(keepMap)

        // Catalog plans (for adding new ones)
        const { data: catalog } = await supabase
          .from('service_plans')
          .select('id, name, price, billing_cycle, fulfillment_type')
          .eq('is_active', true)
          .order('name')
        setCatalogPlans(catalog || [])

      } catch (e) {
        console.error('ExecuteBuyoutModal load error:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [customerId])

  // Build line items for invoice
  function buildLineItems() {
    const items: any[] = []

    // Product line
    if (installedSystem) {
      items.push({
        description: `${installedSystem.name_snapshot || 'Water System'}${installedSystem.sku_snapshot ? ` (${installedSystem.sku_snapshot})` : ''}`,
        quantity: 1,
        unit_price: Number(calculation.current_retail_total) || 0,
        total: Number(calculation.current_retail_total) || 0,
        item_type: 'buyout_product',
      })
    }

    // Rental credit (negative)
    const rentalCredit = Number(calculation.applied_rental_credit) || 0
    if (rentalCredit > 0) {
      items.push({
        description: `Rental Payment Credit (${calculation.payments_made_count || 0} payments × 50%)`,
        quantity: 1,
        unit_price: -rentalCredit,
        total: -rentalCredit,
        item_type: 'credit',
      })
    }

    // Install fee credit (negative)
    const installCredit = Number(calculation.install_reimbursement) || 0
    if (installCredit > 0) {
      items.push({
        description: 'Installation Fee Credit (100%)',
        quantity: 1,
        unit_price: -installCredit,
        total: -installCredit,
        item_type: 'credit',
      })
    }

    // Continuing service plans
    activePlans.filter(p => planKeep[p.id]).forEach(p => {
      items.push({
        description: `${p.service_plans?.name || 'Service Plan'} — Continuing after buyout`,
        quantity: 1,
        unit_price: Number(p.price) || 0,
        total: 0, // Plans don't add to buyout total — they continue separately
        item_type: 'service_plan',
        billing_cycle: p.billing_cycle,
      })
    })

    // New plans being added
    Object.entries(plansToAdd).forEach(([planId, { price, billing_cycle }]) => {
      const plan = catalogPlans.find(p => p.id === planId)
      if (plan) {
        items.push({
          description: `${plan.name} — New plan added at buyout`,
          quantity: 1,
          unit_price: price,
          total: 0,
          item_type: 'service_plan',
          billing_cycle,
        })
      }
    })

    return items
  }

  const buyoutTotal = Number(calculation.buyout_price) || 0
  const plansCancelling = activePlans.filter(p => !planKeep[p.id])
  const plansKeeping = activePlans.filter(p => planKeep[p.id])
  const newPlansActivating = Object.entries(plansToAdd).map(([planId, { price, billing_cycle }]) => {
    const plan = catalogPlans.find(p => p.id === planId)
    return { plan_id: planId, price, billing_cycle, name: plan?.name }
  })

  async function handleGenerateInvoice() {
    setGenerating(true)
    setGenError('')
    try {
      const lineItems = buildLineItems()

      const res = await fetch('/api/stripe/buyout-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contract_id:       contract.id,
          customer_id:       customerId,
          calculation_id:    calculation.id,
          line_items:        lineItems,
          subtotal:          buyoutTotal,
          total:             buyoutTotal,
          notes:             `Equipment buyout — Contract ${contract.contract_number}`,
          plans_to_cancel:   plansCancelling.map(p => p.id),
          plans_to_activate: newPlansActivating,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Invoice generation failed')

      setInvoiceResult(data)
      onInvoiceGenerated?.()
    } catch (e: any) {
      setGenError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  async function handleSendEmail() {
    if (!invoiceResult) return
    setSendingEmail(true)
    try {
      const res = await fetch('/api/email/send-buyout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId:      invoiceResult.invoice_id,
          senderName:     profile?.full_name || 'Zenith Pure Solutions',
          paymentLinkUrl: invoiceResult.payment_link_url,
          systemName:     installedSystem?.name_snapshot,
          warrantyDetails: warranty ? {
            parts_end_date: warranty.parts_end_date,
            labor_end_date: warranty.labor_end_date,
          } : null,
        }),
      })
      if (!res.ok) throw new Error('Email send failed')
      setEmailSent(true)
    } catch (e: any) {
      alert('Email failed: ' + e.message)
    } finally {
      setSendingEmail(false)
    }
  }

  async function handleSendSms() {
    // Opens SMS app with pre-filled message — real SMS needs OpenPhone/JustCall integration
    const { data: customer } = await supabase
      .from('customers')
      .select('phone, full_name')
      .eq('id', customerId)
      .single()

    const phone = customer?.phone?.replace(/\D/g, '') || ''
    const msg = encodeURIComponent(
      `Hi ${customer?.full_name || 'there'}, your equipment buyout invoice from Zenith Pure Solutions is ready. ` +
      `Click here to pay ${fmt(buyoutTotal)}: ${invoiceResult?.payment_link_url}`
    )
    window.open(`sms:${phone}?body=${msg}`, '_blank')
    setSmsSent(true)
  }

  function handleCopy() {
    if (!invoiceResult?.payment_link_url) return
    navigator.clipboard.writeText(invoiceResult.payment_link_url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}>
        <div style={{ color: '#64748b', fontSize: 14 }}>Loading buyout details...</div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}>
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl flex flex-col"
        style={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid #334155', background: '#162232' }}>
          <div>
            <h2 className="text-lg font-bold text-white">Execute Buyout</h2>
            <p className="text-sm mt-0.5" style={{ color: '#94a3b8' }}>
              Contract {contract.contract_number} · {installedSystem?.name_snapshot || 'Water System'}
            </p>
          </div>
          <button onClick={onClose} style={{ color: '#64748b', fontSize: 22, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        <div className="p-6 space-y-6">

          {/* ── Section 1: Buyout Statement ── */}
          <div style={{ background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.25)', borderRadius: 14, padding: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#0ea5e9', margin: '0 0 16px' }}>
              📋 Buyout Statement
            </p>

            {/* Product */}
            {installedSystem && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid rgba(14,165,233,0.15)' }}>
                <div>
                  <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>{installedSystem.name_snapshot}</div>
                  {installedSystem.sku_snapshot && (
                    <div style={{ color: '#64748b', fontSize: 11, fontFamily: 'monospace', marginTop: 2 }}>{installedSystem.sku_snapshot}</div>
                  )}
                  {warranty && (
                    <div style={{ color: '#60a5fa', fontSize: 11, marginTop: 4 }}>
                      🛡 Parts warranty until {fmtDate(warranty.parts_end_date)} · Labor until {fmtDate(warranty.labor_end_date)}
                    </div>
                  )}
                </div>
                <div style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 700 }}>{fmt(calculation.current_retail_total)}</div>
              </div>
            )}

            {/* Credits */}
            {Number(calculation.applied_rental_credit) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: '#94a3b8', fontSize: 13 }}>Rental credit ({calculation.payments_made_count} payments × 50%)</span>
                <span style={{ color: '#4ade80', fontSize: 13, fontWeight: 600 }}>– {fmt(calculation.applied_rental_credit)}</span>
              </div>
            )}
            {Number(calculation.install_reimbursement) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: '#94a3b8', fontSize: 13 }}>Install fee credit (100%)</span>
                <span style={{ color: '#4ade80', fontSize: 13, fontWeight: 600 }}>– {fmt(calculation.install_reimbursement)}</span>
              </div>
            )}

            {/* Divider + total */}
            <div style={{ borderTop: '1px solid rgba(14,165,233,0.2)', marginTop: 12, paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>Balance Due</span>
              <span style={{ fontSize: 26, fontWeight: 800, color: '#0ea5e9' }}>{fmt(buyoutTotal)}</span>
            </div>
          </div>

          {/* ── Section 2: Service Plans ── */}
          <div style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.25)', borderRadius: 14, padding: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#c084fc', margin: '0 0 14px' }}>
              🔧 Service Plans After Buyout
            </p>

            {/* Existing plans */}
            {activePlans.length > 0 && (
              <div className="space-y-2 mb-4">
                <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px', fontWeight: 600 }}>CURRENT ACTIVE PLANS</p>
                {activePlans.map(plan => (
                  <div key={plan.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', borderRadius: 10,
                    background: planKeep[plan.id] ? 'rgba(74,222,128,0.08)' : 'rgba(239,68,68,0.08)',
                    border: `1px solid ${planKeep[plan.id] ? 'rgba(74,222,128,0.2)' : 'rgba(239,68,68,0.2)'}`,
                  }}>
                    <div>
                      <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{plan.service_plans?.name || 'Service Plan'}</div>
                      <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{fmt(plan.price)}/{plan.billing_cycle}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => setPlanKeep(prev => ({ ...prev, [plan.id]: true }))}
                        style={{
                          padding: '4px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                          background: planKeep[plan.id] ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${planKeep[plan.id] ? 'rgba(74,222,128,0.4)' : '#334155'}`,
                          color: planKeep[plan.id] ? '#4ade80' : '#64748b',
                        }}>
                        ✓ Keep
                      </button>
                      <button
                        onClick={() => setPlanKeep(prev => ({ ...prev, [plan.id]: false }))}
                        style={{
                          padding: '4px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                          background: !planKeep[plan.id] ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${!planKeep[plan.id] ? 'rgba(239,68,68,0.4)' : '#334155'}`,
                          color: !planKeep[plan.id] ? '#f87171' : '#64748b',
                        }}>
                        ✕ Cancel
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add new plans from catalog */}
            <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px', fontWeight: 600 }}>ADD NEW PLANS</p>
            <div className="space-y-2">
              {catalogPlans
                .filter(cp => !activePlans.some(ap => ap.plan_id === cp.id)) // exclude already active
                .map(plan => {
                  const isAdded = !!plansToAdd[plan.id]
                  return (
                    <div key={plan.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 12px', borderRadius: 10,
                      background: isAdded ? 'rgba(168,85,247,0.1)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${isAdded ? 'rgba(168,85,247,0.3)' : '#1e3a4f'}`,
                    }}>
                      <div>
                        <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{plan.name}</div>
                        <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{fmt(plan.price)}/{plan.billing_cycle} · {plan.fulfillment_type?.replace(/_/g, ' ')}</div>
                      </div>
                      <button
                        onClick={() => {
                          if (isAdded) {
                            setPlansToAdd(prev => { const n = { ...prev }; delete n[plan.id]; return n })
                          } else {
                            setPlansToAdd(prev => ({ ...prev, [plan.id]: { price: plan.price, billing_cycle: plan.billing_cycle } }))
                          }
                        }}
                        style={{
                          padding: '4px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                          background: isAdded ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${isAdded ? 'rgba(168,85,247,0.4)' : '#334155'}`,
                          color: isAdded ? '#c084fc' : '#64748b',
                        }}>
                        {isAdded ? '✓ Added' : '+ Add'}
                      </button>
                    </div>
                  )
                })}
            </div>

            {/* Summary of plan changes */}
            {(plansCancelling.length > 0 || newPlansActivating.length > 0) && (
              <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)' }}>
                <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#fbbf24' }}>Plan changes on payment:</p>
                {plansCancelling.map(p => (
                  <p key={p.id} style={{ margin: '4px 0 0', fontSize: 11, color: '#f87171' }}>✕ Cancel: {p.service_plans?.name}</p>
                ))}
                {newPlansActivating.map(p => (
                  <p key={p.plan_id} style={{ margin: '4px 0 0', fontSize: 11, color: '#4ade80' }}>✓ Activate: {p.name}</p>
                ))}
              </div>
            )}
          </div>

          {/* ── Section 3: Generate Invoice ── */}
          {!invoiceResult ? (
            <div>
              {genError && (
                <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', fontSize: 13 }}>
                  {genError}
                </div>
              )}
              <button
                onClick={handleGenerateInvoice}
                disabled={generating}
                style={{
                  width: '100%', padding: '14px 20px', borderRadius: 12, fontSize: 15, fontWeight: 700,
                  cursor: generating ? 'not-allowed' : 'pointer',
                  opacity: generating ? 0.6 : 1,
                  background: 'linear-gradient(135deg, #0ea5e9, #0369a1)',
                  color: '#fff', border: 'none',
                  boxShadow: '0 4px 20px rgba(14,165,233,0.3)',
                }}>
                {generating ? '⏳ Generating Invoice...' : `📄 Generate Buyout Invoice — ${fmt(buyoutTotal)}`}
              </button>
              <p style={{ textAlign: 'center', margin: '8px 0 0', fontSize: 11, color: '#475569' }}>
                Creates a formal invoice + Stripe payment link. Ownership transfers automatically when payment is received.
              </p>
            </div>
          ) : (
            <div style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: 14, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 18 }}>✅</span>
                <div>
                  <div style={{ color: '#4ade80', fontWeight: 700, fontSize: 14 }}>Invoice Generated</div>
                  <div style={{ color: '#94a3b8', fontSize: 11 }}>Invoice {invoiceResult.invoice_number} · {fmt(buyoutTotal)} due</div>
                </div>
              </div>

              {/* Payment link */}
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #1e3a4f', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
                <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Payment Link</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#0ea5e9', fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {invoiceResult.payment_link_url}
                  </span>
                  <button
                    onClick={handleCopy}
                    style={{
                      flexShrink: 0, padding: '4px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      background: copied ? 'rgba(74,222,128,0.15)' : 'rgba(14,165,233,0.15)',
                      border: `1px solid ${copied ? 'rgba(74,222,128,0.3)' : 'rgba(14,165,233,0.3)'}`,
                      color: copied ? '#4ade80' : '#0ea5e9',
                    }}>
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                  <a
                    href={invoiceResult.payment_link_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ flexShrink: 0, padding: '4px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', textDecoration: 'none', background: 'rgba(255,255,255,0.04)', border: '1px solid #334155', color: '#94a3b8' }}>
                    Open ↗
                  </a>
                </div>
              </div>

              {/* Send buttons */}
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleSendEmail}
                  disabled={sendingEmail || emailSent}
                  style={{
                    flex: 1, padding: '12px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                    cursor: sendingEmail || emailSent ? 'not-allowed' : 'pointer',
                    opacity: emailSent ? 0.7 : 1,
                    background: emailSent ? 'rgba(74,222,128,0.15)' : 'rgba(14,165,233,0.15)',
                    border: `1px solid ${emailSent ? 'rgba(74,222,128,0.3)' : 'rgba(14,165,233,0.3)'}`,
                    color: emailSent ? '#4ade80' : '#0ea5e9',
                  }}>
                  {sendingEmail ? '⏳ Sending...' : emailSent ? '✓ Email Sent' : '📧 Send Email'}
                </button>
                <button
                  onClick={handleSendSms}
                  disabled={smsSent}
                  style={{
                    flex: 1, padding: '12px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                    cursor: smsSent ? 'not-allowed' : 'pointer',
                    opacity: smsSent ? 0.7 : 1,
                    background: smsSent ? 'rgba(74,222,128,0.15)' : 'rgba(34,197,94,0.15)',
                    border: `1px solid ${smsSent ? 'rgba(74,222,128,0.3)' : 'rgba(34,197,94,0.3)'}`,
                    color: smsSent ? '#4ade80' : '#22c55e',
                  }}>
                  {smsSent ? '✓ SMS Opened' : '💬 Send SMS'}
                </button>
              </div>

              <p style={{ textAlign: 'center', margin: '12px 0 0', fontSize: 11, color: '#475569' }}>
                Ownership transfers automatically when Stripe payment is received.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid #334155' }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'rgba(255,255,255,0.04)', border: '1px solid #334155', color: '#94a3b8' }}>
            {invoiceResult ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}
