import { useState } from 'react'
import type { Job } from '../dispatch.types'
import { JOB_STATUS_LABELS, SYSTEM_TYPE_LABELS } from '../dispatch.types'
import { useTechnicians, useAssignTechnician, useUpdateJobStatus } from '../useJobs'
import type { JobStatus } from '../dispatch.types'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getCompletionStatus } from '../../../services/jobService'
import { checkJobReadiness } from '../../../services/inventoryService'
import { supabase } from '../../../lib/supabase'

const CATEGORY_LABELS: Record<string, string> = {
  ro: 'Reverse Osmosis', softener: 'Water Softener', whole_home_filter: 'Whole Home Filter',
  replacement_filter: 'Replacement Filter', accessory: 'Accessory', service: 'Service',
}

const INVENTORY_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
  reserved:      { label: 'Stock Reserved',    color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  border: 'rgba(74,222,128,0.25)', icon: '✅' },
  short:         { label: 'Stock Shortage',    color: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.25)', icon: '⚠️' },
  pending_check: { label: 'Checking Stock',    color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.25)', icon: '⏳' },
  not_required:  { label: 'No Stock Needed',   color: '#64748b', bg: 'rgba(100,116,139,0.1)', border: 'rgba(100,116,139,0.2)', icon: '—' },
  ready:         { label: 'Stock Ready',       color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  border: 'rgba(74,222,128,0.25)', icon: '✅' },
  n_a:           { label: 'N/A',               color: '#64748b', bg: 'rgba(100,116,139,0.1)', border: 'rgba(100,116,139,0.2)', icon: '—' },
}

interface Props {
  job: Job
  onJobUpdated: (job: Job) => void
}

function formatDate(str: string | null) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatCurrency(val: number | null) {
  if (!val) return '—'
  return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
}

// Dispatch only owns scheduling/stock transitions. Start Job + Mark Complete belong to Installations.
const DISPATCH_STATUS_ACTIONS: Partial<Record<JobStatus, { label: string; target: JobStatus; variant: string }[]>> = {
  ready_to_schedule: [
    { label: 'Waiting for Stock', target: 'waiting_for_stock', variant: 'bg-amber/15 text-amber border-amber/30' },
  ],
  scheduled: [
    { label: 'Waiting for Stock', target: 'waiting_for_stock', variant: 'bg-amber/15 text-amber border-amber/30' },
    { label: 'Back to Ready', target: 'ready_to_schedule', variant: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  ],
  waiting_for_stock: [
    { label: 'Back to Ready', target: 'ready_to_schedule', variant: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
    { label: 'Back to Scheduled', target: 'scheduled', variant: 'bg-border text-slate-300 border-border' },
  ],
}

export function JobOverviewTab({ job, onJobUpdated }: Props) {
  const navigate = useNavigate()
  const { data: techs } = useTechnicians()
  const { mutateAsync: assignTech } = useAssignTechnician()
  const { mutateAsync: updateStatus, isPending: statusPending } = useUpdateJobStatus()

  // ── Scheduling form state (for ready_to_schedule jobs) ──
  const [schedDate, setSchedDate] = useState('')
  const [schedHour, setSchedHour] = useState('')
  const [schedNotes, setSchedNotes] = useState(job.notes || '')
  const [scheduling, setScheduling] = useState(false)

  // Read-only completion readiness
  const { data: completionStatus } = useQuery({
    queryKey: ['job_completion', job.id],
    queryFn: () => getCompletionStatus(job.id),
    enabled: !!job.id,
    staleTime: 15_000,
  })

  // ── NEW: Products from quote line items ──
  const { data: jobProducts } = useQuery({
    queryKey: ['job_products', job.id],
    queryFn: async () => {
      // Try source_quote_id first (webhook path), then lead_id (manual path)
      let quoteId = (job as any).source_quote_id || null

      if (!quoteId && job.lead_id) {
        const { data: quote } = await supabase
          .from('quotes')
          .select('id')
          .eq('lead_id', job.lead_id)
          .in('status', ['accepted', 'signed'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        quoteId = quote?.id || null
      }

      if (!quoteId) return []

      const { data: lineItems } = await supabase
        .from('document_line_items')
        .select('product_id, description, quantity')
        .eq('document_id', quoteId)
        .order('sort_order', { ascending: true })

      if (!lineItems?.length) return []

      const productIds = lineItems.map(li => li.product_id).filter(Boolean)
      let productMap = new Map<string, any>()
      if (productIds.length > 0) {
        const { data: products } = await supabase
          .from('products')
          .select('id, name, category, sku')
          .in('id', productIds)
        productMap = new Map((products || []).map(p => [p.id, p]))
      }

      return lineItems
        .filter(li => li.product_id && productMap.has(li.product_id))
        .map(li => {
          const prod = productMap.get(li.product_id)
          return { name: prod.name, category: prod.category, sku: prod.sku, quantity: li.quantity || 1 }
        })
    },
    enabled: !!job.id,
    staleTime: 60_000,
  })

  // ── NEW: Inventory readiness detail (only when short or pending) ──
  const invStatus = (job as any).inventory_status as string | null
  const { data: inventoryDetail } = useQuery({
    queryKey: ['job_inventory_readiness', job.id],
    queryFn: () => checkJobReadiness(job.id),
    enabled: !!job.id && (invStatus === 'short' || invStatus === 'pending_check' || invStatus === 'reserved'),
    staleTime: 15_000,
  })

  const actions = DISPATCH_STATUS_ACTIONS[job.status] || []

  async function handleStatusChange(target: JobStatus) {
    try {
      const updated = await updateStatus({ jobId: job.id, newStatus: target, currentJob: job })
      onJobUpdated(updated)
    } catch (e: any) {
      alert(e.message)
    }
  }

  async function handleAssignTech(techId: string) {
    try {
      const updated = await assignTech({ jobId: job.id, techId })
      onJobUpdated(updated)
    } catch (e) {
      console.error(e)
    }
  }

  // ── Confirm Schedule: sets date/time/tech and moves to 'scheduled' ──
  async function handleConfirmSchedule() {
    if (!schedDate || !schedHour) return
    setScheduling(true)
    try {
      const datetime = `${schedDate}T${schedHour.padStart(2, '0')}:00:00`
      // Update job fields first
      await supabase.from('jobs').update({
        scheduled_date: datetime,
        notes: schedNotes || null,
      }).eq('id', job.id)

      // Move status to scheduled
      const updated = await updateStatus({ jobId: job.id, newStatus: 'scheduled' as JobStatus, currentJob: { ...job, scheduled_date: datetime } })
      onJobUpdated(updated)
    } catch (e: any) {
      alert('Failed to schedule: ' + e.message)
    } finally {
      setScheduling(false)
    }
  }

  const invConfig = invStatus ? INVENTORY_STATUS_CONFIG[invStatus] : null

  return (
    <div className="space-y-4">
      {/* Open in Installations link */}
      <button
        onClick={() => navigate(`/installations/${job.id}`)}
        className="w-full text-left px-3 py-2.5 bg-accent/10 border border-accent/30 rounded-xl text-sm text-accent font-medium hover:bg-accent/20 transition-colors"
      >
        🔧 Open in Installations →
        <span className="block text-xs text-muted mt-0.5">View checklist, photos, handover forms, and completion status</span>
      </button>

      {/* Dispatch-owned actions */}
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {actions.map(a => (
            <button
              key={a.target}
              onClick={() => handleStatusChange(a.target)}
              disabled={statusPending}
              className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${a.variant} ${statusPending ? 'opacity-50' : ''}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* ── NEW: Scheduling Form (for ready_to_schedule jobs) ── */}
      {job.status === 'ready_to_schedule' && (
        <div style={{
          background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.25)',
          borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>📞</span>
            <div>
              <div style={{ color: '#c084fc', fontWeight: 700, fontSize: 14 }}>Ready to Schedule</div>
              <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>Call customer, pick a date, assign tech, then confirm</div>
            </div>
          </div>

          {/* Date */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Install Date <span style={{ color: '#f87171' }}>*</span>
            </label>
            <input
              type="date"
              value={schedDate}
              onChange={e => setSchedDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              style={{
                width: '100%', boxSizing: 'border-box' as any,
                background: 'rgba(255,255,255,0.04)', border: '1px solid #1e3a4f',
                borderRadius: 8, padding: '10px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none',
              }}
            />
          </div>

          {/* Time */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Time Slot <span style={{ color: '#f87171' }}>*</span>
            </label>
            <select
              value={schedHour}
              onChange={e => setSchedHour(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box' as any,
                background: 'rgba(255,255,255,0.04)', border: '1px solid #1e3a4f',
                borderRadius: 8, padding: '10px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none',
              }}
            >
              <option value="" style={{ background: '#0f1923' }}>Select time...</option>
              {[8,9,10,11,12,13,14,15,16,17].map(h => (
                <option key={h} value={String(h)} style={{ background: '#0f1923' }}>
                  {h === 12 ? '12:00 PM' : h < 12 ? `${h}:00 AM` : `${h-12}:00 PM`}
                </option>
              ))}
            </select>
          </div>

          {/* Technician */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Assign Technician
            </label>
            {techs ? (
              <select
                value={job.assigned_technician_id || ''}
                onChange={e => e.target.value && handleAssignTech(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box' as any,
                  background: 'rgba(255,255,255,0.04)', border: '1px solid #1e3a4f',
                  borderRadius: 8, padding: '10px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none',
                }}
              >
                <option value="" style={{ background: '#0f1923' }}>— Unassigned —</option>
                {techs.map((t: any) => (
                  <option key={t.id} value={t.id} style={{ background: '#0f1923' }}>{t.full_name}</option>
                ))}
              </select>
            ) : (
              <div style={{ color: '#94a3b8', fontSize: 13 }}>Loading...</div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Notes for Tech
            </label>
            <textarea
              value={schedNotes}
              onChange={e => setSchedNotes(e.target.value)}
              placeholder="Any install notes..."
              rows={2}
              style={{
                width: '100%', boxSizing: 'border-box' as any,
                background: 'rgba(255,255,255,0.04)', border: '1px solid #1e3a4f',
                borderRadius: 8, padding: '10px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none',
                resize: 'none',
              }}
            />
          </div>

          {/* Confirm button */}
          <button
            onClick={handleConfirmSchedule}
            disabled={!schedDate || !schedHour || scheduling}
            style={{
              padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 700,
              cursor: !schedDate || !schedHour || scheduling ? 'not-allowed' : 'pointer',
              opacity: !schedDate || !schedHour || scheduling ? 0.5 : 1,
              background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
              color: '#fff', border: 'none',
              boxShadow: schedDate && schedHour ? '0 4px 20px rgba(168,85,247,0.3)' : 'none',
            }}
          >
            {scheduling ? 'Scheduling...' : schedDate && schedHour
              ? `📅 Confirm Schedule — ${new Date(schedDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${
                  Number(schedHour) === 12 ? '12:00 PM' : Number(schedHour) < 12 ? `${schedHour}:00 AM` : `${Number(schedHour)-12}:00 PM`
                }`
              : '📅 Confirm Schedule'}
          </button>
        </div>
      )}

      {/* ── NEW: Products Being Installed (Gap 6) ── */}
      {jobProducts && jobProducts.length > 0 && (
        <div style={{
          background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid #1e3a4f',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 14 }}>📦</span>
            <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13 }}>
              Products Being Installed
            </span>
            <span style={{ color: '#4ade80', fontSize: 11, fontWeight: 600 }}>
              {jobProducts.length} item{jobProducts.length !== 1 ? 's' : ''}
            </span>
          </div>
          {jobProducts.map((p: any, i: number) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 14px',
              borderBottom: i < jobProducts.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
            }}>
              <div>
                <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                  {p.category && (
                    <span style={{ color: '#64748b', fontSize: 11 }}>
                      {CATEGORY_LABELS[p.category] || p.category}
                    </span>
                  )}
                  {p.sku && (
                    <span style={{ color: '#475569', fontSize: 11, fontFamily: 'monospace' }}>
                      {p.sku}
                    </span>
                  )}
                </div>
              </div>
              <span style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>× {p.quantity}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── NEW: Inventory Status (Gap 4) ── */}
      {invConfig && invStatus !== 'not_required' && invStatus !== 'n_a' && (
        <div style={{
          background: invConfig.bg, border: `1px solid ${invConfig.border}`,
          borderRadius: 14, overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14 }}>{invConfig.icon}</span>
              <div>
                <div style={{ color: invConfig.color, fontWeight: 700, fontSize: 13 }}>
                  {invConfig.label}
                </div>
                {invStatus === 'short' && (
                  <div style={{ color: '#f87171', fontSize: 11, marginTop: 2 }}>
                    Cannot start installation until stock arrives
                  </div>
                )}
                {invStatus === 'pending_check' && (
                  <div style={{ color: '#fbbf24', fontSize: 11, marginTop: 2 }}>
                    Inventory check in progress
                  </div>
                )}
                {invStatus === 'reserved' && (
                  <div style={{ color: '#4ade80', fontSize: 11, marginTop: 2 }}>
                    All materials reserved — ready to install
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Inventory detail — per-product breakdown when short */}
          {inventoryDetail && inventoryDetail.items.length > 0 && invStatus === 'short' && (
            <div style={{ borderTop: `1px solid ${invConfig.border}`, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Material Status
              </div>
              {inventoryDetail.items.map((item: any, i: number) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 0',
                  borderBottom: i < inventoryDetail.items.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                }}>
                  <div style={{ color: '#e2e8f0', fontSize: 12 }}>{item.product_name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {item.reserved ? (
                      <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 600 }}>✅ Reserved</span>
                    ) : (
                      <span style={{ fontSize: 11, color: '#f87171', fontWeight: 600 }}>
                        Short {item.shortage_amount > 0 ? `(need ${item.shortage_amount})` : ''}
                      </span>
                    )}
                    {item.reorder_request_id && (
                      <span style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 8,
                        background: 'rgba(251,191,36,0.1)', color: '#fbbf24',
                        border: '1px solid rgba(251,191,36,0.2)',
                      }}>
                        On Order
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Reserved items detail */}
          {inventoryDetail && inventoryDetail.items.length > 0 && invStatus === 'reserved' && (
            <div style={{ borderTop: `1px solid ${invConfig.border}`, padding: '10px 14px' }}>
              {inventoryDetail.items.map((item: any, i: number) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '4px 0',
                }}>
                  <span style={{ color: '#cbd5e1', fontSize: 12 }}>{item.product_name}</span>
                  <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 600 }}>✅ × {item.quantity_needed}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Read-only completion readiness summary */}
      {completionStatus && job.status !== 'complete' && (
        <div className="border border-border rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">Execution Status</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
              completionStatus.ready ? 'bg-green/20 text-green' : 'bg-amber/20 text-amber'
            }`}>
              {completionStatus.ready ? 'Ready' : 'Not Ready'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="text-muted">Checklist: <span className="text-slate-300">{completionStatus.checklistCompleted}/{completionStatus.checklistTotal}</span></div>
            <div className="text-muted">Photos: <span className="text-slate-300">{completionStatus.photosProvided}/{completionStatus.photosRequired}</span></div>
            <div className="text-muted">Verification: <span className="text-slate-300">{completionStatus.verificationCompleted}/{completionStatus.verificationRequired}</span></div>
            <div className="text-muted">Forms: <span className="text-slate-300">{completionStatus.formsCompleted}/{completionStatus.formsRequired}</span></div>
          </div>
          {completionStatus.issues.length > 0 && (
            <div className="text-xs text-amber">{completionStatus.issues.length} blocking issue{completionStatus.issues.length !== 1 ? 's' : ''}</div>
          )}
        </div>
      )}

      {/* Complete badge */}
      {job.status === 'complete' && (
        <div className="bg-green/10 border border-green/20 rounded-xl p-3 text-center">
          <div className="text-green font-bold text-sm">✅ Job Complete</div>
          <div className="text-xs text-muted mt-1">Completed {formatDate(job.completed_at)}</div>
          {job.ready_for_customer_conversion && (
            <div className="text-xs text-accent mt-1">Ready for customer conversion</div>
          )}
        </div>
      )}

      {/* Snapshot info */}
      <InfoRow label="Customer" value={job.customer_name_snapshot} />
      <InfoRow label="Phone" value={job.phone_snapshot} />
      {job.email_snapshot && <InfoRow label="Email" value={job.email_snapshot} />}
      <InfoRow label="Service Address" value={job.service_address_snapshot} />
      <InfoRow label="System Type" value={SYSTEM_TYPE_LABELS[job.system_type]} />
      {job.equipment_summary && <InfoRow label="Equipment" value={job.equipment_summary} />}
      {job.quote_total_snapshot && <InfoRow label="Quote Total" value={formatCurrency(job.quote_total_snapshot)} />}
      {job.payment_method_snapshot && <InfoRow label="Payment" value={job.payment_method_snapshot} />}
      <InfoRow label="Scheduled" value={job.scheduled_date || 'Not set'} />
      {job.started_at && <InfoRow label="Started" value={formatDate(job.started_at)} />}
      {job.serial_number && <InfoRow label="Serial Number" value={job.serial_number} />}

      {/* Technician assignment */}
      <div>
        <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Assigned Technician</div>
        {techs ? (
          <select
            value={job.assigned_technician_id || ''}
            onChange={e => e.target.value && handleAssignTech(e.target.value)}
            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-accent"
          >
            <option value="">— Unassigned —</option>
            {techs.map((t: any) => (
              <option key={t.id} value={t.id}>{t.full_name}</option>
            ))}
          </select>
        ) : (
          <div className="text-sm text-slate-300">{job.assigned_technician?.full_name || 'Unassigned'}</div>
        )}
        {job.assigned_at && (
          <div className="text-xs text-muted mt-1">Assigned {formatDate(job.assigned_at)}</div>
        )}
      </div>

      {/* Notes */}
      {job.notes && (
        <div>
          <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Notes</div>
          <div className="text-sm text-slate-300 bg-card border border-border rounded-lg p-3 whitespace-pre-wrap">{job.notes}</div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-0.5">{label}</div>
      <div className="text-sm text-slate-300">{value}</div>
    </div>
  )
}
