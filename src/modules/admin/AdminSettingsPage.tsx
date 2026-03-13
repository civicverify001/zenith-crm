// src/modules/admin/AdminSettingsPage.tsx
// Admin Settings — tabbed page: Qualifying Checklist | Site Visit Checklist | Term Blocks

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

// ── Types ─────────────────────────────────────────────────────
interface TermBlock {
  id: string
  slug: string
  name: string
  display_title: string
  category: string
  document_type: string
  sort_order: number
  version: number
  content: string
  is_active: boolean
  updated_at: string
}

interface QualifyingQuestion {
  id: string
  question_text: string
  field_type: string
  options: string[]
  is_required: boolean
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

const DOC_TYPE_LABELS: Record<string, string> = {
  terms_page:       '📄 General Terms & Conditions',
  rental_agreement: '📋 Rental Agreement',
  rental_quote:     '💬 Rental Quote',
  purchase_invoice: '🧾 Purchase Invoice / Quote',
  all:              '🌐 All Documents',
}
const DOC_TYPE_ORDER = ['terms_page', 'rental_agreement', 'rental_quote', 'purchase_invoice', 'all']

const FIELD_TYPE_LABELS: Record<string, string> = {
  dropdown:              'Dropdown',
  yes_no:                'Yes / No',
  number:                'Number',
  text:                  'Text Input',
  prefill_water_concern: 'Auto-fill: Water Concern',
  prefill_address:       'Auto-fill: Address',
  prefill_source:        'Auto-fill: Lead Source',
}

type AdminTab = 'qualifying' | 'site_visit' | 'terms'

const TABS: { key: AdminTab; label: string; icon: string; color: string }[] = [
  { key: 'qualifying', label: 'Qualifying Checklist', icon: '✅', color: '#4ade80' },
  { key: 'site_visit', label: 'Site Visit Checklist', icon: '📋', color: '#22d3ee' },
  { key: 'terms',      label: 'Term Blocks',          icon: '📄', color: '#a78bfa' },
]

export default function AdminSettingsPage() {
  const { profile } = useAuth()
  const [activeTab, setActiveTab] = useState<AdminTab>('qualifying')
  const isAdmin = profile?.role === 'admin'

  if (!isAdmin) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <h2 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 20 }}>Admin Access Only</h2>
        <p style={{ color: '#64748b', marginTop: 8 }}>You don't have permission to view this page.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Page header */}
      <div style={{ flexShrink: 0, marginBottom: 20 }}>
        <h1 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 22, margin: 0 }}>Admin Settings</h1>
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
          Manage qualifying questions, site visit checklist, and term blocks
        </p>
      </div>

      {/* Colorful full-width pill tabs */}
      <div
        style={{ display: 'grid', gridTemplateColumns: `repeat(${TABS.length}, 1fr)`, gap: 3, flexShrink: 0, marginBottom: 20 }}
      >
        {TABS.map(tab => {
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 20px', borderRadius: 14, textAlign: 'left',
                background: isActive
                  ? `linear-gradient(135deg, ${tab.color}22, ${tab.color}0a)`
                  : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isActive ? tab.color + '50' : 'rgba(255,255,255,0.06)'}`,
                boxShadow: isActive ? `0 0 18px ${tab.color}18` : 'none',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <div>
                <div style={{
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: isActive ? tab.color : '#64748b', marginBottom: 4,
                }}>
                  <span style={{ marginRight: 6 }}>{tab.icon}</span>{tab.label}
                </div>
              </div>
              {isActive && (
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  backgroundColor: tab.color, boxShadow: `0 0 8px ${tab.color}`,
                }} />
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'qualifying' && <QualifyingQuestionsTab />}
        {activeTab === 'site_visit' && <SiteVisitQuestionsTab />}
        {activeTab === 'terms'      && <TermBlocksTab />}
      </div>
    </div>
  )
}

// ── Shared dark-theme table styles ────────────────────────────
const tableCardStyle: React.CSSProperties = {
  background: '#162232',
  border: '1px solid #1e3a4f',
  borderRadius: 14,
  overflow: 'hidden',
}
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 16px',
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
  color: '#64748b', background: 'rgba(255,255,255,0.03)',
  borderBottom: '1px solid #1e3a4f',
}
const tdStyle: React.CSSProperties = {
  padding: '11px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)',
  fontSize: 13, color: '#e2e8f0',
}

function RequiredBadge({ required, onClick }: { required: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 700, cursor: 'pointer',
      background: required ? 'rgba(248,113,113,0.12)' : 'rgba(100,116,139,0.12)',
      color: required ? '#f87171' : '#64748b',
      border: `1px solid ${required ? 'rgba(248,113,113,0.3)' : 'rgba(100,116,139,0.2)'}`,
    }}>
      {required ? 'Required' : 'Optional'}
    </button>
  )
}

function ActiveBadge({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 700, cursor: 'pointer',
      background: active ? 'rgba(74,222,128,0.12)' : 'rgba(100,116,139,0.12)',
      color: active ? '#4ade80' : '#64748b',
      border: `1px solid ${active ? 'rgba(74,222,128,0.25)' : 'rgba(100,116,139,0.2)'}`,
    }}>
      {active ? 'Active' : 'Off'}
    </button>
  )
}

// ── Shared question add/edit form ─────────────────────────────
function QuestionForm({
  title, onCancel, onSave, saving,
  formText, setFormText,
  formType, setFormType,
  formOptions, setFormOptions,
  formRequired, setFormRequired,
  fieldTypeLabels,
  extraFields,
}: {
  title: string; onCancel: () => void; onSave: () => void; saving: boolean
  formText: string; setFormText: (v: string) => void
  formType: string; setFormType: (v: string) => void
  formOptions: string; setFormOptions: (v: string) => void
  formRequired: boolean; setFormRequired: (v: boolean) => void
  fieldTypeLabels: Record<string, string>
  extraFields?: React.ReactNode
}) {
  return (
    <div style={{ ...tableCardStyle, marginBottom: 16, padding: 20 }}>
      <h3 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14, marginBottom: 16 }}>{title}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6 }}>Question / Item Text</label>
          <input
            type="text" value={formText} onChange={e => setFormText(e.target.value)}
            placeholder="e.g., Homeowner or renter?"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f',
              borderRadius: 10, padding: '9px 14px', color: '#e2e8f0', fontSize: 13, outline: 'none',
            }}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6 }}>Answer Type</label>
            <select value={formType} onChange={e => setFormType(e.target.value)}
              style={{
                width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f',
                borderRadius: 10, padding: '9px 14px', color: '#e2e8f0', fontSize: 13, outline: 'none',
              }}>
              {Object.entries(fieldTypeLabels).map(([key, label]) => (
                <option key={key} value={key} style={{ background: '#0f1923' }}>{label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={formRequired} onChange={e => setFormRequired(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: '#0d7ea3' }} />
              <span style={{ fontSize: 13, color: '#e2e8f0' }}>Required</span>
            </label>
          </div>
        </div>
        {formType === 'dropdown' && (
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6 }}>
              Options <span style={{ color: '#334155' }}>(comma separated)</span>
            </label>
            <input type="text" value={formOptions} onChange={e => setFormOptions(e.target.value)}
              placeholder="e.g., Homeowner, Renter"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f',
                borderRadius: 10, padding: '9px 14px', color: '#e2e8f0', fontSize: 13, outline: 'none',
              }} />
          </div>
        )}
        {extraFields}
        <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
          <button onClick={onCancel} style={{
            padding: '8px 16px', borderRadius: 10, fontSize: 13, color: '#64748b', cursor: 'pointer',
            background: 'rgba(255,255,255,0.04)', border: '1px solid #1e3a4f',
          }}>
            Cancel
          </button>
          <button onClick={onSave} disabled={saving || !formText.trim()} style={{
            padding: '8px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#fff',
            background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none',
            cursor: saving || !formText.trim() ? 'not-allowed' : 'pointer', opacity: saving || !formText.trim() ? 0.5 : 1,
          }}>
            {saving ? 'Saving...' : title.startsWith('Edit') ? 'Update' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// TAB 1: QUALIFYING QUESTIONS
// ════════════════════════════════════════════════════════════════
function QualifyingQuestionsTab() {
  const [questions, setQuestions] = useState<QualifyingQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<QualifyingQuestion | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [formText, setFormText] = useState('')
  const [formType, setFormType] = useState('dropdown')
  const [formOptions, setFormOptions] = useState('')
  const [formRequired, setFormRequired] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchQuestions() }, [])

  async function fetchQuestions() {
    setLoading(true)
    const { data } = await supabase.from('qualifying_questions').select('*').order('sort_order')
    if (data) setQuestions(data)
    setLoading(false)
  }

  function startAdd() {
    setEditing(null); setFormText(''); setFormType('dropdown'); setFormOptions(''); setFormRequired(true)
    setShowAddForm(true)
  }

  function startEdit(q: QualifyingQuestion) {
    setEditing(q); setFormText(q.question_text); setFormType(q.field_type)
    setFormOptions(Array.isArray(q.options) ? q.options.join(', ') : '')
    setFormRequired(q.is_required); setShowAddForm(true)
  }

  async function saveQuestion() {
    if (!formText.trim()) return
    setSaving(true)
    const optionsArray = formType === 'dropdown' ? formOptions.split(',').map(s => s.trim()).filter(Boolean) : []
    if (editing) {
      await supabase.from('qualifying_questions').update({
        question_text: formText.trim(), field_type: formType, options: optionsArray, is_required: formRequired,
      }).eq('id', editing.id)
    } else {
      const maxOrder = questions.reduce((max, q) => Math.max(max, q.sort_order), 0)
      await supabase.from('qualifying_questions').insert({
        question_text: formText.trim(), field_type: formType, options: optionsArray,
        is_required: formRequired, sort_order: maxOrder + 1, is_active: true,
      })
    }
    setShowAddForm(false); setEditing(null); setSaving(false); fetchQuestions()
  }

  async function toggleRequired(q: QualifyingQuestion) {
    await supabase.from('qualifying_questions').update({ is_required: !q.is_required }).eq('id', q.id)
    setQuestions(prev => prev.map(x => x.id === q.id ? { ...x, is_required: !x.is_required } : x))
  }

  async function toggleActive(q: QualifyingQuestion) {
    await supabase.from('qualifying_questions').update({ is_active: !q.is_active }).eq('id', q.id)
    setQuestions(prev => prev.map(x => x.id === q.id ? { ...x, is_active: !x.is_active } : x))
  }

  async function moveQuestion(q: QualifyingQuestion, direction: 'up' | 'down') {
    const idx = questions.findIndex(x => x.id === q.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= questions.length) return
    const other = questions[swapIdx]
    await supabase.from('qualifying_questions').update({ sort_order: other.sort_order }).eq('id', q.id)
    await supabase.from('qualifying_questions').update({ sort_order: q.sort_order }).eq('id', other.id)
    fetchQuestions()
  }

  async function deleteQuestion(q: QualifyingQuestion) {
    if (!confirm(`Delete "${q.question_text}"?`)) return
    await supabase.from('qualifying_questions').delete().eq('id', q.id)
    fetchQuestions()
  }

  const activeCount = questions.filter(q => q.is_active).length
  const requiredCount = questions.filter(q => q.is_active && q.is_required).length

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 16, margin: 0 }}>Qualifying Questions</h2>
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
            {activeCount} active · {requiredCount} required — shown when qualifying a lead
          </p>
        </div>
        <button onClick={startAdd} style={{
          padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700,
          background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: '#fff', border: 'none', cursor: 'pointer',
        }}>
          + Add Question
        </button>
      </div>

      {showAddForm && (
        <QuestionForm
          title={editing ? 'Edit Question' : 'New Question'}
          onCancel={() => { setShowAddForm(false); setEditing(null) }}
          onSave={saveQuestion} saving={saving}
          formText={formText} setFormText={setFormText}
          formType={formType} setFormType={setFormType}
          formOptions={formOptions} setFormOptions={setFormOptions}
          formRequired={formRequired} setFormRequired={setFormRequired}
          fieldTypeLabels={FIELD_TYPE_LABELS}
        />
      )}

      {loading ? (
        <div style={{ textAlign: 'center', color: '#64748b', padding: '48px 0' }}>Loading...</div>
      ) : questions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <p style={{ color: '#64748b' }}>No qualifying questions yet.</p>
        </div>
      ) : (
        <div style={{ ...tableCardStyle, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 36 }}>#</th>
                <th style={thStyle}>Question</th>
                <th style={{ ...thStyle, width: 120 }}>Type</th>
                <th style={{ ...thStyle, width: 100, textAlign: 'center' }}>Required</th>
                <th style={{ ...thStyle, width: 80, textAlign: 'center' }}>Active</th>
                <th style={{ ...thStyle, width: 80, textAlign: 'center' }}>Order</th>
                <th style={{ ...thStyle, width: 110, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((q, idx) => (
                <tr key={q.id} style={{ opacity: q.is_active ? 1 : 0.4 }}>
                  <td style={{ ...tdStyle, color: '#64748b', fontFamily: 'monospace' }}>{idx + 1}</td>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600 }}>{q.question_text}</div>
                    {q.field_type === 'dropdown' && q.options?.length > 0 && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                        Options: {q.options.join(' · ')}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      fontSize: 11, padding: '3px 8px', borderRadius: 20,
                      background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid #1e3a4f',
                    }}>
                      {FIELD_TYPE_LABELS[q.field_type] || q.field_type}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <RequiredBadge required={q.is_required} onClick={() => toggleRequired(q)} />
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <ActiveBadge active={q.is_active} onClick={() => toggleActive(q)} />
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>
                      <button onClick={() => moveQuestion(q, 'up')} disabled={idx === 0}
                        style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', opacity: idx === 0 ? 0.2 : 1 }}>▲</button>
                      <button onClick={() => moveQuestion(q, 'down')} disabled={idx === questions.length - 1}
                        style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', opacity: idx === questions.length - 1 ? 0.2 : 1 }}>▼</button>
                    </div>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                      <button onClick={() => startEdit(q)}
                        style={{ fontSize: 12, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                        Edit
                      </button>
                      <button onClick={() => deleteQuestion(q)}
                        style={{ fontSize: 12, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// TAB 2: SITE VISIT CHECKLIST
// ════════════════════════════════════════════════════════════════

const SV_FIELD_TYPE_LABELS: Record<string, string> = {
  dropdown: 'Dropdown',
  yes_no:   'Yes / No',
  number:   'Number',
  text:     'Text Input',
  photo:    'Photo Upload',
}

interface SiteVisitQuestion {
  id: string
  question_text: string
  field_type: string
  options: string[]
  is_required: boolean
  requires_photo: boolean
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

function SiteVisitQuestionsTab() {
  const [questions, setQuestions] = useState<SiteVisitQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<SiteVisitQuestion | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [formText, setFormText] = useState('')
  const [formType, setFormType] = useState('dropdown')
  const [formOptions, setFormOptions] = useState('')
  const [formRequired, setFormRequired] = useState(true)
  const [formRequiresPhoto, setFormRequiresPhoto] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchQuestions() }, [])

  async function fetchQuestions() {
    setLoading(true)
    const { data } = await supabase.from('site_visit_questions').select('*').order('sort_order')
    if (data) setQuestions(data)
    setLoading(false)
  }

  function startAdd() {
    setEditing(null); setFormText(''); setFormType('dropdown'); setFormOptions('')
    setFormRequired(true); setFormRequiresPhoto(false); setShowAddForm(true)
  }

  function startEdit(q: SiteVisitQuestion) {
    setEditing(q); setFormText(q.question_text); setFormType(q.field_type)
    setFormOptions(Array.isArray(q.options) ? q.options.join(', ') : '')
    setFormRequired(q.is_required); setFormRequiresPhoto(q.requires_photo); setShowAddForm(true)
  }

  async function saveQuestion() {
    if (!formText.trim()) return
    setSaving(true)
    const optionsArray = formType === 'dropdown' ? formOptions.split(',').map(s => s.trim()).filter(Boolean) : []
    const requiresPhoto = formRequiresPhoto || formType === 'photo'
    if (editing) {
      await supabase.from('site_visit_questions').update({
        question_text: formText.trim(), field_type: formType, options: optionsArray,
        is_required: formRequired, requires_photo: requiresPhoto,
      }).eq('id', editing.id)
    } else {
      const maxOrder = questions.reduce((max, q) => Math.max(max, q.sort_order), 0)
      await supabase.from('site_visit_questions').insert({
        question_text: formText.trim(), field_type: formType, options: optionsArray,
        is_required: formRequired, requires_photo: requiresPhoto,
        sort_order: maxOrder + 1, is_active: true,
      })
    }
    setShowAddForm(false); setEditing(null); setSaving(false); fetchQuestions()
  }

  async function toggleRequired(q: SiteVisitQuestion) {
    await supabase.from('site_visit_questions').update({ is_required: !q.is_required }).eq('id', q.id)
    setQuestions(prev => prev.map(x => x.id === q.id ? { ...x, is_required: !x.is_required } : x))
  }

  async function toggleActive(q: SiteVisitQuestion) {
    await supabase.from('site_visit_questions').update({ is_active: !q.is_active }).eq('id', q.id)
    setQuestions(prev => prev.map(x => x.id === q.id ? { ...x, is_active: !x.is_active } : x))
  }

  async function moveQuestion(q: SiteVisitQuestion, direction: 'up' | 'down') {
    const idx = questions.findIndex(x => x.id === q.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= questions.length) return
    const other = questions[swapIdx]
    await supabase.from('site_visit_questions').update({ sort_order: other.sort_order }).eq('id', q.id)
    await supabase.from('site_visit_questions').update({ sort_order: q.sort_order }).eq('id', other.id)
    fetchQuestions()
  }

  async function deleteQuestion(q: SiteVisitQuestion) {
    if (!confirm(`Delete "${q.question_text}"?`)) return
    await supabase.from('site_visit_questions').delete().eq('id', q.id)
    fetchQuestions()
  }

  const activeCount = questions.filter(q => q.is_active).length
  const requiredCount = questions.filter(q => q.is_active && q.is_required).length

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 16, margin: 0 }}>Site Visit Checklist</h2>
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
            {activeCount} active · {requiredCount} required — completed during site visits
          </p>
        </div>
        <button onClick={startAdd} style={{
          padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700,
          background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: '#fff', border: 'none', cursor: 'pointer',
        }}>
          + Add Item
        </button>
      </div>

      {showAddForm && (
        <QuestionForm
          title={editing ? 'Edit Item' : 'New Item'}
          onCancel={() => { setShowAddForm(false); setEditing(null) }}
          onSave={saveQuestion} saving={saving}
          formText={formText} setFormText={setFormText}
          formType={formType}
          setFormType={v => { setFormType(v); if (v === 'photo') setFormRequiresPhoto(true) }}
          formOptions={formOptions} setFormOptions={setFormOptions}
          formRequired={formRequired} setFormRequired={setFormRequired}
          fieldTypeLabels={SV_FIELD_TYPE_LABELS}
        />
      )}

      {loading ? (
        <div style={{ textAlign: 'center', color: '#64748b', padding: '48px 0' }}>Loading...</div>
      ) : questions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <p style={{ color: '#64748b' }}>No site visit items yet.</p>
        </div>
      ) : (
        <div style={{ ...tableCardStyle, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 36 }}>#</th>
                <th style={thStyle}>Item</th>
                <th style={{ ...thStyle, width: 120 }}>Type</th>
                <th style={{ ...thStyle, width: 100, textAlign: 'center' }}>Required</th>
                <th style={{ ...thStyle, width: 80, textAlign: 'center' }}>Active</th>
                <th style={{ ...thStyle, width: 80, textAlign: 'center' }}>Order</th>
                <th style={{ ...thStyle, width: 110, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((q, idx) => (
                <tr key={q.id} style={{ opacity: q.is_active ? 1 : 0.4 }}>
                  <td style={{ ...tdStyle, color: '#64748b', fontFamily: 'monospace' }}>{idx + 1}</td>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600 }}>
                      {q.field_type === 'photo' && '📷 '}{q.question_text}
                    </div>
                    {q.field_type === 'dropdown' && q.options?.length > 0 && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                        Options: {q.options.join(' · ')}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      fontSize: 11, padding: '3px 8px', borderRadius: 20,
                      background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid #1e3a4f',
                    }}>
                      {SV_FIELD_TYPE_LABELS[q.field_type] || q.field_type}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <RequiredBadge required={q.is_required} onClick={() => toggleRequired(q)} />
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <ActiveBadge active={q.is_active} onClick={() => toggleActive(q)} />
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>
                      <button onClick={() => moveQuestion(q, 'up')} disabled={idx === 0}
                        style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', opacity: idx === 0 ? 0.2 : 1 }}>▲</button>
                      <button onClick={() => moveQuestion(q, 'down')} disabled={idx === questions.length - 1}
                        style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', opacity: idx === questions.length - 1 ? 0.2 : 1 }}>▼</button>
                    </div>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                      <button onClick={() => startEdit(q)}
                        style={{ fontSize: 12, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Edit</button>
                      <button onClick={() => deleteQuestion(q)}
                        style={{ fontSize: 12, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// TAB 3: TERM BLOCKS
// ════════════════════════════════════════════════════════════════
function TermBlocksTab() {
  const [blocks, setBlocks] = useState<TermBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [activeDocType, setActiveDocType] = useState('terms_page')
  const [editing, setEditing] = useState<TermBlock | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => { fetchBlocks() }, [])

  async function fetchBlocks() {
    setLoading(true)
    const { data, error } = await supabase.from('term_blocks').select('*').order('document_type').order('sort_order')
    if (!error && data) setBlocks(data)
    setLoading(false)
  }

  function startEdit(block: TermBlock) {
    setEditing(block); setEditContent(block.content)
    setEditTitle(block.display_title || block.name); setSaveMsg('')
  }

  async function saveEdit() {
    if (!editing) return
    setSaving(true)
    const { error } = await supabase.from('term_blocks').update({
      content: editContent, display_title: editTitle,
      version: editing.version + 1, updated_at: new Date().toISOString(),
    }).eq('id', editing.id)
    if (error) {
      setSaveMsg('❌ Error: ' + error.message)
    } else {
      setSaveMsg('✅ Saved')
      setBlocks(prev => prev.map(b => b.id === editing.id
        ? { ...b, content: editContent, display_title: editTitle, version: b.version + 1 } : b))
      setEditing(null)
    }
    setSaving(false)
    setTimeout(() => setSaveMsg(''), 3000)
  }

  async function toggleActive(block: TermBlock) {
    const { error } = await supabase.from('term_blocks').update({ is_active: !block.is_active }).eq('id', block.id)
    if (!error) setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, is_active: !b.is_active } : b))
  }

  const filtered = blocks.filter(b => {
    const matchType = b.document_type === activeDocType
    const matchSearch = !search ||
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.content.toLowerCase().includes(search.toLowerCase()) ||
      (b.display_title || '').toLowerCase().includes(search.toLowerCase())
    return matchType && matchSearch
  })

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* LEFT SIDEBAR */}
      <div style={{
        width: 220, flexShrink: 0, background: '#162232',
        border: '1px solid #1e3a4f', borderRadius: '14px 0 0 14px',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #1e3a4f' }}>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13 }}>Document Categories</div>
          <div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>Changes go live instantly</div>
        </div>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #1e3a4f' }}>
          <input type="text" placeholder="Search terms..." value={search} onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.04)', border: '1px solid #1e3a4f',
              borderRadius: 8, padding: '7px 12px', color: '#e2e8f0', fontSize: 12, outline: 'none',
            }} />
        </div>
        <nav style={{ flex: 1, padding: 8, overflowY: 'auto' }}>
          {DOC_TYPE_ORDER.map(dt => {
            const count = blocks.filter(b => b.document_type === dt).length
            const isActive = activeDocType === dt
            return (
              <button key={dt} onClick={() => { setActiveDocType(dt); setEditing(null) }}
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 10,
                  marginBottom: 2, cursor: 'pointer',
                  background: isActive ? 'rgba(13,126,163,0.15)' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(13,126,163,0.3)' : 'transparent'}`,
                  color: isActive ? '#38bdf8' : '#94a3b8',
                }}>
                <div style={{ fontSize: 12, fontWeight: isActive ? 700 : 500 }}>
                  {DOC_TYPE_LABELS[dt] || dt}
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{count} blocks</div>
              </button>
            )
          })}
        </nav>
        <div style={{ padding: 12, borderTop: '1px solid #1e3a4f' }}>
          <a href="/terms" target="_blank" rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 12px', borderRadius: 8, fontSize: 12, color: '#64748b',
              background: 'rgba(255,255,255,0.03)', border: '1px solid #1e3a4f', textDecoration: 'none',
            }}>
            <span>🌐</span><span>View Public T&C</span><span style={{ marginLeft: 'auto' }}>↗</span>
          </a>
        </div>
      </div>

      {/* BLOCK LIST */}
      <div style={{
        width: editing ? 280 : undefined, flex: editing ? undefined : 1,
        flexShrink: 0, overflowY: 'auto',
        background: '#0f1923', borderTop: '1px solid #1e3a4f', borderBottom: '1px solid #1e3a4f',
        ...(editing ? {} : { borderRight: '1px solid #1e3a4f', borderRadius: '0 14px 14px 0' }),
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #1e3a4f', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13 }}>{DOC_TYPE_LABELS[activeDocType]}</div>
          <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{filtered.length} term blocks</div>
        </div>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#64748b', padding: 48 }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#64748b', padding: 48 }}>No blocks found</div>
        ) : (
          filtered.map(block => (
            <div key={block.id} onClick={() => startEdit(block)}
              style={{
                padding: '14px 16px', cursor: 'pointer', opacity: block.is_active ? 1 : 0.4,
                borderBottom: '1px solid #1e3a4f',
                background: editing?.id === block.id ? 'rgba(13,126,163,0.08)' : 'transparent',
                borderLeft: editing?.id === block.id ? '2px solid #0d7ea3' : '2px solid transparent',
              }}
              onMouseEnter={e => { if (editing?.id !== block.id) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)' }}
              onMouseLeave={e => { if (editing?.id !== block.id) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {block.display_title || block.name}
                  </div>
                  <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>v{block.version} · {block.slug}</div>
                </div>
                <button onClick={e => { e.stopPropagation(); toggleActive(block) }}
                  style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 20, flexShrink: 0, cursor: 'pointer',
                    background: block.is_active ? 'rgba(74,222,128,0.12)' : 'rgba(100,116,139,0.12)',
                    color: block.is_active ? '#4ade80' : '#64748b',
                    border: `1px solid ${block.is_active ? 'rgba(74,222,128,0.25)' : 'rgba(100,116,139,0.2)'}`,
                  }}>
                  {block.is_active ? 'Active' : 'Off'}
                </button>
              </div>
              <p style={{ color: '#64748b', fontSize: 11, marginTop: 6 }}>
                {block.content.slice(0, 100)}...
              </p>
              <div style={{ color: '#334155', fontSize: 10, marginTop: 4 }}>
                Updated {new Date(block.updated_at).toLocaleDateString()}
              </div>
            </div>
          ))
        )}
      </div>

      {/* EDITOR PANEL */}
      {editing && (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: '0 14px 14px 0',
          borderLeft: 'none',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 20px', borderBottom: '1px solid #1e3a4f', background: 'rgba(255,255,255,0.02)',
          }}>
            <div>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>Edit Block</div>
              <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                {editing.slug} · v{editing.version} → v{editing.version + 1}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {saveMsg && (
                <span style={{ fontSize: 13, fontWeight: 600, color: saveMsg.includes('❌') ? '#f87171' : '#4ade80' }}>
                  {saveMsg}
                </span>
              )}
              <button onClick={() => setEditing(null)} style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 12, color: '#64748b', cursor: 'pointer',
                background: 'rgba(255,255,255,0.04)', border: '1px solid #1e3a4f',
              }}>Cancel</button>
              <button onClick={saveEdit} disabled={saving} style={{
                padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, color: '#fff',
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none',
                cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1,
              }}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            <div style={{
              background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)',
              borderRadius: 10, padding: '10px 14px', marginBottom: 16,
              display: 'flex', gap: 8, fontSize: 12, color: '#fbbf24',
            }}>
              <span>⚠️</span>
              <span><strong>Live content.</strong> Changes update the public T&C page and all new documents instantly.</span>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6 }}>Section Title</label>
              <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f',
                  borderRadius: 10, padding: '9px 14px', color: '#e2e8f0', fontSize: 13, outline: 'none',
                }} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                Content <span style={{ color: '#334155' }}>({editContent.length} chars)</span>
              </label>
              <textarea value={editContent} onChange={e => setEditContent(e.target.value)} rows={20}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f',
                  borderRadius: 10, padding: '10px 14px', color: '#e2e8f0', fontSize: 12,
                  fontFamily: 'monospace', outline: 'none', resize: 'none', lineHeight: 1.6,
                }} />
            </div>

            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Preview
              </div>
              <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{editTitle}</div>
                <div style={{ color: '#94a3b8', fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{editContent}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!editing && (
        <div style={{
          flex: 1, display: 'none',
        }} className="lg:flex items-center justify-center" />
      )}
    </div>
  )
}
