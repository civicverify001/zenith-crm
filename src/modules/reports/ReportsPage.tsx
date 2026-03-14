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
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

const STAGE_LABELS: Record<string, string> = {
  new_lead:             'New Lead',
  qualifying:           'Qualifying',
  qualified:            'Qualified',
  site_visit_scheduled: 'Site Visit',
  proposal_in_progress: 'Proposal',
  quote_sent:           'Quote Sent',
  agreement_signed:     'Agreement Signed',
}

const STAGE_COLORS: Record<string, string> = {
  new_lead:             '#64748b',
  qualifying:           '#a78bfa',
  qualified:            '#0d7ea3',
  site_visit_scheduled: '#22d3ee',
  proposal_in_progress: '#22d3ee',
  quote_sent:           '#f59e0b',
  agreement_signed:     '#4ade80',
}

// ─── Shared UI Components ──────────────────────────────────────

function KPICard({ label, value, sub, accent, icon, tooltip }: {
  label: string; value: string; sub?: string; accent: string; icon: string; tooltip?: string
}) {
  return (
    <div style={{
      background: '#0f1923', border: `1px solid ${accent}25`,
      borderTop: `3px solid ${accent}`, borderRadius: 12,
      padding: '16px 18px', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: -16, right: -16, width: 60, height: 60, borderRadius: '50%', background: `${accent}10`, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
        {tooltip && (
          <span title={tooltip} style={{ fontSize: 11, color: '#334155', cursor: 'help', marginLeft: 2 }}>ⓘ</span>
        )}
      </div>
      <div style={{ fontSize: 30, fontWeight: 900, color: accent, lineHeight: 1, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>{sub}</div>}
    </div>
  )
}

function SectionHeader({ title, sub, onExport, exportLabel }: {
  title: string; sub?: string; onExport?: () => void; exportLabel?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16 }}>
      <div>
        <h2 style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 18, margin: 0, letterSpacing: '-0.01em' }}>{title}</h2>
        {sub && <p style={{ color: '#475569', fontSize: 12, marginTop: 4, marginBottom: 0 }}>{sub}</p>}
      </div>
      {onExport && (
        <button onClick={onExport} style={{
          fontSize: 11, padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
          background: 'rgba(13,126,163,0.1)', border: '1px solid rgba(13,126,163,0.3)',
          color: '#0d7ea3', fontWeight: 600,
        }}>
          ↓ {exportLabel || 'Export CSV'}
        </button>
      )}
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
  height?: number; color?: string
  formatValue?: (v: number) => string
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
  rows: any[]
  emptyText?: string
  onExport?: () => void
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
  const urgentColor = count > 0 ? '#f87171' : '#4ade80'

  return (
    <div style={{ background: '#0f1923', border: `1px solid ${count > 0 ? 'rgba(248,113,113,0.2)' : '#1e3a4f'}`, borderRadius: 12, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '13px 16px', cursor: 'pointer', background: 'linear-gradient(135deg, #162232, #0d1a26)',
          border: 'none', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1' }}>{title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            minWidth: 28, height: 22, borderRadius: 20, padding: '0 8px',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 800,
            background: count === 0 ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
            color: urgentColor,
            border: `1px solid ${count === 0 ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.25)'}`,
          }}>
            {count}
          </span>
          {count > 0 && (
            <button onClick={e => { e.stopPropagation(); downloadCSV(rows, `${title.toLowerCase().replace(/\s+/g, '_')}.csv`) }}
              style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, cursor: 'pointer', background: 'rgba(13,126,163,0.1)', border: '1px solid rgba(13,126,163,0.25)', color: '#0d7ea3' }}>
              ↓ CSV
            </button>
          )}
          <span style={{ color: '#334155', fontSize: 13 }}>{open ? '▾' : '▸'}</span>
        </div>
      </button>
      {open && (
        <div style={{ borderTop: '1px solid #1e3a4f' }}>
          <DrilldownTable columns={columns} rows={rows} emptyText={emptyText} />
        </div>
      )}
    </div>
  )
}

// ─── Section: Executive Overview ──────────────────────────────

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
        <KPICard label="Active Pipeline Leads" value={String(d.activeLeads)} icon="⬡" accent="#38bdf8"
          sub="Excludes won/lost/parked" />
        <KPICard label="Current MRR" value={fmt$(d.mrr)} icon="💰" accent="#4ade80"
          sub="Active rental contracts" tooltip="Sum of monthly_amount from contracts where status = active." />
        <KPICard label="Cash Collected" value={fmt$(d.cashCollected)} icon="💳" accent="#a78bfa"
          sub={`${range.label} — account level`}
          tooltip="Payments recorded at account level. Individual contract attribution is not available." />
        <KPICard label="Installs Completed" value={String(d.installsCompleted)} icon="✅" accent="#34d399"
          sub={range.label} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <KPICard label="Failed Payments" value={String(d.failedPayments48h)} icon="⚠️"
          accent={d.failedPayments48h > 0 ? '#f87171' : '#4ade80'}
          sub="Last 48 hours" />
        <KPICard label="Awaiting Signature" value={String(d.unsignedAgreements)} icon="✍️"
          accent={d.unsignedAgreements > 0 ? '#fbbf24' : '#4ade80'}
          sub="Agreements pending" />
        <KPICard label="Unassigned Jobs" value={String(d.unassignedJobs)} icon="👷"
          accent={d.unassignedJobs > 0 ? '#fb923c' : '#4ade80'}
          sub="Scheduled, no tech" />
      </div>
    </div>
  )
}

// ─── Section: Revenue & Billing ────────────────────────────────

function RevenueSection({ range }: { range: DateRange }) {
  const { data: summary, isLoading: sl } = useQuery({
    queryKey: ['reports', 'revenue_summary', range.start, range.end],
    queryFn: () => rs.getRevenueSummary(range),
  })
  const { data: cashByMonth = [], isLoading: cl } = useQuery({
    queryKey: ['reports', 'cash_by_month'],
    queryFn: () => rs.getCashByMonth(6),
  })
  const { data: contractsByMonth = [], isLoading: nml } = useQuery({
    queryKey: ['reports', 'contracts_by_month'],
    queryFn: () => rs.getNewContractValueByMonth(6),
  })
  const { data: aging, isLoading: al } = useQuery({
    queryKey: ['reports', 'invoice_aging'],
    queryFn: () => rs.getInvoiceAging(),
  })
  const { data: payments = [], isLoading: pl } = useQuery({
    queryKey: ['reports', 'payments_drilldown', range.start, range.end],
    queryFn: () => rs.getPaymentsDrilldown(range),
  })

  const s = summary || { mrr: 0, overdueTotal: 0, cashCollected: 0, failedPaymentsCount: 0 }
  const ag = aging || { amounts: { b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 }, counts: { b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 } }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionHeader title="Revenue & Billing" sub="MRR is contract-level. Cash collected is account-level." />

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KPICard label="Current MRR" value={sl ? '…' : fmt$(s.mrr)} icon="📈" accent="#4ade80"
          tooltip="Sum of monthly_amount from active contracts. Not a historical trend — this is a snapshot of current committed monthly revenue." />
        <KPICard label="Cash Collected" value={sl ? '…' : fmt$(s.cashCollected)} icon="💳" accent="#a78bfa"
          sub={`${range.label} — account level`}
          tooltip="Payments recorded at account level. Individual contract attribution is not available." />
        <KPICard label="Overdue Invoices" value={sl ? '…' : fmt$(s.overdueTotal)} icon="🔴"
          accent={s.overdueTotal > 0 ? '#f87171' : '#4ade80'} sub="Total outstanding" />
        <KPICard label="Failed Payments" value={sl ? '…' : String(s.failedPaymentsCount)} icon="⚠️"
          accent={s.failedPaymentsCount > 0 ? '#f87171' : '#4ade80'} sub={range.label} />
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <ChartCard title="Cash Collected by Month"
          tooltip="Account-level cash actually received per month.">
          {cl ? <LoadingState small /> : (
            <VerticalBarChart
              data={cashByMonth.map(m => ({ label: fmtMonth(String(m.month)), value: Number(m.total_collected) }))}
              color="#a78bfa" height={110} formatValue={v => `$${Math.round(v / 1000)}k`}
            />
          )}
        </ChartCard>

        <ChartCard title="New Rental Contract Value by Month"
          tooltip="Value of new rental contracts signed each month. This is not a historical MRR trend — it reflects new business only, not total active contracts in any past month.">
          {nml ? <LoadingState small /> : (
            <VerticalBarChart
              data={contractsByMonth.map(m => ({ label: fmtMonth(String(m.month)), value: Number(m.new_monthly_value) }))}
              color="#4ade80" height={110} formatValue={v => `$${Math.round(v / 1000)}k`}
            />
          )}
        </ChartCard>
      </div>

      {/* Invoice Aging */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', marginBottom: 10 }}>Invoice Aging</div>
        {al ? <LoadingState small /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[
              { label: '0–30 days', amt: ag.amounts.b0_30, cnt: ag.counts.b0_30, color: '#f59e0b' },
              { label: '31–60 days', amt: ag.amounts.b31_60, cnt: ag.counts.b31_60, color: '#fb923c' },
              { label: '61–90 days', amt: ag.amounts.b61_90, cnt: ag.counts.b61_90, color: '#f87171' },
              { label: '90+ days', amt: ag.amounts.b90plus, cnt: ag.counts.b90plus, color: '#dc2626' },
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

      {/* Payments drilldown */}
      {pl ? <LoadingState small /> : (
        <DrilldownTable
          columns={[
            { key: 'customers', label: 'Customer', render: (v: any) => v?.full_name || '—' },
            { key: 'amount', label: 'Amount', render: (v: any) => fmt$(Number(v)) },
            { key: 'status', label: 'Status', render: (v: string) => (
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700,
                background: v === 'succeeded' ? 'rgba(74,222,128,0.12)' : v === 'failed' ? 'rgba(248,113,113,0.12)' : 'rgba(100,116,139,0.12)',
                color: v === 'succeeded' ? '#4ade80' : v === 'failed' ? '#f87171' : '#94a3b8',
              }}>{v}</span>
            )},
            { key: 'type', label: 'Type' },
            { key: 'failure_reason', label: 'Failure Reason', render: (v: any) => v || '—' },
            { key: 'attempted_at', label: 'Date', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' },
          ]}
          rows={payments}
          emptyText="No payment transactions in this period"
          onExport={() => downloadCSV(payments, `payments_${range.start}_${range.end}.csv`)}
        />
      )}
    </div>
  )
}

// ─── Section: Installations ────────────────────────────────────

function InstallationsSection({ range }: { range: DateRange }) {
  const { data: kpis, isLoading: kl } = useQuery({
    queryKey: ['reports', 'install_kpis', range.start, range.end],
    queryFn: () => rs.getInstallKPIs(range),
  })
  const { data: weekly = [], isLoading: wl } = useQuery({
    queryKey: ['reports', 'weekly_installs'],
    queryFn: () => rs.getWeeklyInstalls(8),
  })
  const { data: jobs = [], isLoading: jl } = useQuery({
    queryKey: ['reports', 'jobs_drilldown', range.start, range.end],
    queryFn: () => rs.getJobsDrilldown(range),
  })

  const k = kpis || { completedInRange: 0, scheduled: 0, inProgress: 0, proofBacklog: 0, waitingStock: 0 }

  const STATUS_LABEL: Record<string, string> = {
    scheduled: 'Scheduled', in_progress: 'In Progress',
    waiting_for_stock: 'Waiting Stock', complete: 'Complete', cancelled: 'Cancelled',
  }
  const STATUS_COLOR: Record<string, string> = {
    scheduled: '#60a5fa', in_progress: '#22d3ee',
    waiting_for_stock: '#f59e0b', complete: '#4ade80', cancelled: '#64748b',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionHeader title="Installations & Operations" sub="Uses completed_at from jobs table" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <KPICard label="Completed" value={kl ? '…' : String(k.completedInRange)} icon="✅" accent="#4ade80" sub={range.label} />
        <KPICard label="Scheduled" value={kl ? '…' : String(k.scheduled)} icon="📅" accent="#60a5fa" sub="Future" />
        <KPICard label="In Progress" value={kl ? '…' : String(k.inProgress)} icon="⚡" accent="#22d3ee" sub="Active now" />
        <KPICard label="Proof Backlog" value={kl ? '…' : String(k.proofBacklog)} icon="📸"
          accent={k.proofBacklog > 0 ? '#fbbf24' : '#4ade80'} sub="Awaiting review" />
        <KPICard label="Waiting Stock" value={kl ? '…' : String(k.waitingStock)} icon="📦"
          accent={k.waitingStock > 0 ? '#fb923c' : '#4ade80'} sub="Blocked" />
      </div>

      <ChartCard title="Weekly Install Volume (last 8 weeks)">
        {wl ? <LoadingState small /> : (
          <VerticalBarChart data={weekly.map(w => ({ label: w.label, value: w.count }))} color="#4ade80" height={120} />
        )}
      </ChartCard>

      {jl ? <LoadingState small /> : (
        <DrilldownTable
          columns={[
            { key: 'customer_name_snapshot', label: 'Customer' },
            { key: 'system_type', label: 'System' },
            { key: 'status', label: 'Status', render: (v: string) => (
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700,
                background: `${STATUS_COLOR[v] || '#64748b'}18`, color: STATUS_COLOR[v] || '#64748b' }}>
                {STATUS_LABEL[v] || v}
              </span>
            )},
            { key: 'scheduled_date', label: 'Scheduled', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' },
            { key: 'completed_at', label: 'Completed', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' },
            { key: 'assigned_technician_name', label: 'Technician', render: (v: any) => v || <span style={{ color: '#f59e0b' }}>⚠ Unassigned</span> },
            { key: 'proof_approved', label: 'Proof', render: (v: boolean) => v
              ? <span style={{ color: '#4ade80', fontSize: 11, fontWeight: 700 }}>✓ Approved</span>
              : <span style={{ color: '#f59e0b', fontSize: 11, fontWeight: 700 }}>Pending</span>
            },
            { key: 'service_address_snapshot', label: 'Address' },
          ]}
          rows={jobs}
          emptyText="No jobs in this period"
          onExport={() => downloadCSV(jobs, `installations_${range.start}_${range.end}.csv`)}
        />
      )}
    </div>
  )
}

// ─── Section: Pipeline Snapshot ────────────────────────────────

function PipelineSection({ range }: { range: DateRange }) {
  const { data: snapshot = [], isLoading: sl } = useQuery({
    queryKey: ['reports', 'pipeline_snapshot'],
    queryFn: () => rs.getPipelineSnapshot(),
  })
  const { data: outcomes, isLoading: ol } = useQuery({
    queryKey: ['reports', 'pipeline_outcomes', range.start, range.end],
    queryFn: () => rs.getPipelineOutcomes(range),
  })
  const { data: leads = [], isLoading: ll } = useQuery({
    queryKey: ['reports', 'leads_drilldown'],
    queryFn: () => rs.getLeadsDrilldown(100),
  })

  const o = outcomes || { won: 0, lost: 0, dnd: 0, parked: 0 }

  const stageOrder = ['new_lead','qualifying','qualified','site_visit_scheduled','proposal_in_progress','quote_sent','agreement_signed']
  const sortedSnapshot = stageOrder
    .map(s => snapshot.find((r: any) => r.stage === s) || { stage: s, lead_count: 0 })
    .filter(r => r.lead_count > 0 || stageOrder.includes(r.stage))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionHeader title="Pipeline Snapshot" />

      {/* Caveat banner */}
      <div style={{ padding: '10px 14px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, fontSize: 12, color: '#94a3b8' }}>
        <strong style={{ color: '#a5b4fc' }}>Snapshot only.</strong> Shows where leads currently stand. Stage transition history is not tracked. Drop-off rates and time-in-stage are not available.
      </div>

      {/* Open pipeline chart */}
      <ChartCard title="Open Pipeline — Current Stage Distribution">
        {sl ? <LoadingState small /> : (
          <HBarChart data={sortedSnapshot.map((r: any) => ({
            label: STAGE_LABELS[r.stage] || r.stage,
            value: r.lead_count,
            color: STAGE_COLORS[r.stage] || '#64748b',
          }))} />
        )}
      </ChartCard>

      {/* Outcomes summary */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          Pipeline Outcomes — {range.label}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <KPICard label="Won (approx.)" value={ol ? '…' : String(o.won)} icon="🏆" accent="#4ade80"
            tooltip="Based on leads.updated_at falling in the selected period. Leads updated for other reasons may be included. Approximate." />
          <KPICard label="Lost (approx.)" value={ol ? '…' : String(o.lost)} icon="❌" accent="#f87171"
            tooltip="Based on leads.updated_at falling in the selected period. Approximate." />
          <KPICard label="DND (all time)" value={ol ? '…' : String(o.dnd)} icon="🚫" accent="#64748b"
            sub="Do not disturb — all time" />
          <KPICard label="Parked" value={ol ? '…' : String(o.parked)} icon="⏸️" accent="#94a3b8"
            sub="Future follow-up — all time" />
        </div>
      </div>

      {/* Leads drilldown */}
      {ll ? <LoadingState small /> : (
        <DrilldownTable
          columns={[
            { key: 'full_name', label: 'Name' },
            { key: 'phone', label: 'Phone' },
            { key: 'stage', label: 'Stage', render: (v: string) => (
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700,
                background: `${STAGE_COLORS[v] || '#64748b'}18`, color: STAGE_COLORS[v] || '#94a3b8' }}>
                {STAGE_LABELS[v] || v}
              </span>
            )},
            { key: 'source', label: 'Source', render: (v: any) => v || <span style={{ color: '#f59e0b' }}>⚠ None</span> },
            { key: 'days_open', label: 'Days Open', render: (v: number) => (
              <span style={{ color: v > 30 ? '#f87171' : v > 14 ? '#fbbf24' : '#94a3b8', fontWeight: 600 }}>{v}</span>
            )},
            { key: 'created_at', label: 'Created', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' },
          ]}
          rows={leads}
          emptyText="No active leads"
          onExport={() => downloadCSV(leads, `pipeline_snapshot.csv`)}
        />
      )}
    </div>
  )
}

// ─── Section: Data Quality ─────────────────────────────────────

function DataQualitySection() {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'data_quality'],
    queryFn: () => rs.getDataQualityExceptions(),
    refetchInterval: 300_000,
  })

  if (isLoading) return <LoadingState />

  const d = data || {
    nullSourceLeads: [], nullCommercialTypeQuotes: [], noProofJobs: [],
    customersNoSystem: [], contractsNoPmt: [], overdue60Invoices: [],
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SectionHeader title="Data Quality — Exceptions" sub="Internal use. Expand each row to review and export." />

      <div style={{ padding: '10px 14px', background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.2)', borderRadius: 8, fontSize: 12, color: '#94a3b8' }}>
        These exceptions indicate data that may affect reporting accuracy. Address them before relying on other reports.
      </div>

      <ExceptionBlock title="Leads with missing source" count={d.nullSourceLeads.length}
        rows={d.nullSourceLeads}
        columns={[
          { key: 'full_name', label: 'Name' },
          { key: 'stage', label: 'Stage' },
          { key: 'created_at', label: 'Created', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' },
        ]}
        emptyText="All active leads have a source ✓"
      />

      <ExceptionBlock title="Non-draft quotes missing commercial_type" count={d.nullCommercialTypeQuotes.length}
        rows={d.nullCommercialTypeQuotes}
        columns={[
          { key: 'quote_number', label: 'Quote #' },
          { key: 'status', label: 'Status' },
          { key: 'created_at', label: 'Created', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' },
        ]}
        emptyText="All sent quotes have commercial_type ✓"
      />

      <ExceptionBlock title="Completed installs awaiting proof review" count={d.noProofJobs.length}
        rows={d.noProofJobs}
        columns={[
          { key: 'customer_name_snapshot', label: 'Customer' },
          { key: 'scheduled_date', label: 'Scheduled', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' },
          { key: 'completed_at', label: 'Completed', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' },
        ]}
        emptyText="All completed installs have approved proof ✓"
      />

      <ExceptionBlock title="Customers with no installed system" count={d.customersNoSystem.length}
        rows={d.customersNoSystem}
        columns={[
          { key: 'full_name', label: 'Customer' },
          { key: 'lifecycle_status', label: 'Status' },
          { key: 'created_at', label: 'Created', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' },
        ]}
        emptyText="All customers have at least one installed system ✓"
      />

      <ExceptionBlock
        title="Active rental contracts — no payment in 35 days (account-level)"
        count={d.contractsNoPmt.length}
        rows={d.contractsNoPmt}
        columns={[
          { key: 'customers', label: 'Customer', render: (v: any) => v?.full_name || '—' },
          { key: 'contract_number', label: 'Contract #' },
          { key: 'monthly_amount', label: 'Monthly', render: (v: any) => fmt$(Number(v)) },
          { key: 'created_at', label: 'Signed', render: (v: string) => v ? fmtDate(v.split('T')[0]) : '—' },
        ]}
        emptyText="All active rental contracts have recent payments ✓"
      />

      <ExceptionBlock title="Invoices overdue 60+ days" count={d.overdue60Invoices.length}
        rows={d.overdue60Invoices}
        columns={[
          { key: 'customers', label: 'Customer', render: (v: any) => v?.full_name || '—' },
          { key: 'amount', label: 'Amount', render: (v: any) => fmt$(Number(v)) },
          { key: 'due_date', label: 'Due Date', render: (v: string) => v ? fmtDate(v) : '—' },
          { key: 'status', label: 'Status' },
        ]}
        emptyText="No invoices overdue 60+ days ✓"
      />
    </div>
  )
}

// ─── Loading State ─────────────────────────────────────────────

function LoadingState({ small }: { small?: boolean }) {
  return (
    <div style={{ padding: small ? '20px 0' : '48px 0', textAlign: 'center', color: '#334155', fontSize: 13 }}>
      Loading…
    </div>
  )
}

// ─── Date Range Bar ────────────────────────────────────────────

function DateRangeBar({ range, onChange }: { range: DateRange; onChange: (r: DateRange) => void }) {
  const presets = [
    { label: 'MTD',     fn: rs.getMTDRange    },
    { label: 'Last 30d', fn: rs.getLast30Range },
    { label: 'Last 90d', fn: rs.getLast90Range },
    { label: 'YTD',     fn: rs.getYTDRange    },
  ]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Period:</span>
      {presets.map(p => (
        <button key={p.label} onClick={() => onChange(p.fn())} style={{
          padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          background: range.label === p.label ? 'rgba(13,126,163,0.2)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${range.label === p.label ? '#0d7ea3' : '#1e3a4f'}`,
          color: range.label === p.label ? '#0d7ea3' : '#64748b',
          transition: 'all 0.12s',
        }}>
          {p.label}
        </button>
      ))}
      <span style={{ fontSize: 11, color: '#334155', marginLeft: 4 }}>
        {range.start} → {range.end}
      </span>
    </div>
  )
}

// ─── Left Sidebar Nav ──────────────────────────────────────────

type Section = 'overview' | 'revenue' | 'installs' | 'pipeline' | 'quality'

const NAV_ITEMS: { id: Section; label: string; icon: string; adminOnly?: boolean }[] = [
  { id: 'overview',  label: 'Executive Overview',   icon: '◉' },
  { id: 'revenue',   label: 'Revenue & Billing',     icon: '💰' },
  { id: 'installs',  label: 'Installations',         icon: '🔧' },
  { id: 'pipeline',  label: 'Pipeline Snapshot',     icon: '⬡' },
  { id: 'quality',   label: 'Data Quality',          icon: '🔍', adminOnly: true },
]

// ─── Main Page ─────────────────────────────────────────────────

export function ReportsPage() {
  const { role } = useAuth()
  const isAdmin = role === 'admin'

  const [activeSection, setActiveSection] = useState<Section>('overview')
  const [range, setRange] = useState<DateRange>(rs.getMTDRange())

  const visibleNav = NAV_ITEMS.filter(n => !n.adminOnly || isAdmin)

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ color: '#f1f5f9', fontWeight: 800, fontSize: 22, margin: 0, letterSpacing: '-0.02em' }}>Reports</h1>
          <p style={{ color: '#475569', fontSize: 13, marginTop: 4, marginBottom: 0 }}>Zenith Pure Solutions · Indianapolis, IN</p>
        </div>
        <DateRangeBar range={range} onChange={setRange} />
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>

        {/* Left nav */}
        <div style={{ width: 200, flexShrink: 0, position: 'sticky', top: 0 }}>
          <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 12, overflow: 'hidden', padding: '8px 0' }}>
            {visibleNav.map(item => {
              const active = activeSection === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', border: 'none', cursor: 'pointer',
                    background: active ? 'rgba(13,126,163,0.12)' : 'transparent',
                    borderLeft: `3px solid ${active ? '#0d7ea3' : 'transparent'}`,
                    transition: 'all 0.12s',
                    textAlign: 'left',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)' }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{item.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: active ? 700 : 500, color: active ? '#0d7ea3' : '#64748b', lineHeight: 1.3 }}>
                    {item.label}
                  </span>
                  {item.adminOnly && (
                    <span style={{ marginLeft: 'auto', fontSize: 9, color: '#334155', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Admin
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* P2 coming soon */}
          <div style={{ marginTop: 16, background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Coming in P2</div>
            {['Rep Performance', 'Quotes & Commercial', 'Customers & Rentals', 'Marketing Sources'].map(label => (
              <div key={label} style={{ fontSize: 11, color: '#1e3a4f', padding: '4px 0', fontWeight: 500 }}>{label}</div>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {activeSection === 'overview'  && <ExecutiveSection range={range} />}
          {activeSection === 'revenue'   && <RevenueSection   range={range} />}
          {activeSection === 'installs'  && <InstallationsSection range={range} />}
          {activeSection === 'pipeline'  && <PipelineSection  range={range} />}
          {activeSection === 'quality'   && isAdmin && <DataQualitySection />}
        </div>
      </div>
    </div>
  )
}
