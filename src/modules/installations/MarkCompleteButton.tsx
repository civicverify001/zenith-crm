import { useState } from 'react'

interface MarkCompleteButtonProps {
  jobId: string
  jobStatus: string
  installFee: number | null
  customerName: string
  completedBy?: string
  onCompleted?: (result: any) => void
}

export default function MarkCompleteButton({
  jobId,
  jobStatus,
  installFee,
  customerName,
  completedBy,
  onCompleted,
}: MarkCompleteButtonProps) {
  const [loading, setLoading] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [result, setResult] = useState<any>(null)

  const hasFee = installFee != null && installFee > 0

  const handleComplete = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/installations/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, completed_by: completedBy }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to complete installation')
      setResult(data)
      setShowConfirm(false)
      onCompleted?.(data)
    } catch (err: any) {
      setResult({ success: false, error: err.message })
    } finally {
      setLoading(false)
    }
  }

  // ── Post-action result feedback ──
  if (result) {
    if (result.success) {
      const cs = result.charge_status
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            color: '#4ade80', fontSize: 13, fontWeight: 600,
          }}>
            ✅ Installation Marked Complete
          </div>
          {cs === 'charged' && (
            <span style={{
              fontSize: 12, padding: '4px 10px', borderRadius: 6,
              backgroundColor: 'rgba(34,197,94,0.12)', color: '#4ade80',
              border: '1px solid rgba(34,197,94,0.25)',
            }}>
              💳 ${result.charge_details.amount.toFixed(2)} charged to ••••{result.charge_details.last_four}
            </span>
          )}
          {cs === 'failed' && (
            <span style={{
              fontSize: 12, padding: '4px 10px', borderRadius: 6,
              backgroundColor: 'rgba(239,68,68,0.12)', color: '#f87171',
              border: '1px solid rgba(239,68,68,0.25)',
            }}>
              ⚠️ Charge failed: {result.charge_details.error} — retry manually
            </span>
          )}
          {cs === 'skipped' && (
            <span style={{
              fontSize: 12, padding: '4px 10px', borderRadius: 6,
              backgroundColor: 'rgba(251,191,36,0.12)', color: '#fbbf24',
              border: '1px solid rgba(251,191,36,0.25)',
            }}>
              {result.charge_details?.reason || 'No install fee'}
            </span>
          )}
        </div>
      )
    } else {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#f87171', fontSize: 13 }}>❌ {result.error}</span>
          <button
            onClick={() => { setResult(null); setShowConfirm(false) }}
            style={{ color: '#64748b', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Try again
          </button>
        </div>
      )
    }
  }

  // ── Confirmation inline panel ──
  if (showConfirm) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: '12px 14px', borderRadius: 8,
        background: '#1a2a36', border: '1px solid rgba(34,197,94,0.3)',
      }}>
        <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>
          Mark this installation as complete?
        </div>
        {hasFee ? (
          <div style={{ color: '#94a3b8', fontSize: 12 }}>
            This will charge <strong style={{ color: '#e2e8f0' }}>${installFee!.toFixed(2)}</strong> (install fee)
            to <strong style={{ color: '#e2e8f0' }}>{customerName}</strong>'s card on file.
          </div>
        ) : (
          <div style={{ color: '#94a3b8', fontSize: 12 }}>
            No install fee to charge for this job.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            onClick={handleComplete}
            disabled={loading}
            style={{
              fontSize: 13, padding: '9px 18px', borderRadius: 8, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
              backgroundColor: '#16a34a', color: '#ffffff', border: '1px solid #22c55e',
              opacity: loading ? 0.6 : 1, whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {loading ? '⏳ Processing…' : hasFee ? `✅ Complete & Charge $${installFee!.toFixed(2)}` : '✅ Complete'}
          </button>
          <button
            onClick={() => setShowConfirm(false)}
            disabled={loading}
            style={{
              fontSize: 13, padding: '9px 18px', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
              backgroundColor: 'transparent', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.3)',
              whiteSpace: 'nowrap',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // ── Default: the trigger button ──
  return (
    <button
      onClick={() => setShowConfirm(true)}
      style={{
        fontSize: 13, padding: '9px 18px', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
        backgroundColor: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)',
        whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6,
      }}
    >
      ✅ Mark Complete{hasFee ? ` & Charge $${installFee!.toFixed(2)}` : ''}
    </button>
  )
}
