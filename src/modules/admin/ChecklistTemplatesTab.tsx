// src/modules/admin/ChecklistTemplatesTab.tsx
// Admin tab for managing checklist templates, sections, and items
// Phase 4: Site Survey + Water Testing
import { useState, useEffect } from 'react'
import {
  fetchTemplates,
  fetchTemplateWithSections,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  createSection,
  updateSection,
  deleteSection,
  reorderSections,
  createItem,
  updateItem,
  deleteItem,
  reorderItems,
  type ChecklistTemplate,
  type ChecklistSection,
  type ChecklistItem,
} from '../../services/checklistService'

// ── Constants ─────────────────────────────────────────────────
const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  installer:   '🔧 Installer Checklist',
  handover:    '🤝 Customer Handover',
  site_survey: '📋 Site Survey',
}

const SYSTEM_TYPE_LABELS: Record<string, string> = {
  ro:         'Reverse Osmosis',
  softener:   'Water Softener',
  whole_home: 'Whole Home',
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  checkbox: '☑️ Checkbox',
  text:     '📝 Text',
  dropdown: '📋 Dropdown',
  photo:    '📷 Photo',
  number:   '🔢 Number',
}

const FIELD_TYPE_COLORS: Record<string, string> = {
  checkbox: '#4ade80',
  text:     '#60a5fa',
  dropdown: '#a78bfa',
  photo:    '#f59e0b',
  number:   '#22d3ee',
}

// ── Shared Styles ─────────────────────────────────────────────
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
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f',
  borderRadius: 10, padding: '9px 14px', color: '#e2e8f0', fontSize: 13, outline: 'none',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6,
}
const btnPrimary: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#fff',
  background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', border: 'none', cursor: 'pointer',
}
const btnSecondary: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 10, fontSize: 13, color: '#64748b', cursor: 'pointer',
  background: 'rgba(255,255,255,0.04)', border: '1px solid #1e3a4f',
}

// ════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ════════════════════════════════════════════════════════════════
export function ChecklistTemplatesTab() {
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTemplate, setSelectedTemplate] = useState<ChecklistTemplate | null>(null)
  const [showTemplateForm, setShowTemplateForm] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<ChecklistTemplate | null>(null)

  // Template form state
  const [fName, setFName] = useState('')
  const [fType, setFType] = useState<'installer' | 'handover' | 'site_survey'>('installer')
  const [fSystemType, setFSystemType] = useState<'ro' | 'softener' | 'whole_home' | ''>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadTemplates() }, [])

  async function loadTemplates() {
    setLoading(true)
    const data = await fetchTemplates()
    setTemplates(data)
    setLoading(false)
  }

  function startAddTemplate() {
    setEditingTemplate(null)
    setFName(''); setFType('installer'); setFSystemType('')
    setShowTemplateForm(true)
  }

  function startEditTemplate(t: ChecklistTemplate) {
    setEditingTemplate(t)
    setFName(t.name)
    setFType(t.type)
    setFSystemType(t.system_type || '')
    setShowTemplateForm(true)
  }

  async function saveTemplate() {
    if (!fName.trim()) return
    setSaving(true)
    const systemType = fSystemType || null
    if (editingTemplate) {
      await updateTemplate(editingTemplate.id, { name: fName.trim(), type: fType, system_type: systemType as any })
    } else {
      await createTemplate({ name: fName.trim(), type: fType, system_type: systemType as any })
    }
    setShowTemplateForm(false)
    setEditingTemplate(null)
    setSaving(false)
    loadTemplates()
  }

  async function handleDeleteTemplate(t: ChecklistTemplate) {
    if (!confirm(`Delete "${t.name}" and all its sections/items? This cannot be undone.`)) return
    await deleteTemplate(t.id)
    if (selectedTemplate?.id === t.id) setSelectedTemplate(null)
    loadTemplates()
  }

  async function handleToggleActive(t: ChecklistTemplate) {
    await updateTemplate(t.id, { is_active: !t.is_active })
    setTemplates(prev => prev.map(x => x.id === t.id ? { ...x, is_active: !x.is_active } : x))
  }

  async function selectTemplate(t: ChecklistTemplate) {
    const full = await fetchTemplateWithSections(t.id)
    setSelectedTemplate(full)
  }

  const activeCount = templates.filter(t => t.is_active).length
  const typeGroups = {
    installer: templates.filter(t => t.type === 'installer'),
    handover: templates.filter(t => t.type === 'handover'),
    site_survey: templates.filter(t => t.type === 'site_survey'),
  }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* LEFT: Template list */}
      <div style={{
        width: selectedTemplate ? 280 : 360, flexShrink: 0,
        background: '#162232', border: '1px solid #1e3a4f',
        borderRadius: selectedTemplate ? '14px 0 0 14px' : 14,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #1e3a4f' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>Checklist Templates</div>
              <div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>
                {templates.length} total · {activeCount} active
              </div>
            </div>
            <button onClick={startAddTemplate} style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
              background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', color: '#fff',
              border: 'none', cursor: 'pointer',
            }}>
              + Add
            </button>
          </div>
        </div>

        {/* Template form (inline) */}
        {showTemplateForm && (
          <div style={{ padding: 16, borderBottom: '1px solid #1e3a4f', background: 'rgba(139,92,246,0.04)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>
              {editingTemplate ? 'Edit Template' : 'New Template'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={labelStyle}>Name</label>
                <input type="text" value={fName} onChange={e => setFName(e.target.value)}
                  placeholder="e.g., RO Installer Checklist" style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={labelStyle}>Type</label>
                  <select value={fType} onChange={e => setFType(e.target.value as any)} style={inputStyle}>
                    <option value="installer" style={{ background: '#0f1923' }}>Installer</option>
                    <option value="handover" style={{ background: '#0f1923' }}>Handover</option>
                    <option value="site_survey" style={{ background: '#0f1923' }}>Site Survey</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>System Type</label>
                  <select value={fSystemType} onChange={e => setFSystemType(e.target.value as any)} style={inputStyle}>
                    <option value="" style={{ background: '#0f1923' }}>All Systems</option>
                    <option value="ro" style={{ background: '#0f1923' }}>RO</option>
                    <option value="softener" style={{ background: '#0f1923' }}>Softener</option>
                    <option value="whole_home" style={{ background: '#0f1923' }}>Whole Home</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setShowTemplateForm(false); setEditingTemplate(null) }} style={btnSecondary}>Cancel</button>
                <button onClick={saveTemplate} disabled={saving || !fName.trim()}
                  style={{ ...btnPrimary, opacity: saving || !fName.trim() ? 0.5 : 1, cursor: saving || !fName.trim() ? 'not-allowed' : 'pointer' }}>
                  {saving ? 'Saving...' : editingTemplate ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Template list by type */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#64748b', padding: 48 }}>Loading...</div>
          ) : templates.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 16px' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
              <p style={{ color: '#64748b', fontSize: 13 }}>No checklist templates yet.</p>
            </div>
          ) : (
            (['installer', 'handover', 'site_survey'] as const).map(typeKey => {
              const group = typeGroups[typeKey]
              if (group.length === 0) return null
              return (
                <div key={typeKey}>
                  <div style={{
                    padding: '10px 16px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.06em', color: '#64748b', background: 'rgba(255,255,255,0.02)',
                    borderBottom: '1px solid #1e3a4f',
                  }}>
                    {TEMPLATE_TYPE_LABELS[typeKey]}
                  </div>
                  {group.map(t => {
                    const isSelected = selectedTemplate?.id === t.id
                    return (
                      <div key={t.id}
                        onClick={() => selectTemplate(t)}
                        style={{
                          padding: '12px 16px', cursor: 'pointer',
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                          borderLeft: isSelected ? '3px solid #8b5cf6' : '3px solid transparent',
                          background: isSelected ? 'rgba(139,92,246,0.08)' : 'transparent',
                          opacity: t.is_active ? 1 : 0.4,
                        }}
                        onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)' }}
                        onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                            <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                              {t.system_type ? SYSTEM_TYPE_LABELS[t.system_type] : 'All Systems'}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                            <button onClick={e => { e.stopPropagation(); handleToggleActive(t) }}
                              style={{
                                fontSize: 10, padding: '2px 8px', borderRadius: 20, cursor: 'pointer',
                                background: t.is_active ? 'rgba(74,222,128,0.12)' : 'rgba(100,116,139,0.12)',
                                color: t.is_active ? '#4ade80' : '#64748b',
                                border: `1px solid ${t.is_active ? 'rgba(74,222,128,0.25)' : 'rgba(100,116,139,0.2)'}`,
                              }}>
                              {t.is_active ? 'Active' : 'Off'}
                            </button>
                            <button onClick={e => { e.stopPropagation(); startEditTemplate(t) }}
                              style={{ fontSize: 11, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer' }}>
                              ✏️
                            </button>
                            <button onClick={e => { e.stopPropagation(); handleDeleteTemplate(t) }}
                              style={{ fontSize: 11, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer' }}>
                              🗑
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* RIGHT: Section & Item editor */}
      {selectedTemplate ? (
        <SectionEditor
          template={selectedTemplate}
          onRefresh={() => selectTemplate(selectedTemplate)}
        />
      ) : (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0f1923', border: '1px solid #1e3a4f', borderLeft: 'none',
          borderRadius: '0 14px 14px 0',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.4 }}>📋</div>
            <p style={{ color: '#64748b', fontSize: 13 }}>Select a template to manage its sections and items</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// SECTION EDITOR — manages sections and items within a template
// ════════════════════════════════════════════════════════════════
function SectionEditor({ template, onRefresh }: {
  template: ChecklistTemplate
  onRefresh: () => void
}) {
  const sections = template.sections || []
  const [expandedSection, setExpandedSection] = useState<string | null>(
    sections.length > 0 ? sections[0].id : null
  )

  // Section form
  const [showSectionForm, setShowSectionForm] = useState(false)
  const [editingSection, setEditingSection] = useState<ChecklistSection | null>(null)
  const [sTitle, setSTitle] = useState('')
  const [sLabel, setSLabel] = useState('')
  const [sConditional, setSConditional] = useState(false)
  const [sConditionLabel, setSConditionLabel] = useState('')
  const [savingSection, setSavingSection] = useState(false)

  // Item form
  const [showItemForm, setShowItemForm] = useState(false)
  const [editingItem, setEditingItem] = useState<ChecklistItem | null>(null)
  const [itemSectionId, setItemSectionId] = useState('')
  const [iText, setIText] = useState('')
  const [iFieldType, setIFieldType] = useState<'checkbox' | 'text' | 'dropdown' | 'photo' | 'number'>('checkbox')
  const [iOptions, setIOptions] = useState('')
  const [iRequired, setIRequired] = useState(false)
  const [iPhoto, setIPhoto] = useState(false)
  const [savingItem, setSavingItem] = useState(false)

  // ── Section CRUD ────────────────────────────────────────────
  function startAddSection() {
    setEditingSection(null)
    setSTitle(''); setSLabel(''); setSConditional(false); setSConditionLabel('')
    setShowSectionForm(true)
  }

  function startEditSection(s: ChecklistSection) {
    setEditingSection(s)
    setSTitle(s.title)
    setSLabel(s.letter_label || '')
    setSConditional(s.is_conditional)
    setSConditionLabel(s.condition_label || '')
    setShowSectionForm(true)
  }

  async function saveSection() {
    if (!sTitle.trim()) return
    setSavingSection(true)
    if (editingSection) {
      await updateSection(editingSection.id, {
        title: sTitle.trim(),
        letter_label: sLabel.trim() || null,
        is_conditional: sConditional,
        condition_label: sConditional ? sConditionLabel.trim() || null : null,
      })
    } else {
      const maxSort = sections.reduce((max, s) => Math.max(max, s.sort_order), 0)
      await createSection({
        template_id: template.id,
        title: sTitle.trim(),
        letter_label: sLabel.trim() || null,
        is_conditional: sConditional,
        condition_label: sConditional ? sConditionLabel.trim() || null : null,
        sort_order: maxSort + 1,
      })
    }
    setShowSectionForm(false)
    setEditingSection(null)
    setSavingSection(false)
    onRefresh()
  }

  async function handleDeleteSection(s: ChecklistSection) {
    if (!confirm(`Delete section "${s.title}" and all its items?`)) return
    await deleteSection(s.id)
    if (expandedSection === s.id) setExpandedSection(null)
    onRefresh()
  }

  async function handleToggleSectionActive(s: ChecklistSection) {
    await updateSection(s.id, { is_active: !s.is_active })
    onRefresh()
  }

  async function moveSectionUp(idx: number) {
    if (idx === 0) return
    const updates = [
      { id: sections[idx].id, sort_order: sections[idx - 1].sort_order },
      { id: sections[idx - 1].id, sort_order: sections[idx].sort_order },
    ]
    await reorderSections(updates)
    onRefresh()
  }

  async function moveSectionDown(idx: number) {
    if (idx >= sections.length - 1) return
    const updates = [
      { id: sections[idx].id, sort_order: sections[idx + 1].sort_order },
      { id: sections[idx + 1].id, sort_order: sections[idx].sort_order },
    ]
    await reorderSections(updates)
    onRefresh()
  }

  // ── Item CRUD ───────────────────────────────────────────────
  function startAddItem(sectionId: string) {
    setEditingItem(null)
    setItemSectionId(sectionId)
    setIText(''); setIFieldType('checkbox'); setIOptions(''); setIRequired(false); setIPhoto(false)
    setShowItemForm(true)
  }

  function startEditItem(item: ChecklistItem, sectionId: string) {
    setEditingItem(item)
    setItemSectionId(sectionId)
    setIText(item.item_text)
    setIFieldType(item.field_type)
    setIOptions(Array.isArray(item.options) ? item.options.join(', ') : '')
    setIRequired(item.is_required)
    setIPhoto(item.requires_photo)
    setShowItemForm(true)
  }

  async function saveItem() {
    if (!iText.trim()) return
    setSavingItem(true)
    const optionsArray = iFieldType === 'dropdown' ? iOptions.split(',').map(s => s.trim()).filter(Boolean) : []
    const requiresPhoto = iPhoto || iFieldType === 'photo'

    if (editingItem) {
      await updateItem(editingItem.id, {
        item_text: iText.trim(),
        field_type: iFieldType,
        options: optionsArray,
        is_required: iRequired,
        requires_photo: requiresPhoto,
      })
    } else {
      // Get max sort_order within the section
      const section = sections.find(s => s.id === itemSectionId)
      const maxSort = (section?.items || []).reduce((max, i) => Math.max(max, i.sort_order), 0)
      await createItem({
        section_id: itemSectionId,
        item_text: iText.trim(),
        field_type: iFieldType,
        options: optionsArray,
        is_required: iRequired,
        requires_photo: requiresPhoto,
        sort_order: maxSort + 1,
      })
    }
    setShowItemForm(false)
    setEditingItem(null)
    setSavingItem(false)
    onRefresh()
  }

  async function handleDeleteItem(item: ChecklistItem) {
    if (!confirm(`Delete "${item.item_text}"?`)) return
    await deleteItem(item.id)
    onRefresh()
  }

  async function handleToggleItemActive(item: ChecklistItem) {
    await updateItem(item.id, { is_active: !item.is_active })
    onRefresh()
  }

  async function handleToggleItemRequired(item: ChecklistItem) {
    await updateItem(item.id, { is_required: !item.is_required })
    onRefresh()
  }

  async function moveItemUp(sectionItems: ChecklistItem[], idx: number) {
    if (idx === 0) return
    const updates = [
      { id: sectionItems[idx].id, sort_order: sectionItems[idx - 1].sort_order },
      { id: sectionItems[idx - 1].id, sort_order: sectionItems[idx].sort_order },
    ]
    await reorderItems(updates)
    onRefresh()
  }

  async function moveItemDown(sectionItems: ChecklistItem[], idx: number) {
    if (idx >= sectionItems.length - 1) return
    const updates = [
      { id: sectionItems[idx].id, sort_order: sectionItems[idx + 1].sort_order },
      { id: sectionItems[idx + 1].id, sort_order: sectionItems[idx].sort_order },
    ]
    await reorderItems(updates)
    onRefresh()
  }

  const totalItems = sections.reduce((sum, s) => sum + (s.items?.length || 0), 0)
  const requiredItems = sections.reduce((sum, s) => sum + (s.items?.filter(i => i.is_required).length || 0), 0)

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: '#0f1923', border: '1px solid #1e3a4f', borderLeft: 'none',
      borderRadius: '0 14px 14px 0',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid #1e3a4f',
        background: 'rgba(255,255,255,0.02)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>{template.name}</div>
          <div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>
            {sections.length} sections · {totalItems} items · {requiredItems} required
            {template.system_type && (
              <span style={{
                marginLeft: 8, fontSize: 10, padding: '1px 8px', borderRadius: 10,
                background: 'rgba(139,92,246,0.1)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.25)',
              }}>
                {SYSTEM_TYPE_LABELS[template.system_type]}
              </span>
            )}
          </div>
        </div>
        <button onClick={startAddSection} style={{
          padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
          background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: '#fff',
          border: 'none', cursor: 'pointer',
        }}>
          + Add Section
        </button>
      </div>

      {/* Section form */}
      {showSectionForm && (
        <div style={{ padding: 16, borderBottom: '1px solid #1e3a4f', background: 'rgba(59,130,246,0.04)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>
            {editingSection ? 'Edit Section' : 'New Section'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8 }}>
              <div>
                <label style={labelStyle}>Section Title</label>
                <input type="text" value={sTitle} onChange={e => setSTitle(e.target.value)}
                  placeholder="e.g., Pre-Installation" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Label</label>
                <input type="text" value={sLabel} onChange={e => setSLabel(e.target.value)}
                  placeholder="A" maxLength={3} style={inputStyle} />
              </div>
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={sConditional} onChange={e => setSConditional(e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: '#f59e0b' }} />
                <span style={{ fontSize: 13, color: '#e2e8f0' }}>Conditional section</span>
              </label>
              {sConditional && (
                <input type="text" value={sConditionLabel} onChange={e => setSConditionLabel(e.target.value)}
                  placeholder="e.g., If Pure Start applicable"
                  style={{ ...inputStyle, marginTop: 8 }} />
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setShowSectionForm(false); setEditingSection(null) }} style={btnSecondary}>Cancel</button>
              <button onClick={saveSection} disabled={savingSection || !sTitle.trim()}
                style={{ ...btnPrimary, background: 'linear-gradient(135deg, #3b82f6, #2563eb)', opacity: savingSection || !sTitle.trim() ? 0.5 : 1 }}>
                {savingSection ? 'Saving...' : editingSection ? 'Update' : 'Add Section'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Item form */}
      {showItemForm && (
        <div style={{ padding: 16, borderBottom: '1px solid #1e3a4f', background: 'rgba(74,222,128,0.04)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>
            {editingItem ? 'Edit Item' : 'New Item'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={labelStyle}>Item Text</label>
              <input type="text" value={iText} onChange={e => setIText(e.target.value)}
                placeholder="e.g., Verify water supply is turned off" style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={labelStyle}>Field Type</label>
                <select value={iFieldType} onChange={e => { setIFieldType(e.target.value as any); if (e.target.value === 'photo') setIPhoto(true) }} style={inputStyle}>
                  <option value="checkbox" style={{ background: '#0f1923' }}>Checkbox</option>
                  <option value="text" style={{ background: '#0f1923' }}>Text</option>
                  <option value="dropdown" style={{ background: '#0f1923' }}>Dropdown</option>
                  <option value="photo" style={{ background: '#0f1923' }}>Photo</option>
                  <option value="number" style={{ background: '#0f1923' }}>Number</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, paddingBottom: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={iRequired} onChange={e => setIRequired(e.target.checked)}
                    style={{ width: 14, height: 14, accentColor: '#f87171' }} />
                  <span style={{ fontSize: 12, color: '#e2e8f0' }}>Required</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={iPhoto} onChange={e => setIPhoto(e.target.checked)}
                    style={{ width: 14, height: 14, accentColor: '#f59e0b' }} />
                  <span style={{ fontSize: 12, color: '#e2e8f0' }}>Photo</span>
                </label>
              </div>
            </div>
            {iFieldType === 'dropdown' && (
              <div>
                <label style={labelStyle}>Options <span style={{ color: '#334155' }}>(comma separated)</span></label>
                <input type="text" value={iOptions} onChange={e => setIOptions(e.target.value)}
                  placeholder="e.g., Pass, Fail, N/A" style={inputStyle} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setShowItemForm(false); setEditingItem(null) }} style={btnSecondary}>Cancel</button>
              <button onClick={saveItem} disabled={savingItem || !iText.trim()}
                style={{ ...btnPrimary, background: 'linear-gradient(135deg, #4ade80, #22c55e)', opacity: savingItem || !iText.trim() ? 0.5 : 1 }}>
                {savingItem ? 'Saving...' : editingItem ? 'Update' : 'Add Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sections accordion */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
        {sections.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px' }}>
            <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.4 }}>📂</div>
            <p style={{ color: '#64748b', fontSize: 13 }}>No sections yet. Click "+ Add Section" to get started.</p>
          </div>
        ) : (
          sections.map((section, sIdx) => {
            const isExpanded = expandedSection === section.id
            const items = section.items || []
            return (
              <div key={section.id} style={{ borderBottom: '1px solid #1e3a4f' }}>
                {/* Section header */}
                <div
                  onClick={() => setExpandedSection(isExpanded ? null : section.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px',
                    cursor: 'pointer', background: isExpanded ? 'rgba(255,255,255,0.02)' : 'transparent',
                    opacity: section.is_active ? 1 : 0.4,
                  }}
                  onMouseEnter={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.015)' }}
                  onMouseLeave={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <span style={{ color: '#64748b', fontSize: 12, fontFamily: 'monospace', width: 20 }}>
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
                      {items.length} items · {items.filter(i => i.is_required).length} required
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => moveSectionUp(sIdx)} disabled={sIdx === 0}
                      style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, opacity: sIdx === 0 ? 0.2 : 1 }}>▲</button>
                    <button onClick={() => moveSectionDown(sIdx)} disabled={sIdx === sections.length - 1}
                      style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, opacity: sIdx === sections.length - 1 ? 0.2 : 1 }}>▼</button>
                    <button onClick={() => handleToggleSectionActive(section)}
                      style={{
                        fontSize: 9, padding: '2px 6px', borderRadius: 10, cursor: 'pointer', marginLeft: 4,
                        background: section.is_active ? 'rgba(74,222,128,0.12)' : 'rgba(100,116,139,0.12)',
                        color: section.is_active ? '#4ade80' : '#64748b',
                        border: `1px solid ${section.is_active ? 'rgba(74,222,128,0.25)' : 'rgba(100,116,139,0.2)'}`,
                      }}>
                      {section.is_active ? 'On' : 'Off'}
                    </button>
                    <button onClick={() => startEditSection(section)}
                      style={{ fontSize: 11, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer' }}>✏️</button>
                    <button onClick={() => handleDeleteSection(section)}
                      style={{ fontSize: 11, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer' }}>🗑</button>
                  </div>
                </div>

                {/* Items list */}
                {isExpanded && (
                  <div style={{ padding: '0 20px 12px 52px' }}>
                    {items.length === 0 ? (
                      <div style={{ padding: '16px 0', color: '#64748b', fontSize: 12 }}>
                        No items in this section yet.
                      </div>
                    ) : (
                      <div style={{ ...tableCardStyle, marginBottom: 8 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              <th style={{ ...thStyle, width: 28 }}>#</th>
                              <th style={thStyle}>Item</th>
                              <th style={{ ...thStyle, width: 90 }}>Type</th>
                              <th style={{ ...thStyle, width: 70, textAlign: 'center' }}>Req</th>
                              <th style={{ ...thStyle, width: 50, textAlign: 'center' }}>📷</th>
                              <th style={{ ...thStyle, width: 60, textAlign: 'center' }}>Order</th>
                              <th style={{ ...thStyle, width: 90, textAlign: 'right' }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item, iIdx) => (
                              <tr key={item.id} style={{ opacity: item.is_active ? 1 : 0.4 }}>
                                <td style={{ ...tdStyle, color: '#64748b', fontFamily: 'monospace', fontSize: 11 }}>{iIdx + 1}</td>
                                <td style={{ ...tdStyle, fontSize: 12 }}>
                                  <div style={{ fontWeight: 500 }}>{item.item_text}</div>
                                  {item.field_type === 'dropdown' && item.options?.length > 0 && (
                                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                                      {item.options.join(' · ')}
                                    </div>
                                  )}
                                </td>
                                <td style={tdStyle}>
                                  <span style={{
                                    fontSize: 10, padding: '2px 6px', borderRadius: 10,
                                    background: `${FIELD_TYPE_COLORS[item.field_type] || '#64748b'}15`,
                                    color: FIELD_TYPE_COLORS[item.field_type] || '#64748b',
                                    border: `1px solid ${FIELD_TYPE_COLORS[item.field_type] || '#64748b'}30`,
                                  }}>
                                    {FIELD_TYPE_LABELS[item.field_type] || item.field_type}
                                  </span>
                                </td>
                                <td style={{ ...tdStyle, textAlign: 'center' }}>
                                  <button onClick={() => handleToggleItemRequired(item)} style={{
                                    fontSize: 10, padding: '2px 6px', borderRadius: 10, cursor: 'pointer',
                                    background: item.is_required ? 'rgba(248,113,113,0.12)' : 'rgba(100,116,139,0.08)',
                                    color: item.is_required ? '#f87171' : '#64748b',
                                    border: `1px solid ${item.is_required ? 'rgba(248,113,113,0.3)' : 'rgba(100,116,139,0.15)'}`,
                                  }}>
                                    {item.is_required ? 'Yes' : 'No'}
                                  </button>
                                </td>
                                <td style={{ ...tdStyle, textAlign: 'center', fontSize: 11 }}>
                                  {item.requires_photo ? '📷' : '—'}
                                </td>
                                <td style={{ ...tdStyle, textAlign: 'center' }}>
                                  <div style={{ display: 'flex', justifyContent: 'center', gap: 2 }}>
                                    <button onClick={() => moveItemUp(items, iIdx)} disabled={iIdx === 0}
                                      style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, opacity: iIdx === 0 ? 0.2 : 1 }}>▲</button>
                                    <button onClick={() => moveItemDown(items, iIdx)} disabled={iIdx === items.length - 1}
                                      style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, opacity: iIdx === items.length - 1 ? 0.2 : 1 }}>▼</button>
                                  </div>
                                </td>
                                <td style={{ ...tdStyle, textAlign: 'right' }}>
                                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                    <button onClick={() => startEditItem(item, section.id)}
                                      style={{ fontSize: 11, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
                                    <button onClick={() => handleToggleItemActive(item)}
                                      style={{ fontSize: 11, color: item.is_active ? '#64748b' : '#4ade80', background: 'none', border: 'none', cursor: 'pointer' }}>
                                      {item.is_active ? 'Off' : 'On'}
                                    </button>
                                    <button onClick={() => handleDeleteItem(item)}
                                      style={{ fontSize: 11, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer' }}>Del</button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <button onClick={() => startAddItem(section.id)} style={{
                      padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      background: 'rgba(74,222,128,0.08)', color: '#4ade80',
                      border: '1px solid rgba(74,222,128,0.2)', cursor: 'pointer',
                    }}>
                      + Add Item to {section.letter_label || section.title}
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
