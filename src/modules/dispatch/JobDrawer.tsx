import { useState, useCallback, useEffect } from 'react'
import type { Job } from './dispatch.types'
import { JOB_STATUS_LABELS, JOB_STATUS_COLORS, SYSTEM_TYPE_LABELS } from './dispatch.types'
import { JobOverviewTab } from './tabs/JobOverviewTab'
import { JobActivityTab } from './tabs/JobActivityTab'
import { useQueryClient } from '@tanstack/react-query'
import { JOB_KEYS } from './useJobs'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

interface Props {
  job: Job
  onClose: () => void
}

type DispatchTab = 'overview' | 'activity'

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

// Status badge override — ensures text is always visible regardless of color combo
const STATUS_BADGE_STYLES: Record<string, { background: string; color: string; border: string }> = {
  ready_to_schedule: { background: 'rgba(96,165,250,0.18)', color: '#93c5fd',  border: '1px solid rgba(96,165,250,0.5)'  },
  scheduled:         { background: 'rgba(34,211,238,0.15)', color: '#22d3ee',  border: '1px solid rgba(34,211,238,0.4)'  },
  waiting_for_stock: { background: 'rgba(245,158,11,0.15)', color: '#fbbf24',  border: '1px solid rgba(245,158,11,0.4)'  },
  in_progress:       { background: 'rgba(74,222,128,0.15)', color: '#4ade80',  border: '1px solid rgba(74,222,128,0.4)'  },
  complete:          { background: 'rgba(74,222,128,0.2)',  color: '#86efac',  border: '1px solid rgba(74,222,128,0.5)'  },
}

export function JobDrawer({ job: initialJob, onClose }: Props) {
  const { profile } = useAuth()
  const [job, setJob] = useState<Job>(initialJob)
  const [activeTab, setActiveTab] = useState<DispatchTab>('overview')
  const qc = useQueryClient()

  // SMS state
  const [showSmsModal, setShowSmsModal] = useState(false)
  const [smsMessage, setSmsMessage] = useState('')
  const [smsSending, setSmsSending] = useState(false)
  const [smsTemplates, setSmsTemplates] = useState<any[]>([])
  const [visitInfo, setVisitInfo] = useState<{ date?: string } | null>(null)

  useEffect(() => {
    supabase.from('sms_templates').select('*').eq('is_active', true).order('stage').order('name')
      .then(({ data }) => setSmsTemplates(data || []))
  }, [])

  const handleJobUpdated = useCallback((updated: Job) => {
    setJob(updated)
    qc.invalidateQueries({ queryKey: JOB_KEYS.board() })
    qc.invalidateQueries({ queryKey: JOB_KEYS.activity(updated.id) })
  }, [qc])

  async function handleSendSms() {
    if (!smsMessage.trim() || !job.phone_snapshot) return
    setSmsSending(true)
    try {
      await fetch('/api/openphone/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: job.phone_snapshot,
          message: smsMessage.trim(),
          entity_type: 'job',
          entity_id: job.id,
        }),
      })
      setShowSmsModal(false)
      setSmsMessage('')
    } catch (e) {
      console.error('Send SMS error:', e)
    } finally {
      setSmsSending(false)
    }
  }

  const badgeStyle = STATUS_BADGE_STYLES[job.status] || {
    background: 'rgba(100,116,139,0.15)', color: '#cbd5e1', border: '1px solid rgba(100,116,139,0.3)',
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface border-l border-border h-full overflow-y-auto shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-cyan/20 text-cyan font-bold flex items-center justify-center text-sm">
              {initials(job.customer_name_snapshot)}
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{job.customer_name_snapshot}</h2>
              <div className="text-sm text-muted">{job.phone_snapshot}</div>
              <div className="text-xs text-muted mt-0.5">{SYSTEM_TYPE_LABELS[job.system_type]}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* SMS button */}
            {job.phone_snapshot && (
              <button
                onClick={() => {
                  setSmsMessage(`Hi ${job.customer_name_snapshot.split(' ')[0]}, `)
                  setShowSmsModal(true)
                }}
                style={{
                  padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  background: 'rgba(34,197,94,0.1)', color: '#22c55e',
                  border: '1px solid rgba(34,197,94,0.3)',
                }}
              >
                💬 Text
              </button>
            )}

            {/* Status badge — always visible */}
            <div style={{
              padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
              whiteSpace: 'nowrap',
              ...badgeStyle,
            }}>
              {JOB_STATUS_LABELS[job.status]}
            </div>

            <button onClick={onClose} className="text-muted hover:text-white text-xl leading-none ml-1">✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border flex-shrink-0">
          {(['overview', 'activity'] as DispatchTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                activeTab === tab
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-muted hover:text-slate-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'overview' && <JobOverviewTab job={job} onJobUpdated={handleJobUpdated} />}
          {activeTab === 'activity' && <JobActivityTab jobId={job.id} />}
        </div>

        {/* SMS Modal */}
        {showSmsModal && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center p-4 z-20">
            <div className="bg-card border border-border rounded-2xl w-full max-w-sm p-5 shadow-2xl">
              <h3 className="font-bold text-white mb-1">Send Text</h3>
              <p className="text-xs text-muted mb-4">To: {job.phone_snapshot}</p>

              {smsTemplates.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Use Template</label>
                  <select
                    defaultValue=""
                    onChange={e => {
                      const t = smsTemplates.find(t => t.id === e.target.value)
                      if (!t) return
                      const firstName = job.customer_name_snapshot?.split(' ')[0] || ''
                      setSmsMessage(
                        t.body
                          .replace(/{first_name}/g, firstName)
                          .replace(/{rep_name}/g, profile?.full_name || 'Your Zenith Tech')
                          .replace(/{company}/g, 'Zenith Pure Solutions')
                          .replace(/{review_url}/g, import.meta.env.VITE_GOOGLE_REVIEW_URL || '')
                          .replace(/{visit_date}/g, '')
                          .replace(/{install_date}/g, job.scheduled_date ? new Date(job.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '')
                      )
                      e.target.value = ''
                    }}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-accent"
                  >
                    <option value="">— Pick a template —</option>
                    {smsTemplates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Message</label>
              <textarea
                value={smsMessage}
                onChange={e => setSmsMessage(e.target.value)}
                placeholder="Type your message..."
                rows={4}
                autoFocus
                className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent resize-none"
              />
              <div className="text-right text-xs text-muted mt-1">{smsMessage.length} chars</div>

              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => { setShowSmsModal(false); setSmsMessage('') }}
                  className="flex-1 py-2 text-sm text-muted hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendSms}
                  disabled={smsSending || !smsMessage.trim()}
                  className="flex-1 py-2 font-semibold rounded-lg text-sm transition-colors disabled:opacity-50"
                  style={{ background: '#22c55e', color: '#fff' }}
                >
                  {smsSending ? 'Sending…' : 'Send Text 💬'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
