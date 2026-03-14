// src/modules/reports/ReportsPage.tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../hooks/useAuth'
import * as rs from '../../services/reportingService'
import type { DateRange } from '../../services/reportingService'

// ─── Helpers ───────────────────────────────────────────────────
function fmt$(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}
function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}
function fmtMonth(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}
function downloadCSV(data: any[], filename: string) {
  if (!data.length) return
  const keys = Object.keys(data[0])
  const rows = data.map(row =>
    keys.map(k => {
      const v = row[k]
      const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
      return `"${s.replace(/"/g, '""')}"`
    }).join(',')
  )
  const csv = [keys.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

const STAGE_LABELS: Record<string, string> = {
  new_lead:'New Lead', qualifying:'Qualifying', qualified:'Qualified',
  site_visit_scheduled:'Site Visit', proposal_in_progress:'Proposal',
  quote_sent:'Quote Sent', agreement_signed:'Agreement Signed',
}
const STAGE_COLORS: Record<string, string> = {
  new_lead:'#64748b', qualifying:'#a78bfa', qualified:'#0d7ea3',
  site_visit_scheduled:'#22d3ee', proposal_in_progress:'#22d3ee',
  quote_sent:'#f59e0b', agreement_signed:'#4ade80',
}

// ─── Health Score Engine ────────────────────────────────────────
interface HealthSignal {
  label: string
  score: number      // 0–100
  weight: number     // relative weight
  status: 'good' | 'warn' | 'bad' | 'neutral'
  detail: string
}

function computeHealthScore(kpis: any, exceptions: any): { score: number; grade: string; color: string; signals: HealthSignal[] } {
  const signals: HealthSignal[] = []

  // Failed payments (weight 25)
  const failedPmt = kpis?.failedPayments48h ?? 0
  signals.push({
    label: 'Failed Payments',
    score: failedPmt === 0 ? 100 : failedPmt <= 2 ? 60 : 20,
    weight: 25,
    status: failedPmt === 0 ? 'good' : failedPmt <= 2 ? 'warn' : 'bad',
    detail: failedPmt === 0 ? 'All clear' : `${failedPmt} failed in last 48h`,
  })

  // Unsigned agreements (weight 15)
  const unsigned = kpis?.unsignedAgreements ?? 0
  signals.push({
    label: 'Unsigned Agreements',
    score: unsigned === 0 ? 100 : unsigned <= 2 ? 70 : 40,
    weight: 15,
    status: unsigned === 0 ? 'good' : unsigned <= 2 ? 'warn' : 'bad',
    detail: unsigned === 0 ? 'All signed' : `${unsigned} awaiting signature`,
  })

  // Unassigned jobs (weight 15)
  const unassigned = kpis?.unassignedJobs ?? 0
  signals.push({
    label: 'Unassigned Jobs',
    score: unassigned === 0 ? 100 : unassigned <= 1 ? 65 : 30,
    weight: 15,
    status: unassigned === 0 ? 'good' : unassigned <= 1 ? 'warn' : 'bad',
    detail: unassigned === 0 ? 'All jobs assigned' : `${unassigned} job${unassigned !== 1 ? 's' : ''} need a tech`,
  })

  // Active pipeline (weight 10)
  const leads = kpis?.activeLeads ?? 0
  signals.push({
    label: 'Active Pipeline',
    score: leads >= 5 ? 100 : leads >= 2 ? 75 : leads >= 1 ? 50 : 20,
    weight: 10,
    status: leads >= 3 ? 'good' : leads >= 1 ? 'warn' : 'bad',
    detail: `${leads} active lead${leads !== 1 ? 's' : ''} in pipeline`,
  })

  // MRR (weight 15)
  const mrr = kpis?.mrr ?? 0
  signals.push({
    label: 'Monthly Revenue',
    score: mrr >= 500 ? 100 : mrr >= 200 ? 75 : mrr > 0 ? 50 : 20,
    weight: 15,
    status: mrr >= 200 ? 'good' : mrr > 0 ? 'warn' : 'bad',
    detail: mrr > 0 ? `${fmt$(mrr)} MRR from active contracts` : 'No active rental contracts',
  })

  // Data quality (weight 20)
  const dqIssues = exceptions
    ? (exceptions.nullSourceLeads?.length ?? 0) +
      (exceptions.nullCommercialTypeQuotes?.length ?? 0) +
      (exceptions.overdue60Invoices?.length ?? 0)
    : 0
  signals.push({
    label: 'Data Quality',
    score: dqIssues === 0 ? 100 : dqIssues <= 2 ? 65 : 35,
    weight: 20,
    status: dqIssues === 0 ? 'good' : dqIssues <= 2 ? 'warn' : 'bad',
    detail: dqIssues === 0 ? 'No data issues found' : `${dqIssues} data issue${dqIssues !== 1 ? 's' : ''} need attention`,
  })

  const totalWeight = signals.reduce((s, x) => s + x.weight, 0)
  const weighted = signals.reduce((s, x) => s + (x.score * x.weight), 0)
  const score = Math.round(weighted / totalWeight)

  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F'
  const color = score >= 90 ? '#4ade80' : score >= 75 ? '#34d399' : score >= 60 ? '#fbbf24' : score >= 40 ? '#fb923c' : '#f87171'

  return { score, grade, color, signals }
}

// ─── Health Meter Component ─────────────────────────────────────
function HealthMeter({ range }: { range: DateRange }) {
  const { data: kpis } = useQuery({
    queryKey: ['reports', 'executive', range.start, range.end],
    queryFn: () => rs.getExecutiveKPIs(range),
    refetchInterval: 120_000,
  })
  const { data: exceptions } = useQuery({
    queryKey: ['reports', 'data_quality'],
    queryFn: () => rs.getDataQualityExceptions(),
    refetchInterval: 300_000,
  })

  const health = computeHealthScore(kpis, exceptions)
  const { score, grade, color, signals } = health

  const gradeLabel = grade === 'A' ? 'Excellent' : grade === 'B' ? 'Good' : grade === 'C' ? 'Fair' : grade === 'D' ? 'Needs Attention' : 'Critical'
  const goodCount = signals.filter(s => s.status === 'good').length
  const warnCount = signals.filter(s => s.status === 'warn').length
  const badCount  = signals.filter(s => s.status === 'bad').length

  // Arc SVG parameters
  const r = 54, cx = 70, cy = 70
  const circumference = Math.PI * r  // half circle
  const arcOffset = circumference - (score / 100) * circumference

  return (
    <div style={{
      background: '#0f1923',
      border: `1px solid ${color}30`,
      borderRadius: 16,
      padding: '20px 24px',
      display: 'flex',
      gap: 28,
      alignItems: 'center',
      flexWrap: 'wrap',
      marginBottom: 20,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background glow */}
      <div style={{ position: 'absolute', top: -40, left: -40, width: 200, height: 200, borderRadius: '50%', background: `${color}08`, pointerEvents: 'none' }} />

      {/* Gauge */}
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <svg width="140" height="80" viewBox="0 0 140 80">
          {/* Track */}
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none" stroke="#1e3a4f" strokeWidth="10" strokeLinecap="round"
          />
          {/* Fill */}
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={arcOffset}
            style={{ transition: 'stroke-dashoffset 0.8s ease, stroke 0.4s ease' }}
          />
          {/* Score text */}
          <text x={cx} y={cy - 6} textAnchor="middle" fill={color} fontSize="22" fontWeight="900" fontFamily="system-ui">
            {score}
          </text>
          <text x={cx} y={cy + 10} textAnchor="middle" fill="#475569" fontSize="10" fontFamily="system-ui">
            / 100
          </text>
        </svg>
        <div style={{ fontSize: 13, fontWeight: 800, color, letterSpacing: '-0.01em' }}>{gradeLabel}</div>
        <div style={{ fontSize: 10, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Business Health</div>
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 80, background: '#1e3a4f', flexShrink: 0 }} />

      {/* Signal pills */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          {[
            { count: goodCount, label: 'Healthy',  color: '#4ade80', bg: 'rgba(74,222,128,0.1)'  },
            { count: warnCount, label: 'Warning',  color: '#fbbf24', bg: 'rgba(251,191,36,0.1)'  },
            { count: badCount,  label: 'Critical', color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: s.bg, border: `1px solid ${s.color}25` }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: s.color }}>{s.count}</span>
              <span style={{ fontSize: 11, color: s.color, fontWeight: 600 }}>{s.label}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {signals.map(sig => {
            const sc = sig.status === 'good' ? '#4ade80' : sig.status === 'warn' ? '#fbbf24' : '#f87171'
            const icon = sig.status === 'good' ? '✓' : sig.status === 'warn' ? '⚠' : '✕'
            return (
              <div key={sig.label} style={{
                padding: '8px 10px', borderRadius: 10,
                background: `${sc}08`, border: `1px solid ${sc}20`,
                display: 'flex', flexDirection: 'column', gap: 3,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 11, color: sc, fontWeight: 800 }}>{icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>{sig.label}</span>
                </div>
                <div style={{ fontSize: 10, color: '#475569', lineHeight: 1.4 }}>{sig.detail}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Shared UI ─────────────────────────────────────────────────

function KPICard({ label, value, sub, accent, icon, tooltip }: {
  label: string; value: string; sub?: string; accent: string; icon: string; tooltip?: string
}) {
  return (
    <div style={{ background: '#0f1923', border: `1px solid ${accent}25`, borderTop: `3px solid ${accent}`, borderRadius: 12, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: -16, right: -16, width: 60, height: 60, borderRadius: '50%', background: `${accent}10`, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
        {tooltip && <span title={tooltip} style={{ fontSize: 11, color: '#334155', cursor: 'help', marginLeft: 2 }}>ⓘ</span>}
      </div>
      <div style={{ fontSize: 30, fontWeight: 900, color: accent, lineHeight: 1, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>{sub}</div>}
    </div>
  )
}

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 18, margin: 0, letterSpacing: '-0.01em' }}>{title}</h2>
      {sub && <p style={{ color: '#475569', fontSize: 12, marginTop: 4, marginBottom: 0 }}>{sub}</p>}
    </div>
  )
}

function ChartCard({ title, children, tooltip }: { title: string; children: React.ReactNode; tooltip?: string }) {
  return (
    <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1' }}>{title}</span>
        {tooltip && <span title={tooltip} style={{ fontSize: 11, color: '#334155', cursor: 'help' }}>ⓘ</span>}
      </div>
      {children}
    </div>
  )
}

function VerticalBarChart({ data, height = 120, color = '#0d7ea3', formatValue }: {
  data: { label: string; value: number }[]
  height?: number; color?: string; formatValue?: (v: number) => string
}) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: height + 40, paddingTop: 20 }}>
      {data.map((d, i) => {
        const barH = Math.max((d.value / max) * height, d.value > 0 ? 4 : 0)
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, justifyContent: 'flex-end', height: '100%' }}>
            <div style={{ fontSize: 9, color: '#64748b', fontWeight: 600, height: 14 }}>
              {d.value > 0 ? (formatValue ? formatValue(d.value) : d.value) : ''}
            </div>
            <div style={{ width: '100%', height: barH, background: `${color}cc`, borderRadius: '4px 4px 2px 2px', boxShadow: d.value > 0 ? `0 0 8px ${color}30` : 'none' }} />
            <div style={{ fontSize: 9, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', textAlign: 'center' }}>
              {d.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function HBarChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 130, fontSize: 11, color: '#94a3b8', textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</div>
          <div style={{ flex: 1, height: 18, background: '#0d1a26', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(d.value / max) * 100}%`, background: d.color, borderRadius: 4, transition: 'width 0.4s ease' }} />
          </div>
          <div style={{ width: 28, fontSize: 12, fontWeight: 800, color: d.color, textAlign: 'right', flexShrink: 0 }}>{d.value}</div>
        </div>
      ))}
    </div>
  )
}

function DrilldownTable({ columns, rows, emptyText = 'No data', onExport }: {
  columns: { key: string; label: string; render?: (v: any, row: any) => React.ReactNode }[]
  rows: any[]; emptyText?: string; onExport?: () => void
}) {
  return (
    <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #1e3a4f', background: '#162232' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {rows.length} record{rows.length !== 1 ? 's' : ''}
        </span>
        {onExport && rows.length > 0 && (
          <button onClick={onExport} style={{ fontSize: 11, padding: '4px 12px', borderRadius: 6, cursor: 'pointer', background: 'rgba(13,126,163,0.1)', border: '1px solid rgba(13,126,163,0.25)', color: '#0d7ea3', fontWeight: 600 }}>
            ↓ CSV
          </button>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        {rows.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: '#334155' }}>{emptyText}</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {columns.map(col => (
                  <th key={col.key} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #1e3a4f', whiteSpace: 'nowrap', background: '#0d1a26' }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} style={{ borderBottom: '1px solid #0d1a26' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                  {columns.map(col => (
                    <td key={col.key} style={{ padding: '10px 14px', fontSize: 12, color: '#cbd5e1', whiteSpace: 'nowrap' }}>
                      {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function ExceptionBlock({ title, count, rows, columns, emptyText }: {
  title: string; count: number
  rows: any[]; columns: { key: string; label: string; render?: (v: any, row: any) => React.ReactNode }[]
  emptyText: string
}) {
  const [open, setOpen] = useState(false)
  const sc = count > 0 ? '#f87171' : '#4ade80'
  return (
    <div style={{ background: '#0f1923', border: `1px solid ${count > 0 ? 'rgba(248,113,113,0.2)' : '#1e3a4f'}`, borderRadius: 12, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', cursor: 'pointer', background: 'linear-gradient(135deg, #162232, #0d1a26)', border: 'none', textAlign: 'left' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1' }}>{title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ minWidth: 28, height: 22, borderRadius: 20, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, background: count === 0 ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)', color: sc, border: `1px solid ${count === 0 ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.25)'}` }}>{count}</span>
          {count > 0 && (
            <button onClick={e => { e.stopPropagation(); downloadCSV(rows, `${title.toLowerCase().replace(/\s+/g, '_')}.csv`) }}
              style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, cursor: 'pointer', background: 'rgba(13,126,163,0.1)', border: '1px solid rgba(13,126,163,0.25)', color: '#0d7ea3' }}>
              ↓ CSV
            </button>
          )}
          <span style={{ color: '#334155', fontSize: 13 }}>{open ? '▾' : '▸'}</span>
        </div>
      </button>
      {open && <div style={{ borderTop: '1px solid #1e3a4f' }}><DrilldownTable columns={columns} rows={rows} emptyText={emptyText} /></div>}
    </div>
  )
}

function LoadingState({ small }: { small?: boolean }) {
  return <div style={{ padding: small ? '20px 0' : '48px 0', textAlign: 'center', color: '#334155', fontSize: 13 }}>Loading…</div>
}

// ─── Sections ──────────────────────────────────────────────────

function ExecutiveSection({ range }: { range: DateRange }) {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'executive', range.start, range.end],
    queryFn: () => rs.getExecutiveKPIs(range),
    refetchInterval: 120_000,
  })
  if (isLoading) return <LoadingState />
  const d = data || { activeLeads: 0, mrr: 0, cashCollected: 0, installsCompleted: 0, failedPayments48h: 0, unsignedAgreements: 0, unassignedJobs: 0 }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionHeader title="Executive Overview" sub={`${range.label} snapshot`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KPICard label="Active Pipeline Leads" value={String(d.activeLeads)} icon="⬡" accent="#38bdf8" sub="Excludes won/lost/parked" />
        <KPICard label="Current MRR" value={fmt$(d.mrr)} icon="💰" accent="#4ade80" sub="Active rental contracts" tooltip="Sum of monthly_amount from contracts where status = active." />
        <KPICard label="Cash Collected" value={fmt$(d.cashCollected)} icon="💳" accent="#a78bfa" sub={`${range.label} — account level`} tooltip="Payments recorded at account level. Individual contract attribution is not available." />
        <KPICard label="Installs Completed" value={String(d.installsCompleted)} icon="✅" accent="#34d399" sub={range.label} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <KPICard label="Failed Payments" value={String(d.failedPayments48h)} icon="⚠️" accent={d.failedPayments48h > 0 ? '#f87171' : '#4ade80'} sub="Last 48 hours" />
        <KPICard label="Awaiting Signature" value={String(d.unsignedAgreements)} icon="✍️" accent={d.unsignedAgreements > 0 ? '#fbbf24' : '#4ade80'} sub="Agreements pending" />
        <KPICard label="Unassigned Jobs" value={String(d.unassignedJobs)} icon="👷" accent={d.unassignedJobs > 0 ? '#fb923c' : '#4ade80'} sub="Scheduled, no tech" />
      </div>
    </div>
  )
}

function RevenueSection({ range }: { range: DateRange }) {
  const { data: summary, isLoading: sl } = useQuery({ queryKey: ['reports', 'revenue_summary', range.start, range.end], queryFn: () => rs.getRevenueSummary(range) })
  const { data: cashByMonth = [], isLoading: cl } = useQuery({ queryKey: ['reports', 'cash_by_month'], queryFn: () => rs.getCashByMonth(6) })
  const { data: contractsByMonth = [], isLoading: nml } = useQuery({ queryKey: ['reports', 'contracts_by_month'], queryFn: () => rs.getNewContractValueByMonth(6) })
  const { data: aging, isLoading: al } = useQuery({ queryKey: ['reports', 'invoice_aging'], queryFn: () => rs.getInvoiceAging() })
  const { data: payments = [], isLoading: pl } = useQuery({ queryKey: ['reports', 'payments_drilldown', range.start, range.end], queryFn: () => rs.getPaymentsDrilldown(range) })
  const s = summary || { mrr: 0, overdueTotal: 0, cashCollected: 0, failedPaymentsCount: 0 }
  const ag = aging || { amounts: { b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 }, counts: { b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 } }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionHeader title="Revenue & Billing" sub="MRR is contract-level. Cash collected is account-level." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KPICard label="Current MRR" value={sl ? '…' : fmt$(s.mrr)} icon="📈" accent="#4ade80" tooltip="Snapshot of current committed monthly revenue from active contracts." />
        <KPICard label="Cash Collected" value={sl ? '…' : fmt$(s.cashCollected)} icon="💳" accent="#a78bfa" sub={`${range.label} — account level`} tooltip="Payments recorded at account level. Individual contract attribution is not available." />
        <KPICard label="Overdue Invoices" value={sl ? '…' : fmt$(s.overdueTotal)} icon="🔴" accent={s.overdueTotal > 0 ? '#f87171' : '#4ade80'} sub="Total outstanding" />
        <KPICard label="Failed Payments" value={sl ? '…' : String(s.failedPaymentsCount)} icon="⚠️" accent={s.failedPaymentsCount > 0 ? '#f87171' : '#4ade80'} sub={range.label} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <ChartCard title="Cash Collected by Month" tooltip="Account-level cash actually received per month.">
          {cl ? <LoadingState small /> : <VerticalBarChart data={cashByMonth.map(m => ({ label: fmtMonth(String(m.month)), value: Number(m.total_collected) }))} color="#a78bfa" height={110} formatValue={v => `$${Math.round(v / 1000)}k`} />}
        </ChartCard>
        <ChartCard title="New Rental Contract Value by Month" tooltip="Value of new rental contracts signed each month. Not a historical MRR trend — reflects new business only.">
          {nml ? <LoadingState small /> : <VerticalBarChart data={contractsByMonth.map(m => ({ label: fmtMonth(String(m.month)), value: Number(m.new_monthly_value) }))} color="#4ade80" height={110} formatValue={v => `$${Math.round(v / 1000)}k`} />}
        </ChartCard>
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', marginBottom: 10 }}>Invoice Aging</div>
        {al ? <LoadingState small /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[
              { label: '0–30 days', amt: ag.amounts.b0_30,   cnt: ag.counts.b0_30,   color: '#f59e0b' },
              { label: '31–60 days', amt: ag.amounts.b31_60, cnt: ag.counts.b31_60,  color: '#fb923c' },
              { label: '61–90 days', amt: ag.amounts.b61_90, cnt: ag.counts.b61_90,  color: '#f87171' },
              { label: '90+ days',   amt: ag.amounts.b90plus,cnt: ag.counts.b90plus, color: '#dc2626' },
            ].map(b => (
              <div key={b.label} style={{ background: `${b.color}10`, border: `1px solid ${b.color}25`, borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{b.label}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: b.color }}>{fmt$(b.amt)}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{b.cnt} invoice{b.cnt !== 1 ? 's' : ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      {pl ? <LoadingState small /> : (
        <DrilldownTable
          columns={[
            { key: 'customers', label: 'Customer', render: (v: any) => v?.full_name || '—' },
            { key: 'amount',    label: 'Amount',   render: (v: any) => fmt$(Number(v)) },
            { key: 'status',    label: 'Status',   render: (v: string) => <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700, background: v === 'succeeded' ? 'rgba(74,222,128,0.12)' : v === 'failed' ? 'rgba(248,113,113,0.12)' : 'rgba(100,116,139,0.12)', color: v === 'succeeded' ? '#4ade80' : v === 'failed' ? '#f87171' : '#94a3b8' }}>{v}</span> },
            { key: 'type',           label: 'Type' },
            { key: 'failure_reason', label: 'Failure Reason', render: (v: any) => v || '—' },
            { key: 'attempted_at',   label: 'Date', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' },
          ]}
          rows={payments} emptyText="No payment transactions in this period"
          onExport={() => downloadCSV(payments, `payments_${range.start}_${range.end}.csv`)}
        />
      )}
    </div>
  )
}

function InstallationsSection({ range }: { range: DateRange }) {
  const { data: kpis, isLoading: kl } = useQuery({ queryKey: ['reports', 'install_kpis', range.start, range.end], queryFn: () => rs.getInstallKPIs(range) })
  const { data: weekly = [], isLoading: wl } = useQuery({ queryKey: ['reports', 'weekly_installs'], queryFn: () => rs.getWeeklyInstalls(8) })
  const { data: jobs = [], isLoading: jl } = useQuery({ queryKey: ['reports', 'jobs_drilldown', range.start, range.end], queryFn: () => rs.getJobsDrilldown(range) })
  const k = kpis || { completedInRange: 0, scheduled: 0, inProgress: 0, proofBacklog: 0, waitingStock: 0 }
  const STATUS_LABEL: Record<string, string> = { scheduled:'Scheduled', in_progress:'In Progress', waiting_for_stock:'Waiting Stock', complete:'Complete', cancelled:'Cancelled' }
  const STATUS_COLOR: Record<string, string> = { scheduled:'#60a5fa', in_progress:'#22d3ee', waiting_for_stock:'#f59e0b', complete:'#4ade80', cancelled:'#64748b' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionHeader title="Installations & Operations" sub="Uses completed_at from jobs table" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <KPICard label="Completed" value={kl ? '…' : String(k.completedInRange)} icon="✅" accent="#4ade80" sub={range.label} />
        <KPICard label="Scheduled"   value={kl ? '…' : String(k.scheduled)}        icon="📅" accent="#60a5fa" sub="Future" />
        <KPICard label="In Progress" value={kl ? '…' : String(k.inProgress)}       icon="⚡" accent="#22d3ee" sub="Active now" />
        <KPICard label="Proof Backlog" value={kl ? '…' : String(k.proofBacklog)}   icon="📸" accent={k.proofBacklog > 0 ? '#fbbf24' : '#4ade80'} sub="Awaiting review" />
        <KPICard label="Waiting Stock" value={kl ? '…' : String(k.waitingStock)}   icon="📦" accent={k.waitingStock > 0 ? '#fb923c' : '#4ade80'} sub="Blocked" />
      </div>
      <ChartCard title="Weekly Install Volume (last 8 weeks)">
        {wl ? <LoadingState small /> : <VerticalBarChart data={weekly.map(w => ({ label: w.label, value: w.count }))} color="#4ade80" height={120} />}
      </ChartCard>
      {jl ? <LoadingState small /> : (
        <DrilldownTable
          columns={[
            { key: 'customer_name_snapshot', label: 'Customer' },
            { key: 'system_type', label: 'System' },
            { key: 'status', label: 'Status', render: (v: string) => <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700, background: `${STATUS_COLOR[v] || '#64748b'}18`, color: STATUS_COLOR[v] || '#64748b' }}>{STATUS_LABEL[v] || v}</span> },
            { key: 'scheduled_date', label: 'Scheduled', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' },
            { key: 'completed_at', label: 'Completed', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' },
            { key: 'assigned_technician_name', label: 'Technician', render: (v: any) => v || <span style={{ color: '#f59e0b' }}>⚠ Unassigned</span> },
            { key: 'proof_approved', label: 'Proof', render: (v: boolean) => v ? <span style={{ color: '#4ade80', fontSize: 11, fontWeight: 700 }}>✓ Approved</span> : <span style={{ color: '#f59e0b', fontSize: 11, fontWeight: 700 }}>Pending</span> },
          ]}
          rows={jobs} emptyText="No jobs in this period"
          onExport={() => downloadCSV(jobs, `installations_${range.start}_${range.end}.csv`)}
        />
      )}
    </div>
  )
}

function PipelineSection({ range }: { range: DateRange }) {
  const { data: snapshot = [], isLoading: sl } = useQuery({ queryKey: ['reports', 'pipeline_snapshot'], queryFn: () => rs.getPipelineSnapshot() })
  const { data: outcomes, isLoading: ol } = useQuery({ queryKey: ['reports', 'pipeline_outcomes', range.start, range.end], queryFn: () => rs.getPipelineOutcomes(range) })
  const { data: leads = [], isLoading: ll } = useQuery({ queryKey: ['reports', 'leads_drilldown'], queryFn: () => rs.getLeadsDrilldown(100) })
  const o = outcomes || { won: 0, lost: 0, dnd: 0, parked: 0 }
  const stageOrder = ['new_lead','qualifying','qualified','site_visit_scheduled','proposal_in_progress','quote_sent','agreement_signed']
  const sortedSnapshot = stageOrder.map(s => (snapshot as any[]).find((r: any) => r.stage === s) || { stage: s, lead_count: 0 })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionHeader title="Pipeline Snapshot" />
      <div style={{ padding: '10px 14px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, fontSize: 12, color: '#94a3b8' }}>
        <strong style={{ color: '#a5b4fc' }}>Snapshot only.</strong> Shows where leads currently stand. Stage transition history is not tracked. Drop-off rates and time-in-stage are not available.
      </div>
      <ChartCard title="Open Pipeline — Current Stage Distribution">
        {sl ? <LoadingState small /> : <HBarChart data={sortedSnapshot.map((r: any) => ({ label: STAGE_LABELS[r.stage] || r.stage, value: r.lead_count, color: STAGE_COLORS[r.stage] || '#64748b' }))} />}
      </ChartCard>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Pipeline Outcomes — {range.label}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <KPICard label="Won (approx.)" value={ol ? '…' : String(o.won)} icon="🏆" accent="#4ade80" tooltip="Based on leads.updated_at. Approximate." />
          <KPICard label="Lost (approx.)" value={ol ? '…' : String(o.lost)} icon="❌" accent="#f87171" tooltip="Based on leads.updated_at. Approximate." />
          <KPICard label="DND (all time)" value={ol ? '…' : String(o.dnd)} icon="🚫" accent="#64748b" sub="Do not disturb" />
          <KPICard label="Parked" value={ol ? '…' : String(o.parked)} icon="⏸️" accent="#94a3b8" sub="Future follow-up" />
        </div>
      </div>
      {ll ? <LoadingState small /> : (
        <DrilldownTable
          columns={[
            { key: 'full_name', label: 'Name' },
            { key: 'phone', label: 'Phone' },
            { key: 'stage', label: 'Stage', render: (v: string) => <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700, background: `${STAGE_COLORS[v] || '#64748b'}18`, color: STAGE_COLORS[v] || '#94a3b8' }}>{STAGE_LABELS[v] || v}</span> },
            { key: 'source', label: 'Source', render: (v: any) => v || <span style={{ color: '#f59e0b' }}>⚠ None</span> },
            { key: 'days_open', label: 'Days Open', render: (v: number) => <span style={{ color: v > 30 ? '#f87171' : v > 14 ? '#fbbf24' : '#94a3b8', fontWeight: 600 }}>{v}</span> },
            { key: 'created_at', label: 'Created', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' },
          ]}
          rows={leads} emptyText="No active leads"
          onExport={() => downloadCSV(leads, 'pipeline_snapshot.csv')}
        />
      )}
    </div>
  )
}

function DataQualitySection() {
  const { data, isLoading } = useQuery({ queryKey: ['reports', 'data_quality'], queryFn: () => rs.getDataQualityExceptions(), refetchInterval: 300_000 })
  if (isLoading) return <LoadingState />
  const d = data || { nullSourceLeads: [], nullCommercialTypeQuotes: [], noProofJobs: [], customersNoSystem: [], contractsNoPmt: [], overdue60Invoices: [] }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SectionHeader title="Data Quality — Exceptions" sub="Internal use. Expand each row to review and export." />
      <div style={{ padding: '10px 14px', background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.2)', borderRadius: 8, fontSize: 12, color: '#94a3b8' }}>
        These exceptions indicate data that may affect reporting accuracy. Address them before relying on other reports.
      </div>
      <ExceptionBlock title="Leads with missing source" count={d.nullSourceLeads.length} rows={d.nullSourceLeads}
        columns={[{ key: 'full_name', label: 'Name' }, { key: 'stage', label: 'Stage' }, { key: 'created_at', label: 'Created', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' }]}
        emptyText="All active leads have a source ✓" />
      <ExceptionBlock title="Non-draft quotes missing commercial_type" count={d.nullCommercialTypeQuotes.length} rows={d.nullCommercialTypeQuotes}
        columns={[{ key: 'quote_number', label: 'Quote #' }, { key: 'status', label: 'Status' }, { key: 'created_at', label: 'Created', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' }]}
        emptyText="All sent quotes have commercial_type ✓" />
      <ExceptionBlock title="Completed installs awaiting proof review" count={d.noProofJobs.length} rows={d.noProofJobs}
        columns={[{ key: 'customer_name_snapshot', label: 'Customer' }, { key: 'scheduled_date', label: 'Scheduled', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' }, { key: 'completed_at', label: 'Completed', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' }]}
        emptyText="All completed installs have approved proof ✓" />
      <ExceptionBlock title="Customers with no installed system" count={d.customersNoSystem.length} rows={d.customersNoSystem}
        columns={[{ key: 'full_name', label: 'Customer' }, { key: 'lifecycle_status', label: 'Status' }, { key: 'created_at', label: 'Created', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' }]}
        emptyText="All customers have at least one installed system ✓" />
      <ExceptionBlock title="Active rental contracts — no payment in 35 days (account-level)" count={d.contractsNoPmt.length} rows={d.contractsNoPmt}
        columns={[{ key: 'customers', label: 'Customer', render: (v: any) => v?.full_name || '—' }, { key: 'contract_number', label: 'Contract #' }, { key: 'monthly_amount', label: 'Monthly', render: (v: any) => fmt$(Number(v)) }, { key: 'created_at', label: 'Signed', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' }]}
        emptyText="All active rental contracts have recent payments ✓" />
      <ExceptionBlock title="Invoices overdue 60+ days" count={d.overdue60Invoices.length} rows={d.overdue60Invoices}
        columns={[{ key: 'customers', label: 'Customer', render: (v: any) => v?.full_name || '—' }, { key: 'amount', label: 'Amount', render: (v: any) => fmt$(Number(v)) }, { key: 'due_date', label: 'Due Date', render: (v: string) => v ? fmtDate(v) : '—' }, { key: 'status', label: 'Status' }]}
        emptyText="No invoices overdue 60+ days ✓" />
    </div>
  )
}


// ─── Customers & Rentals Section ───────────────────────────────

const LIFECYCLE_COLORS: Record<string, string> = {
  active:       '#4ade80',
  service_due:  '#fbbf24',
  renewal_due:  '#fb923c',
  upsell:       '#38bdf8',
  at_risk:      '#f87171',
  inactive:     '#64748b',
  unknown:      '#334155',
}

const LIFECYCLE_LABELS: Record<string, string> = {
  active:       'Active',
  service_due:  'Service Due',
  renewal_due:  'Renewal Due',
  upsell:       'Upsell',
  at_risk:      'At Risk',
  inactive:     'Inactive',
  unknown:      'Unknown',
}

const SYSTEM_TYPE_LABELS: Record<string, string> = {
  ro:                'RO System',
  ro_install:        'RO System',
  softener:          'Water Softener',
  softener_only:     'Water Softener',
  whole_home_filter: 'Whole Home Filter',
  iron_filter:       'Iron Filter',
  dual_tank:         'Dual Tank',
  advanced_softener: 'Advanced Softener',
  unknown:           'Unknown',
}

const SYSTEM_COLORS = ['#38bdf8','#4ade80','#a78bfa','#fb923c','#22d3ee','#fbbf24','#f87171','#34d399']

function CustomersSection({ range }: { range: DateRange }) {
  const { data: kpis, isLoading: kl } = useQuery({
    queryKey: ['reports', 'customer_kpis'],
    queryFn: () => rs.getCustomerKPIs(),
    refetchInterval: 120_000,
  })
  const { data: lifecycle = [], isLoading: ll } = useQuery({
    queryKey: ['reports', 'customer_lifecycle'],
    queryFn: () => rs.getCustomerLifecycleDistribution(),
  })
  const { data: systemDist = [], isLoading: sdl } = useQuery({
    queryKey: ['reports', 'system_type_dist'],
    queryFn: () => rs.getSystemTypeDistribution(),
  })
  const { data: newByMonth = [], isLoading: nml } = useQuery({
    queryKey: ['reports', 'new_customers_by_month'],
    queryFn: () => rs.getNewCustomersByMonth(6),
  })
  const { data: customers = [], isLoading: cl } = useQuery({
    queryKey: ['reports', 'customers_drilldown'],
    queryFn: () => rs.getCustomersDrilldown(150),
  })

  const k = kpis || { totalCustomers: 0, activeCustomers: 0, atRisk: 0, renewalsIn30: 0, serviceDue: 0 }

  // Donut chart using SVG
  const totalSystems = systemDist.reduce((s, d) => s + d.count, 0)
  let cumAngle = -90 // start at top
  const donutSlices = systemDist.map((d, i) => {
    const pct   = totalSystems > 0 ? d.count / totalSystems : 0
    const angle = pct * 360
    const start = cumAngle
    cumAngle   += angle
    const r     = 52, cx = 70, cy = 70
    const toRad = (deg: number) => (deg * Math.PI) / 180
    const x1 = cx + r * Math.cos(toRad(start))
    const y1 = cy + r * Math.sin(toRad(start))
    const x2 = cx + r * Math.cos(toRad(start + angle))
    const y2 = cy + r * Math.sin(toRad(start + angle))
    const large = angle > 180 ? 1 : 0
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
    return { ...d, path, color: SYSTEM_COLORS[i % SYSTEM_COLORS.length], pct }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 18, margin: 0, letterSpacing: '-0.01em' }}>Customers & Rentals</h2>
        <p style={{ color: '#475569', fontSize: 12, marginTop: 4, marginBottom: 0 }}>
          lifecycle_status reliability depends on automation rules. Verify before acting on at-risk counts.
        </p>
      </div>

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <KPICard label="Total Customers"  value={kl ? '…' : String(k.totalCustomers)}  icon="👥" accent="#38bdf8" />
        <KPICard label="Active"           value={kl ? '…' : String(k.activeCustomers)} icon="✅" accent="#4ade80" sub="lifecycle = active" />
        <KPICard label="At Risk"          value={kl ? '…' : String(k.atRisk)}          icon="🔴"
          accent={k.atRisk > 0 ? '#f87171' : '#4ade80'} sub="Needs attention" />
        <KPICard label="Renewals in 30d"  value={kl ? '…' : String(k.renewalsIn30)}    icon="↻"
          accent={k.renewalsIn30 > 0 ? '#fbbf24' : '#4ade80'} sub="Active contracts" />
        <KPICard label="Service Due"      value={kl ? '…' : String(k.serviceDue)}      icon="🔧"
          accent={k.serviceDue > 0 ? '#fb923c' : '#4ade80'} sub="Due or overdue" />
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>

        {/* Lifecycle distribution bar */}
        <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 16 }}>Customer Lifecycle</div>
          {ll ? <LoadingState small /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {lifecycle.length === 0 ? (
                <div style={{ color: '#334155', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No customers yet</div>
              ) : lifecycle.map(item => {
                const max = Math.max(...lifecycle.map(l => l.count), 1)
                const c = LIFECYCLE_COLORS[item.status] || '#64748b'
                return (
                  <div key={item.status}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{LIFECYCLE_LABELS[item.status] || item.status}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: c }}>{item.count}</span>
                    </div>
                    <div style={{ height: 8, background: '#0d1a26', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(item.count / max) * 100}%`, background: c, borderRadius: 4, boxShadow: `0 0 6px ${c}40` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* New customers by month */}
        <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 16 }}>New Customers by Month</div>
          {nml ? <LoadingState small /> : (
            <VerticalBarChart
              data={newByMonth.map(m => ({ label: m.month, value: m.count }))}
              color="#38bdf8" height={110}
            />
          )}
        </div>

        {/* System type donut */}
        <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 12 }}>Installed Systems</div>
          {sdl ? <LoadingState small /> : totalSystems === 0 ? (
            <div style={{ color: '#334155', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No systems recorded</div>
          ) : (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <svg width="140" height="140" viewBox="0 0 140 140" style={{ flexShrink: 0 }}>
                {donutSlices.map((s, i) => (
                  <path key={i} d={s.path} fill={s.color} opacity={0.85} />
                ))}
                {/* Donut hole */}
                <circle cx="70" cy="70" r="30" fill="#0f1923" />
                <text x="70" y="73" textAnchor="middle" fill="#e2e8f0" fontSize="14" fontWeight="800">{totalSystems}</text>
                <text x="70" y="86" textAnchor="middle" fill="#475569" fontSize="9">systems</text>
              </svg>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {donutSlices.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {SYSTEM_TYPE_LABELS[s.type] || s.type}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: s.color, flexShrink: 0 }}>{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Customers drilldown table */}
      {cl ? <LoadingState small /> : (
        <DrilldownTable
          columns={[
            { key: 'full_name',        label: 'Customer' },
            { key: 'phone',            label: 'Phone' },
            { key: 'lifecycle_status', label: 'Status', render: (v: string) => {
              const c = LIFECYCLE_COLORS[v] || '#64748b'
              return <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700, background: `${c}18`, color: c, border: `1px solid ${c}30` }}>{LIFECYCLE_LABELS[v] || v || '—'}</span>
            }},
            { key: 'contract', label: 'Contract Type', render: (v: any) => v ? (
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{v.type} · {v.monthly_amount ? `$${Number(v.monthly_amount).toFixed(0)}/mo` : '—'}</span>
            ) : <span style={{ color: '#334155' }}>None</span> },
            { key: 'systems', label: 'Systems', render: (v: any[]) => v?.length
              ? v.map((s: any) => SYSTEM_TYPE_LABELS[s.system_type] || s.system_type).join(', ')
              : <span style={{ color: '#334155' }}>None</span>
            },
            { key: 'last_payment_at', label: 'Last Payment', render: (v: string) => v ? fmtDate(v.split('T')[0]) : <span style={{ color: '#f59e0b' }}>None recorded</span> },
            { key: 'created_at', label: 'Customer Since', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' },
          ]}
          rows={customers}
          emptyText="No customers found"
          onExport={() => downloadCSV(
            customers.map((c: any) => ({
              name: c.full_name, phone: c.phone, status: c.lifecycle_status,
              contract_type: c.contract?.type || '', monthly: c.contract?.monthly_amount || '',
              systems: (c.systems || []).map((s: any) => s.system_type).join('; '),
              last_payment: c.last_payment_at || '',
              customer_since: c.created_at || '',
            })),
            'customers.csv'
          )}
        />
      )}
    </div>
  )
}

// ─── Date Range Bar ─────────────────────────────────────────────
function DateRangeBar({ range, onChange }: { range: DateRange; onChange: (r: DateRange) => void }) {
  const presets = [
    { label: 'MTD',      fn: rs.getMTDRange    },
    { label: 'Last 30d', fn: rs.getLast30Range },
    { label: 'Last 90d', fn: rs.getLast90Range },
    { label: 'YTD',      fn: rs.getYTDRange    },
  ]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Period:</span>
      {presets.map(p => (
        <button key={p.label} onClick={() => onChange(p.fn())} style={{
          padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          background: range.label === p.label ? 'rgba(13,126,163,0.2)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${range.label === p.label ? '#0d7ea3' : '#1e3a4f'}`,
          color: range.label === p.label ? '#0d7ea3' : '#64748b',
        }}>{p.label}</button>
      ))}
      <span style={{ fontSize: 11, color: '#334155', marginLeft: 4 }}>{range.start} → {range.end}</span>
    </div>
  )
}

// ─── Nav Tab Config ─────────────────────────────────────────────
type Section = 'overview' | 'revenue' | 'installs' | 'pipeline' | 'customers' | 'quality'

const NAV_TABS: { id: Section; label: string; icon: string; color: string; bg: string; adminOnly?: boolean }[] = [
  { id: 'overview',  label: 'Executive Overview',  icon: '◉',  color: '#38bdf8', bg: 'rgba(56,189,248,0.12)'  },
  { id: 'revenue',   label: 'Revenue & Billing',   icon: '💰', color: '#4ade80', bg: 'rgba(74,222,128,0.12)'  },
  { id: 'installs',  label: 'Installations',       icon: '🔧', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)'  },
  { id: 'pipeline',  label: 'Pipeline Snapshot',   icon: '⬡',  color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  { id: 'customers', label: 'Customers & Rentals',  icon: '👥', color: '#34d399', bg: 'rgba(52,211,153,0.12)'  },
  { id: 'quality',   label: 'Data Quality',        icon: '🔍', color: '#fb923c', bg: 'rgba(251,146,60,0.12)',  adminOnly: true },
]

// ─── Main Page ──────────────────────────────────────────────────
export function ReportsPage() {
  const { role } = useAuth()
  const isAdmin = role === 'admin'
  const [activeSection, setActiveSection] = useState<Section>('overview')
  const [range, setRange] = useState<DateRange>(rs.getMTDRange())
  const visibleTabs = NAV_TABS.filter(t => !t.adminOnly || isAdmin)

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ color: '#f1f5f9', fontWeight: 800, fontSize: 22, margin: 0, letterSpacing: '-0.02em' }}>Reports</h1>
          <p style={{ color: '#475569', fontSize: 13, marginTop: 4, marginBottom: 0 }}>Zenith Pure Solutions · Indianapolis, IN</p>
        </div>
        <DateRangeBar range={range} onChange={setRange} />
      </div>

      {/* Health Meter */}
      <HealthMeter range={range} />

      {/* Horizontal tab nav */}
      <div style={{
        display: 'flex', gap: 6, marginBottom: 20,
        borderBottom: '1px solid #1e3a4f', paddingBottom: 0,
        overflowX: 'auto', scrollbarWidth: 'none',
      }}>
        {visibleTabs.map(tab => {
          const active = activeSection === tab.id
          return (
            <button key={tab.id} onClick={() => setActiveSection(tab.id)} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 18px', cursor: 'pointer', border: 'none',
              borderBottom: `3px solid ${active ? tab.color : 'transparent'}`,
              background: active ? tab.bg : 'transparent',
              borderRadius: '8px 8px 0 0',
              color: active ? tab.color : '#475569',
              fontSize: 13, fontWeight: active ? 700 : 500,
              flexShrink: 0,
              transition: 'all 0.15s',
            }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = '#94a3b8' }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = '#475569' }}
            >
              <span style={{ fontSize: 15 }}>{tab.icon}</span>
              {tab.label}
              {tab.adminOnly && (
                <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 20, background: `${tab.color}20`, color: tab.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Admin
                </span>
              )}
            </button>
          )
        })}

        {/* P2 coming soon tabs — grayed out, not clickable */}
        {['Rep Performance', 'Quotes & Commercial', 'Marketing'].map(label => (
          <div key={label} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '10px 16px', borderBottom: '3px solid transparent',
            color: '#1e3a4f', fontSize: 12, fontWeight: 500, flexShrink: 0,
            cursor: 'not-allowed', borderRadius: '8px 8px 0 0',
          }}>
            {label}
            <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 10, background: '#1e2a38', color: '#334155', fontWeight: 700, textTransform: 'uppercase' }}>P2</span>
          </div>
        ))}
      </div>

      {/* Section content */}
      <div style={{ minHeight: 400 }}>
        {activeSection === 'overview' && <ExecutiveSection range={range} />}
        {activeSection === 'revenue'  && <RevenueSection   range={range} />}
        {activeSection === 'installs' && <InstallationsSection range={range} />}
        {activeSection === 'pipeline' && <PipelineSection  range={range} />}
        {activeSection === 'customers' && <CustomersSection range={range} />}
        {activeSection === 'quality'  && isAdmin && <DataQualitySection />}
      </div>
    </div>
  )
}
