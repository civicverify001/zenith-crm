// src/modules/customers/tabs/ServicePlansTab.tsx
// Shows service plans for a customer with Add Plan, Pause, Resume, Cancel actions

import { useState, useEffect } from 'react'
import {
  fetchCustomerServicePlans,
  fetchPlanTemplates,
  activatePlanFromCustomerPage,
  pausePlan,
  resumePlan,
  cancelPlan,
  checkPaymentMethod,
  BILLING_CYCLE_LABELS,
  FULFILLMENT_TYPE_LABELS,
  PLAN_STATUS_CONFIG,
  type CustomerServicePlan,
  type ServicePlanTemplate,
} from '../../../services/servicePlanService'
import { fetchInstalledSystems } from '../../../services/customerService'
import { useAuth } from '../../../hooks/useAuth'

interface Props {
  customerId: string
}

export function ServicePlansTab({ customerId }: Props) {
  const { profile } = useAuth()
  const role = profile?.role || ''
  const canAdd = ['admin', 'frontdesk', 'salesrep'].includes(role)
  const canPause = ['admin', 'frontdesk'].includes(role)
  const canCancel = role === 'admin'
  const canOverridePrice = role === 'admin'

  const [plans, setPlans] = useState<CustomerServicePlan[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => { loadPlans() }, [customerId])

  async function loadPlans() {
    setLoading(true)
    try {
      const data = await fetchCustomerServicePlans(customerId)
      setPlans(data)
    } catch (e) {
      console.error('Failed to load service plans:', e)
    }
    setLoading(false)
  }

  async function handlePause(plan: CustomerServicePlan) {
    const reason = prompt('Reason for pausing (optional):')
    if (reason === null) return // cancelled prompt
    setActionLoading(plan.id)
    try {
      await pausePlan(plan.id, reason || undefined)
      loadPlans()
    } catch (e: any) {
      alert('Failed to pause: ' + e.message)
    }
    setActionLoading(null)
  }

  async function handleResume(plan: CustomerServicePlan) {
    setActionLoading(plan.id)
    try {
      await resumePlan(plan.id)
      loadPlans()
    } catch (e: any) {
      alert('Failed to resume: ' + e.message)
    }
    setActionLoading(null)
  }

  async function handleCancel(plan: CustomerServicePlan) {
    const reason = prompt('Reason for cancellation:')
    if (!reason) return
    if (!confirm(`Cancel "${plan.plan_name}"? This cannot be undone.`)) return
    setActionLoading(plan.id)
    try {
      await cancelPlan(plan.id, reason)
      loadPlans()
    } catch (e: any) {
      alert('Failed to cancel: ' + e.message)
    }
    setActionLoading(null)
  }

  // Separate active vs inactive plans
  const activePlans = plans.filter(p => ['active', 'pending_payment_method', 'pending_install', 'paused', 'payment_failed'].includes(p.status))
  const pastPlans = plans.filter(p => ['cancelled', 'completed', 'expired'].includes(p.status))

  function formatDate(d: string | null | undefined) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  if (loading) {
    return <div style={{ textAlign: 'center', color: '#64748b', padding: '48px 0' }}>Loading service plans...</div>
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 16, margin: 0 }}>Service Plans</h2>
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
            {activePlans.length} active plan{activePlans.length !== 1 ? 's' : ''}
            {pastPlans.length > 0 && ` · ${pastPlans.length} past`}
          </p>
        </div>
        {canAdd && (
          <button onClick={() => setShowAddModal(true)} style={{
            padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700,
            background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff', border: 'none', cursor: 'pointer',
          }}>
            + Add Service Plan
          </button>
        )}
      </div>

      {/* Add Plan Modal */}
      {showAddModal && (
        <AddPlanModal
          customerId={customerId}
          canOverridePrice={canOverridePrice}
          onClose={() => setShowAddModal(false)}
          onAdded={() => { setShowAddModal(false); loadPlans() }}
        />
      )}

      {/* Active Plans */}
      {activePlans.length === 0 && pastPlans.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔄</div>
          <p style={{ color: '#64748b', fontSize: 14 }}>No service plans yet.</p>
          {canAdd && (
            <p style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
              Click "+ Add Service Plan" to enroll this customer.
            </p>
          )}
        </div>
      ) : (
        <>
          {activePlans.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: pastPlans.length > 0 ? 24 : 0 }}>
              {activePlans.map(plan => {
                const sc = PLAN_STATUS_CONFIG[plan.status] || PLAN_STATUS_CONFIG.active
                const isLoading = actionLoading === plan.id
                return (
                  <div key={plan.id} style={{
                    background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, padding: 16,
                  }}>
                    {/* Top row: name + status + actions */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>{plan.plan_name}</span>
                          <span style={{
                            fontSize: 11, padding: '2px 10px', borderRadius: 20, fontWeight: 700,
                            background: sc.bgColor, color: sc.color,
                            border: `1px solid ${sc.color}30`,
                          }}>
                            {sc.label}
                          </span>
                          {plan.source === 'auto_install' && (
                            <span style={{
                              fontSize: 10, padding: '2px 8px', borderRadius: 20,
                              background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)',
                            }}>Auto-enrolled</span>
                          )}
                        </div>
                        {plan.notes && (
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{plan.notes}</div>
                        )}
                      </div>

                      {/* Price */}
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 16, fontFamily: 'monospace' }}>
                          ${Number(plan.price).toFixed(2)}
                        </div>
                        <div style={{ color: '#64748b', fontSize: 10 }}>
                          {BILLING_CYCLE_LABELS[plan.billing_cycle] || ''}
                        </div>
                      </div>
                    </div>

                    {/* Detail grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 12 }}>
                      <DetailCell label="Fulfillment" value={FULFILLMENT_TYPE_LABELS[plan.plan_fulfillment_type || ''] || '—'} />
                      <DetailCell label="Started" value={formatDate(plan.activated_at || plan.start_date)} />
                      <DetailCell label="Next Billing" value={formatDate(plan.next_billing_date)} />
                      <DetailCell label="Next Service" value={formatDate(plan.next_fulfillment_date || plan.next_service)} />
                    </div>

                    {/* Warning banners */}
                    {plan.status === 'pending_payment_method' && (
                      <div style={{
                        marginTop: 10, padding: '8px 12px', borderRadius: 8, fontSize: 12,
                        background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', color: '#fbbf24',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <span>💳</span>
                        <span>Card required to start billing. Save a payment method to activate.</span>
                      </div>
                    )}
                    {plan.status === 'payment_failed' && (
                      <div style={{
                        marginTop: 10, padding: '8px 12px', borderRadius: 8, fontSize: 12,
                        background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)', color: '#f87171',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <span>⚠️</span>
                        <span>Payment failed {plan.failed_billing_count} time{plan.failed_billing_count !== 1 ? 's' : ''}. Update card to resume billing.</span>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      {plan.status === 'active' && canPause && (
                        <ActionBtn label={isLoading ? '...' : 'Pause'} color="#fbbf24" onClick={() => handlePause(plan)} disabled={isLoading} />
                      )}
                      {plan.status === 'paused' && canPause && (
                        <ActionBtn label={isLoading ? '...' : 'Resume'} color="#4ade80" onClick={() => handleResume(plan)} disabled={isLoading} />
                      )}
                      {canCancel && !['cancelled', 'completed', 'expired'].includes(plan.status) && (
                        <ActionBtn label={isLoading ? '...' : 'Cancel'} color="#f87171" onClick={() => handleCancel(plan)} disabled={isLoading} />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Past Plans */}
          {pastPlans.length > 0 && (
            <>
              <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Past Plans
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pastPlans.map(plan => {
                  const sc = PLAN_STATUS_CONFIG[plan.status] || PLAN_STATUS_CONFIG.cancelled
                  return (
                    <div key={plan.id} style={{
                      background: '#162232', border: '1px solid #1e3a4f', borderRadius: 10, padding: '10px 14px',
                      opacity: 0.5,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13 }}>{plan.plan_name}</span>
                          <span style={{
                            fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700,
                            background: sc.bgColor, color: sc.color,
                          }}>{sc.label}</span>
                        </div>
                        <span style={{ color: '#64748b', fontSize: 11 }}>
                          {plan.cancelled_at ? `Cancelled ${formatDate(plan.cancelled_at)}` : formatDate(plan.activated_at)}
                        </span>
                      </div>
                      {plan.cancel_reason && (
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Reason: {plan.cancel_reason}</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ── Small components ──────────────────────────────────────────

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 500 }}>{value}</div>
    </div>
  )
}

function ActionBtn({ label, color, onClick, disabled }: { label: string; color: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '5px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
      background: `${color}12`, color, border: `1px solid ${color}30`,
      opacity: disabled ? 0.5 : 1,
    }}>
      {label}
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════
// ADD PLAN MODAL
// ═══════════════════════════════════════════════════════════════

function AddPlanModal({
  customerId, canOverridePrice, onClose, onAdded,
}: {
  customerId: string; canOverridePrice: boolean; onClose: () => void; onAdded: () => void
}) {
  const [templates, setTemplates] = useState<ServicePlanTemplate[]>([])
  const [systems, setSystems] = useState<any[]>([])
  const [hasCard, setHasCard] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Form state
  const [selectedPlan, setSelectedPlan] = useState('')
  const [selectedSystem, setSelectedSystem] = useState('')
  const [priceOverride, setPriceOverride] = useState('')
  const [billingStart, setBillingStart] = useState<'immediate' | 'next_cycle'>('immediate')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [t, s, card] = await Promise.all([
          fetchPlanTemplates(true),
          fetchInstalledSystems(customerId),
          checkPaymentMethod(customerId),
        ])
        setTemplates(t)
        setSystems((s || []).filter((sys: any) => sys.is_active !== false))
        setHasCard(card)
      } catch (e) {
        console.error('Failed to load modal data:', e)
      }
      setLoading(false)
    }
    load()
  }, [customerId])

  const selectedTemplate = templates.find(t => t.id === selectedPlan)
  const needsSystem = selectedTemplate?.requires_installed_system ?? true

  // Filter systems by template's applies_to_categories
  const filteredSystems = selectedTemplate && Array.isArray(selectedTemplate.applies_to_categories) && selectedTemplate.applies_to_categories.length > 0
    ? systems.filter(s => selectedTemplate.applies_to_categories.includes(s.system_type))
    : systems

  async function handleSubmit() {
    if (!selectedPlan) { setError('Select a plan'); return }
    if (needsSystem && !selectedSystem) { setError('Select an installed system'); return }

    setSaving(true)
    setError('')

    try {
      await activatePlanFromCustomerPage({
        customer_id: customerId,
        plan_id: selectedPlan,
        installed_system_id: needsSystem ? selectedSystem : null,
        price_override: priceOverride ? parseFloat(priceOverride) : null,
        billing_start: billingStart,
        notes: notes.trim() || undefined,
      })
      onAdded()
    } catch (e: any) {
      setError(e.message || 'Failed to activate plan')
    }
    setSaving(false)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box' as const,
    background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f',
    borderRadius: 10, padding: '9px 14px', color: '#e2e8f0', fontSize: 13, outline: 'none',
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: '#162232', border: '1px solid #1e3a4f', borderRadius: 16,
        width: 480, maxHeight: '80vh', overflow: 'auto', padding: 24,
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Add Service Plan</h3>

        {loading ? (
          <div style={{ textAlign: 'center', color: '#64748b', padding: 24 }}>Loading...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {error && (
              <div style={{
                background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)',
                borderRadius: 10, padding: '8px 14px', fontSize: 12, color: '#f87171',
              }}>{error}</div>
            )}

            {/* Step 1: Select plan */}
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6 }}>Select Plan</label>
              <select value={selectedPlan} onChange={e => { setSelectedPlan(e.target.value); setSelectedSystem('') }} style={inputStyle}>
                <option value="" style={{ background: '#0f1923' }}>Choose a plan...</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id} style={{ background: '#0f1923' }}>
                    {t.name} — ${Number(t.price).toFixed(2)}{BILLING_CYCLE_LABELS[t.billing_cycle] || ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Plan details preview */}
            {selectedTemplate && (
              <div style={{
                background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.15)',
                borderRadius: 10, padding: '10px 14px',
              }}>
                <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600, marginBottom: 4 }}>{selectedTemplate.name}</div>
                {selectedTemplate.description && (
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>{selectedTemplate.description}</div>
                )}
                <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#94a3b8' }}>
                  <span>Billing: {selectedTemplate.billing_cycle}</span>
                  <span>Fulfillment: {FULFILLMENT_TYPE_LABELS[selectedTemplate.fulfillment_type]}</span>
                  {selectedTemplate.fulfillment_interval_months && (
                    <span>Every {selectedTemplate.fulfillment_interval_months} mo</span>
                  )}
                </div>
              </div>
            )}

            {/* Step 2: Select system */}
            {selectedTemplate && needsSystem && (
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6 }}>Installed System</label>
                {filteredSystems.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#f87171', padding: '8px 0' }}>
                    No matching installed systems found for this plan type.
                  </div>
                ) : (
                  <select value={selectedSystem} onChange={e => setSelectedSystem(e.target.value)} style={inputStyle}>
                    <option value="" style={{ background: '#0f1923' }}>Choose a system...</option>
                    {filteredSystems.map((s: any) => (
                      <option key={s.id} value={s.id} style={{ background: '#0f1923' }}>
                        {s.name_snapshot || s.system_type} — {s.ownership_type}
                        {s.install_date ? ` (installed ${new Date(s.install_date).toLocaleDateString()})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Step 3: Price override (admin only) */}
            {selectedTemplate && canOverridePrice && (
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                  Price Override <span style={{ color: '#334155' }}>(leave empty for default: ${Number(selectedTemplate.price).toFixed(2)})</span>
                </label>
                <input type="number" step="0.01" min="0" value={priceOverride}
                  onChange={e => setPriceOverride(e.target.value)} placeholder={String(selectedTemplate.price)} style={inputStyle} />
              </div>
            )}

            {/* Step 4: Billing start */}
            {selectedTemplate && selectedTemplate.billing_cycle !== 'one_time' && (
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6 }}>Billing Start</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['immediate', 'next_cycle'] as const).map(opt => (
                    <button key={opt} onClick={() => setBillingStart(opt)} style={{
                      flex: 1, padding: '8px 12px', borderRadius: 10, fontSize: 12, cursor: 'pointer',
                      background: billingStart === opt ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.03)',
                      color: billingStart === opt ? '#f59e0b' : '#64748b',
                      border: `1px solid ${billingStart === opt ? 'rgba(245,158,11,0.4)' : '#1e3a4f'}`,
                      fontWeight: billingStart === opt ? 700 : 400,
                    }}>
                      {opt === 'immediate' ? 'Start Immediately' : 'Start Next Cycle'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Payment method warning */}
            {selectedTemplate && !hasCard && selectedTemplate.billing_cycle !== 'one_time' && (
              <div style={{
                background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)',
                borderRadius: 10, padding: '8px 14px', fontSize: 12, color: '#fbbf24',
                display: 'flex', gap: 8,
              }}>
                <span>💳</span>
                <span>No card on file. Plan will be created as <strong>"Card Required"</strong> — billing starts when a card is saved.</span>
              </div>
            )}

            {/* Step 5: Notes */}
            {selectedTemplate && (
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6 }}>Notes (optional)</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  placeholder="Internal notes about this plan"
                  style={{ ...inputStyle, resize: 'none' as const, fontFamily: 'inherit' }} />
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 8, paddingTop: 4, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{
                padding: '8px 16px', borderRadius: 10, fontSize: 13, color: '#64748b', cursor: 'pointer',
                background: 'rgba(255,255,255,0.04)', border: '1px solid #1e3a4f',
              }}>Cancel</button>
              <button onClick={handleSubmit} disabled={saving || !selectedPlan} style={{
                padding: '8px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#fff',
                background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none',
                cursor: saving || !selectedPlan ? 'not-allowed' : 'pointer',
                opacity: saving || !selectedPlan ? 0.5 : 1,
              }}>
                {saving ? 'Activating...' : hasCard ? 'Activate Plan' : 'Create Plan (Card Required)'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
