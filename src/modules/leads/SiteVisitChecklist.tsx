// src/modules/leads/SiteVisitChecklist.tsx
// Admin-configurable site visit checklist — same pattern as QualifyingChecklist
// Includes photo upload for photo-type questions

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { Lead } from './leads.types'

interface SiteVisitQuestion {
  id: string
  question_text: string
  field_type: string  // dropdown | yes_no | number | text | photo
  options: string[]
  is_required: boolean
  requires_photo: boolean
  sort_order: number
  is_active: boolean
}

interface Props {
  lead: Lead
  onLeadUpdated: (lead: Lead) => void
  onCompletionChange?: (allRequiredDone: boolean) => void
}

export default function SiteVisitChecklist({ lead, onLeadUpdated, onCompletionChange }: Props) {
  const { user } = useAuth()
  const [questions, setQuestions] = useState<SiteVisitQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)

  // Load questions + existing answers
  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('site_visit_questions')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')

      if (data) setQuestions(data)

      const existing = (lead as any).site_visit_answers || {}
      setAnswers(existing)
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
      .update({ site_visit_answers: updated })
      .eq('id', lead.id)
      .select('*')
      .single()

    if (!error && data) {
      onLeadUpdated({ ...lead, ...data })
    }
    setSaving(false)
  }, [answers, lead, onLeadUpdated])

  // Photo upload
  async function handlePhotoUpload(questionId: string, file: File) {
    if (!user) return
    setUploading(questionId)

    try {
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `site-visit-photos/${lead.id}/${questionId}-${Date.now()}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(path, file, { upsert: true })

      if (uploadError) {
        // If storage bucket doesn't exist, save as base64 data URL instead
        const reader = new FileReader()
        reader.onload = async () => {
          const dataUrl = reader.result as string
          await saveAnswer(questionId, dataUrl)
        }
        reader.readAsDataURL(file)
        return
      }

      const { data: urlData } = supabase.storage.from('media').getPublicUrl(path)
      await saveAnswer(questionId, urlData.publicUrl)

      // Also save to media table for cross-module visibility
      await supabase.from('media').insert({
        entity_type: 'site_visit_photo',
        entity_id: lead.id,
        file_type: 'photo',
        url: urlData.publicUrl,
        filename: file.name,
        metadata: { question_id: questionId },
        uploaded_by: user.id,
      }).catch(() => {}) // best effort
    } catch (e: any) {
      console.error('Photo upload failed:', e)
      alert('Photo upload failed. Try again.')
    } finally {
      setUploading(null)
    }
  }

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

  // Notify parent when completion state changes
  useEffect(() => {
    onCompletionChange?.(allRequiredDone && questions.length > 0)
  }, [allRequiredDone, questions.length])

  if (loading) {
    return (
      <div className="rounded-xl p-4" style={{ backgroundColor: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.2)' }}>
        <div className="text-xs animate-pulse" style={{ color: '#c084fc' }}>Loading site visit checklist...</div>
      </div>
    )
  }

  if (questions.length === 0) return null

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.2)' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide" style={{ color: '#c084fc' }}>
            Site Visit Checklist
          </div>
          <div className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>
            {totalAnswered} of {questions.length} completed
            {!allRequiredDone && (
              <span style={{ color: '#fbbf24' }} className="ml-1">
                · {requiredQuestions.length - answeredRequired.length} required remaining
              </span>
            )}
          </div>
        </div>
        {saving && <div className="text-xs animate-pulse" style={{ color: '#c084fc' }}>Saving...</div>}
        {allRequiredDone && !saving && (
          <div className="text-xs font-bold flex items-center gap-1" style={{ color: '#4ade80' }}>
            ✓ Ready to build quote
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(100,116,139,0.3)' }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${(answeredRequired.length / Math.max(requiredQuestions.length, 1)) * 100}%`,
            backgroundColor: allRequiredDone ? '#4ade80' : '#a855f7',
          }}
        />
      </div>

      {/* Questions */}
      <div className="space-y-3">
        {questions.map(q => {
          const val = answers[q.id]
          const isAnswered = val !== undefined && val !== null && val !== ''
          const isPhoto = q.field_type === 'photo'

          return (
            <div key={q.id} className="flex items-start gap-2.5">
              {/* Checkbox indicator */}
              <div className="mt-1 w-4 h-4 rounded flex items-center justify-center flex-shrink-0 text-xs" style={{
                backgroundColor: isAnswered ? 'rgba(74,222,128,0.2)' : 'rgba(100,116,139,0.2)',
                border: isAnswered ? '1px solid rgba(74,222,128,0.3)' : q.is_required ? '1px solid rgba(245,158,11,0.3)' : '1px solid rgba(100,116,139,0.3)',
                color: isAnswered ? '#4ade80' : 'transparent',
              }}>
                {isAnswered ? '✓' : ''}
              </div>

              {/* Question + input */}
              <div className="flex-1 min-w-0">
                <label className="text-xs font-medium flex items-center gap-1" style={{ color: '#cbd5e1' }}>
                  {isPhoto && '📷 '}{q.question_text}
                  {q.is_required && <span style={{ color: '#f87171' }}>*</span>}
                </label>

                <div className="mt-1">
                  {/* Photo upload */}
                  {isPhoto && (
                    <div>
                      {isAnswered ? (
                        <div className="space-y-1">
                          <img
                            src={val}
                            alt={q.question_text}
                            className="w-full max-w-xs rounded-lg border"
                            style={{ borderColor: '#334155', maxHeight: 200, objectFit: 'cover' }}
                          />
                          <div className="flex gap-2">
                            <span className="text-xs" style={{ color: '#4ade80' }}>✓ Photo uploaded</span>
                            <label className="text-xs cursor-pointer" style={{ color: '#60a5fa' }}>
                              Replace
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                onChange={e => {
                                  const f = e.target.files?.[0]
                                  if (f) handlePhotoUpload(q.id, f)
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      ) : (
                        <label
                          className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg cursor-pointer transition-colors"
                          style={{
                            backgroundColor: uploading === q.id ? 'rgba(168,85,247,0.2)' : 'rgba(100,116,139,0.15)',
                            border: '2px dashed rgba(100,116,139,0.3)',
                          }}
                        >
                          <span className="text-sm">{uploading === q.id ? '⏳' : '📷'}</span>
                          <span className="text-xs font-medium" style={{ color: '#94a3b8' }}>
                            {uploading === q.id ? 'Uploading...' : 'Take Photo or Upload'}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            disabled={uploading === q.id}
                            onChange={e => {
                              const f = e.target.files?.[0]
                              if (f) handlePhotoUpload(q.id, f)
                            }}
                          />
                        </label>
                      )}
                    </div>
                  )}

                  {/* Dropdown */}
                  {q.field_type === 'dropdown' && (
                    <select
                      value={val || ''}
                      onChange={e => saveAnswer(q.id, e.target.value)}
                      className="w-full rounded-lg px-2.5 py-1.5 text-sm focus:outline-none"
                      style={{ backgroundColor: 'rgba(30,41,59,0.6)', border: '1px solid rgba(100,116,139,0.4)', color: '#e2e8f0' }}
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
                        className="px-3 py-1 text-xs rounded-lg font-medium transition-colors"
                        style={{
                          backgroundColor: val === 'Yes' ? 'rgba(74,222,128,0.2)' : 'rgba(30,41,59,0.4)',
                          color: val === 'Yes' ? '#4ade80' : '#94a3b8',
                          border: val === 'Yes' ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(100,116,139,0.3)',
                        }}
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => saveAnswer(q.id, 'No')}
                        className="px-3 py-1 text-xs rounded-lg font-medium transition-colors"
                        style={{
                          backgroundColor: val === 'No' ? 'rgba(239,68,68,0.2)' : 'rgba(30,41,59,0.4)',
                          color: val === 'No' ? '#f87171' : '#94a3b8',
                          border: val === 'No' ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(100,116,139,0.3)',
                        }}
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
                      value={val || ''}
                      onChange={e => saveAnswer(q.id, e.target.value ? parseInt(e.target.value) : '')}
                      placeholder="Enter number"
                      className="w-24 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none"
                      style={{ backgroundColor: 'rgba(30,41,59,0.6)', border: '1px solid rgba(100,116,139,0.4)', color: '#e2e8f0' }}
                    />
                  )}

                  {/* Text */}
                  {q.field_type === 'text' && (
                    <input
                      type="text"
                      value={val || ''}
                      onChange={e => saveAnswer(q.id, e.target.value)}
                      placeholder="Type answer..."
                      className="w-full rounded-lg px-2.5 py-1.5 text-sm focus:outline-none"
                      style={{ backgroundColor: 'rgba(30,41,59,0.6)', border: '1px solid rgba(100,116,139,0.4)', color: '#e2e8f0' }}
                    />
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

