import { useQuery } from '@tanstack/react-query'
import { getCompletionStatus } from '../../services/jobService'
import type { CompletionStatus } from '../../services/jobService'

interface Props {
  jobId: string
  jobStatus: string
}

function ProgressRow({ label, done, total, color }: { label: string; done: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 100
  const complete = done >= total

  return (
    <div className="flex items-center gap-3">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
        complete ? 'bg-green/20 text-green' : 'bg-amber/20 text-amber'
      }`}>
        {complete ? '✓' : '!'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-xs text-slate-300">{label}</span>
          <span className={`text-xs font-semibold ${complete ? 'text-green' : 'text-amber'}`}>
            {done}/{total}
          </span>
        </div>
        <div className="h-1.5 bg-surface rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${complete ? `bg-green` : `bg-${color}`}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  )
}

export function CompletionReadinessPanel({ jobId, jobStatus }: Props) {
  const { data: status, isLoading } = useQuery<CompletionStatus>({
    queryKey: ['job_completion', jobId],
    queryFn: () => getCompletionStatus(jobId),
    enabled: !!jobId,
    staleTime: 10_000,
  })

  if (isLoading || !status) {
    return <div className="text-xs text-muted py-2">Checking completion readiness...</div>
  }

  if (jobStatus === 'complete') {
    return (
      <div className="bg-green/10 border border-green/20 rounded-xl p-3 text-center">
        <span className="text-green font-bold text-sm">✅ Job Complete</span>
      </div>
    )
  }

  return (
    <div className={`border rounded-xl p-4 space-y-3 ${
      status.ready ? 'border-green/30 bg-green/5' : 'border-border'
    }`}>
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wide">Completion Readiness</h4>
        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
          status.ready ? 'bg-green/20 text-green' : 'bg-amber/20 text-amber'
        }`}>
          {status.ready ? 'Ready' : 'Not Ready'}
        </span>
      </div>

      <div className="space-y-2">
        <ProgressRow
          label="Checklist Items"
          done={status.checklistCompleted}
          total={status.checklistTotal}
          color="accent"
        />
        <ProgressRow
          label="Required Photos"
          done={status.photosProvided}
          total={status.photosRequired}
          color="cyan"
        />
        <ProgressRow
          label="Tech Verification"
          done={status.verificationCompleted}
          total={status.verificationRequired}
          color="orange"
        />
        <ProgressRow
          label="Required Forms"
          done={status.formsCompleted}
          total={status.formsRequired}
          color="purple"
        />
        <div className="flex items-center gap-3">
          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
            status.generalPhotos > 0 ? 'bg-green/20 text-green' : 'bg-amber/20 text-amber'
          }`}>
            {status.generalPhotos > 0 ? '✓' : '!'}
          </div>
          <span className="text-xs text-slate-300">
            Job Photos: {status.generalPhotos > 0 ? `${status.generalPhotos} uploaded` : 'None uploaded'}
          </span>
        </div>
      </div>

      {status.issues.length > 0 && (
        <div className="border-t border-border pt-2 mt-2">
          <div className="text-xs text-amber font-semibold mb-1">Blocking Issues:</div>
          {status.issues.map((issue, i) => (
            <div key={i} className="text-xs text-muted flex items-start gap-1.5">
              <span className="text-amber mt-0.5">•</span>
              <span>{issue}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
