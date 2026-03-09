import { useState } from 'react'
import { useLeadsKanban, usePipelineCounts } from './useLeads'
import { LeadCard } from './LeadCard'
import { CreateLeadModal } from './CreateLeadModal'
import { LeadDetailPanel } from './LeadDetailPanel'
import type { Lead } from './leads.types'
import { PIPELINE_COLUMNS, LEAD_STAGE_LABELS } from '../../types/domain.types'
import type { LeadStage } from '../../types/domain.types'
import { useAuth } from '../../hooks/useAuth'
import { usePermission } from '../../hooks/usePermission'

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
  const { can } = usePermission(role)
  const { data: leadsByStage, isLoading, error } = useLeadsKanban()
  const { data: counts } = usePipelineCounts()

  const [showCreate, setShowCreate] = useState(false)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

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

      <div className="flex gap-4 overflow-x-auto flex-1 pb-4">
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
            <div key={stage} className={`kanban-col bg-surface border-t-2 ${STAGE_COLORS[stage]} rounded-xl flex-shrink-0`}>
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">
                  {LEAD_STAGE_LABELS[stage]}
                </span>
                <span className="text-xs bg-card border border-border rounded-full px-2 py-0.5 text-muted font-semibold">
                  {filtered.length}
                </span>
              </div>
              <div className="flex flex-col gap-2 p-2 overflow-y-auto max-h-[calc(100vh-220px)]">
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

        <div className="kanban-col bg-surface border-t-2 border-t-border rounded-xl flex-shrink-0">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">Other</span>
          </div>
          <div className="p-3 space-y-2">
            {(['won', 'lost', 'future_follow_up', 'dnd'] as LeadStage[]).map(s => (
              <div key={s} className="flex items-center justify-between text-xs">
                <span className="text-muted">{LEAD_STAGE_LABELS[s]}</span>
                <span className="text-slate-400 font-semibold">{counts?.[s] || 0}</span>
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
