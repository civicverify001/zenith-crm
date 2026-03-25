// src/modules/admin/AdminSettingsPage.tsx
// Admin Settings — tabbed page: Qualifying Checklist | Site Visit Checklist | Term Blocks | Service Plans | Email Templates | Checklists | SMS Templates | Automations
import { EmailTemplatesTab } from './EmailTemplatesTab'
import SmsTemplatesTab from './SmsTemplatesTab'
import { ChecklistTemplatesTab } from './ChecklistTemplatesTab'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import {
  fetchPlanTemplates,
  createPlanTemplate,
  updatePlanTemplate,
  togglePlanTemplateActive,
  toggleAutoActivate,
  duplicatePlanTemplate,
  fetchPlanComponents,
  savePlanComponents,
  BILLING_CYCLE_LABELS,
  FULFILLMENT_TYPE_LABELS,
  COMPONENT_CODES,
  COMPONENT_FULFILLMENT_LABELS,
  type ServicePlanTemplate,
  type CreatePlanTemplateInput,
  type ComponentDraft,
} from '../../services/servicePlanService'

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

interface PlanItem {
  product_id: string
  quantity: number
  cycle_year: number
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

type AdminTab = 'qualifying' | 'site_visit' | 'terms' | 'service_plans' | 'email_templates' | 'checklists' | 'sms_templates' | 'automations'

const TABS: { key: AdminTab; label: string; icon: string; color: string }[] = [
  { key: 'qualifying',       label: 'Qualifying Checklist', icon: '✅', color: '#4ade80' },
  { key: 'site_visit',       label: 'Site Visit Checklist', icon: '📋', color: '#22d3ee' },
  { key: 'terms',            label: 'Term Blocks',          icon: '📄', color: '#a78bfa' },
  { key: 'service_plans',    label: 'Service Plans',        icon: '🔄', color: '#f59e0b' },
  { key: 'email_templates',  label: 'Email Templates',      icon: '✉️', color: '#f472b6' },
  { key: 'checklists',       label: 'Checklists',           icon: '📋', color: '#8b5cf6' },
  { key: 'sms_templates',    label: 'SMS Templates',        icon: '💬', color: '#22c55e' },
  { key: 'automations',      label: 'Automations',          icon: '⚡', color: '#f97316' },
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
          Manage qualifying questions, site visit checklist, term blocks, and service plans
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
        {activeTab === 'qualifying'      && <QualifyingQuestionsTab />}
        {activeTab === 'site_visit'      && <SiteVisitQuestionsTab />}
        {activeTab === 'terms'           && <TermBlocksTab />}
        {activeTab === 'service_plans'   && <ServicePlansTemplateTab />}
        {activeTab === 'email_templates' && <EmailTemplatesTab />}
        {activeTab === 'checklists'      && <ChecklistTemplatesTab />}
        {activeTab === 'sms_templates'   && <SmsTemplatesTab />}
        {activeTab === 'automations'     && <AutomationsTab />}
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
        <div style={{ flex: 1, display: 'none' }} className="lg:flex items-center justify-center" />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// TAB 4: SERVICE PLAN TEMPLATES
// Gap 18: Multi-product plan items with quantity + cycle_year
// Uses service_plan_items table. Single fProductId removed.
// planItemsMap loaded at template-load time for table display.
// ════════════════════════════════════════════════════════════════

const PRODUCT_CATEGORIES = [
  { value: 'ro', label: 'Reverse Osmosis' },
  { value: 'softener', label: 'Water Softener' },
  { value: 'whole_home_filter', label: 'Whole Home Filter' },
  { value: 'iron_filter', label: 'Iron Filter' },
  { value: 'uv_system', label: 'UV System' },
  { value: 'combo_whole_home_ro', label: 'Combo (Whole Home + RO)' },
]

// ── Plan Items Editor sub-component ───────────────────────────
function PlanItemsEditor({
  items,
  onChange,
  products,
  fulfillmentType,
}: {
  items: PlanItem[]
  onChange: (items: PlanItem[]) => void
  products: { id: string; name: string }[]
  fulfillmentType: string
}) {
  const [newProductId, setNewProductId] = useState('')
  const [newQuantity, setNewQuantity] = useState('1')
  const [newCycleYear, setNewCycleYear] = useState('0')
  const [addError, setAddError] = useState('')

  // cycle_year = 0 means "every cycle". 1+ = specific year
  const cycleYearLabel = (cy: number) => cy === 0 ? 'Every cycle' : `Year ${cy} only`

  function addItem() {
    if (!newProductId) { setAddError('Select a product'); return }
    const qty = parseInt(newQuantity) || 1
    const cy = parseInt(newCycleYear) || 0
    // Prevent duplicate product+cycle_year combos
    const exists = items.some(i => i.product_id === newProductId && i.cycle_year === cy)
    if (exists) { setAddError('This product+cycle combo already exists'); return }
    onChange([...items, { product_id: newProductId, quantity: qty, cycle_year: cy }])
    setNewProductId(''); setNewQuantity('1'); setNewCycleYear('0'); setAddError('')
  }

  function removeItem(idx: number) {
    onChange(items.filter((_, i) => i !== idx))
  }

  function updateQty(idx: number, val: string) {
    const qty = Math.max(1, parseInt(val) || 1)
    onChange(items.map((item, i) => i === idx ? { ...item, quantity: qty } : item))
  }

  const isShipment = fulfillmentType === 'shipment'
  const isTechVisit = fulfillmentType === 'tech_visit'
  const showCycleYear = isShipment // cycle year most relevant for filter shipments

  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {isShipment ? '📦 Products to Ship' : isTechVisit ? '🔧 Related Products' : '🛍 Products'}
        {isShipment && <span style={{ color: '#a855f7', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}> — fulfilled per cycle by shipping cron</span>}
      </label>

      {/* Existing items */}
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {items.map((item, idx) => {
            const prodName = products.find(p => p.id === item.product_id)?.name || 'Unknown product'
            return (
              <div key={idx} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)',
                borderRadius: 10, padding: '8px 12px',
              }}>
                <span style={{ fontSize: 14 }}>📦</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {prodName}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                    <span style={{ fontSize: 10, color: '#a855f7' }}>Qty: {item.quantity}</span>
                    {showCycleYear && (
                      <span style={{ fontSize: 10, color: '#64748b' }}>· {cycleYearLabel(item.cycle_year)}</span>
                    )}
                  </div>
                </div>
                {/* Inline qty edit */}
                <input
                  type="number" min="1" value={item.quantity}
                  onChange={e => updateQty(idx, e.target.value)}
                  style={{
                    width: 50, background: 'rgba(255,255,255,0.06)', border: '1px solid #1e3a4f',
                    borderRadius: 6, padding: '4px 8px', color: '#e2e8f0', fontSize: 12, outline: 'none',
                    textAlign: 'center',
                  }}
                />
                <button onClick={() => removeItem(idx)} style={{
                  color: '#f87171', background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 16, lineHeight: 1, padding: '2px 4px',
                }}>×</button>
              </div>
            )
          })}
        </div>
      )}

      {/* Add new item row */}
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1px dashed #1e3a4f',
        borderRadius: 10, padding: 12,
      }}>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 600 }}>+ Add Product</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select
            value={newProductId}
            onChange={e => { setNewProductId(e.target.value); setAddError('') }}
            style={{
              flex: '2 1 160px', background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f',
              borderRadius: 8, padding: '7px 10px', color: newProductId ? '#e2e8f0' : '#64748b',
              fontSize: 12, outline: 'none',
            }}
          >
            <option value="" style={{ background: '#0f1923' }}>Select product...</option>
            {products.map(p => (
              <option key={p.id} value={p.id} style={{ background: '#0f1923' }}>{p.name}</option>
            ))}
          </select>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '0 0 70px' }}>
            <label style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Qty</label>
            <input
              type="number" min="1" value={newQuantity}
              onChange={e => setNewQuantity(e.target.value)}
              style={{
                background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f',
                borderRadius: 8, padding: '7px 10px', color: '#e2e8f0', fontSize: 12, outline: 'none',
                textAlign: 'center',
              }}
            />
          </div>

          {showCycleYear && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 100px' }}>
              <label style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Ships in</label>
              <select
                value={newCycleYear}
                onChange={e => setNewCycleYear(e.target.value)}
                style={{
                  background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f',
                  borderRadius: 8, padding: '7px 10px', color: '#e2e8f0', fontSize: 12, outline: 'none',
                }}
              >
                <option value="0" style={{ background: '#0f1923' }}>Every cycle</option>
                <option value="1" style={{ background: '#0f1923' }}>Year 1 only</option>
                <option value="2" style={{ background: '#0f1923' }}>Year 2 only</option>
                <option value="3" style={{ background: '#0f1923' }}>Year 3 only</option>
                <option value="4" style={{ background: '#0f1923' }}>Year 4 only</option>
                <option value="5" style={{ background: '#0f1923' }}>Year 5 only</option>
              </select>
            </div>
          )}

          <button
            onClick={addItem}
            style={{
              flex: '0 0 auto', alignSelf: 'flex-end',
              padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              background: 'linear-gradient(135deg, #a855f7, #9333ea)', color: '#fff', border: 'none',
            }}
          >
            Add
          </button>
        </div>

        {addError && (
          <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>⚠️ {addError}</div>
        )}

        {showCycleYear && (
          <div style={{ fontSize: 10, color: '#475569', marginTop: 8, lineHeight: 1.5 }}>
            💡 <strong>Every cycle</strong> = ships on every fulfillment date.
            {' '}<strong>Year N only</strong> = only ships when the subscription age matches that year.
            Use this for multi-year filter kits (e.g., annual + 3-year membrane).
          </div>
        )}
      </div>

      {isShipment && items.length === 0 && (
        <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 8 }}>
          ⚠️ No products added — fulfillment cron will skip this plan until at least one product is linked
        </div>
      )}
    </div>
  )
}

// ── Plan Components Editor ─────────────────────────────────────
function PlanComponentsEditor({
  components,
  onChange,
}: {
  components: ComponentDraft[]
  onChange: (c: ComponentDraft[]) => void
}) {
  const [newLabel, setNewLabel] = useState('')
  const [newCode, setNewCode] = useState('annual_maintenance_visit')
  const [newFulfillment, setNewFulfillment] = useState<'tech_visit' | 'shipment' | 'delivery' | 'on_demand'>('tech_visit')
  const [newInterval, setNewInterval] = useState('12')
  const [addError, setAddError] = useState('')

  function addComponent() {
    if (!newLabel.trim()) { setAddError('Label is required'); return }
    if (newFulfillment !== 'on_demand' && (!newInterval || parseInt(newInterval) <= 0)) {
      setAddError('Interval must be > 0 for non-on-demand components'); return
    }
    onChange([...components, {
      label: newLabel.trim(),
      component_code: newCode,
      fulfillment_type: newFulfillment,
      interval_months: newFulfillment === 'on_demand' ? null : parseInt(newInterval),
    }])
    setNewLabel(''); setNewCode('annual_maintenance_visit')
    setNewFulfillment('tech_visit'); setNewInterval('12'); setAddError('')
  }

  function removeComponent(idx: number) {
    onChange(components.filter((_, i) => i !== idx))
  }

  const inputS: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f',
    borderRadius: 8, padding: '7px 10px', color: '#e2e8f0', fontSize: 12, outline: 'none',
  }

  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        🔁 Recurring Components
        <span style={{ color: '#475569', fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 8 }}>
          snapshotted per customer at activation — editing here does not affect existing customers
        </span>
      </label>

      {/* Existing components */}
      {components.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {components.map((c, idx) => (
            <div key={idx} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)',
              borderRadius: 10, padding: '8px 12px',
            }}>
              <span style={{ fontSize: 14 }}>
                {c.fulfillment_type === 'tech_visit' ? '🔧' : c.fulfillment_type === 'shipment' ? '📦' : c.fulfillment_type === 'delivery' ? '🚚' : '🔔'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 12 }}>{c.label}</div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                  {COMPONENT_FULFILLMENT_LABELS[c.fulfillment_type]}
                  {c.interval_months ? ` · every ${c.interval_months} months` : ' · no fixed schedule'}
                  {' · '}<span style={{ color: '#94a3b8' }}>{c.component_code}</span>
                </div>
              </div>
              <button onClick={() => removeComponent(idx)} style={{
                color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1,
              }}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Add new component row */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed #1e3a4f', borderRadius: 10, padding: 12 }}>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, fontWeight: 600 }}>+ Add Component</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>Label</div>
              <input type="text" value={newLabel} onChange={e => { setNewLabel(e.target.value); setAddError('') }}
                placeholder="e.g., Annual Tech Visit" style={{ ...inputS, width: '100%', boxSizing: 'border-box' as const }} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>Component Code</div>
              <select value={newCode} onChange={e => setNewCode(e.target.value)}
                style={{ ...inputS, width: '100%', boxSizing: 'border-box' as const }}>
                {COMPONENT_CODES.map(cc => (
                  <option key={cc.value} value={cc.value} style={{ background: '#0f1923' }}>{cc.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>Fulfillment Type</div>
              <select
                value={newFulfillment}
                onChange={e => {
                  const v = e.target.value as 'tech_visit' | 'shipment' | 'delivery' | 'on_demand'
                  setNewFulfillment(v)
                  if (v === 'on_demand') setNewInterval('')
                  setAddError('')
                }}
                style={{ ...inputS, width: '100%', boxSizing: 'border-box' as const }}>
                <option value="tech_visit" style={{ background: '#0f1923' }}>Technician Visit</option>
                <option value="shipment" style={{ background: '#0f1923' }}>Shipment</option>
                <option value="delivery" style={{ background: '#0f1923' }}>Delivery</option>
                <option value="on_demand" style={{ background: '#0f1923' }}>On-Demand (no schedule)</option>
              </select>
            </div>
            {newFulfillment !== 'on_demand' && (
              <div>
                <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>Interval (months)</div>
                <input type="number" min="1" value={newInterval}
                  onChange={e => { setNewInterval(e.target.value); setAddError('') }}
                  style={{ ...inputS, width: '100%', boxSizing: 'border-box' as const, textAlign: 'center' }} />
              </div>
            )}
            <button onClick={addComponent} style={{
              padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              background: 'linear-gradient(135deg, #38bdf8, #0ea5e9)', color: '#fff', border: 'none',
              alignSelf: 'flex-end',
            }}>Add</button>
          </div>
        </div>
        {addError && <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>⚠️ {addError}</div>}
      </div>

      {components.length === 0 && (
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, fontStyle: 'italic' }}>
          No components — this plan has no recurring schedule (billing only or priority access).
        </div>
      )}
    </div>
  )
}

function ServicePlansTemplateTab() {
  const [templates, setTemplates] = useState<ServicePlanTemplate[]>([])
  const [planItemsMap, setPlanItemsMap] = useState<Record<string, PlanItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ServicePlanTemplate | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [products, setProducts] = useState<{ id: string; name: string }[]>([])

  // Form state
  const [fName, setFName] = useState('')
  const [fDesc, setFDesc] = useState('')
  const [fNotes, setFNotes] = useState('')
  const [fCycle, setFCycle] = useState('yearly')
  const [fPrice, setFPrice] = useState('')
  const [fFulfillment, setFFulfillment] = useState('none')
  const [fInterval, setFInterval] = useState('')
  const [fCategories, setFCategories] = useState<string[]>([])
  const [fRequiresSystem, setFRequiresSystem] = useState(true)
  const [fAutoActivate, setFAutoActivate] = useState(false)
  // Gap 18: Multi-product items replaces single fProductId
  const [fPlanItems, setFPlanItems] = useState<PlanItem[]>([])
  // Components
  const [fComponents, setFComponents] = useState<ComponentDraft[]>([])
  // Feature flags
  const [fIncludesScheduled, setFIncludesScheduled] = useState(false)
  const [fIncludesUnscheduled, setFIncludesUnscheduled] = useState(false)
  const [fIncludesWaterTest, setFIncludesWaterTest] = useState(false)
  const [fIncludesSalt, setFIncludesSalt] = useState(false)
  const [fIncludesFilters, setFIncludesFilters] = useState(false)
  const [fIncludesPriority, setFIncludesPriority] = useState(false)
  useEffect(() => {
    loadTemplates()
    supabase.from('products').select('id, name').eq('is_active', true).order('name').then(({ data }) => {
      setProducts((data || []).map(p => ({ id: p.id, name: p.name })))
    })
  }, [])

  async function loadTemplates() {
    setLoading(true)
    try {
      const data = await fetchPlanTemplates()
      setTemplates(data)

      // Load plan items for all templates in one query
      if (data.length > 0) {
        const ids = data.map(t => t.id)
        const { data: items } = await supabase
          .from('service_plan_items')
          .select('service_plan_id, product_id, quantity, cycle_year')
          .in('service_plan_id', ids)
        if (items) {
          const map: Record<string, PlanItem[]> = {}
          for (const item of items) {
            if (!map[item.service_plan_id]) map[item.service_plan_id] = []
            map[item.service_plan_id].push({
              product_id: item.product_id,
              quantity: item.quantity ?? 1,
              cycle_year: item.cycle_year ?? 0,
            })
          }
          setPlanItemsMap(map)
        }
      }
    } catch (e: any) {
      console.error('Failed to load plan templates:', e)
    }
    setLoading(false)
  }

  function resetForm() {
    setFName(''); setFDesc(''); setFNotes(''); setFCycle('yearly'); setFPrice('')
    setFFulfillment('none'); setFInterval(''); setFCategories([])
    setFRequiresSystem(true); setFAutoActivate(false); setFPlanItems([])
    setFComponents([])
    setFIncludesScheduled(false); setFIncludesUnscheduled(false)
    setFIncludesWaterTest(false); setFIncludesSalt(false)
    setFIncludesFilters(false); setFIncludesPriority(false)
    setEditing(null); setError('')
  }

  function startAdd() { resetForm(); setShowForm(true) }

  function startEdit(t: ServicePlanTemplate) {
    setEditing(t); setFName(t.name); setFDesc(t.description || ''); setFNotes(t.internal_notes || '')
    setFCycle(t.billing_cycle); setFPrice(String(t.price || '')); setFFulfillment(t.fulfillment_type)
    setFInterval(t.fulfillment_interval_months ? String(t.fulfillment_interval_months) : '')
    setFCategories(Array.isArray(t.applies_to_categories) ? t.applies_to_categories : [])
    setFRequiresSystem(t.requires_installed_system); setFAutoActivate(t.auto_activate_on_install)
    setFPlanItems(planItemsMap[t.id] || [])
    // Feature flags
    const ta = t as any
    setFIncludesScheduled(ta.includes_scheduled_maintenance ?? false)
    setFIncludesUnscheduled(ta.includes_unscheduled_maintenance ?? false)
    setFIncludesWaterTest(ta.includes_water_test ?? false)
    setFIncludesSalt(ta.includes_salt_delivery ?? false)
    setFIncludesFilters(ta.includes_filter_shipments ?? false)
    setFIncludesPriority(ta.includes_priority_service ?? false)
    // Load existing components
    fetchPlanComponents(t.id).then(comps => setFComponents(comps.map(c => ({
      label: c.label,
      component_code: c.component_code,
      fulfillment_type: c.fulfillment_type,
      interval_months: c.interval_months,
    })))).catch(() => setFComponents([]))
    setShowForm(true); setError('')
  }

  async function handleSave() {
    if (!fName.trim()) { setError('Plan name is required'); return }
    if (!fPrice || parseFloat(fPrice) < 0) { setError('Valid price is required'); return }
    setSaving(true); setError('')

    const input: CreatePlanTemplateInput = {
      name: fName.trim(), description: fDesc.trim() || undefined,
      internal_notes: fNotes.trim() || undefined, billing_cycle: fCycle,
      price: parseFloat(fPrice), fulfillment_type: fFulfillment,
      fulfillment_interval_months: fInterval ? parseInt(fInterval) : null,
      applies_to_categories: fCategories, requires_installed_system: fRequiresSystem,
      auto_activate_on_install: fAutoActivate,
    }

    try {
      let planId: string

      if (editing) {
        await updatePlanTemplate(editing.id, input)
        planId = editing.id
      } else {
        const created = await createPlanTemplate(input)
        planId = created.id
      }

      // Gap 18: Sync service_plan_items
      await supabase.from('service_plan_items').delete().eq('service_plan_id', planId)
      if (fPlanItems.length > 0) {
        await supabase.from('service_plan_items').insert(
          fPlanItems.map(item => ({
            service_plan_id: planId,
            product_id: item.product_id,
            quantity: item.quantity,
            cycle_year: item.cycle_year,
          }))
        )
      }

      // Save feature flags
      await supabase.from('service_plans').update({
        includes_scheduled_maintenance: fIncludesScheduled,
        includes_unscheduled_maintenance: fIncludesUnscheduled,
        includes_water_test: fIncludesWaterTest,
        includes_salt_delivery: fIncludesSalt,
        includes_filter_shipments: fIncludesFilters,
        includes_priority_service: fIncludesPriority,
      }).eq('id', planId)

      // Save components (templates only — does NOT touch customer snapshots)
      await savePlanComponents(planId, fComponents)

      setShowForm(false); resetForm(); loadTemplates()
    } catch (e: any) {
      setError(e.message || 'Failed to save')
    }
    setSaving(false)
  }

  async function handleToggleActive(t: ServicePlanTemplate) {
    try {
      await togglePlanTemplateActive(t.id, !t.is_active)
      setTemplates(prev => prev.map(x => x.id === t.id ? { ...x, is_active: !x.is_active } : x))
    } catch (e: any) { console.error('Toggle active error:', e) }
  }

  async function handleToggleAutoActivate(t: ServicePlanTemplate) {
    try {
      await toggleAutoActivate(t.id, !t.auto_activate_on_install)
      setTemplates(prev => prev.map(x => x.id === t.id ? { ...x, auto_activate_on_install: !x.auto_activate_on_install } : x))
    } catch (e: any) { console.error('Toggle auto-activate error:', e) }
  }

  async function handleDelete(t: ServicePlanTemplate) {
    if (!confirm(`Delete "${t.name}"? This cannot be undone.`)) return
    // service_plan_items cascade deletes with plan (FK ON DELETE CASCADE expected)
    const { error } = await supabase.from('service_plans').delete().eq('id', t.id)
    if (!error) loadTemplates()
  }

  async function handleMove(t: ServicePlanTemplate, direction: 'up' | 'down') {
    const idx = templates.findIndex(x => x.id === t.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= templates.length) return
    const other = templates[swapIdx]
    await supabase.from('service_plans').update({ sort_order: other.sort_order }).eq('id', t.id)
    await supabase.from('service_plans').update({ sort_order: t.sort_order }).eq('id', other.id)
    loadTemplates()
  }

  function toggleCategory(cat: string) {
    setFCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat])
  }

  const activeCount = templates.filter(t => t.is_active).length
  const autoCount = templates.filter(t => t.auto_activate_on_install && t.is_active).length

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box' as const,
    background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f',
    borderRadius: 10, padding: '9px 14px', color: '#e2e8f0', fontSize: 13, outline: 'none',
  }
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6 }

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 16, margin: 0 }}>Service Plan Templates</h2>
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
            {activeCount} active · {autoCount} auto-enroll on install
          </p>
        </div>
        <button onClick={startAdd} style={{
          padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700,
          background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff', border: 'none', cursor: 'pointer',
        }}>+ Add Plan Template</button>
      </div>

      {showForm && (
        <div style={{ ...tableCardStyle, marginBottom: 16, padding: 20 }}>
          <h3 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14, marginBottom: 16 }}>
            {editing ? 'Edit Plan Template' : 'New Plan Template'}
          </h3>
          {error && (
            <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 10, padding: '8px 14px', marginBottom: 14, fontSize: 12, color: '#f87171' }}>{error}</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Plan Name</label>
              <input type="text" value={fName} onChange={e => setFName(e.target.value)} placeholder="e.g., Annual Maintenance Plan" style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Billing Cycle</label>
                <select value={fCycle} onChange={e => setFCycle(e.target.value)} style={inputStyle}>
                  <option value="monthly" style={{ background: '#0f1923' }}>Monthly</option>
                  <option value="quarterly" style={{ background: '#0f1923' }}>Quarterly</option>
                  <option value="yearly" style={{ background: '#0f1923' }}>Yearly</option>
                  <option value="one_time" style={{ background: '#0f1923' }}>One-Time</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Price per Cycle ($)</label>
                <input type="number" step="0.01" min="0" value={fPrice} onChange={e => setFPrice(e.target.value)} placeholder="0.00" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Fulfillment Type</label>
                <select value={fFulfillment} onChange={e => setFFulfillment(e.target.value)} style={inputStyle}>
                  <option value="tech_visit" style={{ background: '#0f1923' }}>Technician Visit</option>
                  <option value="shipment" style={{ background: '#0f1923' }}>Filter Shipment</option>
                  <option value="on_demand" style={{ background: '#0f1923' }}>On-Demand Service</option>
                  <option value="none" style={{ background: '#0f1923' }}>Billing Only (No Fulfillment)</option>
                </select>
              </div>
              {(fFulfillment === 'tech_visit' || fFulfillment === 'shipment') && (
                <div>
                  <label style={labelStyle}>Fulfillment Interval (months)</label>
                  <input type="number" min="1" value={fInterval} onChange={e => setFInterval(e.target.value)} placeholder="12" style={inputStyle} />
                </div>
              )}
            </div>

            {/* Gap 18: Multi-product plan items editor — shown for all fulfillment types */}
            {fFulfillment !== 'none' && (
              <div style={{ background: 'rgba(168,85,247,0.04)', border: '1px solid rgba(168,85,247,0.15)', borderRadius: 12, padding: 16 }}>
                <PlanItemsEditor
                  items={fPlanItems}
                  onChange={setFPlanItems}
                  products={products}
                  fulfillmentType={fFulfillment}
                />
              </div>
            )}

            <div>
              <label style={labelStyle}>Customer-Facing Description</label>
              <textarea value={fDesc} onChange={e => setFDesc(e.target.value)} rows={2} placeholder="Shown on quotes and customer pages" style={{ ...inputStyle, resize: 'none' as const, fontFamily: 'inherit' }} />
            </div>
            <div>
              <label style={labelStyle}>Internal Notes (admin only)</label>
              <textarea value={fNotes} onChange={e => setFNotes(e.target.value)} rows={2} placeholder="Not shown to customers" style={{ ...inputStyle, resize: 'none' as const, fontFamily: 'inherit' }} />
            </div>
            <div>
              <label style={labelStyle}>Applies to Product Categories <span style={{ color: '#334155' }}>(empty = all)</span></label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {PRODUCT_CATEGORIES.map(cat => {
                  const selected = fCategories.includes(cat.value)
                  return (
                    <button key={cat.value} onClick={() => toggleCategory(cat.value)} style={{
                      padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                      background: selected ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.04)',
                      color: selected ? '#f59e0b' : '#64748b',
                      border: `1px solid ${selected ? 'rgba(245,158,11,0.4)' : '#1e3a4f'}`,
                      fontWeight: selected ? 700 : 400,
                    }}>{cat.label}</button>
                  )
                })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 24 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={fRequiresSystem} onChange={e => setFRequiresSystem(e.target.checked)} style={{ width: 15, height: 15, accentColor: '#0d7ea3' }} />
                <span style={{ fontSize: 13, color: '#e2e8f0' }}>Requires Installed System</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={fAutoActivate} onChange={e => setFAutoActivate(e.target.checked)} style={{ width: 15, height: 15, accentColor: '#f59e0b' }} />
                <span style={{ fontSize: 13, color: '#e2e8f0' }}>Auto-Enroll on Install</span>
              </label>
            </div>
            {fAutoActivate && (
              <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, padding: '8px 14px', fontSize: 12, color: '#f59e0b', display: 'flex', gap: 8 }}>
                <span>⚡</span><span>This plan will automatically activate for every new installation matching the selected categories.</span>
              </div>
            )}

            {/* Feature Flags */}
            <div style={{ background: 'rgba(56,189,248,0.04)', border: '1px solid rgba(56,189,248,0.15)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                Coverage Features <span style={{ color: '#475569', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— informational only, shown on customer page</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  { state: fIncludesScheduled,   set: setFIncludesScheduled,   label: 'Scheduled Maintenance' },
                  { state: fIncludesUnscheduled,  set: setFIncludesUnscheduled,  label: 'Unscheduled Access' },
                  { state: fIncludesWaterTest,    set: setFIncludesWaterTest,    label: 'Water Tests' },
                  { state: fIncludesSalt,         set: setFIncludesSalt,         label: 'Salt Delivery' },
                  { state: fIncludesFilters,      set: setFIncludesFilters,      label: 'Filter Shipments' },
                  { state: fIncludesPriority,     set: setFIncludesPriority,     label: 'Priority Service' },
                ].map(({ state, set, label }) => (
                  <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={state} onChange={e => set(e.target.checked)}
                      style={{ width: 13, height: 13, accentColor: '#38bdf8' }} />
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Components Editor */}
            <div style={{ background: 'rgba(56,189,248,0.04)', border: '1px solid rgba(56,189,248,0.15)', borderRadius: 12, padding: 16 }}>
              <PlanComponentsEditor components={fComponents} onChange={setFComponents} />
            </div>

            <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
              <button onClick={() => { setShowForm(false); resetForm() }} style={{ padding: '8px 16px', borderRadius: 10, fontSize: 13, color: '#64748b', cursor: 'pointer', background: 'rgba(255,255,255,0.04)', border: '1px solid #1e3a4f' }}>Cancel</button>
              <button onClick={handleSave} disabled={saving || !fName.trim()} style={{ padding: '8px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#fff', background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', cursor: saving || !fName.trim() ? 'not-allowed' : 'pointer', opacity: saving || !fName.trim() ? 0.5 : 1 }}>
                {saving ? 'Saving...' : editing ? 'Update Template' : 'Create Template'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', color: '#64748b', padding: '48px 0' }}>Loading...</div>
      ) : templates.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔄</div>
          <p style={{ color: '#64748b' }}>No service plan templates yet.</p>
        </div>
      ) : (
        <div style={{ ...tableCardStyle, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 36 }}>#</th>
                <th style={thStyle}>Plan</th>
                <th style={{ ...thStyle, width: 100 }}>Billing</th>
                <th style={{ ...thStyle, width: 90, textAlign: 'right' }}>Price</th>
                <th style={{ ...thStyle, width: 160 }}>Fulfillment</th>
                <th style={{ ...thStyle, width: 80, textAlign: 'center' }}>Active</th>
                <th style={{ ...thStyle, width: 90, textAlign: 'center' }}>Auto-Enroll</th>
                <th style={{ ...thStyle, width: 70, textAlign: 'center' }}>Order</th>
                <th style={{ ...thStyle, width: 100, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t, idx) => {
                const tItems = planItemsMap[t.id] || []
                return (
                  <tr key={t.id} style={{ opacity: t.is_active ? 1 : 0.4 }}>
                    <td style={{ ...tdStyle, color: '#64748b', fontFamily: 'monospace' }}>{idx + 1}</td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{t.name}</div>
                      {t.description && <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>{t.description.length > 80 ? t.description.slice(0, 80) + '...' : t.description}</div>}
                      {Array.isArray(t.applies_to_categories) && t.applies_to_categories.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                          {t.applies_to_categories.map((cat: string) => (
                            <span key={cat} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 10, background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)' }}>{cat}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 20, background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid #1e3a4f' }}>
                        {t.billing_cycle === 'one_time' ? 'One-Time' : t.billing_cycle.charAt(0).toUpperCase() + t.billing_cycle.slice(1)}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                      ${Number(t.price).toFixed(2)}
                      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 400 }}>{BILLING_CYCLE_LABELS[t.billing_cycle] || ''}</div>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        fontSize: 11, padding: '3px 8px', borderRadius: 20,
                        background: t.fulfillment_type === 'tech_visit' ? 'rgba(96,165,250,0.1)' : t.fulfillment_type === 'shipment' ? 'rgba(168,85,247,0.1)' : t.fulfillment_type === 'on_demand' ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.05)',
                        color: t.fulfillment_type === 'tech_visit' ? '#60a5fa' : t.fulfillment_type === 'shipment' ? '#a855f7' : t.fulfillment_type === 'on_demand' ? '#4ade80' : '#94a3b8',
                        border: '1px solid transparent',
                      }}>
                        {FULFILLMENT_TYPE_LABELS[t.fulfillment_type] || t.fulfillment_type}
                      </span>
                      {t.fulfillment_interval_months && <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Every {t.fulfillment_interval_months} mo</div>}
                      {/* Gap 18: Show all plan items instead of single product */}
                      {tItems.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                          {tItems.map((item, i) => {
                            const pName = products.find(p => p.id === item.product_id)?.name
                            if (!pName) return null
                            return (
                              <div key={i} style={{ fontSize: 10, color: '#a855f7', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span>📦</span>
                                <span>{pName} ×{item.quantity}</span>
                                {item.cycle_year > 0 && (
                                  <span style={{ color: '#64748b' }}>· Yr {item.cycle_year}</span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        t.fulfillment_type === 'shipment' && (
                          <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>⚠️ No products linked</div>
                        )
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}><ActiveBadge active={t.is_active} onClick={() => handleToggleActive(t)} /></td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <button onClick={() => handleToggleAutoActivate(t)} style={{
                        fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 700, cursor: 'pointer',
                        background: t.auto_activate_on_install ? 'rgba(245,158,11,0.12)' : 'rgba(100,116,139,0.12)',
                        color: t.auto_activate_on_install ? '#f59e0b' : '#64748b',
                        border: `1px solid ${t.auto_activate_on_install ? 'rgba(245,158,11,0.4)' : 'rgba(100,116,139,0.2)'}`,
                      }}>
                        {t.auto_activate_on_install ? '⚡ On' : 'Off'}
                      </button>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>
                        <button onClick={() => handleMove(t, 'up')} disabled={idx === 0} style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', opacity: idx === 0 ? 0.2 : 1 }}>▲</button>
                        <button onClick={() => handleMove(t, 'down')} disabled={idx === templates.length - 1} style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', opacity: idx === templates.length - 1 ? 0.2 : 1 }}>▼</button>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                        <button onClick={() => startEdit(t)} style={{ fontSize: 12, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Edit</button>
                        <button onClick={async () => { try { await duplicatePlanTemplate(t.id); loadTemplates() } catch(e: any) { alert('Duplicate failed: ' + e.message) } }} style={{ fontSize: 12, color: '#a855f7', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Duplicate</button>
                        <button onClick={() => handleDelete(t)} style={{ fontSize: 12, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// TAB 8: AUTOMATIONS
// Toggle on/off + edit SMS templates for all 31 automation keys
// Grouped by group_name, reads/writes automation_settings table
// ════════════════════════════════════════════════════════════════

interface AutomationSetting {
  id: string
  key: string
  label: string
  group_name: string
  enabled: boolean
  channel: string
  sms_template: string | null
  timing_label: string | null
  updated_at: string
}

const CHANNEL_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  sms:      { bg: 'rgba(34,197,94,0.1)',   color: '#22c55e', border: 'rgba(34,197,94,0.3)' },
  email:    { bg: 'rgba(96,165,250,0.1)',  color: '#60a5fa', border: 'rgba(96,165,250,0.3)' },
  task:     { bg: 'rgba(251,191,36,0.1)',  color: '#fbbf24', border: 'rgba(251,191,36,0.3)' },
  internal: { bg: 'rgba(100,116,139,0.1)', color: '#94a3b8', border: 'rgba(100,116,139,0.2)' },
}

function AutomationsTab() {
  const [settings, setSettings] = useState<AutomationSetting[]>([])
  const [loading, setLoading] = useState(true)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editTemplate, setEditTemplate] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<Record<string, string>>({})

  useEffect(() => { loadSettings() }, [])

  async function loadSettings() {
    setLoading(true)
    const { data } = await supabase
      .from('automation_settings')
      .select('id, key, label, group_name, enabled, channel, sms_template, timing_label, updated_at')
      .order('group_name')
      .order('key')
    if (data) setSettings(data)
    setLoading(false)
  }

  async function toggleEnabled(setting: AutomationSetting) {
    const { error } = await supabase
      .from('automation_settings')
      .update({ enabled: !setting.enabled, updated_at: new Date().toISOString() })
      .eq('id', setting.id)
    if (!error) {
      setSettings(prev => prev.map(s => s.id === setting.id ? { ...s, enabled: !s.enabled } : s))
    }
  }

  function startEditTemplate(setting: AutomationSetting) {
    setEditingKey(setting.key)
    setEditTemplate(setting.sms_template || '')
  }

  async function saveTemplate(setting: AutomationSetting) {
    setSaving(true)
    const { error } = await supabase
      .from('automation_settings')
      .update({ sms_template: editTemplate.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', setting.id)

    if (error) {
      setSaveMsg(prev => ({ ...prev, [setting.key]: '❌ Error: ' + error.message }))
    } else {
      setSettings(prev => prev.map(s => s.id === setting.id ? { ...s, sms_template: editTemplate.trim() || null } : s))
      setSaveMsg(prev => ({ ...prev, [setting.key]: '✅ Saved' }))
      setEditingKey(null)
      setTimeout(() => setSaveMsg(prev => { const n = { ...prev }; delete n[setting.key]; return n }), 3000)
    }
    setSaving(false)
  }

  // Group settings by group_name
  const groups = settings.reduce<Record<string, AutomationSetting[]>>((acc, s) => {
    if (!acc[s.group_name]) acc[s.group_name] = []
    acc[s.group_name].push(s)
    return acc
  }, {})

  const groupOrder = ['Lead Pipeline', 'Consultation', 'Installation', 'Post-Install & Retention', 'Billing & Contracts', 'Shipping & Fulfillment']
  const sortedGroups = [
    ...groupOrder.filter(g => groups[g]),
    ...Object.keys(groups).filter(g => !groupOrder.includes(g)),
  ]

  const enabledCount = settings.filter(s => s.enabled).length

  if (loading) return <div style={{ textAlign: 'center', color: '#64748b', padding: '48px 0' }}>Loading automations...</div>

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 16, margin: 0 }}>Automation Settings</h2>
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
            {enabledCount} of {settings.length} automations active — toggle on/off and edit message templates
          </p>
        </div>
        <div style={{
          fontSize: 11, padding: '6px 14px', borderRadius: 20, fontWeight: 600,
          background: 'rgba(249,115,22,0.1)', color: '#f97316', border: '1px solid rgba(249,115,22,0.3)',
        }}>
          ⚡ Changes take effect on next trigger
        </div>
      </div>

      {/* Variable reference */}
      <div style={{
        background: 'rgba(13,126,163,0.06)', border: '1px solid rgba(13,126,163,0.2)',
        borderRadius: 12, padding: '12px 16px', marginBottom: 20,
        display: 'flex', gap: 12, alignItems: 'flex-start',
      }}>
        <span style={{ fontSize: 18, flexShrink: 0 }}>💡</span>
        <div>
          <div style={{ color: '#38bdf8', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Template Variables</div>
          <div style={{ color: '#64748b', fontSize: 11, lineHeight: 1.6 }}>
            Use <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4, color: '#94a3b8' }}>{'{{name}}'}</code>
            {' '}<code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4, color: '#94a3b8' }}>{'{{date}}'}</code>
            {' '}<code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4, color: '#94a3b8' }}>{'{{time}}'}</code>
            {' '}<code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4, color: '#94a3b8' }}>{'{{tracking_number}}'}</code>
            {' '}<code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4, color: '#94a3b8' }}>{'{{plan_name}}'}</code>
            {' — '}replaced automatically when SMS is sent.
          </div>
        </div>
      </div>

      {/* Groups */}
      {sortedGroups.map(groupName => {
        const groupSettings = groups[groupName] || []
        const groupEnabled = groupSettings.filter(s => s.enabled).length

        return (
          <div key={groupName} style={{ marginBottom: 20 }}>
            {/* Group header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8,
              paddingBottom: 8, borderBottom: '1px solid #1e3a4f',
            }}>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13 }}>{groupName}</div>
              <div style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 600,
                background: 'rgba(249,115,22,0.08)', color: '#f97316',
              }}>
                {groupEnabled}/{groupSettings.length} active
              </div>
            </div>

            {/* Automation rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {groupSettings.map(setting => {
                const chanStyle = CHANNEL_COLORS[setting.channel] || CHANNEL_COLORS.internal
                const isEditingThis = editingKey === setting.key
                const hasSaveMsg = saveMsg[setting.key]

                return (
                  <div key={setting.key} style={{
                    background: '#162232', border: `1px solid ${setting.enabled ? '#1e3a4f' : 'rgba(255,255,255,0.04)'}`,
                    borderRadius: 12, overflow: 'hidden',
                    opacity: setting.enabled ? 1 : 0.55,
                  }}>
                    {/* Main row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                      {/* Toggle */}
                      <button
                        onClick={() => toggleEnabled(setting)}
                        style={{
                          width: 44, height: 24, borderRadius: 12, cursor: 'pointer', flexShrink: 0,
                          background: setting.enabled ? '#f97316' : 'rgba(100,116,139,0.3)',
                          border: 'none', position: 'relative', transition: 'background 0.2s',
                        }}
                      >
                        <div style={{
                          position: 'absolute', top: 3,
                          left: setting.enabled ? 23 : 3,
                          width: 18, height: 18, borderRadius: '50%',
                          background: '#fff', transition: 'left 0.2s',
                        }} />
                      </button>

                      {/* Label + timing */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13 }}>{setting.label}</div>
                        {setting.timing_label && (
                          <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>⏱ {setting.timing_label}</div>
                        )}
                      </div>

                      {/* Channel badge */}
                      <span style={{
                        fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700, flexShrink: 0,
                        background: chanStyle.bg, color: chanStyle.color, border: `1px solid ${chanStyle.border}`,
                        textTransform: 'uppercase',
                      }}>
                        {setting.channel}
                      </span>

                      {/* Edit template button (SMS only) */}
                      {setting.channel === 'sms' && (
                        <button
                          onClick={() => isEditingThis ? setEditingKey(null) : startEditTemplate(setting)}
                          style={{
                            fontSize: 11, padding: '4px 12px', borderRadius: 8, cursor: 'pointer', flexShrink: 0,
                            background: isEditingThis ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.05)',
                            color: isEditingThis ? '#f97316' : '#64748b',
                            border: `1px solid ${isEditingThis ? 'rgba(249,115,22,0.3)' : '#1e3a4f'}`,
                            fontWeight: 600,
                          }}
                        >
                          {isEditingThis ? 'Cancel' : '✏️ Edit Message'}
                        </button>
                      )}

                      {hasSaveMsg && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: hasSaveMsg.includes('❌') ? '#f87171' : '#4ade80', flexShrink: 0 }}>
                          {hasSaveMsg}
                        </span>
                      )}
                    </div>

                    {/* SMS template editor (expanded) */}
                    {isEditingThis && (
                      <div style={{ padding: '0 16px 16px', borderTop: '1px solid #1e3a4f' }}>
                        <div style={{ paddingTop: 12 }}>
                          <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                            Message Template <span style={{ color: '#334155' }}>({editTemplate.length} chars · recommended max 160)</span>
                          </label>
                          <textarea
                            value={editTemplate}
                            onChange={e => setEditTemplate(e.target.value)}
                            rows={3}
                            style={{
                              width: '100%', boxSizing: 'border-box',
                              background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f',
                              borderRadius: 10, padding: '10px 14px', color: '#e2e8f0', fontSize: 13,
                              fontFamily: 'inherit', outline: 'none', resize: 'none',
                            }}
                          />
                          {/* Preview with dummy vars */}
                          {editTemplate && (
                            <div style={{
                              background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8,
                              padding: '8px 12px', marginTop: 8, fontSize: 12, color: '#94a3b8', lineHeight: 1.5,
                            }}>
                              <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Preview: </span>
                              {editTemplate
                                .replace(/{{name}}/g, 'John')
                                .replace(/{{date}}/g, 'Wednesday, April 2')
                                .replace(/{{time}}/g, '10:00 AM')
                                .replace(/{{tracking_number}}/g, '1234567890')
                                .replace(/{{plan_name}}/g, 'Annual Filter Plan')
                                .replace(/{{review_url}}/g, 'g.page/review')}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <button onClick={() => setEditingKey(null)} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, color: '#64748b', cursor: 'pointer', background: 'rgba(255,255,255,0.04)', border: '1px solid #1e3a4f' }}>
                              Cancel
                            </button>
                            <button
                              onClick={() => saveTemplate(setting)}
                              disabled={saving}
                              style={{ padding: '7px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, color: '#fff', background: 'linear-gradient(135deg, #f97316, #ea580c)', border: 'none', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1 }}
                            >
                              {saving ? 'Saving...' : 'Save Template'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Current template preview (collapsed, SMS only) */}
                    {!isEditingThis && setting.channel === 'sms' && setting.sms_template && (
                      <div style={{
                        padding: '6px 16px 10px',
                        borderTop: '1px solid rgba(255,255,255,0.03)',
                      }}>
                        <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.5, fontStyle: 'italic' }}>
                          "{setting.sms_template.length > 120 ? setting.sms_template.slice(0, 120) + '...' : setting.sms_template}"
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
