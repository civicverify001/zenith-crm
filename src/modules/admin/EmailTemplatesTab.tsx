// src/modules/admin/EmailTemplatesTab.tsx
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

// ─── Types ───────────────────────────────────────────────────
interface BrandSettings {
  id: string
  company_name: string
  tagline: string
  phone: string
  address: string
  city_state_zip: string
  website: string
  from_name_quotes: string
  from_name_billing: string
  reply_to_quotes: string
  reply_to_billing: string
}

interface EmailTemplate {
  id: string
  email_type: string
  display_name: string
  description: string
  default_subject: string
  subject_override: string | null
  greeting_override: string | null
  body_override: string | null
  is_active: boolean
}

// ─── Default brand ────────────────────────────────────────────
const DEFAULT_BRAND: Omit<BrandSettings, 'id'> = {
  company_name: 'Zenith Pure Solutions',
  tagline: 'Clean Water. Pure Simple.',
  phone: '(317) 690-4172',
  address: '6951 E 30th St, Suite B',
  city_state_zip: 'Indianapolis, IN 46219',
  website: 'zenithpuresolutions.com',
  from_name_quotes: 'Zenith Pure Solutions',
  from_name_billing: 'Zenith Pure Solutions',
  reply_to_quotes: 'quotes@zenithpuresolutions.com',
  reply_to_billing: 'info@zenithpuresolutions.com',
}

// ─── Email type icons & colors ────────────────────────────────
const TYPE_META: Record<string, { icon: string; color: string; trigger: string }> = {
  quote_sent:           { icon: '📄', color: '#60a5fa', trigger: 'When rep clicks Send Quote' },
  payment_receipt:      { icon: '✅', color: '#4ade80', trigger: 'After successful autopay charge' },
  payment_failed:       { icon: '❌', color: '#f87171', trigger: 'When autopay fails (up to 3x)' },
  card_saved:           { icon: '💳', color: '#818cf8', trigger: 'When rental customer saves card' },
  purchase_receipt:     { icon: '🧾', color: '#34d399', trigger: 'After purchase deposit payment' },
  service_plan_receipt: { icon: '🔄', color: '#22d3ee', trigger: 'After service plan charged' },
  service_plan_failed:  { icon: '⚠️', color: '#fbbf24', trigger: 'When service plan charge fails' },
}

// ─── Preview renderer ─────────────────────────────────────────
function buildPreviewHtml(template: EmailTemplate, brand: BrandSettings | null) {
  const b = brand || DEFAULT_BRAND
  const subject = template.subject_override || template.default_subject
  const greeting = template.greeting_override || 'Hi {{customer_name}},'
  const body = template.body_override || getDefaultBody(template.email_type)
  const meta = TYPE_META[template.email_type] || { icon: '📧', color: '#64748b', trigger: '' }

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:16px;background:#f3f4f6;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
  <tr><td style="background:#0a2540;padding:20px 28px;text-align:center;">
    <p style="color:white;font-weight:700;font-size:16px;margin:0;">${b.company_name}</p>
    <p style="color:#93c5fd;font-size:12px;margin:3px 0 0;">${b.tagline}</p>
  </td></tr>
  <tr><td style="padding:24px 28px;">
    <p style="font-size:13px;color:#374151;margin:0 0 16px;">${greeting.replace('{{customer_name}}', 'John Smith')}</p>
    <p style="font-size:13px;color:#374151;margin:0 0 16px;line-height:1.6;">${body}</p>
    <div style="background:#f9fafb;border-radius:8px;padding:14px 18px;font-size:12px;color:#6b7280;margin-top:16px;">
      <strong>Sample data shown.</strong> Real emails use actual customer name, amount, and contract details.
    </div>
  </td></tr>
  <tr><td style="border-top:1px solid #e5e7eb;padding:14px 28px;text-align:center;">
    <p style="font-size:11px;color:#9ca3af;margin:0;">${b.company_name} · ${b.address} · ${b.city_state_zip}</p>
    <p style="font-size:11px;color:#9ca3af;margin:3px 0 0;">${b.reply_to_billing} · ${b.website}</p>
  </td></tr>
</table>
<p style="font-size:11px;color:#9ca3af;margin:10px 0 0;text-align:center;">Subject: ${subject.replace('{{from_name}}', b.from_name_quotes).replace('{{quote_number}}', 'Q-2026-0061').replace('{{amount}}', '29.99').replace('{{plan_name}}', 'Annual Maintenance')}</p>
</td></tr></table>
</body></html>`
}

function getDefaultBody(emailType: string): string {
  const bodies: Record<string, string> = {
    quote_sent: 'Your quote is ready to review. Click the button below to review your personalized quote and accept it online.',
    payment_receipt: 'Your monthly payment has been processed successfully. Your receipt details are above.',
    payment_failed: 'We were unable to process your payment. Please contact us to update your payment method and avoid any interruption to your service.',
    card_saved: 'Your payment method has been saved securely. Autopay will begin automatically after your installation is complete.',
    purchase_receipt: 'Thank you for your payment. We will be in touch shortly to schedule your installation.',
    service_plan_receipt: 'Your service plan payment has been processed. Thank you for keeping your system in top shape.',
    service_plan_failed: 'We were unable to process your service plan payment. Please contact us to update your payment method.',
  }
  return bodies[emailType] || 'Thank you for choosing Zenith Pure Solutions.'
}

// ─── Main Component ───────────────────────────────────────────
export function EmailTemplatesTab() {
  const [brand, setBrand]           = useState<BrandSettings | null>(null)
  const [brandForm, setBrandForm]   = useState<Omit<BrandSettings, 'id'>>(DEFAULT_BRAND)
  const [templates, setTemplates]   = useState<EmailTemplate[]>([])
  const [loading, setLoading]       = useState(true)
  const [savingBrand, setSavingBrand] = useState(false)
  const [brandSaved, setBrandSaved] = useState(false)
  const [editTemplate, setEditTemplate] = useState<EmailTemplate | null>(null)
  const [editForm, setEditForm]     = useState<{ subject_override: string; greeting_override: string; body_override: string }>({ subject_override: '', greeting_override: '', body_override: '' })
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [previewTemplate, setPreviewTemplate] = useState<EmailTemplate | null>(null)
  const [activeSection, setActiveSection] = useState<'brand' | 'templates'>('brand')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [{ data: brandData }, { data: tmplData }] = await Promise.all([
        supabase.from('brand_settings').select('*').limit(1).single(),
        supabase.from('email_templates').select('*').order('created_at'),
      ])
      if (brandData) { setBrand(brandData); setBrandForm({ ...brandData }) }
      setTemplates(tmplData || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function saveBrand() {
    setSavingBrand(true)
    try {
      if (brand?.id) {
        await supabase.from('brand_settings').update({ ...brandForm, updated_at: new Date().toISOString() }).eq('id', brand.id)
      } else {
        const { data } = await supabase.from('brand_settings').insert(brandForm).select().single()
        if (data) setBrand(data)
      }
      setBrandSaved(true)
      setTimeout(() => setBrandSaved(false), 2500)
      await loadAll()
    } catch (e) { console.error(e) }
    finally { setSavingBrand(false) }
  }

  function openEdit(t: EmailTemplate) {
    setEditTemplate(t)
    setEditForm({
      subject_override: t.subject_override || '',
      greeting_override: t.greeting_override || '',
      body_override: t.body_override || '',
    })
  }

  async function saveTemplate() {
    if (!editTemplate) return
    setSavingTemplate(true)
    try {
      await supabase.from('email_templates').update({
        subject_override:  editForm.subject_override  || null,
        greeting_override: editForm.greeting_override || null,
        body_override:     editForm.body_override     || null,
        updated_at: new Date().toISOString(),
      }).eq('id', editTemplate.id)
      await loadAll()
      setEditTemplate(null)
    } catch (e) { console.error(e) }
    finally { setSavingTemplate(false) }
  }

  async function toggleActive(t: EmailTemplate) {
    await supabase.from('email_templates').update({ is_active: !t.is_active }).eq('id', t.id)
    setTemplates(prev => prev.map(x => x.id === t.id ? { ...x, is_active: !x.is_active } : x))
  }

  async function clearOverrides(t: EmailTemplate) {
    if (!confirm('Clear all custom overrides for this template? It will revert to defaults.')) return
    await supabase.from('email_templates').update({
      subject_override: null, greeting_override: null, body_override: null,
    }).eq('id', t.id)
    await loadAll()
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading email settings…</div>

  const hasOverrides = (t: EmailTemplate) => !!(t.subject_override || t.greeting_override || t.body_override)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Section toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {[
          { key: 'brand' as const, label: '🏢 Brand Settings' },
          { key: 'templates' as const, label: '✉️ Email Templates' },
        ].map(s => (
          <button key={s.key} onClick={() => setActiveSection(s.key)} style={{
            padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
            background: activeSection === s.key ? '#0d7ea3' : '#162232',
            color: activeSection === s.key ? '#fff' : '#64748b',
            border: `1px solid ${activeSection === s.key ? '#0d7ea3' : '#1e3a4f'}`,
          }}>{s.label}</button>
        ))}
      </div>

      {/* ── BRAND SETTINGS ── */}
      {activeSection === 'brand' && (
        <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #1e3a4f', background: '#0d1a26' }}>
            <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>Brand Settings</div>
            <div style={{ color: '#475569', fontSize: 12, marginTop: 2 }}>These values inject into every email automatically</div>
          </div>
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Company Name" value={brandForm.company_name} onChange={v => setBrandForm(f => ({ ...f, company_name: v }))} />
              <Field label="Tagline" value={brandForm.tagline} onChange={v => setBrandForm(f => ({ ...f, tagline: v }))} />
              <Field label="Phone" value={brandForm.phone} onChange={v => setBrandForm(f => ({ ...f, phone: v }))} />
              <Field label="Website" value={brandForm.website} onChange={v => setBrandForm(f => ({ ...f, website: v }))} />
              <Field label="Address" value={brandForm.address} onChange={v => setBrandForm(f => ({ ...f, address: v }))} />
              <Field label="City, State ZIP" value={brandForm.city_state_zip} onChange={v => setBrandForm(f => ({ ...f, city_state_zip: v }))} />
            </div>

            <div style={{ borderTop: '1px solid #1e3a4f', paddingTop: 16 }}>
              <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Email From / Reply-To</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="From Name (Quotes)" value={brandForm.from_name_quotes} onChange={v => setBrandForm(f => ({ ...f, from_name_quotes: v }))} />
                <Field label="Reply-To (Quotes)" value={brandForm.reply_to_quotes} onChange={v => setBrandForm(f => ({ ...f, reply_to_quotes: v }))} />
                <Field label="From Name (Billing)" value={brandForm.from_name_billing} onChange={v => setBrandForm(f => ({ ...f, from_name_billing: v }))} />
                <Field label="Reply-To (Billing)" value={brandForm.reply_to_billing} onChange={v => setBrandForm(f => ({ ...f, reply_to_billing: v }))} />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={saveBrand} disabled={savingBrand} style={{ padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 14 }}>
                {savingBrand ? 'Saving…' : 'Save Brand Settings'}
              </button>
              {brandSaved && <span style={{ color: '#4ade80', fontSize: 13, fontWeight: 600 }}>✓ Saved</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── EMAIL TEMPLATES ── */}
      {activeSection === 'templates' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ color: '#475569', fontSize: 13, marginBottom: 4, lineHeight: 1.6 }}>
            Customize subject lines and body text for each email type. Leave blank to use the default. HTML structure and branding stay consistent automatically.
          </div>

          {templates.map(t => {
            const meta = TYPE_META[t.email_type] || { icon: '📧', color: '#64748b', trigger: '' }
            const customized = hasOverrides(t)

            return (
              <div key={t.id} style={{ background: '#162232', border: `1px solid ${customized ? '#0d7ea3' + '40' : '#1e3a4f'}`, borderLeft: `3px solid ${t.is_active ? meta.color : '#334155'}`, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
                  {/* Icon */}
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: `${meta.color}15`, border: `1px solid ${meta.color}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                    {meta.icon}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>{t.display_name}</span>
                      {customized && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(13,126,163,0.15)', color: '#0d7ea3', border: '1px solid rgba(13,126,163,0.3)', fontWeight: 700 }}>CUSTOMIZED</span>}
                      {!t.is_active && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(100,116,139,0.15)', color: '#64748b', border: '1px solid rgba(100,116,139,0.3)', fontWeight: 700 }}>DISABLED</span>}
                    </div>
                    <div style={{ color: '#475569', fontSize: 12, marginTop: 2 }}>{meta.trigger}</div>
                    <div style={{ color: '#334155', fontSize: 11, marginTop: 3, fontStyle: 'italic' }}>
                      Subject: {t.subject_override || t.default_subject}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                    <button onClick={() => setPreviewTemplate(t)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #1e3a4f', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                      Preview
                    </button>
                    <button onClick={() => openEdit(t)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #0d7ea3', background: 'transparent', color: '#0d7ea3', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                      Edit
                    </button>
                    <button onClick={() => toggleActive(t)} style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${t.is_active ? '#334155' : '#15803d'}`, background: 'transparent', color: t.is_active ? '#64748b' : '#4ade80', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                      {t.is_active ? 'Disable' : 'Enable'}
                    </button>
                    {customized && (
                      <button onClick={() => clearOverrides(t)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #3f1a1a', background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: 12 }}>
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {templates.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#334155', fontSize: 14 }}>
              No email templates found. Run the SQL migration first.
            </div>
          )}
        </div>
      )}

      {/* ── EDIT MODAL ── */}
      {editTemplate && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) setEditTemplate(null) }}>
          <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 16, width: '100%', maxWidth: 580, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #1e3a4f', background: '#162232' }}>
              <div>
                <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 15 }}>Edit: {editTemplate.display_name}</div>
                <div style={{ color: '#475569', fontSize: 12, marginTop: 2 }}>Leave fields blank to use defaults</div>
              </div>
              <button onClick={() => setEditTemplate(null)} style={{ color: '#475569', background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f', borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>

            {/* Modal body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Default subject (read-only reference) */}
              <div>
                <div style={{ color: '#475569', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Default Subject (for reference)</div>
                <div style={{ background: '#0d1a26', border: '1px solid #1e3a4f', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#475569', fontStyle: 'italic' }}>
                  {editTemplate.default_subject}
                </div>
              </div>

              {/* Subject override */}
              <div>
                <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Subject Override <span style={{ color: '#334155', fontWeight: 400 }}>(optional)</span></div>
                <input
                  value={editForm.subject_override}
                  onChange={e => setEditForm(f => ({ ...f, subject_override: e.target.value }))}
                  placeholder="Leave blank to use default…"
                  style={{ width: '100%', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
                <div style={{ color: '#334155', fontSize: 11, marginTop: 4 }}>Variables: {'{{from_name}}'} {'{{quote_number}}'} {'{{amount}}'} {'{{plan_name}}'}</div>
              </div>

              {/* Greeting override */}
              <div>
                <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Greeting <span style={{ color: '#334155', fontWeight: 400 }}>(optional)</span></div>
                <input
                  value={editForm.greeting_override}
                  onChange={e => setEditForm(f => ({ ...f, greeting_override: e.target.value }))}
                  placeholder={`Hi {{customer_name}},`}
                  style={{ width: '100%', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              {/* Body override */}
              <div>
                <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Body Text <span style={{ color: '#334155', fontWeight: 400 }}>(optional)</span></div>
                <textarea
                  value={editForm.body_override}
                  onChange={e => setEditForm(f => ({ ...f, body_override: e.target.value }))}
                  placeholder={getDefaultBody(editTemplate.email_type)}
                  rows={5}
                  style={{ width: '100%', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.6 }}
                />
                <div style={{ color: '#334155', fontSize: 11, marginTop: 4 }}>Plain text only. Line breaks are preserved. Variable names above also work here.</div>
              </div>
            </div>

            {/* Modal footer */}
            <div style={{ padding: '14px 20px', borderTop: '1px solid #1e3a4f', background: '#0d1a26', display: 'flex', gap: 10 }}>
              <button onClick={saveTemplate} disabled={savingTemplate} style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: 'none', cursor: 'pointer', background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 14 }}>
                {savingTemplate ? 'Saving…' : 'Save Template'}
              </button>
              <button onClick={() => setEditTemplate(null)} style={{ padding: '11px 20px', borderRadius: 10, border: '1px solid #1e3a4f', background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PREVIEW MODAL ── */}
      {previewTemplate && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) setPreviewTemplate(null) }}>
          <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 16, width: '100%', maxWidth: 640, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid #1e3a4f', background: '#162232', flexShrink: 0 }}>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>Preview: {previewTemplate.display_name}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#475569' }}>Sample data shown</span>
                <button onClick={() => setPreviewTemplate(null)} style={{ color: '#475569', background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f', borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', background: '#f3f4f6' }}>
              <iframe
                srcDoc={buildPreviewHtml(previewTemplate, brand)}
                style={{ width: '100%', height: '100%', minHeight: 500, border: 'none' }}
                title="Email preview"
              />
            </div>

            <div style={{ padding: '12px 20px', borderTop: '1px solid #1e3a4f', background: '#0d1a26', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: '#475569' }}>Uses brand settings from the Brand Settings tab</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setPreviewTemplate(null); openEdit(previewTemplate) }} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #0d7ea3', background: 'transparent', color: '#0d7ea3', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Edit This Template</button>
                <button onClick={() => setPreviewTemplate(null)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #1e3a4f', background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 13 }}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Field component ──────────────────────────────────────────
function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>{label}</div>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: '100%', background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '9px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
      />
    </div>
  )
}
