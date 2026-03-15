// src/modules/shared/ChecklistRenderer.tsx
// Renders any checklist template with sections and items for tech to fill in
// Used in lead detail (site survey), installation (installer + handover), and customer detail
import { useState, useEffect } from 'react'
import { useAuth } from '../../hooks/useAuth'
import {
  fetchTemplateWithSections,
  fetchResponses,
  bulkSaveResponses,
  getCompletionStats,
  type ChecklistTemplate,
  type ChecklistSection,
  type ChecklistItem,
  type ChecklistResponse,
} from '../../services/checklistService'

interface ChecklistRendererProps {
  templateId: string
  entityType: 'lead' | 'job' | 'customer'
  entityId: string
  readOnly?: boolean
  onComplete?: () => void
}

export function ChecklistRenderer({
  templateId, entityType, entityId, readOnly = false, onComplete,
}: ChecklistRendererProps) {
  const { profile } = useAuth()
  const [template, setTemplate] = useState<ChecklistTemplate | null>(null)
  const [responses, setResponses] = useState<Record<string, { value: string; photo_url: string | null }>>({})
  const [stats, setStats] = useState({ total: 0, completed: 0, percentage: 0 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [skippedSections, setSkippedSections] = useState<Set<string>>(new Set())

  useEffect(() => { loadData() }, [templateId, entityType, entityId])

  async function loadData() {
    setLoading(true)
    const [tmpl, existingResponses, completionStats] = await Promise.all([
      fetchTemplateWithSections(templateId),
      fetchResponses(entityType, entityId, templateId),
      getCompletionStats(templateId, entityType, entityId),
    ])
    setTemplate(tmpl)
    setStats(completionStats)

    // Build response map: item_id -> { value, photo_url }
    const respMap: Record<string, { value: string; photo_url: string | null }> = {}
    for (const r of existingResponses) {
      respMap[r.item_id] = { value: r.response_value || '', photo_url: r.photo_url }
    }
    setResponses(respMap)

    // Expand all sections by default
    if (tmpl?.sections) {
      setExpandedSections(new Set(tmpl.sections.map(s => s.id)))
    }
    setLoading(false)
  }

  function updateResponse(itemId: string, value: string) {
    setResponses(prev => ({
      ...prev,
      [itemId]: { value, photo_url: prev[itemId]?.photo_url || null },
    }))
  }

  function toggleCheckbox(itemId: string) {
    const current = responses[itemId]?.value
    updateResponse(itemId, current === 'true' ? 'false' : 'true')
  }

  function toggleSection(sectionId: string) {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }

  function toggleSkipSection(sectionId: string) {
    setSkippedSections(prev => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }

  async function handleSave() {
    if (!template?.sections) return
    setSaving(true)
    setSaveMsg('')

    // Collect all responses (excluding skipped conditional sections)
    const allResponses: {
      section_id: string; item_id: string; response_value: string | null; photo_url?: string | null
    }[] = []

    for (const section of template.sections) {
      if (skippedSections.has(section.id)) continue
      if (!section.items) continue
      for (const item of section.items) {
        const resp = responses[item.id]
        allResponses.push({
          section_id: section.id,
          item_id: item.id,
          response_value: resp?.value || null,
          photo_url: resp?.photo_url || null,
        })
      }
    }

    const success = await bulkSaveResponses(
      templateId, entityType, entityId, allResponses, profile?.id || null
    )

    if (success) {
      setSaveMsg('✅ Saved')
      const newStats = await getCompletionStats(templateId, entityType, entityId)
      setStats(newStats)
      if (newStats.percentage === 100 && onComplete) {
        onComplete()
      }
    } else {
      setSaveMsg('❌ Failed to save')
    }
    setSaving(false)
    setTimeout(() => setSaveMsg(''), 3000)
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', color: '#64748b', padding: '48px 0' }}>Loading checklist...</div>
    )
  }

  if (!template) {
    return (
      <div style={{ textAlign: 'center', color: '#64748b', padding: '48px 0' }}>Checklist template not found.</div>
    )
  }

  const sections = template.sections || []
  const totalItems = sections.reduce((sum, s) => sum + (s.items?.length || 0), 0)

  return (
    <div style={{
      background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid #1e3a4f',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>{template.name}</div>
          <div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>
            {sections.length} sections · {totalItems} items
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 100, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${stats.percentage}%`, height: '100%', borderRadius: 3,
                background: stats.percentage === 100
                  ? 'linear-gradient(90deg, #4ade80, #22c55e)'
                  : 'linear-gradient(90deg, #3b82f6, #2563eb)',
                transition: 'width 0.3s',
              }} />
            </div>
            <span style={{
              fontSize: 12, fontWeight: 700,
              color: stats.percentage === 100 ? '#4ade80' : '#60a5fa',
            }}>
              {stats.percentage}%
            </span>
          </div>
          {!readOnly && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {saveMsg && (
                <span style={{ fontSize: 12, fontWeight: 600, color: saveMsg.includes('❌') ? '#f87171' : '#4ade80' }}>
                  {saveMsg}
                </span>
              )}
              <button onClick={handleSave} disabled={saving} style={{
                padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, color: '#fff',
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none',
                cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1,
              }}>
                {saving ? 'Saving...' : 'Save Progress'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Sections */}
      <div style={{ maxHeight: 600, overflowY: 'auto' }}>
        {sections.map((section, sIdx) => {
          const isExpanded = expandedSections.has(section.id)
          const isSkipped = skippedSections.has(section.id)
          const items = section.items || []
          const sectionCompleted = items.filter(i => {
            const resp = responses[i.id]
            return resp && resp.value && resp.value !== '' && resp.value !== 'false'
          }).length

          return (
            <div key={section.id} style={{
              borderBottom: '1px solid #1e3a4f',
              opacity: isSkipped ? 0.4 : 1,
            }}>
              {/* Section header */}
              <div
                onClick={() => toggleSection(section.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px',
                  cursor: 'pointer', background: isExpanded ? 'rgba(255,255,255,0.02)' : 'transparent',
                }}
              >
                <span style={{ color: '#64748b', fontSize: 12, fontFamily: 'monospace', width: 16 }}>
                  {isExpanded ? '▼' : '▶'}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {section.letter_label && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                        background: 'rgba(139,92,246,0.12)', color: '#a78bfa',
                        border: '1px solid rgba(139,92,246,0.25)',
                      }}>
                        {section.letter_label}
                      </span>
                    )}
                    <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13 }}>{section.title}</span>
                    {section.is_conditional && (
                      <span style={{
                        fontSize: 10, padding: '1px 8px', borderRadius: 10,
                        background: 'rgba(245,158,11,0.1)', color: '#f59e0b',
                        border: '1px solid rgba(245,158,11,0.25)',
                      }}>
                        {section.condition_label || 'Conditional'}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {isSkipped ? 'Skipped' : `${sectionCompleted} / ${items.length} completed`}
                  </div>
                </div>
                {section.is_conditional && !readOnly && (
                  <button
                    onClick={e => { e.stopPropagation(); toggleSkipSection(section.id) }}
                    style={{
                      fontSize: 10, padding: '3px 10px', borderRadius: 10, cursor: 'pointer',
                      background: isSkipped ? 'rgba(245,158,11,0.12)' : 'rgba(100,116,139,0.08)',
                      color: isSkipped ? '#f59e0b' : '#64748b',
                      border: `1px solid ${isSkipped ? 'rgba(245,158,11,0.3)' : 'rgba(100,116,139,0.15)'}`,
                      fontWeight: 700,
                    }}>
                    {isSkipped ? 'N/A — Skipped' : 'Mark N/A'}
                  </button>
                )}
              </div>

              {/* Items */}
              {isExpanded && !isSkipped && (
                <div style={{ padding: '0 20px 16px 48px' }}>
                  {items.map((item, iIdx) => (
                    <ChecklistItemRow
                      key={item.id}
                      item={item}
                      index={iIdx + 1}
                      value={responses[item.id]?.value || ''}
                      readOnly={readOnly}
                      onChange={val => updateResponse(item.id, val)}
                      onToggle={() => toggleCheckbox(item.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Checklist Item Row ────────────────────────────────────────
function ChecklistItemRow({ item, index, value, readOnly, onChange, onToggle }: {
  item: ChecklistItem
  index: number
  value: string
  readOnly: boolean
  onChange: (val: string) => void
  onToggle: () => void
}) {
  const isChecked = value === 'true'
  const hasValue = value && value !== '' && value !== 'false'

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0',
      borderBottom: '1px solid rgba(255,255,255,0.03)',
    }}>
      {/* Number */}
      <span style={{
        fontSize: 11, color: '#475569', fontFamily: 'monospace', width: 20, paddingTop: 2, flexShrink: 0,
      }}>
        {index}.
      </span>

      {/* Input based on field_type */}
      <div style={{ flex: 1 }}>
        {item.field_type === 'checkbox' && (
          <label style={{
            display: 'flex', alignItems: 'center', gap: 10,
            cursor: readOnly ? 'default' : 'pointer',
          }}>
            <input
              type="checkbox"
              checked={isChecked}
              onChange={readOnly ? undefined : onToggle}
              disabled={readOnly}
              style={{ width: 18, height: 18, accentColor: '#4ade80', flexShrink: 0 }}
            />
            <span style={{
              fontSize: 13, color: isChecked ? '#e2e8f0' : '#94a3b8',
              textDecoration: isChecked ? 'none' : 'none',
            }}>
              {item.item_text}
            </span>
          </label>
        )}

        {item.field_type === 'text' && (
          <div>
            <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 6 }}>{item.item_text}</div>
            <input
              type="text" value={value} onChange={e => onChange(e.target.value)}
              disabled={readOnly}
              placeholder="Enter response..."
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.04)', border: '1px solid #1e3a4f',
                borderRadius: 8, padding: '7px 12px', color: '#e2e8f0', fontSize: 12, outline: 'none',
              }}
            />
          </div>
        )}

        {item.field_type === 'number' && (
          <div>
            <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 6 }}>{item.item_text}</div>
            <input
              type="number" value={value} onChange={e => onChange(e.target.value)}
              disabled={readOnly}
              placeholder="0"
              style={{
                width: 120, boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.04)', border: '1px solid #1e3a4f',
                borderRadius: 8, padding: '7px 12px', color: '#e2e8f0', fontSize: 12, outline: 'none',
              }}
            />
          </div>
        )}

        {item.field_type === 'dropdown' && (
          <div>
            <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 6 }}>{item.item_text}</div>
            <select
              value={value} onChange={e => onChange(e.target.value)}
              disabled={readOnly}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.04)', border: '1px solid #1e3a4f',
                borderRadius: 8, padding: '7px 12px', color: '#e2e8f0', fontSize: 12, outline: 'none',
              }}
            >
              <option value="" style={{ background: '#0f1923' }}>Select...</option>
              {(item.options || []).map(opt => (
                <option key={opt} value={opt} style={{ background: '#0f1923' }}>{opt}</option>
              ))}
            </select>
          </div>
        )}

        {item.field_type === 'photo' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14 }}>📷</span>
              <span style={{ fontSize: 13, color: '#e2e8f0' }}>{item.item_text}</span>
            </div>
            {!readOnly && (
              <div style={{
                marginTop: 6, padding: '10px 14px', borderRadius: 8,
                background: 'rgba(245,158,11,0.05)', border: '1px dashed rgba(245,158,11,0.2)',
                fontSize: 11, color: '#f59e0b', textAlign: 'center',
              }}>
                Photo upload available in mobile view
              </div>
            )}
          </div>
        )}

        {/* Required + Photo badges */}
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          {item.is_required && (
            <span style={{
              fontSize: 9, padding: '1px 6px', borderRadius: 8,
              background: 'rgba(248,113,113,0.08)', color: '#f87171',
              border: '1px solid rgba(248,113,113,0.2)',
            }}>
              Required
            </span>
          )}
          {item.requires_photo && item.field_type !== 'photo' && (
            <span style={{
              fontSize: 9, padding: '1px 6px', borderRadius: 8,
              background: 'rgba(245,158,11,0.08)', color: '#f59e0b',
              border: '1px solid rgba(245,158,11,0.2)',
            }}>
              📷 Photo needed
            </span>
          )}
        </div>
      </div>

      {/* Completion indicator */}
      <div style={{ flexShrink: 0, paddingTop: 2 }}>
        {hasValue ? (
          <span style={{ fontSize: 14 }}>✅</span>
        ) : item.is_required ? (
          <span style={{ fontSize: 14 }}>⬜</span>
        ) : (
          <span style={{ fontSize: 14, opacity: 0.3 }}>⬜</span>
        )}
      </div>
    </div>
  )
}

// ── Compact Checklist Status Badge ────────────────────────────
// Shows completion % for use in list views and cards
export function ChecklistStatusBadge({ templateId, entityType, entityId }: {
  templateId: string
  entityType: 'lead' | 'job' | 'customer'
  entityId: string
}) {
  const [stats, setStats] = useState({ total: 0, completed: 0, percentage: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getCompletionStats(templateId, entityType, entityId).then(s => {
      setStats(s)
      setLoading(false)
    })
  }, [templateId, entityType, entityId])

  if (loading) return null
  if (stats.total === 0) return null

  const isComplete = stats.percentage === 100
  const color = isComplete ? '#4ade80' : stats.percentage > 50 ? '#f59e0b' : '#64748b'

  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
      background: `${color}15`, color, border: `1px solid ${color}30`,
    }}>
      {isComplete ? '✅' : '📋'} {stats.completed}/{stats.total}
    </span>
  )
}
