import { useState } from 'react'
import { useMaintenancePlans, useComplianceRequirements, useServiceScheduleItems, useServiceCompletions } from '../useCustomers'
import { COMPLIANCE_TYPE_LABELS } from '../customers.types'
import { ServiceCompleteModal } from '../modals/ServiceCompleteModal'
import { ProofUploadModal } from '../modals/ProofUploadModal'

interface Props { customerId: string }

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysUntil(d: string): number {
  return Math.floor((new Date(d).getTime() - Date.now()) / 86400000)
}

const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  upcoming:  { color: '#94a3b8', label: 'Upcoming' },
  due_soon:  { color: '#fbbf24', label: 'Due Soon' },
  overdue:   { color: '#f87171', label: 'Overdue' },
  completed: { color: '#4ade80', label: 'Completed' },
  skipped:   { color: '#94a3b8', label: 'Skipped' },
}

export function MaintenanceComplianceTab({ customerId }: Props) {
  const { data: plans, isLoading: plansLoading } = useMaintenancePlans(customerId)
  const { data: requirements, isLoading: reqLoading } = useComplianceRequirements(customerId)
  const { data: schedules, isLoading: schLoading } = useServiceScheduleItems(customerId)
  const { data: completions } = useServiceCompletions(customerId)

  const [completeModal, setCompleteModal] = useState<any>(null)
  const [proofModal, setProofModal] = useState<any>(null)

  const isLoading = plansLoading || reqLoading || schLoading
  if (isLoading) return <p className="text-sm text-muted text-center py-8">Loading maintenance data...</p>

  const activePlan = (plans || []).find((p: any) => p.status === 'active')
  const hasSchedules = (schedules || []).length > 0
  const hasRequirements = (requirements || []).length > 0
  const reqList = requirements as any[] || []

  function getReqLabel(requirementId: string): string {
    const req = reqList.find(r => r.id === requirementId)
    if (!req) return 'Scheduled Service'
    return COMPLIANCE_TYPE_LABELS[req.requirement_type as keyof typeof COMPLIANCE_TYPE_LABELS] || req.requirement_type?.replace(/_/g, ' ')
  }

  return (
    <div className="space-y-4">
      {/* Maintenance Plan */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wide">Annual Maintenance Plan</h4>
          {activePlan ? (
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: '#4ade80' }}>Active</span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#f87171' }}>No Active Plan</span>
          )}
        </div>
        {activePlan ? (
          <div className="text-xs text-muted space-y-1">
            <div>Price: {(activePlan as any).included_in_rental ? 'Included in Rental' : `$${(activePlan as any).price_snapshot}/year`}</div>
            <div>Renewal: {formatDate((activePlan as any).renewal_date)}</div>
            <div>Auto-renew: {(activePlan as any).auto_renew ? 'Yes' : 'No'}</div>
          </div>
        ) : (
          <div className="text-xs text-muted">No active maintenance plan. Some warranties require an active plan to remain valid.</div>
        )}
      </div>

      {/* Service Schedule with action buttons */}
      <div>
        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wide mb-3">Service Schedule</h4>
        {!hasSchedules ? (
          <p className="text-sm text-muted text-center py-4">No service schedule items.</p>
        ) : (
          <div className="space-y-2">
            {(schedules as any[]).map(sch => {
              const days = sch.due_date ? daysUntil(sch.due_date) : 0
              const style = STATUS_STYLES[sch.status] || STATUS_STYLES.upcoming
              const label = getReqLabel(sch.compliance_requirement_id)
              const canComplete = sch.status !== 'completed' && sch.status !== 'skipped'

              return (
                <div key={sch.id} className="bg-card border border-border rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-white">{label}</span>
                    <span className="text-xs font-semibold" style={{ color: style.color }}>
                      {sch.status === 'overdue' ? `Overdue (${Math.abs(days)}d)` :
                       sch.status === 'due_soon' ? `Due in ${days}d` :
                       sch.status === 'completed' ? 'Completed' :
                       sch.status === 'skipped' ? 'Skipped' :
                       sch.due_date ? `In ${days}d` : style.label}
                    </span>
                  </div>
                  <div className="text-xs text-muted space-y-0.5">
                    <div>Due: {formatDate(sch.due_date)}</div>
                    {sch.grace_expiry_date && sch.status === 'overdue' && (
                      <div style={{ color: '#f87171' }}>Grace expires: {formatDate(sch.grace_expiry_date)} — warranty will void</div>
                    )}
                    {sch.completed_at && <div>Completed: {formatDate(sch.completed_at)}</div>}
                  </div>

                  {/* Actions */}
                  {canComplete && (
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => setCompleteModal({ item: sch, label })}
                        className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors"
                        style={{ backgroundColor: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)' }}>
                        ✓ Mark Complete
                      </button>
                      {sch.compliance_requirement_id && (
                        <button
                          onClick={() => setProofModal({ requirementId: sch.compliance_requirement_id, label })}
                          className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors"
                          style={{ backgroundColor: 'rgba(56,189,248,0.12)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.25)' }}>
                          📎 Upload Proof
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Compliance Requirements */}
      {hasRequirements && (
        <div>
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wide mb-3">Compliance Requirements</h4>
          <div className="space-y-2">
            {reqList.map(req => (
              <div key={req.id} className="bg-card border border-border rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-white">
                    {COMPLIANCE_TYPE_LABELS[req.requirement_type as keyof typeof COMPLIANCE_TYPE_LABELS] || req.requirement_type?.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-muted">Every {req.interval_months} months</span>
                </div>
                <div className="flex flex-wrap gap-2 mt-1 text-xs">
                  {req.must_purchase_through_zenith && (
                    <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(56,189,248,0.1)', color: '#38bdf8' }}>Must purchase through Zenith</span>
                  )}
                  {req.affects_warranty && (
                    <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(245,158,11,0.1)', color: '#fbbf24' }}>Affects warranty</span>
                  )}
                  {req.requires_active_plan && (
                    <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(168,85,247,0.1)', color: '#c084fc' }}>Requires active plan</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent completions */}
      {(completions || []).length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wide mb-3">Recent Service Completions</h4>
          <div className="space-y-1">
            {(completions as any[]).slice(0, 10).map(comp => (
              <div key={comp.id} className="flex items-center justify-between text-xs py-2 border-b border-border/50 last:border-0">
                <div>
                  <span className="text-slate-300">{getReqLabel(comp.compliance_requirement_id)}</span>
                  {comp.purchased_through_zenith && <span className="text-muted ml-2">(via Zenith)</span>}
                  {comp.purchased_through_zenith === false && <span className="ml-2" style={{ color: '#fbbf24' }}>(external)</span>}
                </div>
                <div className="text-muted">{formatDate(comp.completed_date)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {completeModal && (
        <ServiceCompleteModal
          scheduleItem={completeModal.item}
          customerId={customerId}
          requirementLabel={completeModal.label}
          onClose={() => setCompleteModal(null)}
          onCompleted={() => setCompleteModal(null)}
        />
      )}
      {proofModal && (
        <ProofUploadModal
          requirementId={proofModal.requirementId}
          customerId={customerId}
          requirementLabel={proofModal.label}
          onClose={() => setProofModal(null)}
          onCompleted={() => setProofModal(null)}
        />
      )}
    </div>
  )
}
