// src/modules/shared/WaterTestResults.tsx
// Reusable water test results display — before/after, readings table, recommendations
import {
  getBeforeAfterComparison,
  READING_LABELS,
  formatReading,
  type WaterTest,
  type WaterTestRecommendation,
} from '../../services/waterTestService'

// ── Single Test Card ──────────────────────────────────────────
export function WaterTestCard({ test, onEdit, onDelete }: {
  test: WaterTest
  onEdit?: (test: WaterTest) => void
  onDelete?: (test: WaterTest) => void
}) {
  const recs: WaterTestRecommendation[] = Array.isArray(test.recommendations) ? test.recommendations : []
  const typeColors: Record<string, { bg: string; text: string; label: string }> = {
    initial: { bg: 'rgba(96,165,250,0.12)', text: '#60a5fa', label: 'Initial' },
    post_install: { bg: 'rgba(74,222,128,0.12)', text: '#4ade80', label: 'Post-Install' },
    routine: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', label: 'Routine' },
  }
  const tc = typeColors[test.test_type] || typeColors.initial

  return (
    <div style={{
      background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid #1e3a4f',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>💧</span>
          <div>
            <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13 }}>
              Water Test
              {test.tested_at && (
                <span style={{ color: '#64748b', fontWeight: 400, marginLeft: 8 }}>
                  {new Date(test.tested_at).toLocaleDateString()}
                </span>
              )}
            </div>
            {test.water_source && (
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                Source: {test.water_source}{test.location ? ` · ${test.location}` : ''}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 10, padding: '2px 10px', borderRadius: 20, fontWeight: 700,
            background: tc.bg, color: tc.text,
          }}>
            {tc.label}
          </span>
          {onEdit && (
            <button onClick={() => onEdit(test)} style={{
              fontSize: 11, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer',
            }}>Edit</button>
          )}
          {onDelete && (
            <button onClick={() => onDelete(test)} style={{
              fontSize: 11, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer',
            }}>Delete</button>
          )}
        </div>
      </div>

      {/* Readings */}
      <div style={{ padding: '12px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }}>
          <ReadingPill label="Hardness" value={test.hardness_gpg} unit="gpg" threshold={7} direction="above" />
          <ReadingPill label="Iron" value={test.iron_mgl} unit="ppm" threshold={0.3} direction="above" />
          <ReadingPill label="TDS" value={test.tds_ppm} unit="ppm" threshold={300} direction="above" />
          <ReadingPill label="pH" value={test.ph} unit="" threshold={6.5} direction="below" />
          <ReadingPill label="Chlorine" value={test.chlorine_mgl} unit="ppm" threshold={1.0} direction="above" />
          <div style={{
            padding: '8px 12px', borderRadius: 10,
            background: test.sulfur_present ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${test.sulfur_present ? 'rgba(245,158,11,0.2)' : '#1e3a4f'}`,
          }}>
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>Sulfur</div>
            <div style={{
              fontSize: 13, fontWeight: 600,
              color: test.sulfur_present ? '#f59e0b' : '#4ade80',
            }}>
              {test.sulfur_present === null ? '—' : test.sulfur_present ? 'Detected' : 'Clear'}
            </div>
          </div>
        </div>

        {/* Notes */}
        {test.notes && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, marginTop: 8,
            background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)',
            fontSize: 12, color: '#94a3b8', fontStyle: 'italic',
          }}>
            {test.notes}
          </div>
        )}

        {/* Recommendations */}
        {recs.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
              color: '#22d3ee', marginBottom: 8,
            }}>
              Recommendations ({recs.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {recs.map((rec, idx) => {
                const urgColors: Record<string, string> = {
                  recommended: '#60a5fa',
                  strongly_recommended: '#f59e0b',
                  urgent: '#f87171',
                }
                return (
                  <span key={idx} style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 600,
                    background: `${urgColors[rec.urgency] || '#60a5fa'}15`,
                    color: urgColors[rec.urgency] || '#60a5fa',
                    border: `1px solid ${urgColors[rec.urgency] || '#60a5fa'}30`,
                  }}>
                    {CATEGORY_LABELS[rec.product_category] || rec.product_category}
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Before/After Comparison ───────────────────────────────────
export function WaterTestComparison({ tests }: { tests: WaterTest[] }) {
  const { before, after } = getBeforeAfterComparison(tests)

  if (!before && !after) {
    return (
      <div style={{
        background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14,
        padding: '32px 20px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>💧</div>
        <p style={{ color: '#64748b', fontSize: 13 }}>No water tests recorded yet.</p>
      </div>
    )
  }

  const readingKeys = ['hardness_gpg', 'iron_mgl', 'tds_ppm', 'ph', 'chlorine_mgl'] as const

  return (
    <div style={{
      background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid #1e3a4f',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>📊</span>
        <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>Before & After Comparison</div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={compThStyle}>Reading</th>
            <th style={{ ...compThStyle, textAlign: 'center' }}>
              Before
              {before?.tested_at && (
                <div style={{ fontSize: 9, fontWeight: 400, color: '#475569', marginTop: 2 }}>
                  {new Date(before.tested_at).toLocaleDateString()}
                </div>
              )}
            </th>
            <th style={{ ...compThStyle, textAlign: 'center' }}>
              After
              {after?.tested_at && (
                <div style={{ fontSize: 9, fontWeight: 400, color: '#475569', marginTop: 2 }}>
                  {new Date(after.tested_at).toLocaleDateString()}
                </div>
              )}
            </th>
            <th style={{ ...compThStyle, textAlign: 'center' }}>Change</th>
          </tr>
        </thead>
        <tbody>
          {readingKeys.map(key => {
            const info = READING_LABELS[key]
            const beforeVal = before ? (before as any)[key] : null
            const afterVal = after ? (after as any)[key] : null
            let changeText = '—'
            let changeColor = '#64748b'

            if (beforeVal != null && afterVal != null) {
              const diff = afterVal - beforeVal
              const pct = beforeVal !== 0 ? Math.round((diff / beforeVal) * 100) : 0

              if (key === 'ph') {
                // pH closer to 7 is better
                const beforeDist = Math.abs(7 - beforeVal)
                const afterDist = Math.abs(7 - afterVal)
                changeColor = afterDist < beforeDist ? '#4ade80' : afterDist > beforeDist ? '#f87171' : '#64748b'
                changeText = diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)
              } else {
                // Lower is better for all others
                changeColor = diff < 0 ? '#4ade80' : diff > 0 ? '#f87171' : '#64748b'
                changeText = diff > 0 ? `+${pct}%` : diff < 0 ? `${pct}%` : 'No change'
              }
            }

            return (
              <tr key={key}>
                <td style={compTdStyle}>
                  <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{info.label}</span>
                  <span style={{ color: '#64748b', marginLeft: 4, fontSize: 11 }}>{info.unit}</span>
                </td>
                <td style={{ ...compTdStyle, textAlign: 'center', fontFamily: 'monospace' }}>
                  {beforeVal != null ? beforeVal : '—'}
                </td>
                <td style={{ ...compTdStyle, textAlign: 'center', fontFamily: 'monospace' }}>
                  {afterVal != null ? afterVal : '—'}
                </td>
                <td style={{ ...compTdStyle, textAlign: 'center', fontWeight: 600, color: changeColor }}>
                  {changeText}
                </td>
              </tr>
            )
          })}
          {/* Sulfur row */}
          <tr>
            <td style={compTdStyle}>
              <span style={{ fontWeight: 600, color: '#e2e8f0' }}>Sulfur</span>
            </td>
            <td style={{ ...compTdStyle, textAlign: 'center' }}>
              {before?.sulfur_present == null ? '—' : before.sulfur_present ? '⚠️ Yes' : '✅ No'}
            </td>
            <td style={{ ...compTdStyle, textAlign: 'center' }}>
              {after?.sulfur_present == null ? '—' : after.sulfur_present ? '⚠️ Yes' : '✅ No'}
            </td>
            <td style={{ ...compTdStyle, textAlign: 'center', fontWeight: 600, color:
              before?.sulfur_present && !after?.sulfur_present ? '#4ade80' :
              !before?.sulfur_present && after?.sulfur_present ? '#f87171' : '#64748b'
            }}>
              {before?.sulfur_present == null || after?.sulfur_present == null ? '—' :
                before.sulfur_present && !after.sulfur_present ? 'Resolved' :
                !before.sulfur_present && after.sulfur_present ? 'New issue' : 'No change'}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ── Test History List ─────────────────────────────────────────
export function WaterTestHistory({ tests, onEdit, onDelete }: {
  tests: WaterTest[]
  onEdit?: (test: WaterTest) => void
  onDelete?: (test: WaterTest) => void
}) {
  if (tests.length === 0) {
    return (
      <div style={{
        background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14,
        padding: '32px 20px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>💧</div>
        <p style={{ color: '#64748b', fontSize: 13 }}>No water tests recorded.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {tests.map(test => (
        <WaterTestCard key={test.id} test={test} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  )
}

// ── Recommendation Summary ────────────────────────────────────
export function RecommendationSummary({ tests }: { tests: WaterTest[] }) {
  // Get recommendations from the most recent initial test
  const initialTests = tests
    .filter(t => t.test_type === 'initial')
    .sort((a, b) => new Date(b.tested_at || '').getTime() - new Date(a.tested_at || '').getTime())

  const latestInitial = initialTests[0]
  if (!latestInitial) return null

  const recs: WaterTestRecommendation[] = Array.isArray(latestInitial.recommendations)
    ? latestInitial.recommendations
    : []

  if (recs.length === 0) return null

  return (
    <div style={{
      background: 'rgba(34,211,238,0.04)', border: '1px solid rgba(34,211,238,0.15)',
      borderRadius: 14, padding: 16,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
        color: '#22d3ee', marginBottom: 10,
      }}>
        💡 Recommended Products (from water test)
      </div>
      {recs.map((rec, idx) => {
        const urgColors: Record<string, string> = {
          recommended: '#60a5fa',
          strongly_recommended: '#f59e0b',
          urgent: '#f87171',
        }
        const color = urgColors[rec.urgency] || '#60a5fa'
        return (
          <div key={idx} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0',
            borderBottom: idx < recs.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
          }}>
            <span style={{
              fontSize: 11, fontWeight: 700, color,
              minWidth: 140,
            }}>
              {CATEGORY_LABELS[rec.product_category] || rec.product_category}
            </span>
            <span style={{ fontSize: 11, color: '#94a3b8', flex: 1 }}>
              {rec.reason}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────
const CATEGORY_LABELS: Record<string, string> = {
  softener: 'Water Softener',
  ro: 'Reverse Osmosis',
  iron_filter: 'Iron Filter',
  acid_neutralizer: 'Acid Neutralizer',
  whole_home_filter: 'Whole Home Filter',
  sulfur_treatment: 'Sulfur Treatment',
}

function ReadingPill({ label, value, unit, threshold, direction }: {
  label: string
  value: number | null
  unit: string
  threshold: number
  direction: 'above' | 'below'
}) {
  const isOver = value != null && (
    direction === 'above' ? value > threshold : value < threshold
  )

  return (
    <div style={{
      padding: '8px 12px', borderRadius: 10,
      background: isOver ? 'rgba(248,113,113,0.06)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${isOver ? 'rgba(248,113,113,0.15)' : '#1e3a4f'}`,
    }}>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>{label}</div>
      <div style={{
        fontSize: 14, fontWeight: 700, fontFamily: 'monospace',
        color: value == null ? '#334155' : isOver ? '#f87171' : '#4ade80',
      }}>
        {value == null ? '—' : `${value} ${unit}`.trim()}
      </div>
      {value != null && (
        <div style={{ fontSize: 9, color: isOver ? '#f87171' : '#4ade80', marginTop: 1 }}>
          {isOver ? `Above ${threshold} ${unit}` : 'Normal'}
        </div>
      )}
    </div>
  )
}

const compThStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 16px',
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
  color: '#64748b', background: 'rgba(255,255,255,0.03)',
  borderBottom: '1px solid #1e3a4f',
}

const compTdStyle: React.CSSProperties = {
  padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)',
  fontSize: 13, color: '#e2e8f0',
}
