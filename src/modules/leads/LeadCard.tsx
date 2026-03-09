import { useState } from 'react'
import type { Lead } from './leads.types'
import { LEAD_SOURCE_LABELS, WATER_CONCERN_LABELS, LEAD_STAGE_COLORS } from '../../types/domain.types'

interface Props {
  lead: Lead
  onClick: (lead: Lead) => void
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function initials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

export function LeadCard({ lead, onClick }: Props) {
  const days = daysSince(lead.stage_changed_at)
  const isStale = days >= 3

  return (
    <div
      onClick={() => onClick(lead)}
      className={`bg-card border rounded-xl p-3 cursor-pointer hover:border-accent/50 transition-all group ${lead.urgent ? 'border-orange/50' : 'border-border'}`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Avatar */}
          <div className="w-7 h-7 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center flex-shrink-0">
            {initials(lead.full_name)}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate leading-tight">
              {lead.full_name}
            </div>
            <div className="text-xs text-muted truncate">{lead.phone}</div>
          </div>
        </div>

        {/* Flags */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {lead.urgent && (
            <span className="text-orange text-xs" title="Urgent">🔥</span>
          )}
          {isStale && (
            <span className="text-amber text-xs" title={`${days} days in stage`}>⏰</span>
          )}
        </div>
      </div>

      {/* Concern badge */}
      {lead.water_concern && (
        <div className="mb-2">
          <span className="text-xs bg-surface border border-border rounded px-1.5 py-0.5 text-muted">
            {WATER_CONCERN_LABELS[lead.water_concern]}
          </span>
        </div>
      )}

      {/* Bottom row */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">
          {LEAD_SOURCE_LABELS[lead.source]}
        </span>
        <div className="flex items-center gap-2">
          {/* Assigned rep initials */}
          {lead.assigned_rep && (
            <div className="w-5 h-5 rounded-full bg-green/20 text-green text-xs font-bold flex items-center justify-center" title={lead.assigned_rep.full_name}>
              {initials(lead.assigned_rep.full_name)}
            </div>
          )}
          {/* Days in stage */}
          <span className={`text-xs ${isStale ? 'text-amber' : 'text-muted'}`}>
            {days === 0 ? 'Today' : `${days}d`}
          </span>
        </div>
      </div>
    </div>
  )
}
