// src/modules/admin/SmsTemplatesTab.tsx
// Admin Settings — 6th tab: SMS Templates
// CRUD for pipeline stage SMS templates with variable reference

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

interface SmsTemplate {
  id: string
  name: string
  stage: string | null
  body: string
  is_active: boolean
  created_at: string
}

const STAGE_OPTIONS = [
  { value: '',                 label: 'General (no stage)' },
  { value: 'qualifying',      label: 'Qualifying' },
  { value: 'site_visit',      label: 'Site Visit Scheduled' },
  { value: 'quote_sent',      label: 'Quote Sent' },
  { value: 'install_scheduled', label: 'Install Scheduled' },
  { value: 'won',             label: 'Install Complete' },
]

const VARIABLES = [
  { var: '{first_name}',  desc: 'Customer first name' },
  { var: '{rep_name}',    desc: 'Rep full name' },
  { var: '{visit_date}',  desc: 'Site visit date' },
  { var: '{install_date}',desc: 'Install date' },
  { var: '{review_url}',  desc: 'Google review link' },
  { var: '{company}',     desc: 'Zenith Pure Solutions' },
]

const CHAR_LIMIT = 160

function stageLabel(stage: string | null) {
  return STAGE_OPTIONS.find(s => s.value === (stage || ''))?.label || stage || 'General'
}

export default function SmsTemplatesTab() {
  const [templates, setTemplates] = useState<SmsTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<SmsTemplate | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // Form state
  const [formName,   setFormName]   = useState('')
  const [formStage,  setFormStage]  = useState('')
  const [formBody,   setFormBody]   = useState('')
  const [formActive, setFormActive] = useState(true)

  useEffect(() => { fetchTemplates() }, [])

  async function fetchTemplates() {
    setLoading(true)
    const { data } = await supabase.from('sms_templates').select('*').order('stage').order('name')
    setTemplates(data || [])
    setLoading(false)
  }

  function openCreate() {
    setFormName(''); setFormStage(''); setFormBody(''); setFormActive(true)
    setEditing(null); setCreating(true)
  }

  function openEdit(t: SmsTemplate) {
    setFormName(t.name); setFormStage(t.stage || ''); setFormBody(t.body); setFormActive(t.is_active)
    setCreating(false); setEditing(t)
  }

  function closeForm() { setEditing(null); setCreating(false) }

  function insertVar(v: string) {
    setFormBody(prev => prev + v)
  }

  async function handleSave() {
    if (!formName.trim() || !formBody.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: formName.trim(),
        stage: formStage || null,
        body: formBody.trim(),
        is_active: formActive,
        updated_at: new Date().toISOString(),
      }
      if (editing) {
        await supabase.from('sms_templates').update(payload).eq('id', editing.id)
      } else {
        await supabase.from('sms_templates').insert(payload)
      }
      await fetchTemplates()
      closeForm()
    } catch (e) { console.error(e) } finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    await supabase.from('sms_templates').delete().eq('id', id)
    setDeleteId(null)
    await fetchTemplates()
  }

  async function toggleActive(t: SmsTemplate) {
    await supabase.from('sms_templates').update({ is_active: !t.is_active }).eq('id', t.id)
    await fetchTemplates()
  }

  const charCount = formBody.length
  const isForm = editing !== null || creating

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>SMS Templates</h2>
          <p style={{ fontSize: 12, color: '#475569', marginTop: 4, marginBottom: 0 }}>
            Pre-written messages for each pipeline stage. Reps pick a template when sending a text.
          </p>
        </div>
        <button onClick={openCreate}
          style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          + New Template
        </button>
      </div>

      {/* Variables reference */}
      <div style={{ background: 'rgba(13,126,163,0.08)', border: '1px solid rgba(13,126,163,0.2)', borderRadius: 10, padding: 14, marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#0d7ea3', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Available Variables</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {VARIABLES.map(v => (
            <div key={v.var} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <code style={{ fontSize: 11, background: 'rgba(13,126,163,0.15)', color: '#38bdf8', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>{v.var}</code>
              <span style={{ fontSize: 11, color: '#475569' }}>{v.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Edit / Create form */}
      {isForm && (
        <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 16 }}>
            {creating ? 'New Template' : `Edit: ${editing?.name}`}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Template Name *</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Qualifying Follow-Up"
                style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Pipeline Stage</label>
              <select value={formStage} onChange={e => setFormStage(e.target.value)}
                style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}>
                {STAGE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Message Body *</label>
              <span style={{ fontSize: 11, color: charCount > CHAR_LIMIT ? '#f87171' : '#475569' }}>{charCount} / {CHAR_LIMIT} chars</span>
            </div>
            <textarea value={formBody} onChange={e => setFormBody(e.target.value)} rows={4}
              placeholder="Type your message here. Use variables like {first_name}…"
              style={{ width: '100%', background: '#0f1923', border: `1px solid ${charCount > CHAR_LIMIT ? '#f87171' : '#1e3a4f'}`, borderRadius: 8, color: '#e2e8f0', padding: '10px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
          </div>

          {/* Quick insert variables */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            <span style={{ fontSize: 11, color: '#475569', alignSelf: 'center' }}>Insert:</span>
            {VARIABLES.map(v => (
              <button key={v.var} onClick={() => insertVar(v.var)}
                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(56,189,248,0.25)', background: 'rgba(56,189,248,0.08)', color: '#38bdf8', cursor: 'pointer', fontFamily: 'monospace' }}>
                {v.var}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <div
                onClick={() => setFormActive(v => !v)}
                style={{ width: 36, height: 20, borderRadius: 10, background: formActive ? '#0d7ea3' : '#334155', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 2, left: formActive ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
              </div>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>Active</span>
            </label>
            <div style={{ flex: 1 }} />
            <button onClick={closeForm}
              style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #1e3a4f', background: 'transparent', color: '#64748b', fontSize: 13, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || !formName.trim() || !formBody.trim()}
              style={{ padding: '8px 22px', borderRadius: 8, border: 'none', background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Save Template'}
            </button>
          </div>
        </div>
      )}

      {/* Template list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>Loading templates…</div>
      ) : templates.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#334155', fontSize: 14 }}>No templates yet. Create one above.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {templates.map(t => (
            <div key={t.id} style={{ background: '#162232', border: `1px solid ${t.is_active ? '#1e3a4f' : '#0d1a26'}`, borderRadius: 12, padding: 16, opacity: t.is_active ? 1 : 0.55 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14 }}>{t.name}</span>
                    {t.stage && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(13,126,163,0.15)', color: '#38bdf8', border: '1px solid rgba(13,126,163,0.25)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {stageLabel(t.stage)}
                      </span>
                    )}
                    {!t.is_active && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(100,116,139,0.15)', color: '#64748b' }}>Inactive</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'inherit' }}>{t.body}</div>
                  <div style={{ fontSize: 11, color: '#334155', marginTop: 4 }}>{t.body.length} characters</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => toggleActive(t)}
                    style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #1e3a4f', background: 'transparent', color: '#64748b', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                    {t.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => openEdit(t)}
                    style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid rgba(13,126,163,0.3)', background: 'rgba(13,126,163,0.08)', color: '#38bdf8', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                    Edit
                  </button>
                  {deleteId === t.id ? (
                    <>
                      <button onClick={() => handleDelete(t.id)}
                        style={{ padding: '5px 12px', borderRadius: 7, border: 'none', background: '#dc2626', color: '#fff', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>
                        Confirm
                      </button>
                      <button onClick={() => setDeleteId(null)}
                        style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #1e3a4f', background: 'transparent', color: '#64748b', fontSize: 11, cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setDeleteId(t.id)}
                      style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid rgba(248,113,113,0.2)', background: 'transparent', color: '#f87171', fontSize: 11, cursor: 'pointer' }}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
