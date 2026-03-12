// src/modules/admin/AdminSettingsPage.tsx
// Admin Settings — tabbed page: Term Blocks | Qualifying Checklist
// Replaces old TermsAdminPage with same term block logic + new qualifying questions manager

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
  terms_page: '📄 General Terms & Conditions',
  rental_agreement: '📋 Rental Agreement',
  rental_quote: '💬 Rental Quote',
  purchase_invoice: '🧾 Purchase Invoice / Quote',
  all: '🌐 All Documents',
}
const DOC_TYPE_ORDER = ['terms_page', 'rental_agreement', 'rental_quote', 'purchase_invoice', 'all']

const FIELD_TYPE_LABELS: Record<string, string> = {
  dropdown: 'Dropdown',
  yes_no: 'Yes / No',
  number: 'Number',
  text: 'Text Input',
  prefill_water_concern: 'Auto-fill: Water Concern',
  prefill_address: 'Auto-fill: Address',
  prefill_source: 'Auto-fill: Lead Source',
}

type AdminTab = 'terms' | 'qualifying' | 'site_visit'

export default function AdminSettingsPage() {
  const { profile } = useAuth()
  const [activeTab, setActiveTab] = useState<AdminTab>('qualifying')
  const isAdmin = profile?.role === 'admin'

  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <div className="text-4xl mb-4">🔒</div>
        <h2 className="text-xl font-semibold text-gray-700">Admin Access Only</h2>
        <p className="text-gray-500 mt-2">You don't have permission to view this page.</p>
      </div>
    )
  }

  const tabs: { key: AdminTab; label: string; icon: string }[] = [
    { key: 'qualifying', label: 'Qualifying Checklist', icon: '✅' },
    { key: 'site_visit', label: 'Site Visit Checklist', icon: '📋' },
    { key: 'terms', label: 'Term Blocks', icon: '📄' },
  ]

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Top bar with tabs */}
      <div className="bg-white border-b border-gray-200 px-6 pt-5 pb-0">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Admin Settings</h1>
        <p className="text-sm text-gray-500 mb-4">Manage qualifying questions, terms, and business configuration</p>
        <div className="flex gap-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === t.key
                  ? 'bg-gray-50 text-blue-700 border-t-2 border-x border-blue-500 border-gray-200 -mb-px'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              <span className="mr-1.5">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'terms' && <TermBlocksTab />}
        {activeTab === 'qualifying' && <QualifyingQuestionsTab />}
        {activeTab === 'site_visit' && <SiteVisitQuestionsTab />}
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

  // Add/Edit form state
  const [formText, setFormText] = useState('')
  const [formType, setFormType] = useState('dropdown')
  const [formOptions, setFormOptions] = useState('')
  const [formRequired, setFormRequired] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchQuestions() }, [])

  async function fetchQuestions() {
    setLoading(true)
    const { data } = await supabase
      .from('qualifying_questions')
      .select('*')
      .order('sort_order')
    if (data) setQuestions(data)
    setLoading(false)
  }

  function startAdd() {
    setEditing(null)
    setFormText('')
    setFormType('dropdown')
    setFormOptions('')
    setFormRequired(true)
    setShowAddForm(true)
  }

  function startEdit(q: QualifyingQuestion) {
    setEditing(q)
    setFormText(q.question_text)
    setFormType(q.field_type)
    setFormOptions(Array.isArray(q.options) ? q.options.join(', ') : '')
    setFormRequired(q.is_required)
    setShowAddForm(true)
  }

  async function saveQuestion() {
    if (!formText.trim()) return
    setSaving(true)

    const optionsArray = formType === 'dropdown'
      ? formOptions.split(',').map(s => s.trim()).filter(Boolean)
      : []

    if (editing) {
      // Update existing
      await supabase
        .from('qualifying_questions')
        .update({
          question_text: formText.trim(),
          field_type: formType,
          options: optionsArray,
          is_required: formRequired,
        })
        .eq('id', editing.id)
    } else {
      // Insert new
      const maxOrder = questions.reduce((max, q) => Math.max(max, q.sort_order), 0)
      await supabase
        .from('qualifying_questions')
        .insert({
          question_text: formText.trim(),
          field_type: formType,
          options: optionsArray,
          is_required: formRequired,
          sort_order: maxOrder + 1,
          is_active: true,
        })
    }

    setShowAddForm(false)
    setEditing(null)
    setSaving(false)
    fetchQuestions()
  }

  async function toggleRequired(q: QualifyingQuestion) {
    await supabase
      .from('qualifying_questions')
      .update({ is_required: !q.is_required })
      .eq('id', q.id)
    setQuestions(prev => prev.map(x => x.id === q.id ? { ...x, is_required: !x.is_required } : x))
  }

  async function toggleActive(q: QualifyingQuestion) {
    await supabase
      .from('qualifying_questions')
      .update({ is_active: !q.is_active })
      .eq('id', q.id)
    setQuestions(prev => prev.map(x => x.id === q.id ? { ...x, is_active: !x.is_active } : x))
  }

  async function moveQuestion(q: QualifyingQuestion, direction: 'up' | 'down') {
    const idx = questions.findIndex(x => x.id === q.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= questions.length) return

    const other = questions[swapIdx]
    // Swap sort_order values
    await supabase.from('qualifying_questions').update({ sort_order: other.sort_order }).eq('id', q.id)
    await supabase.from('qualifying_questions').update({ sort_order: q.sort_order }).eq('id', other.id)
    fetchQuestions()
  }

  async function deleteQuestion(q: QualifyingQuestion) {
    if (!confirm(`Delete "${q.question_text}"?\n\nExisting lead answers for this question will remain in the database but won't display.`)) return
    await supabase.from('qualifying_questions').delete().eq('id', q.id)
    fetchQuestions()
  }

  const activeCount = questions.filter(q => q.is_active).length
  const requiredCount = questions.filter(q => q.is_active && q.is_required).length

  return (
    <div className="p-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Qualifying Questions</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {activeCount} active questions · {requiredCount} required
            <span className="text-gray-400 ml-2">— Front desk sees these when qualifying a lead</span>
          </p>
        </div>
        <button
          onClick={startAdd}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Add Question
        </button>
      </div>

      {/* Add/Edit form */}
      {showAddForm && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-4">{editing ? 'Edit Question' : 'New Question'}</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Question Text</label>
              <input
                type="text"
                value={formText}
                onChange={e => setFormText(e.target.value)}
                placeholder="e.g., Homeowner or renter?"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Answer Type</label>
                <select
                  value={formType}
                  onChange={e => setFormType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Object.entries(FIELD_TYPE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formRequired}
                    onChange={e => setFormRequired(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">Required to qualify</span>
                </label>
              </div>
            </div>

            {formType === 'dropdown' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Options <span className="font-normal text-gray-400">(comma separated)</span>
                </label>
                <input
                  type="text"
                  value={formOptions}
                  onChange={e => setFormOptions(e.target.value)}
                  placeholder="e.g., Homeowner, Renter"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setShowAddForm(false); setEditing(null) }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={saveQuestion}
                disabled={saving || !formText.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : editing ? 'Update Question' : 'Add Question'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Questions list */}
      {loading ? (
        <div className="text-center text-gray-400 py-12">Loading...</div>
      ) : questions.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-gray-500">No qualifying questions yet. Add your first one above.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 w-10">#</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Question</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 w-32">Type</th>
                <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 w-24">Required</th>
                <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 w-20">Active</th>
                <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 w-24">Order</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 w-28">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {questions.map((q, idx) => (
                <tr key={q.id} className={`hover:bg-gray-50 transition-colors ${!q.is_active ? 'opacity-40' : ''}`}>
                  <td className="px-4 py-3 text-sm text-gray-400 font-mono">{idx + 1}</td>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">{q.question_text}</div>
                    {q.field_type === 'dropdown' && q.options?.length > 0 && (
                      <div className="text-xs text-gray-400 mt-0.5">
                        Options: {q.options.join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {FIELD_TYPE_LABELS[q.field_type] || q.field_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleRequired(q)}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                        q.is_required
                          ? 'bg-red-100 text-red-700 hover:bg-red-200'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {q.is_required ? 'Required' : 'Optional'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleActive(q)}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                        q.is_active
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {q.is_active ? 'Active' : 'Off'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => moveQuestion(q, 'up')}
                        disabled={idx === 0}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-sm"
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => moveQuestion(q, 'down')}
                        disabled={idx === questions.length - 1}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-sm"
                      >
                        ▼
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => startEdit(q)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteQuestion(q)}
                        className="text-xs text-red-500 hover:text-red-700 font-medium"
                      >
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
  yes_no: 'Yes / No',
  number: 'Number',
  text: 'Text Input',
  photo: 'Photo Upload',
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
    const { data } = await supabase
      .from('site_visit_questions')
      .select('*')
      .order('sort_order')
    if (data) setQuestions(data)
    setLoading(false)
  }

  function startAdd() {
    setEditing(null)
    setFormText(''); setFormType('dropdown'); setFormOptions(''); setFormRequired(true); setFormRequiresPhoto(false)
    setShowAddForm(true)
  }

  function startEdit(q: SiteVisitQuestion) {
    setEditing(q)
    setFormText(q.question_text)
    setFormType(q.field_type)
    setFormOptions(Array.isArray(q.options) ? q.options.join(', ') : '')
    setFormRequired(q.is_required)
    setFormRequiresPhoto(q.requires_photo)
    setShowAddForm(true)
  }

  async function saveQuestion() {
    if (!formText.trim()) return
    setSaving(true)
    const optionsArray = formType === 'dropdown' ? formOptions.split(',').map(s => s.trim()).filter(Boolean) : []

    if (editing) {
      await supabase.from('site_visit_questions').update({
        question_text: formText.trim(), field_type: formType, options: optionsArray,
        is_required: formRequired, requires_photo: formRequiresPhoto || formType === 'photo',
      }).eq('id', editing.id)
    } else {
      const maxOrder = questions.reduce((max, q) => Math.max(max, q.sort_order), 0)
      await supabase.from('site_visit_questions').insert({
        question_text: formText.trim(), field_type: formType, options: optionsArray,
        is_required: formRequired, requires_photo: formRequiresPhoto || formType === 'photo',
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
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Site Visit Checklist</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {activeCount} active items · {requiredCount} required
            <span className="text-gray-400 ml-2">— Sales reps complete these during site visits</span>
          </p>
        </div>
        <button onClick={startAdd} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          + Add Item
        </button>
      </div>

      {/* Add/Edit form */}
      {showAddForm && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-4">{editing ? 'Edit Item' : 'New Item'}</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Item Text</label>
              <input type="text" value={formText} onChange={e => setFormText(e.target.value)} placeholder="e.g., Under-sink photo"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Answer Type</label>
                <select value={formType} onChange={e => { setFormType(e.target.value); if (e.target.value === 'photo') setFormRequiresPhoto(true) }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {Object.entries(SV_FIELD_TYPE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2 pt-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formRequired} onChange={e => setFormRequired(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm font-medium text-gray-700">Required</span>
                </label>
              </div>
            </div>
            {formType === 'dropdown' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Options <span className="font-normal text-gray-400">(comma separated)</span></label>
                <input type="text" value={formOptions} onChange={e => setFormOptions(e.target.value)} placeholder="e.g., Yes, No, Needs Work"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button onClick={() => { setShowAddForm(false); setEditing(null) }} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={saveQuestion} disabled={saving || !formText.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {saving ? 'Saving...' : editing ? 'Update Item' : 'Add Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Questions list */}
      {loading ? (
        <div className="text-center text-gray-400 py-12">Loading...</div>
      ) : questions.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-gray-500">No site visit items yet.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 w-10">#</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Item</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 w-28">Type</th>
                <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 w-24">Required</th>
                <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 w-20">Active</th>
                <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 w-24">Order</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 w-28">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {questions.map((q, idx) => (
                <tr key={q.id} className={`hover:bg-gray-50 transition-colors ${!q.is_active ? 'opacity-40' : ''}`}>
                  <td className="px-4 py-3 text-sm text-gray-400 font-mono">{idx + 1}</td>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">
                      {q.field_type === 'photo' && '📷 '}{q.question_text}
                    </div>
                    {q.field_type === 'dropdown' && q.options?.length > 0 && (
                      <div className="text-xs text-gray-400 mt-0.5">Options: {q.options.join(' · ')}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {SV_FIELD_TYPE_LABELS[q.field_type] || q.field_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleRequired(q)}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${q.is_required ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                      {q.is_required ? 'Required' : 'Optional'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleActive(q)}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${q.is_active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                      {q.is_active ? 'Active' : 'Off'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => moveQuestion(q, 'up')} disabled={idx === 0} className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-sm">▲</button>
                      <button onClick={() => moveQuestion(q, 'down')} disabled={idx === questions.length - 1} className="text-gray-400 hover:text-gray-600 disabled:opacity-20 text-sm">▼</button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => startEdit(q)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                      <button onClick={() => deleteQuestion(q)} className="text-xs text-red-500 hover:text-red-700 font-medium">Delete</button>
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
// TAB 3: TERM BLOCKS (existing logic, unchanged)
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
    const { data, error } = await supabase
      .from('term_blocks')
      .select('*')
      .order('document_type')
      .order('sort_order')
    if (!error && data) setBlocks(data)
    setLoading(false)
  }

  function startEdit(block: TermBlock) {
    setEditing(block)
    setEditContent(block.content)
    setEditTitle(block.display_title || block.name)
    setSaveMsg('')
  }

  async function saveEdit() {
    if (!editing) return
    setSaving(true)
    const { error } = await supabase
      .from('term_blocks')
      .update({
        content: editContent,
        display_title: editTitle,
        version: editing.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editing.id)
    if (error) {
      setSaveMsg('❌ Error saving: ' + error.message)
    } else {
      setSaveMsg('✅ Saved')
      setBlocks(prev => prev.map(b => b.id === editing.id
        ? { ...b, content: editContent, display_title: editTitle, version: b.version + 1 }
        : b
      ))
      setEditing(null)
    }
    setSaving(false)
    setTimeout(() => setSaveMsg(''), 3000)
  }

  async function toggleActive(block: TermBlock) {
    const { error } = await supabase
      .from('term_blocks')
      .update({ is_active: !block.is_active })
      .eq('id', block.id)
    if (!error) {
      setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, is_active: !b.is_active } : b))
    }
  }

  const filtered = blocks.filter(b => {
    const matchType = b.document_type === activeDocType
    const matchSearch = search === '' ||
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.content.toLowerCase().includes(search.toLowerCase()) ||
      (b.display_title || '').toLowerCase().includes(search.toLowerCase())
    return matchType && matchSearch
  })

  return (
    <div className="flex h-full">
      {/* LEFT SIDEBAR — Document Type Nav */}
      <div className="w-64 bg-white border-r border-gray-200 flex-shrink-0 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-900">Document Categories</h2>
          <p className="text-xs text-gray-500 mt-1">Changes go live instantly</p>
        </div>

        <div className="p-3">
          <input
            type="text"
            placeholder="Search terms..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {DOC_TYPE_ORDER.map(dt => {
            const count = blocks.filter(b => b.document_type === dt).length
            return (
              <button
                key={dt}
                onClick={() => { setActiveDocType(dt); setEditing(null) }}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  activeDocType === dt
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <div>{DOC_TYPE_LABELS[dt] || dt}</div>
                <div className="text-xs text-gray-400 mt-0.5">{count} blocks</div>
              </button>
            )
          })}
        </nav>

        {/* Public T&C link */}
        <div className="p-4 border-t border-gray-200">
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 transition-colors"
          >
            <span>🌐</span>
            <span>View Public T&C Page</span>
            <span className="ml-auto text-gray-400">↗</span>
          </a>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex overflow-hidden">
        {/* BLOCK LIST */}
        <div className={`${editing ? 'w-80' : 'flex-1'} flex-shrink-0 overflow-y-auto border-r border-gray-200 bg-white`}>
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <h2 className="font-semibold text-gray-800">{DOC_TYPE_LABELS[activeDocType]}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{filtered.length} term blocks</p>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-400">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-400">No blocks found</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filtered.map(block => (
                <div
                  key={block.id}
                  className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                    editing?.id === block.id ? 'bg-blue-50 border-l-2 border-blue-500' : ''
                  } ${!block.is_active ? 'opacity-50' : ''}`}
                  onClick={() => startEdit(block)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900 truncate">
                        {block.display_title || block.name}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        v{block.version} · {block.slug}
                      </div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); toggleActive(block) }}
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        block.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {block.is_active ? 'Active' : 'Off'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-2 line-clamp-2">{block.content.slice(0, 120)}...</p>
                  <div className="text-xs text-gray-300 mt-1">
                    Updated {new Date(block.updated_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* EDITOR PANEL */}
        {editing && (
          <div className="flex-1 flex flex-col overflow-hidden bg-white">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
              <div>
                <h3 className="font-semibold text-gray-900">Edit Block</h3>
                <p className="text-xs text-gray-400">{editing.slug} · v{editing.version} → v{editing.version + 1}</p>
              </div>
              <div className="flex items-center gap-2">
                {saveMsg && (
                  <span className={`text-sm font-medium ${saveMsg.includes('❌') ? 'text-red-600' : 'text-green-600'}`}>
                    {saveMsg}
                  </span>
                )}
                <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 rounded-lg">Cancel</button>
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
                <span>⚠️</span>
                <div className="text-sm text-amber-800">
                  <strong>Live content.</strong> Changes update the public T&C page and all new documents instantly.
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Section Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Content <span className="text-gray-400 font-normal ml-2">({editContent.length} chars)</span>
                </label>
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  rows={28}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-none"
                />
              </div>

              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">Preview</div>
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                  <h4 className="font-bold text-gray-800 mb-2 text-sm">{editTitle}</h4>
                  <div className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">{editContent}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {!editing && (
          <div className="hidden lg:flex flex-1 items-center justify-center text-gray-400 bg-gray-50">
            <div className="text-center">
              <div className="text-5xl mb-3">📝</div>
              <p className="text-lg font-medium">Select a block to edit</p>
              <p className="text-sm mt-1">Click any term block on the left</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

