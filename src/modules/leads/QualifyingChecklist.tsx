// src/modules/leads/QualifyingChecklist.tsx
// Dynamic qualifying checklist — reads questions from qualifying_questions table
// Renders when lead.stage === 'qualifying', saves answers to lead.qualifying_answers JSONB

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import type { Lead } from './leads.types'
import { LEAD_SOURCE_LABELS, WATER_CONCERN_LABELS } from '../../types/domain.types'

interface QualifyingQuestion {
  id: string
  question_text: string
  field_type: string  // dropdown | yes_no | number | text | prefill_water_concern | prefill_address | prefill_source
  options: string[]
  is_required: boolean
  sort_order: number
  is_active: boolean
}

interface Props {
  lead: Lead
  onLeadUpdated: (lead: Lead) => void
}

export default function QualifyingChecklist({ lead, onLeadUpdated }: Props) {
  const [questions, setQuestions] = useState<QualifyingQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Load questions + existing answers
  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('qualifying_questions')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')

      if (data) setQuestions(data)

      // Load existing answers from lead
      const existing = (lead as any).qualifying_answers || {}

      // Pre-fill from lead data for special field types
      const prefilled: Record<string, any> = { ...existing }
      if (data) {
        for (const q of data) {
          if (prefilled[q.id] !== undefined) continue // already answered, don't overwrite
          if (q.field_type === 'prefill_water_concern' && lead.water_concern) {
            prefilled[q.id] = WATER_CONCERN_LABELS[lead.water_concern] || lead.water_concern
          }
          if (q.field_type === 'prefill_address') {
            const addr = [lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')
            if (addr) prefilled[q.id] = addr
          }
          if (q.field_type === 'prefill_source' && lead.source) {
            prefilled[q.id] = LEAD_SOURCE_LABELS[lead.source] || lead.source
          }
        }
      }

      setAnswers(prefilled)
      setLoading(false)
    }
    load()
  }, [lead.id])

  // Save answer to DB
  const saveAnswer = useCallback(async (questionId: string, value: any) => {
    const updated = { ...answers, [questionId]: value }
    setAnswers(updated)
    setSaving(true)

    const { data, error } = await supabase
      .from('leads')
      .update({ qualifying_answers: updated })
      .eq('id', lead.id)
      .select('*')
      .single()

    if (!error && data) {
      onLeadUpdated({ ...lead, ...data })
    }
    setSaving(false)
  }, [answers, lead, onLeadUpdated])

  // Count completed
  const requiredQuestions = questions.filter(q => q.is_required)
  const answeredRequired = requiredQuestions.filter(q => {
    const val = answers[q.id]
    return val !== undefined && val !== null && val !== ''
  })
  const allRequiredDone = answeredRequired.length === requiredQuestions.length
  const totalAnswered = questions.filter(q => {
    const val = answers[q.id]
    return val !== undefined && val !== null && val !== ''
  }).length

  if (loading) {
    return (
      <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-4">
        <div className="text-xs text-cyan-400 animate-pulse">Loading checklist...</div>
      </div>
    )
  }

  if (questions.length === 0) return null

  return (
    <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-cyan-400 uppercase tracking-wide">
            Qualifying Checklist
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {totalAnswered} of {questions.length} answered
            {!allRequiredDone && (
              <span className="text-amber-400 ml-1">
                · {requiredQuestions.length - answeredRequired.length} required remaining
              </span>
            )}
          </div>
        </div>
        {saving && <div className="text-xs text-cyan-400 animate-pulse">Saving...</div>}
        {allRequiredDone && !saving && (
          <div className="text-xs font-bold text-emerald-400 flex items-center gap-1">
            ✓ Ready to qualify
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${allRequiredDone ? 'bg-emerald-500' : 'bg-cyan-500'}`}
          style={{ width: `${(answeredRequired.length / Math.max(requiredQuestions.length, 1)) * 100}%` }}
        />
      </div>

      {/* Questions */}
      <div className="space-y-2.5">
        {questions.map(q => {
          const val = answers[q.id]
          const isAnswered = val !== undefined && val !== null && val !== ''
          const isPrefill = q.field_type.startsWith('prefill_')

          return (
            <div key={q.id} className="flex items-start gap-2.5">
              {/* Checkbox indicator */}
              <div className={`mt-1 w-4 h-4 rounded flex items-center justify-center flex-shrink-0 text-xs ${
                isAnswered
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : q.is_required
                    ? 'bg-slate-700/30 border border-amber-500/30 text-transparent'
                    : 'bg-slate-700/30 border border-slate-600/30 text-transparent'
              }`}>
                {isAnswered ? '✓' : ''}
              </div>

              {/* Question + input */}
              <div className="flex-1 min-w-0">
                <label className="text-xs font-medium text-slate-300 flex items-center gap-1">
                  {q.question_text}
                  {q.is_required && <span className="text-red-400">*</span>}
                  {isPrefill && isAnswered && (
                    <span className="text-xs text-slate-500 font-normal">(auto-filled)</span>
                  )}
                </label>

                <div className="mt-1">
                  {/* Dropdown */}
                  {(q.field_type === 'dropdown') && (
                    <select
                      value={val || ''}
                      onChange={e => saveAnswer(q.id, e.target.value)}
                      className="w-full bg-slate-800/60 border border-slate-600/40 rounded-lg px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500/50"
                    >
                      <option value="">— Select —</option>
                      {(q.options || []).map((opt: string) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  )}

                  {/* Yes/No */}
                  {q.field_type === 'yes_no' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveAnswer(q.id, 'Yes')}
                        className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                          val === 'Yes'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-800/40 text-slate-400 border border-slate-600/30 hover:bg-slate-700/40'
                        }`}
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => saveAnswer(q.id, 'No')}
                        className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                          val === 'No'
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                            : 'bg-slate-800/40 text-slate-400 border border-slate-600/30 hover:bg-slate-700/40'
                        }`}
                      >
                        No
                      </button>
                    </div>
                  )}

                  {/* Number */}
                  {q.field_type === 'number' && (
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={val || ''}
                      onChange={e => saveAnswer(q.id, e.target.value ? parseInt(e.target.value) : '')}
                      placeholder="Enter number"
                      className="w-24 bg-slate-800/60 border border-slate-600/40 rounded-lg px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500/50"
                    />
                  )}

                  {/* Text */}
                  {q.field_type === 'text' && (
                    <input
                      type="text"
                      value={val || ''}
                      onChange={e => saveAnswer(q.id, e.target.value)}
                      placeholder="Type answer..."
                      className="w-full bg-slate-800/60 border border-slate-600/40 rounded-lg px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500/50"
                    />
                  )}

                  {/* Pre-fill: Water concern (show as confirmed dropdown) */}
                  {q.field_type === 'prefill_water_concern' && (
                    <div className="flex items-center gap-2">
                      <select
                        value={val || ''}
                        onChange={e => saveAnswer(q.id, e.target.value)}
                        className="w-full bg-slate-800/60 border border-slate-600/40 rounded-lg px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500/50"
                      >
                        <option value="">— Select —</option>
                        {Object.entries(WATER_CONCERN_LABELS).map(([key, label]) => (
                          <option key={key} value={label}>{label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Pre-fill: Address (show with confirm button) */}
                  {q.field_type === 'prefill_address' && (
                    <div className="space-y-1">
                      <input
                        type="text"
                        value={val || ''}
                        onChange={e => saveAnswer(q.id, e.target.value)}
                        placeholder="Service address..."
                        className="w-full bg-slate-800/60 border border-slate-600/40 rounded-lg px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500/50"
                      />
                      {!isAnswered && (
                        <div className="text-xs text-amber-400">No address on file — please enter</div>
                      )}
                    </div>
                  )}

                  {/* Pre-fill: Source (read-only display with override option) */}
                  {q.field_type === 'prefill_source' && (
                    <select
                      value={val || ''}
                      onChange={e => saveAnswer(q.id, e.target.value)}
                      className="w-full bg-slate-800/60 border border-slate-600/40 rounded-lg px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500/50"
                    >
                      <option value="">— Select —</option>
                      {Object.entries(LEAD_SOURCE_LABELS).map(([key, label]) => (
                        <option key={key} value={label}>{label}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

