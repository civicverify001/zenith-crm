// src/modules/shared/WaterTestForm.tsx
// Reusable water test input form — used in lead detail, installation detail, and tech visits
import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import {
  createWaterTest,
  updateWaterTest,
  generateRecommendations,
  type WaterTest,
  type WaterTestInput,
  type WaterTestRecommendation,
} from '../../services/waterTestService'

interface WaterTestFormProps {
  leadId?: string | null
  jobId?: string | null
  testType?: 'initial' | 'post_install' | 'routine'
  existingTest?: WaterTest | null
  onSaved?: (test: WaterTest) => void
  onCancel?: () => void
}

const WATER_SOURCES = [
  { value: 'municipal', label: 'Municipal / City Water' },
  { value: 'well', label: 'Private Well' },
  { value: 'community_well', label: 'Community Well' },
  { value: 'other', label: 'Other' },
]

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.05)', border: '1px solid #1e3a4f',
  borderRadius: 10, padding: '9px 14px', color: '#e2e8f0', fontSize: 13, outline: 'none',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6,
}

export function WaterTestForm({
  leadId, jobId, testType = 'initial', existingTest, onSaved, onCancel,
}: WaterTestFormProps) {
  const { profile } = useAuth()

  const [hardness, setHardness] = useState(existingTest?.hardness_gpg?.toString() || '')
  const [iron, setIron] = useState(existingTest?.iron_mgl?.toString() || '')
  const [tds, setTds] = useState(existingTest?.tds_ppm?.toString() || '')
  const [ph, setPh] = useState(existingTest?.ph?.toString() || '')
  const [chlorine, setChlorine] = useState(existingTest?.chlorine_mgl?.toString() || '')
  const [sulfur, setSulfur] = useState(existingTest?.sulfur_present ?? false)
  const [waterSource, setWaterSource] = useState(existingTest?.water_source || '')
  const [location, setLocation] = useState(existingTest?.location || '')
  const [notes, setNotes] = useState(existingTest?.notes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Live preview of recommendations
  const liveRecs = generateRecommendations({
    hardness_gpg: hardness ? parseFloat(hardness) : null,
    iron_mgl: iron ? parseFloat(iron) : null,
    tds_ppm: tds ? parseInt(tds) : null,
    ph: ph ? parseFloat(ph) : null,
    chlorine_mgl: chlorine ? parseFloat(chlorine) : null,
    sulfur_present: sulfur,
  })

  async function handleSave() {
    setSaving(true)
    setError('')

    const input: WaterTestInput = {
      lead_id: leadId || null,
      job_id: jobId || null,
      hardness_gpg: hardness ? parseFloat(hardness) : null,
      iron_mgl: iron ? parseFloat(iron) : null,
      tds_ppm: tds ? parseInt(tds) : null,
      ph: ph ? parseFloat(ph) : null,
      chlorine_mgl: chlorine ? parseFloat(chlorine) : null,
      sulfur_present: sulfur,
      water_source: waterSource || null,
      location: location || null,
      notes: notes || null,
      tested_by: profile?.id || null,
      test_type: testType,
    }

    try {
      let result: WaterTest | null
      if (existingTest) {
        result = await updateWaterTest(existingTest.id, input)
      } else {
        result = await createWaterTest(input)
      }
      if (result) {
        onSaved?.(result)
      } else {
        setError('Failed to save water test')
      }
    } catch (e: any) {
      setError(e.message || 'Failed to save')
    }
    setSaving(false)
  }

  const testTypeLabel = testType === 'initial' ? 'Initial Water Test'
    : testType === 'post_install' ? 'Post-Install Water Test'
    : 'Routine Water Test'

  return (
    <div style={{
      background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid #1e3a4f',
        background: 'rgba(34,211,238,0.04)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>
            💧 {existingTest ? 'Edit' : 'New'} {testTypeLabel}
          </div>
          <div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>
            Enter readings from water test kit
          </div>
        </div>
        <span style={{
          fontSize: 10, padding: '3px 10px', borderRadius: 20,
          background: testType === 'initial' ? 'rgba(96,165,250,0.12)' :
            testType === 'post_install' ? 'rgba(74,222,128,0.12)' : 'rgba(245,158,11,0.12)',
          color: testType === 'initial' ? '#60a5fa' :
            testType === 'post_install' ? '#4ade80' : '#f59e0b',
          border: '1px solid transparent', fontWeight: 700,
        }}>
          {testType === 'initial' ? 'INITIAL' : testType === 'post_install' ? 'POST-INSTALL' : 'ROUTINE'}
        </span>
      </div>

      <div style={{ padding: 20 }}>
        {error && (
          <div style={{
            background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)',
            borderRadius: 10, padding: '8px 14px', marginBottom: 14, fontSize: 12, color: '#f87171',
          }}>
            {error}
          </div>
        )}

        {/* Water Source + Location */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Water Source</label>
            <select value={waterSource} onChange={e => setWaterSource(e.target.value)} style={inputStyle}>
              <option value="" style={{ background: '#0f1923' }}>Select...</option>
              {WATER_SOURCES.map(s => (
                <option key={s.value} value={s.value} style={{ background: '#0f1923' }}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Test Location</label>
            <input type="text" value={location} onChange={e => setLocation(e.target.value)}
              placeholder="e.g., Kitchen sink, Hose bib" style={inputStyle} />
          </div>
        </div>

        {/* Readings grid */}
        <div style={{
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          color: '#64748b', marginBottom: 10,
        }}>
          Water Readings
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Hardness <span style={{ color: '#334155' }}>(gpg)</span></label>
            <input type="number" step="0.1" min="0" value={hardness}
              onChange={e => setHardness(e.target.value)} placeholder="0.0" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Iron <span style={{ color: '#334155' }}>(ppm)</span></label>
            <input type="number" step="0.01" min="0" value={iron}
              onChange={e => setIron(e.target.value)} placeholder="0.00" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>TDS <span style={{ color: '#334155' }}>(ppm)</span></label>
            <input type="number" step="1" min="0" value={tds}
              onChange={e => setTds(e.target.value)} placeholder="0" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>pH <span style={{ color: '#334155' }}>(0-14)</span></label>
            <input type="number" step="0.1" min="0" max="14" value={ph}
              onChange={e => setPh(e.target.value)} placeholder="7.0" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Chlorine <span style={{ color: '#334155' }}>(ppm)</span></label>
            <input type="number" step="0.1" min="0" value={chlorine}
              onChange={e => setChlorine(e.target.value)} placeholder="0.0" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={sulfur} onChange={e => setSulfur(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: '#f59e0b' }} />
              <span style={{ fontSize: 13, color: '#e2e8f0' }}>Sulfur Present</span>
            </label>
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="Additional observations..."
            style={{ ...inputStyle, resize: 'none', fontFamily: 'inherit' }} />
        </div>

        {/* Live recommendations preview */}
        {liveRecs.length > 0 && (
          <div style={{
            background: 'rgba(34,211,238,0.04)', border: '1px solid rgba(34,211,238,0.15)',
            borderRadius: 10, padding: 14, marginBottom: 16,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
              color: '#22d3ee', marginBottom: 10,
            }}>
              💡 Recommendations ({liveRecs.length})
            </div>
            {liveRecs.map((rec, idx) => (
              <RecommendationRow key={idx} rec={rec} />
            ))}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          {onCancel && (
            <button onClick={onCancel} style={{
              padding: '8px 16px', borderRadius: 10, fontSize: 13, color: '#64748b', cursor: 'pointer',
              background: 'rgba(255,255,255,0.04)', border: '1px solid #1e3a4f',
            }}>
              Cancel
            </button>
          )}
          <button onClick={handleSave} disabled={saving} style={{
            padding: '8px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#fff',
            background: 'linear-gradient(135deg, #22d3ee, #0891b2)', border: 'none',
            cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1,
          }}>
            {saving ? 'Saving...' : existingTest ? 'Update Test' : 'Save Test'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RecommendationRow({ rec }: { rec: WaterTestRecommendation }) {
  const urgencyColors: Record<string, { bg: string; text: string; border: string }> = {
    recommended: { bg: 'rgba(96,165,250,0.08)', text: '#60a5fa', border: 'rgba(96,165,250,0.2)' },
    strongly_recommended: { bg: 'rgba(245,158,11,0.08)', text: '#f59e0b', border: 'rgba(245,158,11,0.2)' },
    urgent: { bg: 'rgba(248,113,113,0.08)', text: '#f87171', border: 'rgba(248,113,113,0.2)' },
  }
  const colors = urgencyColors[rec.urgency] || urgencyColors.recommended

  const categoryLabels: Record<string, string> = {
    softener: '🧂 Water Softener',
    ro: '💧 Reverse Osmosis',
    iron_filter: '🔩 Iron Filter',
    acid_neutralizer: '⚗️ Acid Neutralizer',
    whole_home_filter: '🏠 Whole Home Filter',
    sulfur_treatment: '💨 Sulfur Treatment',
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8,
      padding: '8px 10px', borderRadius: 8,
      background: colors.bg, border: `1px solid ${colors.border}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: colors.text }}>
            {categoryLabels[rec.product_category] || rec.product_category}
          </span>
          <span style={{
            fontSize: 9, padding: '1px 6px', borderRadius: 10,
            background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`,
            fontWeight: 700, textTransform: 'uppercase',
          }}>
            {rec.urgency.replace('_', ' ')}
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
          {rec.reason}
        </div>
      </div>
    </div>
  )
}
