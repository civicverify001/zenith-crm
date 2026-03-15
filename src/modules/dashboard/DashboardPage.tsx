import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

// ============================================================
// DATA HOOKS
// ============================================================

function useNewLeadsToday() {
  return useQuery({
    queryKey: ['dashboard', 'new_leads_today'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const { data, error } = await supabase.from('leads')
        .select('id, full_name, phone, source, created_at')
        .eq('stage', 'new_lead').gte('created_at', today + 'T00:00:00')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    refetchInterval: 30_000,
  })
}

function useOverdueLeadFollowUps() {
  return useQuery({
    queryKey: ['dashboard', 'overdue_lead_followups'],
    queryFn: async () => {
      const { data, error } = await supabase.from('leads')
        .select('id, full_name, phone, stage, followup_date, assigned_rep_id')
        .eq('stage', 'future_follow_up').lt('followup_date', new Date().toISOString())
        .order('followup_date', { ascending: true })
      if (error) throw error
      return data || []
    },
    refetchInterval: 30_000,
  })
}

function useUncontactedLeads() {
  return useQuery({
    queryKey: ['dashboard', 'uncontacted_leads'],
    queryFn: async () => {
      const { data, error } = await supabase.from('leads')
        .select('id, full_name, phone, source, created_at, stage')
        .in('stage', ['new_lead', 'qualifying'])
        .order('created_at', { ascending: true }).limit(10)
      if (error) throw error
      return data || []
    },
    refetchInterval: 30_000,
  })
}

function useTodaysJobs() {
  return useQuery({
    queryKey: ['dashboard', 'todays_jobs'],
    queryFn: async () => {
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      // FIX: removed assigned_technician_name (column doesn't exist)
      const { data, error } = await supabase.from('jobs')
        .select('id, customer_name_snapshot, service_address_snapshot, system_type, status, scheduled_date, assigned_technician_id')
        .gte('scheduled_date', today + 'T00:00:00').lte('scheduled_date', today + 'T23:59:59')
        .order('status', { ascending: true })
      if (error) throw error
      return data || []
    },
    refetchInterval: 30_000,
  })
}

function useActiveLeadCounts() {
  return useQuery({
    queryKey: ['dashboard', 'lead_counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('leads').select('stage')
        .not('stage', 'in', '(won,lost,dnd)')
      if (error) throw error
      return (data || []).length
    },
    refetchInterval: 60_000,
  })
}

function useJobsThisWeek() {
  return useQuery({
    queryKey: ['dashboard', 'jobs_this_week'],
    queryFn: async () => {
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const start = new Date(now); start.setDate(now.getDate() - now.getDay())
      const end   = new Date(start); end.setDate(start.getDate() + 6)
      const s = `${start.getFullYear()}-${pad(start.getMonth()+1)}-${pad(start.getDate())}`
      const e = `${end.getFullYear()}-${pad(end.getMonth()+1)}-${pad(end.getDate())}T23:59:59`
      const { data, error } = await supabase.from('jobs')
        .select('id, status, scheduled_date').gte('scheduled_date', s).lte('scheduled_date', e)
      if (error) throw error
      return data || []
    },
    refetchInterval: 60_000,
  })
}

function useOverdueServices() {
  return useQuery({
    queryKey: ['dashboard', 'overdue_services'],
    queryFn: async () => {
      const { data, error } = await supabase.from('service_schedule_items')
        .select('id, customer_id, due_date, status').eq('status', 'overdue')
        .order('due_date', { ascending: true }).limit(10)
      if (error) throw error
      return data || []
    },
    refetchInterval: 60_000,
  })
}

function useRecentCustomers() {
  return useQuery({
    queryKey: ['dashboard', 'recent_customers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('customers')
        .select('id, full_name, lifecycle_status, created_at')
        .order('created_at', { ascending: false }).limit(5)
      if (error) throw error
      return data || []
    },
    refetchInterval: 60_000,
  })
}

function useFailedPayments() {
  return useQuery({
    queryKey: ['dashboard', 'failed_payments'],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase.from('payment_transactions')
        .select('id, amount, failure_reason, attempted_at, description, customer_id, customers!inner(full_name, phone)')
        .eq('status', 'failed').gte('attempted_at', cutoff)
        .order('amount', { ascending: false }).limit(10)
      if (error) throw error
      return data || []
    },
    refetchInterval: 30_000,
  })
}

function useMyUpcomingVisits(userId: string | undefined, isAdmin: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'my_upcoming_visits', userId],
    queryFn: async () => {
      if (!userId) return []
      const today = new Date().toISOString().split('T')[0]
      const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
      let q = supabase.from('site_visits')
        .select('id, lead_id, assigned_rep_id, visit_date, visit_hour, status')
        .gte('visit_date', today).lte('visit_date', nextWeek)
        .not('status', 'eq', 'cancelled')
        .order('visit_date', { ascending: true }).order('visit_hour', { ascending: true }).limit(10)
      if (!isAdmin) q = q.eq('assigned_rep_id', userId)
      const { data: visits, error } = await q
      if (error) throw error
      if (!visits?.length) return []
      const leadIds = [...new Set(visits.map((v: any) => v.lead_id).filter(Boolean))]
      const { data: leads } = await supabase.from('leads').select('id, full_name, phone').in('id', leadIds)
      const lm = Object.fromEntries((leads || []).map((l: any) => [l.id, l]))
      return visits.map((v: any) => ({ ...v, lead: lm[v.lead_id] || null })).filter((v: any) => v.lead)
    },
    enabled: !!userId, refetchInterval: 60_000,
  })
}

function useUpcomingRenewals() {
  return useQuery({
    queryKey: ['dashboard', 'upcoming_renewals'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const in30  = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
      const { data, error } = await supabase.from('contracts')
        .select('id, contract_number, status, end_date, monthly_amount, type, customer_id, customers!inner(full_name, phone)')
        .eq('status', 'active').gte('end_date', today).lte('end_date', in30)
        .order('end_date', { ascending: true }).limit(10)
      if (error) throw error
      return data || []
    },
    refetchInterval: 60_000,
  })
}

function usePendingProofReview() {
  return useQuery({
    queryKey: ['dashboard', 'pending_proof_review'],
    queryFn: async () => {
      // FIX: proof_approved doesn't exist — use handover_signed = false for complete jobs
      const { data, error } = await supabase.from('jobs')
        .select('id, customer_name_snapshot, service_address_snapshot, system_type, status, scheduled_date')
        .eq('status', 'complete').eq('handover_signed', false)
        .order('scheduled_date', { ascending: false }).limit(10)
      if (error) throw error
      return data || []
    },
    refetchInterval: 30_000,
  })
}

function useUnsignedAgreements() {
  return useQuery({
    queryKey: ['dashboard', 'unsigned_agreements'],
    queryFn: async () => {
      const { data, error } = await supabase.from('agreements')
        .select('id, agreement_number, created_at, lead_id, leads!inner(full_name, phone)')
        .eq('status', 'pending_signature')
        .order('created_at', { ascending: true }).limit(10)
      if (error) throw error
      return data || []
    },
    refetchInterval: 60_000,
  })
}

function useColdLeads() {
  return useQuery({
    queryKey: ['dashboard', 'cold_leads'],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 7 * 86400000).toISOString()
      const { data, error } = await supabase.from('leads')
        .select('id, full_name, phone, stage, updated_at')
        .not('stage', 'in', '(won,lost,dnd,agreement_signed)')
        .lt('updated_at', cutoff).order('updated_at', { ascending: true }).limit(10)
      if (error) throw error
      return data || []
    },
    refetchInterval: 60_000,
  })
}

function useUnassignedJobs() {
  return useQuery({
    queryKey: ['dashboard', 'unassigned_jobs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('jobs')
        .select('id, customer_name_snapshot, scheduled_date, system_type, status')
        .in('status', ['scheduled', 'in_progress'])
        .is('assigned_technician_id', null)
        .order('scheduled_date', { ascending: true }).limit(10)
      if (error) throw error
      return data || []
    },
    refetchInterval: 60_000,
  })
}

function useExpiringQuotes() {
  return useQuery({
    queryKey: ['dashboard', 'expiring_quotes'],
    queryFn: async () => {
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const t  = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
      const i7 = new Date(Date.now() + 7 * 86400000)
      const i7s = `${i7.getFullYear()}-${pad(i7.getMonth()+1)}-${pad(i7.getDate())}T23:59:59`
      // FIX: one_time_amount doesn't exist — use total instead
      const { data, error } = await supabase.from('quotes')
        .select('id, quote_number, valid_until, monthly_amount, total, customer_id, customers!inner(full_name)')
        .in('status', ['sent', 'viewed']).gte('valid_until', t).lte('valid_until', i7s)
        .order('valid_until', { ascending: true }).limit(10)
      if (error) throw error
      return data || []
    },
    refetchInterval: 60_000,
  })
}

function useLowInventoryAlerts() {
  return useQuery({
    queryKey: ['dashboard', 'low_inventory'],
    queryFn: async () => {
      // FIX: qty_on_hand → quantity_on_hand; name comes from products join via product_id
      const { data, error } = await supabase.from('inventory_items')
        .select('id, sku, quantity_on_hand, reorder_point, product_id, products(name)')
        .not('reorder_point', 'is', null)
        .order('quantity_on_hand', { ascending: true }).limit(10)
      if (error) throw error
      return (data || []).filter((i: any) => i.quantity_on_hand <= i.reorder_point)
    },
    refetchInterval: 120_000,
  })
}

function usePipelineFunnel() {
  return useQuery({
    queryKey: ['dashboard', 'pipeline_funnel'],
    queryFn: async () => {
      const { data, error } = await supabase.from('leads')
        .select('stage').not('stage', 'in', '(lost,dnd)')
      if (error) throw error
      const counts: Record<string, number> = {}
      for (const row of (data || [])) {
        counts[row.stage] = (counts[row.stage] || 0) + 1
      }
      const stages = [
        { key: 'new_lead',             label: 'New Leads',  color: '#38bdf8' },
        { key: 'qualifying',           label: 'Qualifying', color: '#818cf8' },
        { key: 'site_visit_scheduled', label: 'Site Visit', color: '#22d3ee' },
        { key: 'proposal_in_progress', label: 'Proposal',   color: '#f59e0b' },
        { key: 'quote_sent',           label: 'Quote Sent', color: '#fb923c' },
        { key: 'agreement_signed',     label: 'Signed',     color: '#4ade80' },
        { key: 'won',                  label: 'Won',        color: '#34d399' },
      ]
      return stages.map(s => ({ ...s, count: counts[s.key] || 0 }))
    },
    refetchInterval: 120_000,
  })
}

function useWeekCalendarEvents(userId: string | undefined, role: string | null) {
  return useQuery({
    queryKey: ['dashboard', 'week_calendar', userId, role],
    queryFn: async () => {
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const sow = new Date(now); sow.setDate(now.getDate() - now.getDay())
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(sow); d.setDate(sow.getDate() + i)
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
      })
      const results: Record<string, { visits: any[]; jobs: any[] }> = {}
      for (const d of days) results[d] = { visits: [], jobs: [] }

      if (role === 'admin' || role === 'salesrep' || role === 'frontdesk') {
        let vq = supabase.from('site_visits')
          .select('id, lead_id, assigned_rep_id, visit_date, visit_hour, status')
          .gte('visit_date', days[0]).lte('visit_date', days[6]).not('status', 'eq', 'cancelled')
        if (role !== 'admin') vq = vq.eq('assigned_rep_id', userId)
        const { data: visits } = await vq
        const lids = [...new Set((visits || []).map((v: any) => v.lead_id).filter(Boolean))]
        let lm: Record<string, any> = {}
        if (lids.length) {
          const { data: leads } = await supabase.from('leads').select('id, full_name').in('id', lids)
          lm = Object.fromEntries((leads || []).map((l: any) => [l.id, l]))
        }
        for (const v of (visits || [])) {
          if (results[v.visit_date]) results[v.visit_date].visits.push({ ...v, lead: lm[v.lead_id] || null })
        }
      }
      if (role === 'admin' || role === 'technician') {
        const { data: jobs } = await supabase.from('jobs')
          .select('id, customer_name_snapshot, status, scheduled_date, system_type')
          .gte('scheduled_date', days[0]).lte('scheduled_date', days[6] + 'T23:59:59').not('status', 'eq', 'cancelled')
        for (const j of (jobs || [])) {
          const dk = j.scheduled_date.split('T')[0]
          if (results[dk]) results[dk].jobs.push(j)
        }
      }
      return { days, events: results }
    },
    enabled: !!userId, refetchInterval: 60_000,
  })
}

// ============================================================
// HELPERS
// ============================================================

const pad = (n: number) => String(n).padStart(2, '0')

function localDateStr(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`
}

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function daysOverdue(d: string) { return Math.floor((Date.now() - new Date(d).getTime()) / 86400000) }
function daysUntil(d: string)   { return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) }

function fmt(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtHour(h: number) {
  if (h === 0)  return '12:00 AM'
  if (h < 12)  return `${h}:00 AM`
  if (h === 12) return '12:00 PM'
  return `${h-12}:00 PM`
}

function isToday(d: string)    { return d === localDateStr() }
function isTomorrow(d: string) { return d === localDateStr(new Date(Date.now() + 86400000)) }
function dayLabel(d: string)   { return isToday(d) ? 'Today' : isTomorrow(d) ? 'Tomorrow' : fmt(d) }

const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const JOB_COLOR: Record<string, string> = {
  scheduled:'#60a5fa', in_progress:'#22d3ee', complete:'#4ade80', cancelled:'#64748b',
}

// ============================================================
// PIPELINE FUNNEL CHART
// ============================================================

function PipelineFunnel() {
  const { data: stages = [] } = usePipelineFunnel()
  const navigate = useNavigate()
  const max = Math.max(...stages.map(s => s.count), 1)
  const total = stages.reduce((a, s) => a + s.count, 0)

  return (
    <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'linear-gradient(135deg,#162232 0%,#0d1a26 100%)', borderBottom: '1px solid #1e3a4f' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>⬡</div>
          <div>
            <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13 }}>Pipeline Funnel</div>
            <div style={{ color: '#475569', fontSize: 11, marginTop: 1 }}>{total} active leads across all stages</div>
          </div>
        </div>
        <button onClick={() => navigate('/leads')} style={{ fontSize: 11, color: '#0d7ea3', background: 'rgba(13,126,163,0.1)', border: '1px solid rgba(13,126,163,0.25)', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 600 }}>
          View Pipeline →
        </button>
      </div>
      <div style={{ padding: '18px 18px 14px' }}>
        {stages.map((stage, i) => {
          const pct = max > 0 ? (stage.count / max) * 100 : 0
          return (
            <div key={stage.key} style={{ marginBottom: i < stages.length - 1 ? 10 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500, minWidth: 110 }}>{stage.label}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: stage.count > 0 ? stage.color : '#334155', minWidth: 28, textAlign: 'right' }}>{stage.count}</span>
              </div>
              <div style={{ height: 8, background: '#0d1a26', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 4, width: `${pct}%`,
                  background: stage.count > 0 ? `linear-gradient(90deg, ${stage.color}cc, ${stage.color})` : 'transparent',
                  transition: 'width 0.6s ease',
                  boxShadow: stage.count > 0 ? `0 0 8px ${stage.color}50` : 'none',
                }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================
// WEEKLY JOBS BAR CHART
// ============================================================

function WeeklyJobsChart({ jobsThisWeek }: { jobsThisWeek: any[] }) {
  const now = new Date()
  const sow = new Date(now); sow.setDate(now.getDate() - now.getDay())

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sow); d.setDate(sow.getDate() + i)
    return localDateStr(d)
  })

  const byDay = days.map(day => {
    const jobs = jobsThisWeek.filter((j: any) => j.scheduled_date?.split('T')[0] === day)
    return {
      day, label: DAY_LABELS[new Date(day + 'T00:00:00').getDay()],
      total: jobs.length,
      scheduled:   jobs.filter((j: any) => j.status === 'scheduled').length,
      in_progress: jobs.filter((j: any) => j.status === 'in_progress').length,
      complete:    jobs.filter((j: any) => j.status === 'complete').length,
    }
  })

  const maxCount = Math.max(...byDay.map(d => d.total), 1)
  const chartH = 80

  return (
    <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'linear-gradient(135deg,#162232 0%,#0d1a26 100%)', borderBottom: '1px solid #1e3a4f' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(167,139,250,0.2)', border: '1px solid rgba(167,139,250,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>📊</div>
          <div>
            <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13 }}>Jobs This Week</div>
            <div style={{ color: '#475569', fontSize: 11, marginTop: 1 }}>{jobsThisWeek.length} total · {jobsThisWeek.filter((j: any) => j.status === 'complete').length} completed</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {[['#60a5fa','Scheduled'],['#22d3ee','In Progress'],['#4ade80','Complete']].map(([c,l]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: 'inline-block' }} />
              <span style={{ fontSize: 10, color: '#475569' }}>{l}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: '20px 18px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: chartH + 24 }}>
          {byDay.map(d => {
            const todayFlag = isToday(d.day)
            const barH = d.total > 0 ? Math.max((d.total / maxCount) * chartH, 8) : 0
            const pctS  = d.total > 0 ? (d.scheduled   / d.total) * 100 : 0
            const pctIP = d.total > 0 ? (d.in_progress / d.total) * 100 : 0
            const pctC  = d.total > 0 ? (d.complete    / d.total) * 100 : 0
            return (
              <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: d.total > 0 ? '#94a3b8' : '#1e3a4f', height: 16 }}>
                  {d.total > 0 ? d.total : ''}
                </div>
                <div style={{ width: '100%', height: chartH, display: 'flex', alignItems: 'flex-end' }}>
                  {d.total > 0 ? (
                    <div style={{ width: '100%', height: barH, borderRadius: '4px 4px 2px 2px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                      {pctC  > 0 && <div style={{ flex: pctC,  background: '#4ade80', minHeight: 2 }} />}
                      {pctIP > 0 && <div style={{ flex: pctIP, background: '#22d3ee', minHeight: 2 }} />}
                      {pctS  > 0 && <div style={{ flex: pctS,  background: '#60a5fa', minHeight: 2 }} />}
                    </div>
                  ) : (
                    <div style={{ width: '100%', height: 3, borderRadius: 2, background: '#0d1a26' }} />
                  )}
                </div>
                <div style={{ fontSize: 10, fontWeight: todayFlag ? 800 : 600, color: todayFlag ? '#0d7ea3' : '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {d.label}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// WEEK CALENDAR
// ============================================================

function WeekCalendar({ userId, role }: { userId: string | undefined; role: string | null }) {
  const navigate = useNavigate()
  const { data } = useWeekCalendarEvents(userId, role)
  const [sel, setSel] = useState<string | null>(null)
  if (!data) return null
  const { days, events } = data
  const showV = role === 'admin' || role === 'salesrep' || role === 'frontdesk'
  const showJ = role === 'admin' || role === 'technician'
  const selE  = sel ? events[sel] : null

  return (
    <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'linear-gradient(135deg,#162232 0%,#0d1a26 100%)', borderBottom: '1px solid #1e3a4f' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(13,126,163,0.2)', border: '1px solid rgba(13,126,163,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>📆</div>
          <div>
            <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13 }}>
              {role === 'technician' ? 'My Install Schedule' : role === 'salesrep' ? 'My Visit Schedule' : 'This Week'}
            </div>
            <div style={{ color: '#475569', fontSize: 11, marginTop: 1 }}>
              {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 14 }}>
          {showV && <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22d3ee', display: 'inline-block' }} /><span style={{ fontSize: 11, color: '#475569' }}>Site Visits</span></div>}
          {showJ && <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fb923c', display: 'inline-block' }} /><span style={{ fontSize: 11, color: '#475569' }}>Installs</span></div>}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {days.map((day, i) => {
          const visits = events[day]?.visits || [], jobs = events[day]?.jobs || []
          const total = (showV ? visits.length : 0) + (showJ ? jobs.length : 0)
          const tf = isToday(day), isS = sel === day
          return (
            <button key={day} onClick={() => setSel(isS ? null : day)} style={{
              padding: '12px 4px 10px',
              borderRight: i < 6 ? '1px solid #1e3a4f' : 'none',
              borderBottom: isS ? '2px solid #0d7ea3' : '1px solid #0d1a26',
              background: isS ? 'rgba(13,126,163,0.12)' : tf ? 'rgba(255,255,255,0.02)' : 'transparent',
              cursor: 'pointer', textAlign: 'center',
            }}>
              <div style={{ fontSize: 9, color: '#334155', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>
                {DAY_LABELS[new Date(day + 'T00:00:00').getDay()]}
              </div>
              <div style={{ width: 30, height: 30, borderRadius: '50%', margin: '0 auto 7px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: tf ? '#0d7ea3' : 'transparent', color: tf ? '#fff' : '#94a3b8', fontWeight: tf ? 800 : 500, fontSize: 14, boxShadow: tf ? '0 0 12px rgba(13,126,163,0.4)' : 'none' }}>
                {new Date(day + 'T00:00:00').getDate()}
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 3, minHeight: 7 }}>
                {showV && visits.length > 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22d3ee', display: 'inline-block' }} />}
                {showJ && jobs.length   > 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fb923c', display: 'inline-block' }} />}
              </div>
              {total > 0 && <div style={{ fontSize: 10, color: '#475569', marginTop: 3, fontWeight: 600 }}>{total}</div>}
            </button>
          )
        })}
      </div>
      {sel && selE ? (
        <div style={{ padding: '14px 18px', borderTop: '1px solid #1e3a4f', background: 'rgba(13,126,163,0.04)' }}>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            {isToday(sel) ? 'Today' : isTomorrow(sel) ? 'Tomorrow' : fmt(sel)} · {(showV ? selE.visits.length : 0) + (showJ ? selE.jobs.length : 0)} event(s)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {showV && selE.visits.map((v: any) => (
              <div key={v.id} onClick={() => navigate(`/leads?lead=${v.lead_id}`)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.15)', cursor: 'pointer' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22d3ee', flexShrink: 0 }} />
                <div><div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{v.lead?.full_name || 'Unknown'}</div><div style={{ color: '#64748b', fontSize: 11 }}>{fmtHour(v.visit_hour)} · Site Visit</div></div>
              </div>
            ))}
            {showJ && selE.jobs.map((j: any) => (
              <div key={j.id} onClick={() => navigate(`/installations/${j.id}`)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, background: 'rgba(251,146,60,0.06)', border: '1px solid rgba(251,146,60,0.15)', cursor: 'pointer' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fb923c', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.customer_name_snapshot}</div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>{j.system_type || 'Install'} · <span style={{ color: JOB_COLOR[j.status] || '#64748b' }}>{j.status}</span></div>
                </div>
              </div>
            ))}
            {(showV ? selE.visits.length : 0) + (showJ ? selE.jobs.length : 0) === 0 && (
              <div style={{ color: '#1e3a4f', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>Nothing scheduled</div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ padding: '10px 18px', color: '#1e293b', fontSize: 12, textAlign: 'center' }}>Tap a day to see details</div>
      )}
    </div>
  )
}

// ============================================================
// MAIN PAGE
// ============================================================

export function DashboardPage() {
  const { profile, role } = useAuth()
  const navigate = useNavigate()

  const isAdmin        = role === 'admin'
  const isSalesOrAdmin = role === 'admin' || role === 'salesrep' || role === 'frontdesk'
  const isTechOrAdmin  = role === 'admin' || role === 'technician'

  const { data: newLeadsToday = [] }      = useNewLeadsToday()
  const { data: overdueFollowUps = [] }   = useOverdueLeadFollowUps()
  const { data: uncontactedLeads = [] }   = useUncontactedLeads()
  const { data: todaysJobs = [] }         = useTodaysJobs()
  const { data: activeLeadCount = 0 }    = useActiveLeadCounts()
  const { data: jobsThisWeek = [] }       = useJobsThisWeek()
  const { data: overdueServices = [] }    = useOverdueServices()
  const { data: recentCustomers = [] }    = useRecentCustomers()
  const { data: failedPayments = [] }     = useFailedPayments()
  const { data: upcomingVisits = [] }     = useMyUpcomingVisits(profile?.id, isAdmin)
  const { data: upcomingRenewals = [] }   = useUpcomingRenewals()
  const { data: pendingProof = [] }       = usePendingProofReview()
  const { data: unsignedAgreements = [] } = useUnsignedAgreements()
  const { data: coldLeads = [] }          = useColdLeads()
  const { data: unassignedJobs = [] }     = useUnassignedJobs()
  const { data: expiringQuotes = [] }     = useExpiringQuotes()
  const { data: lowInventory = [] }       = useLowInventoryAlerts()

  const hour = new Date().getHours()
  const greeting = profile
    ? `Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, ${profile.full_name.split(' ')[0]}.`
    : 'Welcome.'

  const completedThisWeek = jobsThisWeek.filter((j: any) => j.status === 'complete').length
  const scheduledToday    = todaysJobs.filter((j: any) => j.status === 'scheduled').length
  const inProgressToday   = todaysJobs.filter((j: any) => j.status === 'in_progress').length
  const urgentCount = overdueFollowUps.length + overdueServices.length + failedPayments.length + pendingProof.length + unsignedAgreements.length + unassignedJobs.length

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ color: '#f1f5f9', fontWeight: 800, fontSize: 24, margin: 0, letterSpacing: '-0.02em' }}>{greeting}</h1>
          <p style={{ color: '#475569', fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        {urgentCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
            {urgentCount} item{urgentCount !== 1 ? 's' : ''} need attention
          </div>
        )}
      </div>

      {/* ── KPI Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KPICard
          label="Active Leads" value={String(activeLeadCount)}
          sub={newLeadsToday.length > 0 ? `+${newLeadsToday.length} new today` : 'No new today'}
          icon="⬡" bg="linear-gradient(135deg, #0c2a4a 0%, #0f3460 100%)" border="#1d4ed8" accent="#38bdf8"
          onClick={() => navigate('/leads')}
        />
        <KPICard
          label="Today's Installs" value={String(todaysJobs.length)}
          sub={inProgressToday > 0 ? `${inProgressToday} in progress` : scheduledToday > 0 ? `${scheduledToday} scheduled` : 'None today'}
          icon="🔧" bg="linear-gradient(135deg, #2d1a00 0%, #3d2200 100%)" border="#92400e" accent="#f59e0b"
          onClick={() => navigate('/installations')}
        />
        <KPICard
          label="Jobs This Week" value={String(jobsThisWeek.length)}
          sub={`${completedThisWeek} completed`}
          icon="📅" bg="linear-gradient(135deg, #1e1040 0%, #251355 100%)" border="#6d28d9" accent="#a78bfa"
          onClick={() => navigate('/dispatch')}
        />
        <KPICard
          label="Failed Payments" value={String(failedPayments.length)}
          sub={failedPayments.length > 0 ? 'Needs immediate action' : 'All clear'}
          icon="💳"
          bg={failedPayments.length > 0 ? 'linear-gradient(135deg, #3b0a0a 0%, #450c0c 100%)' : 'linear-gradient(135deg, #0a2010 0%, #0c2a14 100%)'}
          border={failedPayments.length > 0 ? '#7f1d1d' : '#b91c1c'}
          accent={failedPayments.length > 0 ? '#ef4444' : '#4ade80'}
          urgent={failedPayments.length > 0}
          onClick={() => navigate('/customers')}
        />
      </div>

      {/* ── Charts Row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <WeeklyJobsChart jobsThisWeek={jobsThisWeek} />
        <PipelineFunnel />
      </div>

      {/* ── Week Calendar ── */}
      <WeekCalendar userId={profile?.id} role={role} />

      {/* ── Action Cards Grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>

        {isAdmin && failedPayments.length > 0 && (
          <ActionCard title="Failed Payments" icon="💳" count={failedPayments.length} accent="#ef4444" urgent onClick={() => navigate('/customers')}>
            {failedPayments.slice(0, 5).map((tx: any) => (
              <Row key={tx.id} onClick={() => navigate(`/customers/${tx.customer_id}`)}>
                <RowLeft primary={tx.customers?.full_name || 'Unknown'} secondary={`${tx.failure_reason || 'Payment failed'} · ${timeAgo(tx.attempted_at)}`} />
                <RowRight><span style={{ fontSize: 13, fontWeight: 800, color: '#f87171' }}>${Number(tx.amount).toFixed(2)}</span></RowRight>
              </Row>
            ))}
            <MoreLink count={failedPayments.length} limit={5} onClick={() => navigate('/customers')} />
          </ActionCard>
        )}

        {isTechOrAdmin && pendingProof.length > 0 && (
          <ActionCard title="Pending Proof Review" icon="📸" count={pendingProof.length} accent="#fbbf24" urgent onClick={() => navigate('/installations')}>
            {pendingProof.slice(0, 5).map((job: any) => (
              <Row key={job.id} onClick={() => navigate(`/installations/${job.id}`)}>
                <RowLeft primary={job.customer_name_snapshot} secondary={job.service_address_snapshot} />
                <RowRight><Pill label="Review" color="#fbbf24" /></RowRight>
              </Row>
            ))}
            <MoreLink count={pendingProof.length} limit={5} onClick={() => navigate('/installations')} />
          </ActionCard>
        )}

        {isAdmin && (
          <ActionCard title="Unsigned Agreements" icon="✍️" count={unsignedAgreements.length} accent="#f87171" urgent={unsignedAgreements.length > 0} onClick={() => navigate('/leads')}>
            {unsignedAgreements.slice(0, 5).map((a: any) => (
              <Row key={a.id} onClick={() => navigate(`/leads?lead=${a.lead_id}`)}>
                <RowLeft primary={a.leads?.full_name || 'Unknown'} secondary={`${a.agreement_number} · ${timeAgo(a.created_at)}`} />
                <RowRight><Pill label="Awaiting" color="#f87171" /></RowRight>
              </Row>
            ))}
            {unsignedAgreements.length === 0 && <EmptyRow text="No pending signatures" />}
            <MoreLink count={unsignedAgreements.length} limit={5} onClick={() => navigate('/leads')} />
          </ActionCard>
        )}

        {isAdmin && (
          <ActionCard title="Unassigned Jobs" icon="⚠️" count={unassignedJobs.length} accent="#fb923c" urgent={unassignedJobs.length > 0} onClick={() => navigate('/dispatch')}>
            {unassignedJobs.slice(0, 5).map((job: any) => (
              <Row key={job.id} onClick={() => navigate('/dispatch')}>
                <RowLeft primary={job.customer_name_snapshot} secondary={`${job.scheduled_date ? fmt(job.scheduled_date.split('T')[0]) : 'No date'} · ${job.system_type || 'Install'}`} />
                <RowRight><Pill label="Unassigned" color="#fb923c" /></RowRight>
              </Row>
            ))}
            {unassignedJobs.length === 0 && <EmptyRow text="All jobs assigned" />}
            <MoreLink count={unassignedJobs.length} limit={5} onClick={() => navigate('/dispatch')} />
          </ActionCard>
        )}

        {isSalesOrAdmin && (
          <ActionCard title="Quotes Expiring Soon" icon="⏰" count={expiringQuotes.length} accent="#fbbf24" urgent={expiringQuotes.length > 0} onClick={() => navigate('/quotes')}>
            {expiringQuotes.slice(0, 5).map((q: any) => {
              const dl = daysUntil(q.valid_until)
              return (
                <Row key={q.id} onClick={() => navigate('/quotes')}>
                  <RowLeft primary={q.customers?.full_name || 'Unknown'} secondary={`${q.quote_number} · ${q.monthly_amount ? `$${Number(q.monthly_amount).toFixed(2)}/mo` : q.total ? `$${Number(q.total).toFixed(2)}` : ''}`} />
                  <RowRight>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: dl <= 2 ? '#f87171' : '#fbbf24' }}>{dl === 0 ? 'Today' : `${dl}d`}</div>
                      <div style={{ fontSize: 10, color: '#475569' }}>{fmt(q.valid_until)}</div>
                    </div>
                  </RowRight>
                </Row>
              )
            })}
            {expiringQuotes.length === 0 && <EmptyRow text="No quotes expiring this week" />}
            <MoreLink count={expiringQuotes.length} limit={5} onClick={() => navigate('/quotes')} />
          </ActionCard>
        )}

        {isAdmin && (
          <ActionCard title="Upcoming Renewals" icon="↻" count={upcomingRenewals.length} accent="#818cf8" onClick={() => navigate('/customers')}>
            {upcomingRenewals.slice(0, 5).map((c: any) => (
              <Row key={c.id} onClick={() => navigate(`/customers/${c.customer_id}`)}>
                <RowLeft primary={c.customers?.full_name} secondary={`${c.contract_number} · $${Number(c.monthly_amount || 0).toFixed(2)}/mo`} />
                <RowRight>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: daysUntil(c.end_date) <= 7 ? '#f87171' : '#fbbf24' }}>{daysUntil(c.end_date)}d</div>
                    <div style={{ fontSize: 10, color: '#475569' }}>{fmt(c.end_date)}</div>
                  </div>
                </RowRight>
              </Row>
            ))}
            {upcomingRenewals.length === 0 && <EmptyRow text="No renewals in next 30 days" />}
            <MoreLink count={upcomingRenewals.length} limit={5} onClick={() => navigate('/customers')} />
          </ActionCard>
        )}

        {isSalesOrAdmin && (
          <ActionCard title={isAdmin ? 'Upcoming Site Visits' : 'My Upcoming Visits'} icon="📍" count={upcomingVisits.length} accent="#22d3ee" onClick={() => navigate('/leads')}>
            {upcomingVisits.slice(0, 6).map((v: any) => (
              <Row key={v.id} onClick={() => navigate(`/leads?lead=${v.lead_id}`)}>
                <RowLeft primary={v.lead?.full_name || 'Unknown'} secondary={v.lead?.phone || ''} />
                <RowRight>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: isToday(v.visit_date) ? '#34d399' : '#94a3b8' }}>{dayLabel(v.visit_date)}</div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{fmtHour(v.visit_hour)}</div>
                  </div>
                </RowRight>
              </Row>
            ))}
            {upcomingVisits.length === 0 && <EmptyRow text="No site visits this week" />}
            <MoreLink count={upcomingVisits.length} limit={6} onClick={() => navigate('/leads')} />
          </ActionCard>
        )}

        {isSalesOrAdmin && (
          <ActionCard title="Overdue Follow-Ups" icon="🔥" count={overdueFollowUps.length} accent="#f87171" urgent={overdueFollowUps.length > 0} onClick={() => navigate('/leads')}>
            {overdueFollowUps.slice(0, 5).map((l: any) => (
              <Row key={l.id} onClick={() => navigate('/leads')}>
                <RowLeft primary={l.full_name} secondary={l.phone} />
                <RowRight><span style={{ fontSize: 11, fontWeight: 700, color: '#f87171' }}>{daysOverdue(l.followup_date)}d overdue</span></RowRight>
              </Row>
            ))}
            {overdueFollowUps.length === 0 && <EmptyRow text="No overdue follow-ups" />}
            <MoreLink count={overdueFollowUps.length} limit={5} onClick={() => navigate('/leads')} />
          </ActionCard>
        )}

        {isSalesOrAdmin && (
          <ActionCard title="Leads Going Cold" icon="🧊" count={coldLeads.length} accent="#94a3b8" onClick={() => navigate('/leads')}>
            {coldLeads.slice(0, 5).map((l: any) => (
              <Row key={l.id} onClick={() => navigate('/leads')}>
                <RowLeft primary={l.full_name} secondary={`${l.phone} · ${l.stage?.replace(/_/g, ' ')}`} />
                <RowRight><span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>{daysOverdue(l.updated_at)}d idle</span></RowRight>
              </Row>
            ))}
            {coldLeads.length === 0 && <EmptyRow text="No leads going cold" />}
            <MoreLink count={coldLeads.length} limit={5} onClick={() => navigate('/leads')} />
          </ActionCard>
        )}

        {isSalesOrAdmin && (
          <ActionCard title="Leads to Contact" icon="📞" count={uncontactedLeads.length} accent="#38bdf8" onClick={() => navigate('/leads')}>
            {uncontactedLeads.slice(0, 5).map((l: any) => (
              <Row key={l.id} onClick={() => navigate('/leads')}>
                <RowLeft primary={l.full_name} secondary={l.phone} />
                <RowRight><span style={{ fontSize: 11, color: '#475569' }}>{timeAgo(l.created_at)}</span></RowRight>
              </Row>
            ))}
            {uncontactedLeads.length === 0 && <EmptyRow text="No leads waiting" />}
            <MoreLink count={uncontactedLeads.length} limit={5} onClick={() => navigate('/leads')} />
          </ActionCard>
        )}

        <ActionCard title="Today's Installations" icon="🔧" count={todaysJobs.length} accent="#f59e0b" onClick={() => navigate('/installations')}>
          {todaysJobs.slice(0, 5).map((job: any) => (
            <Row key={job.id} onClick={() => navigate(`/installations/${job.id}`)}>
              <RowLeft primary={job.customer_name_snapshot} secondary={job.service_address_snapshot} />
              <RowRight>
                <span style={{ fontSize: 10, padding: '3px 9px', borderRadius: 20, fontWeight: 700, whiteSpace: 'nowrap', background: `${JOB_COLOR[job.status] || '#64748b'}18`, color: JOB_COLOR[job.status] || '#64748b', border: `1px solid ${JOB_COLOR[job.status] || '#64748b'}30` }}>
                  {job.status}
                </span>
              </RowRight>
            </Row>
          ))}
          {todaysJobs.length === 0 && <EmptyRow text="No installs today" />}
        </ActionCard>

        {isAdmin && (
          <ActionCard title="Low Inventory" icon="📦" count={lowInventory.length} accent="#2dd4bf" urgent={lowInventory.length > 0} onClick={() => navigate('/inventory')}>
            {lowInventory.slice(0, 5).map((item: any) => (
              <Row key={item.id} onClick={() => navigate('/inventory')}>
                <RowLeft
                  primary={(item.products as any)?.name || item.sku || 'Unknown item'}
                  secondary={`${item.sku || 'No SKU'} · reorder at ${item.reorder_point}`}
                />
                <RowRight>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: item.quantity_on_hand === 0 ? '#f87171' : '#fbbf24', lineHeight: 1 }}>{item.quantity_on_hand}</div>
                    <div style={{ fontSize: 10, color: '#475569' }}>in stock</div>
                  </div>
                </RowRight>
              </Row>
            ))}
            {lowInventory.length === 0 && <EmptyRow text="All stock levels OK" />}
            <MoreLink count={lowInventory.length} limit={5} onClick={() => navigate('/inventory')} />
          </ActionCard>
        )}

        {isAdmin && (
          <ActionCard title="Recent Customers" icon="👥" count={recentCustomers.length} accent="#4ade80" onClick={() => navigate('/customers')}>
            {recentCustomers.map((c: any) => {
              const sc = c.lifecycle_status === 'active' ? '#4ade80' : c.lifecycle_status === 'at_risk' ? '#f87171' : '#94a3b8'
              return (
                <Row key={c.id} onClick={() => navigate(`/customers/${c.id}`)}>
                  <RowLeft primary={c.full_name} secondary={timeAgo(c.created_at)} />
                  <RowRight><Pill label={c.lifecycle_status || 'unknown'} color={sc} /></RowRight>
                </Row>
              )
            })}
          </ActionCard>
        )}

        {isAdmin && overdueServices.length > 0 && (
          <ActionCard title="Overdue Service Items" icon="⚠️" count={overdueServices.length} accent="#ef4444" urgent onClick={() => navigate('/customers')}>
            {overdueServices.slice(0, 5).map((svc: any) => (
              <Row key={svc.id} onClick={() => svc.customer_id ? navigate(`/customers/${svc.customer_id}`) : undefined}>
                <RowLeft primary={`Service due ${fmt(svc.due_date)}`} secondary={`Customer: ${svc.customer_id?.slice(0, 8)}...`} />
                <RowRight><span style={{ fontSize: 11, fontWeight: 700, color: '#f87171' }}>{daysOverdue(svc.due_date)}d overdue</span></RowRight>
              </Row>
            ))}
          </ActionCard>
        )}

      </div>

      {/* Quick Actions */}
      {isSalesOrAdmin && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[
            { label: '+ New Lead', path: '/leads' },
            { label: 'View Pipeline', path: '/leads' },
            { label: 'Dispatch Board', path: '/dispatch' },
            { label: 'All Customers', path: '/customers' },
            ...(isAdmin ? [{ label: 'Product Catalog', path: '/products' }] : []),
          ].map(a => (
            <button key={a.label} onClick={() => navigate(a.path)}
              style={{ fontSize: 12, padding: '8px 16px', borderRadius: 8, cursor: 'pointer', background: '#0f1923', border: '1px solid #1e3a4f', color: '#64748b', fontWeight: 500 }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = '#0d7ea3'; el.style.color = '#e2e8f0' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = '#1e3a4f'; el.style.color = '#64748b' }}
            >{a.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// REUSABLE COMPONENTS
// ============================================================

function KPICard({ label, value, sub, icon, bg, border, accent, urgent, onClick }: {
  label: string; value: string; sub: string; icon: string
  bg: string; border: string; accent: string; urgent?: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick} style={{
      background: bg, border: `1px solid ${border}`, borderRadius: 14, padding: '20px 20px 18px',
      textAlign: 'left', cursor: 'pointer', width: '100%', position: 'relative', overflow: 'hidden',
      boxShadow: urgent ? `0 0 20px ${accent}20` : 'none',
    }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'translateY(-2px)'; el.style.boxShadow = `0 8px 24px ${accent}20` }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'translateY(0)'; el.style.boxShadow = urgent ? `0 0 20px ${accent}20` : 'none' }}
    >
      <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: `${accent}15`, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: 16, right: 16, fontSize: 22, opacity: 0.7 }}>{icon}</div>
      <div style={{ fontSize: 10, fontWeight: 700, color: `${accent}99`, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 12 }}>{label}</div>
      <div style={{ fontSize: 38, fontWeight: 900, color: accent, lineHeight: 1, letterSpacing: '-0.03em' }}>{value}</div>
      <div style={{ fontSize: 11, color: `${accent}70`, marginTop: 10, fontWeight: 500 }}>{sub}</div>
    </button>
  )
}

function ActionCard({ title, icon, count, accent, urgent, children, onClick }: {
  title: string; icon: string; count: number; accent: string
  urgent?: boolean; children: React.ReactNode; onClick: () => void
}) {
  return (
    <div style={{
      background: '#0f1923',
      border: `1px solid ${urgent && count > 0 ? `${accent}35` : '#1e3a4f'}`,
      borderLeft: `3px solid ${urgent && count > 0 ? accent : '#1e3a4f'}`,
      borderRadius: 12, overflow: 'hidden',
    }}>
      <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', background: 'linear-gradient(135deg,#162232 0%,#0d1a26 100%)', borderBottom: '1px solid #0d1a26', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: `${accent}12`, border: `1px solid ${accent}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>{icon}</div>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1' }}>{title}</span>
        </div>
        <span style={{ minWidth: 26, height: 22, borderRadius: 20, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, background: count === 0 ? '#1e293b' : `${accent}18`, color: count === 0 ? '#334155' : accent, border: `1px solid ${count === 0 ? '#1e3a4f' : `${accent}25`}` }}>
          {count}
        </span>
      </div>
      <div>{children}</div>
    </div>
  )
}

function Row({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 16px', cursor: 'pointer', borderBottom: '1px solid #0d1a26' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >{children}</div>
  )
}

function RowLeft({ primary, secondary }: { primary: string; secondary?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{primary}</div>
      {secondary && <div style={{ fontSize: 11, color: '#475569', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{secondary}</div>}
    </div>
  )
}

function RowRight({ children }: { children: React.ReactNode }) {
  return <div style={{ flexShrink: 0, marginLeft: 8 }}>{children}</div>
}

function Pill({ label, color }: { label: string; color: string }) {
  return <span style={{ fontSize: 10, padding: '3px 9px', borderRadius: 20, fontWeight: 700, whiteSpace: 'nowrap', background: `${color}12`, color, border: `1px solid ${color}25` }}>{label}</span>
}

function EmptyRow({ text }: { text: string }) {
  return <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: 12, color: '#1e3a4f' }}>{text}</div>
}

function MoreLink({ count, limit, onClick }: { count: number; limit: number; onClick: () => void }) {
  if (count <= limit) return null
  return (
    <button onClick={onClick} style={{ width: '100%', padding: '9px 16px', fontSize: 11, color: '#0d7ea3', background: 'rgba(13,126,163,0.05)', borderTop: '1px solid #0d1a26', cursor: 'pointer', textAlign: 'center', fontWeight: 600 }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(13,126,163,0.1)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(13,126,163,0.05)' }}
    >View all {count} →</button>
  )
}
