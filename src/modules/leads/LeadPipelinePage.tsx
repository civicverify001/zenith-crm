import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLeadsKanban, usePipelineCounts } from './useLeads'
import { LeadCard } from './LeadCard'
import { CreateLeadModal } from './CreateLeadModal'
import { LeadDetailPanel } from './LeadDetailPanel'
import type { Lead } from './leads.types'
import { PIPELINE_COLUMNS, LEAD_STAGE_LABELS } from '../../types/domain.types'
import type { LeadStage } from '../../types/domain.types'
import { useAuth } from '../../hooks/useAuth'
import { usePermissions } from '../../hooks/usePermissions'

const STAGE_COLORS: Record<string, string> = {
  new_lead:             'border-t-muted',
  qualifying:           'border-t-purple',
  qualified:            'border-t-accent',
  site_visit_scheduled: 'border-t-cyan',
  proposal_in_progress: 'border-t-cyan',
  quote_sent:           'border-t-amber',
  agreement_signed:     'border-t-green',
}

export function LeadPipelinePage() {
  const { role } = useAuth()
  const { can } = usePermissions(role)
  const { data: leadsByStage, isLoading, error } = useLeadsKanban()
  const { data: counts } = usePipelineCounts()
  const [searchParams, setSearchParams] = useSearchParams()

  const [showCreate, setShowCreate] = useState(false)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Auto-open lead panel when ?lead=<id> is in the URL
  useEffect(() => {
    const leadId = searchParams.get('lead')
    if (!leadId || !leadsByStage) return
    const allLeads = Object.values(leadsByStage).flat()
    const found = allLeads.find((l: Lead) => l.id === leadId)
    if (found) {
      setSelectedLead(found)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, leadsByStage])

  const totalActive = Object.values(counts || {}).reduce((a, b) => a + b, 0)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted text-sm">Loading pipeline...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red text-sm">Failed to load pipeline. Please refresh.</div>
      </div>
    )
  }

  // Total columns = pipeline stages + 1 Other column
  const totalCols = PIPELINE_COLUMNS.length + 1

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-5 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white">Lead Pipeline</h1>
          <p className="text-sm text-muted mt-0.5">
            {totalActive} active lead{totalActive !== 1 ? 's' : ''} in pipeline
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search leads..."
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent w-48 transition-colors"
          />
          {can('leads', 'create') && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 bg-accent hover:bg-sky-400 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
            >
              <span className="text-base leading-none">+</span>
              New Lead
            </button>
          )}
        </div>
      </div>

      {/* ── Kanban grid — all columns fit on screen ── */}
      <div
        className="flex-1 pb-2"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${totalCols}, minmax(0, 1fr))`,
          gap: 8,
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        {PIPELINE_COLUMNS.map(stage => {
          const stageleads = leadsByStage?.[stage] || []
          const filtered = searchQuery
            ? stageleads.filter(l =>
                l.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                l.phone.includes(searchQuery) ||
                l.email?.toLowerCase().includes(searchQuery.toLowerCase())
              )
            : stageleads

          return (
            <div
              key={stage}
              className={`bg-surface border-t-2 ${STAGE_COLORS[stage]} rounded-xl`}
              style={{ minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            >
              {/* Column header */}
              <div className="flex items-center justify-between px-2 py-2 border-b border-border flex-shrink-0">
                <span
                  className="font-bold text-slate-300 uppercase tracking-wide truncate"
                  style={{ fontSize: 10 }}
                >
                  {LEAD_STAGE_LABELS[stage]}
                </span>
                <span className="text-xs bg-card border border-border rounded-full px-1.5 py-0.5 text-muted font-semibold flex-shrink-0 ml-1">
                  {filtered.length}
                </span>
              </div>
              {/* Cards */}
              <div
                className="flex flex-col gap-1.5 p-1.5 overflow-y-auto"
                style={{ maxHeight: 'calc(100vh - 220px)' }}
              >
                {filtered.length === 0 ? (
                  <div className="text-center py-6 text-xs text-muted">No leads</div>
                ) : (
                  filtered.map(lead => (
                    <LeadCard key={lead.id} lead={lead} onClick={setSelectedLead} />
                  ))
                )}
              </div>
            </div>
          )
        })}

        {/* Other column */}
        <div
          className="bg-surface border-t-2 border-t-border rounded-xl"
          style={{ minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        >
          <div className="flex items-center justify-between px-2 py-2 border-b border-border flex-shrink-0">
            <span className="font-bold text-slate-300 uppercase tracking-wide" style={{ fontSize: 10 }}>Other</span>
          </div>
          <div className="p-2 space-y-1.5">
            {(['won', 'lost', 'future_follow_up', 'dnd'] as LeadStage[]).map(s => (
              <div key={s} className="flex items-center justify-between" style={{ fontSize: 11 }}>
                <span className="text-muted truncate">{LEAD_STAGE_LABELS[s]}</span>
                <span className="text-slate-400 font-semibold ml-1 flex-shrink-0">{counts?.[s] || 0}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showCreate && (
        <CreateLeadModal onClose={() => setShowCreate(false)} onCreated={() => setShowCreate(false)} />
      )}
      {selectedLead && (
        <LeadDetailPanel lead={selectedLead} onClose={() => setSelectedLead(null)} />
      )}
    </div>
  )
}
