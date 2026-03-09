import type { Job } from '../dispatch.types'
import { JOB_STATUS_LABELS, SYSTEM_TYPE_LABELS } from '../dispatch.types'
import { useTechnicians, useAssignTechnician, useUpdateJobStatus } from '../useJobs'
import type { JobStatus } from '../dispatch.types'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getCompletionStatus } from '../../../services/jobService'

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
  scheduled: [
    { label: 'Waiting for Stock', target: 'waiting_for_stock', variant: 'bg-amber/15 text-amber border-amber/30' },
  ],
  waiting_for_stock: [
    { label: 'Back to Scheduled', target: 'scheduled', variant: 'bg-border text-slate-300 border-border' },
  ],
}

export function JobOverviewTab({ job, onJobUpdated }: Props) {
  const navigate = useNavigate()
  const { data: techs } = useTechnicians()
  const { mutateAsync: assignTech } = useAssignTechnician()
  const { mutateAsync: updateStatus, isPending: statusPending } = useUpdateJobStatus()

  // Read-only completion readiness
  const { data: completionStatus } = useQuery({
    queryKey: ['job_completion', job.id],
    queryFn: () => getCompletionStatus(job.id),
    enabled: !!job.id,
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
