import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

// ============================================================
// DATA FETCHING HOOKS
// ============================================================

function useNewLeadsToday() {
  return useQuery({
    queryKey: ['dashboard', 'new_leads_today'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('leads')
        .select('id, full_name, phone, source, created_at')
        .eq('stage', 'new_lead')
        .gte('created_at', today + 'T00:00:00')
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
      const now = new Date().toISOString()
      const { data, error } = await supabase
        .from('leads')
        .select('id, full_name, phone, stage, followup_date, assigned_rep_id')
        .eq('stage', 'future_follow_up')
        .lt('followup_date', now)
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
      const { data, error } = await supabase
        .from('leads')
        .select('id, full_name, phone, source, created_at, stage')
        .in('stage', ['new_lead', 'qualifying'])
        .order('created_at', { ascending: true })
        .limit(10)
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
      const { data, error } = await supabase
        .from('jobs')
        .select('id, customer_name_snapshot, service_address_snapshot, system_type, status, scheduled_date, assigned_technician_name')
        .gte('scheduled_date', today + 'T00:00:00')
        .lte('scheduled_date', today + 'T23:59:59')
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
      const { data, error } = await supabase
        .from('leads')
        .select('stage')
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
      const startDate = new Date(now)
      startDate.setDate(now.getDate() - now.getDay())
      const endDate = new Date(startDate)
      endDate.setDate(startDate.getDate() + 6)
      const startStr = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}`
      const endStr   = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T23:59:59`
      const { data, error } = await supabase
        .from('jobs')
        .select('id, status, scheduled_date')
        .gte('scheduled_date', startStr)
        .lte('scheduled_date', endStr)
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
      const { data, error } = await supabase
        .from('service_schedule_items')
        .select('id, customer_id, due_date, status')
        .eq('status', 'overdue')
        .order('due_date', { ascending: true })
        .limit(10)
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
      const { data, error } = await supabase
        .from('customers')
        .select('id, full_name, lifecycle_status, created_at')
        .order('created_at', { ascending: false })
        .limit(5)
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
      const { data, error } = await supabase
        .from('payment_transactions')
        .select('id, amount, failure_reason, attempted_at, description, customer_id, customers!inner(full_name, phone)')
        .eq('status', 'failed')
        .gte('attempted_at', cutoff)
        .order('amount', { ascending: false })
        .limit(10)
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
      const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      let query = supabase
        .from('site_visits')
        .select('id, lead_id, assigned_rep_id, visit_date, visit_hour, status')
        .gte('visit_date', today).lte('visit_date', nextWeek)
        .not('status', 'eq', 'cancelled')
        .order('visit_date', { ascending: true })
        .order('visit_hour', { ascending: true })
        .limit(10)
      if (!isAdmin) query = query.eq('assigned_rep_id', userId)
      const { data: visits, error } = await query
      if (error) throw error
      if (!visits || visits.length === 0) return []
      const leadIds = [...new Set(visits.map((v: any) => v.lead_id).filter(Boolean))]
      const { data: leads } = await supabase.from('leads').select('id, full_name, phone').in('id', leadIds)
      const leadMap = Object.fromEntries((leads || []).map((l: any) => [l.id, l]))
      return visits.map((v: any) => ({ ...v, lead: leadMap[v.lead_id] || null })).filter((v: any) => v.lead !== null)
    },
    enabled: !!userId,
    refetchInterval: 60_000,
  })
}

function useUpcomingRenewals() {
  return useQuery({
    queryKey: ['dashboard', 'upcoming_renewals'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('contracts')
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
      const { data, error } = await supabase
        .from('jobs')
        .select('id, customer_name_snapshot, service_address_snapshot, system_type, status, scheduled_date, assigned_technician_name')
        .eq('status', 'complete').eq('proof_approved', false)
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
      const { data, error } = await supabase
        .from('agreements')
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
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase
        .from('leads')
        .select('id, full_name, phone, stage, updated_at, created_at')
        .not('stage', 'in', '(won,lost,dnd,agreement_signed)')
        .lt('updated_at', cutoff)
        .order('updated_at', { ascending: true }).limit(10)
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
      const { data, error } = await supabase
        .from('jobs')
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
      const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      const in7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      const in7Str = `${in7.getFullYear()}-${pad(in7.getMonth() + 1)}-${pad(in7.getDate())}`
      const { data, error } = await supabase
        .from('quotes')
        .select('id, quote_number, valid_until, monthly_amount, one_time_amount, customer_id, customers!inner(full_name)')
        .in('status', ['sent', 'viewed'])
        .gte('valid_until', todayStr).lte('valid_until', in7Str + 'T23:59:59')
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
      const { data, error } = await supabase
        .from('inventory_items')
        .select('id, name, sku, qty_on_hand, reorder_point, unit_cost')
        .not('reorder_point', 'is', null)
        .order('qty_on_hand', { ascending: true }).limit(10)
      if (error) throw error
      return (data || []).filter((item: any) => item.qty_on_hand <= item.reorder_point)
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
      const startOfWeek = new Date(now)
      startOfWeek.setDate(now.getDate() - now.getDay())
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(startOfWeek)
        d.setDate(startOfWeek.getDate() + i)
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      })
      const start = days[0], end = days[6]
      const results: Record<string, { visits: any[]; jobs: any[] }> = {}
      for (const d of days) results[d] = { visits: [], jobs: [] }

      if (role === 'admin' || role === 'salesrep' || role === 'frontdesk') {
        let vq = supabase.from('site_visits').select('id, lead_id, assigned_rep_id, visit_date, visit_hour, status')
          .gte('visit_date', start).lte('visit_date', end).not('status', 'eq', 'cancelled')
        if (role !== 'admin') vq = vq.eq('assigned_rep_id', userId)
        const { data: visits } = await vq
        const leadIds = [...new Set((visits || []).map((v: any) => v.lead_id).filter(Boolean))]
        let leadMap: Record<string, any> = {}
        if (leadIds.length) {
          const { data: leads } = await supabase.from('leads').select('id, full_name').in('id', leadIds)
          leadMap = Object.fromEntries((leads || []).map((l: any) => [l.id, l]))
        }
        for (const v of (visits || [])) {
          if (results[v.visit_date]) results[v.visit_date].visits.push({ ...v, lead: leadMap[v.lead_id] || null })
        }
      }

      if (role === 'admin' || role === 'technician') {
        const { data: jobs } = await supabase.from('jobs')
          .select('id, customer_name_snapshot, status, scheduled_date, assigned_technician_name, system_type')
          .gte('scheduled_date', start).lte('scheduled_date', end + 'T23:59:59').not('status', 'eq', 'cancelled')
        for (const j of (jobs || [])) {
          const dk = j.scheduled_date.split('T')[0]
          if (results[dk]) results[dk].jobs.push(j)
        }
      }
      return { days, events: results }
    },
    enabled: !!userId,
    refetchInterval: 60_000,
  })
}

// ============================================================
// HELPERS
// ============================================================

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function daysOverdue(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
}

function formatShortDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatHour(h: number): string {
  if (h === 0) return '12:00 AM'
  if (h < 12) return `${h}:00 AM`
  if (h === 12) return '12:00 PM'
  return `${h - 12}:00 PM`
}

function isToday(dateStr: string): boolean {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return dateStr === `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function isTomorrow(dateStr: string): boolean {
  const tom = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return dateStr === `${tom.getFullYear()}-${pad(tom.getMonth() + 1)}-${pad(tom.getDate())}`
}

function visitDayLabel(dateStr: string): string {
  if (isToday(dateStr)) return 'Today'
  if (isTomorrow(dateStr)) return 'Tomorrow'
  return formatShortDate(dateStr)
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const JOB_STATUS_COLOR: Record<string, string> = {
  scheduled: '#60a5fa', in_progress: '#22d3ee', complete: '#4ade80', cancelled: '#64748b',
}

// ============================================================
// WEEK CALENDAR
// ============================================================

function WeekCalendar({ userId, role }: { userId: string | undefined; role: string | null }) {
  const navigate = useNavigate()
  const { data } = useWeekCalendarEvents(userId, role)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  if (!data) return null
  const { days, events } = data
  const showVisits = role === 'admin' || role === 'salesrep' || role === 'frontdesk'
  const showJobs   = role === 'admin' || role === 'technician'
  const selectedEvents = selectedDay ? events[selectedDay] : null

  return (
    <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 18px', background: 'linear-gradient(135deg, #162232 0%, #0f1923 100%)',
        borderBottom: '1px solid #1e3a4f',
      }}>
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
          {showVisits && <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22d3ee', display: 'inline-block' }} /><span style={{ fontSize: 11, color: '#64748b' }}>Site Visits</span></div>}
          {showJobs   && <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fb923c', display: 'inline-block' }} /><span style={{ fontSize: 11, color: '#64748b' }}>Installs</span></div>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {days.map((day, i) => {
          const visits = events[day]?.visits || [], jobs = events[day]?.jobs || []
          const total = (showVisits ? visits.length : 0) + (showJobs ? jobs.length : 0)
          const todayFlag = isToday(day), isSelected = selectedDay === day
          return (
            <button key={day} onClick={() => setSelectedDay(isSelected ? null : day)} style={{
              padding: '12px 4px 10px',
              borderRight: i < 6 ? '1px solid #1e3a4f' : 'none',
              borderBottom: isSelected ? '2px solid #0d7ea3' : '1px solid #0d1a26',
              background: isSelected ? 'rgba(13,126,163,0.12)' : todayFlag ? 'rgba(255,255,255,0.02)' : 'transparent',
              cursor: 'pointer', textAlign: 'center', transition: 'background 0.15s',
            }}>
              <div style={{ fontSize: 9, color: '#334155', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>
                {DAY_LABELS[new Date(day + 'T00:00:00').getDay()]}
              </div>
              <div style={{
                width: 30, height: 30, borderRadius: '50%', margin: '0 auto 7px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: todayFlag ? '#0d7ea3' : 'transparent',
                color: todayFlag ? '#fff' : '#94a3b8',
                fontWeight: todayFlag ? 800 : 500, fontSize: 14,
                boxShadow: todayFlag ? '0 0 12px rgba(13,126,163,0.4)' : 'none',
              }}>
                {new Date(day + 'T00:00:00').getDate()}
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 3, minHeight: 7 }}>
                {showVisits && visits.length > 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22d3ee', display: 'inline-block' }} />}
                {showJobs   && jobs.length > 0   && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fb923c', display: 'inline-block' }} />}
              </div>
              {total > 0 && <div style={{ fontSize: 10, color: '#475569', marginTop: 3, fontWeight: 600 }}>{total}</div>}
            </button>
          )
        })}
      </div>

      {selectedDay && selectedEvents ? (
        <div style={{ padding: '14px 18px', borderTop: '1px solid #1e3a4f', background: 'rgba(13,126,163,0.04)' }}>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            {isToday(selectedDay) ? 'Today' : isTomorrow(selectedDay) ? 'Tomorrow' : formatShortDate(selectedDay)}
            &nbsp;·&nbsp;{(showVisits ? selectedEvents.visits.length : 0) + (showJobs ? selectedEvents.jobs.length : 0)} event(s)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {showVisits && selectedEvents.visits.map((v: any) => (
              <div key={v.id} onClick={() => navigate(`/leads?lead=${v.lead_id}`)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.15)', cursor: 'pointer' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22d3ee', flexShrink: 0 }} />
                <div><div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{v.lead?.full_name || 'Unknown lead'}</div><div style={{ color: '#64748b', fontSize: 11 }}>{formatHour(v.visit_hour)} · Site Visit</div></div>
              </div>
            ))}
            {showJobs && selectedEvents.jobs.map((j: any) => (
              <div key={j.id} onClick={() => navigate(`/installations/${j.id}`)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, background: 'rgba(251,146,60,0.06)', border: '1px solid rgba(251,146,60,0.15)', cursor: 'pointer' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fb923c', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.customer_name_snapshot}</div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>{j.system_type || 'Install'} · <span style={{ color: JOB_STATUS_COLOR[j.status] || '#64748b' }}>{j.status}</span></div>
                </div>
              </div>
            ))}
            {(showVisits ? selectedEvents.visits.length : 0) + (showJobs ? selectedEvents.jobs.length : 0) === 0 && (
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

  const greeting = profile
    ? `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${profile.full_name.split(' ')[0]}.`
    : 'Welcome.'

  const completedJobsThisWeek = jobsThisWeek.filter((j: any) => j.status === 'complete').length
  const scheduledToday        = todaysJobs.filter((j: any) => j.status === 'scheduled').length
  const inProgressToday       = todaysJobs.filter((j: any) => j.status === 'in_progress').length
  const urgentCount = overdueFollowUps.length + overdueServices.length + failedPayments.length + pendingProof.length + unsignedAgreements.length + unassignedJobs.length

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
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

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KPICard label="Active Leads" value={String(activeLeadCount)} sub={newLeadsToday.length > 0 ? `+${newLeadsToday.length} new today` : 'No new today'} icon="⬡" accentColor="#38bdf8" onClick={() => navigate('/leads')} />
        <KPICard label="Today's Installs" value={String(todaysJobs.length)} sub={inProgressToday > 0 ? `${inProgressToday} in progress` : scheduledToday > 0 ? `${scheduledToday} scheduled` : 'None today'} icon="🔧" accentColor="#f59e0b" onClick={() => navigate('/installations')} />
        <KPICard label="Jobs This Week" value={String(jobsThisWeek.length)} sub={`${completedJobsThisWeek} completed`} icon="📅" accentColor="#a78bfa" onClick={() => navigate('/dispatch')} />
        <KPICard label="Failed Payments" value={String(failedPayments.length)} sub={failedPayments.length > 0 ? 'Last 48 hours' : 'All clear'} icon="💳" accentColor={failedPayments.length > 0 ? '#f87171' : '#4ade80'} urgent={failedPayments.length > 0} onClick={() => navigate('/customers')} />
      </div>

      {/* Calendar */}
      <WeekCalendar userId={profile?.id} role={role} />

      {/* Action Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>

        {isAdmin && failedPayments.length > 0 && (
          <ActionCard title="Failed Payments" icon="💳" count={failedPayments.length} accentColor="#ef4444" urgent onClick={() => navigate('/customers')}>
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
          <ActionCard title="Pending Proof Review" icon="📸" count={pendingProof.length} accentColor="#fbbf24" urgent onClick={() => navigate('/installations')}>
            {pendingProof.slice(0, 5).map((job: any) => (
              <Row key={job.id} onClick={() => navigate(`/installations/${job.id}`)}>
                <RowLeft primary={job.customer_name_snapshot} secondary={job.service_address_snapshot} />
                <RowRight><StatusPill label="Review" color="#fbbf24" /></RowRight>
              </Row>
            ))}
            <MoreLink count={pendingProof.length} limit={5} onClick={() => navigate('/installations')} />
          </ActionCard>
        )}

        {isAdmin && (
          <ActionCard title="Unsigned Agreements" icon="✍️" count={unsignedAgreements.length} accentColor="#f87171" urgent={unsignedAgreements.length > 0} onClick={() => navigate('/leads')}>
            {unsignedAgreements.slice(0, 5).map((a: any) => (
              <Row key={a.id} onClick={() => navigate(`/leads?lead=${a.lead_id}`)}>
                <RowLeft primary={a.leads?.full_name || 'Unknown'} secondary={`${a.agreement_number} · sent ${timeAgo(a.created_at)}`} />
                <RowRight><StatusPill label="Awaiting" color="#f87171" /></RowRight>
              </Row>
            ))}
            {unsignedAgreements.length === 0 && <EmptyRow text="No pending signatures" />}
            <MoreLink count={unsignedAgreements.length} limit={5} onClick={() => navigate('/leads')} />
          </ActionCard>
        )}

        {isAdmin && (
          <ActionCard title="Unassigned Jobs" icon="⚠️" count={unassignedJobs.length} accentColor="#fb923c" urgent={unassignedJobs.length > 0} onClick={() => navigate('/dispatch')}>
            {unassignedJobs.slice(0, 5).map((job: any) => (
              <Row key={job.id} onClick={() => navigate('/dispatch')}>
                <RowLeft primary={job.customer_name_snapshot} secondary={`${job.scheduled_date ? formatShortDate(job.scheduled_date.split('T')[0]) : 'No date'} · ${job.system_type || 'Install'}`} />
                <RowRight><StatusPill label="Unassigned" color="#fb923c" /></RowRight>
              </Row>
            ))}
            {unassignedJobs.length === 0 && <EmptyRow text="All jobs assigned" />}
            <MoreLink count={unassignedJobs.length} limit={5} onClick={() => navigate('/dispatch')} />
          </ActionCard>
        )}

        {isSalesOrAdmin && (
          <ActionCard title="Quotes Expiring Soon" icon="⏰" count={expiringQuotes.length} accentColor="#fbbf24" urgent={expiringQuotes.length > 0} onClick={() => navigate('/quotes')}>
            {expiringQuotes.slice(0, 5).map((q: any) => {
              const dl = daysUntil(q.valid_until)
              return (
                <Row key={q.id} onClick={() => navigate('/quotes')}>
                  <RowLeft primary={q.customers?.full_name || 'Unknown'} secondary={`${q.quote_number} · ${q.monthly_amount ? `$${Number(q.monthly_amount).toFixed(2)}/mo` : q.one_time_amount ? `$${Number(q.one_time_amount).toFixed(2)}` : ''}`} />
                  <RowRight>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: dl <= 2 ? '#f87171' : '#fbbf24' }}>{dl === 0 ? 'Today' : `${dl}d`}</div>
                      <div style={{ fontSize: 10, color: '#475569' }}>{formatShortDate(q.valid_until)}</div>
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
          <ActionCard title="Upcoming Renewals" icon="↻" count={upcomingRenewals.length} accentColor="#818cf8" onClick={() => navigate('/customers')}>
            {upcomingRenewals.slice(0, 5).map((c: any) => (
              <Row key={c.id} onClick={() => navigate(`/customers/${c.customer_id}`)}>
                <RowLeft primary={c.customers?.full_name} secondary={`${c.contract_number} · $${Number(c.monthly_amount || 0).toFixed(2)}/mo`} />
                <RowRight>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: daysUntil(c.end_date) <= 7 ? '#f87171' : '#fbbf24' }}>{daysUntil(c.end_date)}d</div>
                    <div style={{ fontSize: 10, color: '#475569' }}>{formatShortDate(c.end_date)}</div>
                  </div>
                </RowRight>
              </Row>
            ))}
            {upcomingRenewals.length === 0 && <EmptyRow text="No renewals in next 30 days" />}
            <MoreLink count={upcomingRenewals.length} limit={5} onClick={() => navigate('/customers')} />
          </ActionCard>
        )}

        {isSalesOrAdmin && (
          <ActionCard title={isAdmin ? 'Upcoming Site Visits' : 'My Upcoming Visits'} icon="📍" count={upcomingVisits.length} accentColor="#22d3ee" onClick={() => navigate('/leads')}>
            {upcomingVisits.slice(0, 6).map((visit: any) => (
              <Row key={visit.id} onClick={() => navigate(`/leads?lead=${visit.lead_id}`)}>
                <RowLeft primary={visit.lead?.full_name || 'Unknown'} secondary={visit.lead?.phone || ''} />
                <RowRight>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: isToday(visit.visit_date) ? '#34d399' : '#94a3b8' }}>{visitDayLabel(visit.visit_date)}</div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{formatHour(visit.visit_hour)}</div>
                  </div>
                </RowRight>
              </Row>
            ))}
            {upcomingVisits.length === 0 && <EmptyRow text="No site visits this week" />}
            <MoreLink count={upcomingVisits.length} limit={6} onClick={() => navigate('/leads')} />
          </ActionCard>
        )}

        {isSalesOrAdmin && (
          <ActionCard title="Overdue Follow-Ups" icon="🔥" count={overdueFollowUps.length} accentColor="#f87171" urgent={overdueFollowUps.length > 0} onClick={() => navigate('/leads')}>
            {overdueFollowUps.slice(0, 5).map((lead: any) => (
              <Row key={lead.id} onClick={() => navigate('/leads')}>
                <RowLeft primary={lead.full_name} secondary={lead.phone} />
                <RowRight><span style={{ fontSize: 11, fontWeight: 700, color: '#f87171' }}>{daysOverdue(lead.followup_date)}d overdue</span></RowRight>
              </Row>
            ))}
            {overdueFollowUps.length === 0 && <EmptyRow text="No overdue follow-ups" />}
            <MoreLink count={overdueFollowUps.length} limit={5} onClick={() => navigate('/leads')} />
          </ActionCard>
        )}

        {isSalesOrAdmin && (
          <ActionCard title="Leads Going Cold" icon="🧊" count={coldLeads.length} accentColor="#94a3b8" onClick={() => navigate('/leads')}>
            {coldLeads.slice(0, 5).map((lead: any) => (
              <Row key={lead.id} onClick={() => navigate('/leads')}>
                <RowLeft primary={lead.full_name} secondary={`${lead.phone} · ${lead.stage?.replace(/_/g, ' ')}`} />
                <RowRight><span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>{daysOverdue(lead.updated_at)}d idle</span></RowRight>
              </Row>
            ))}
            {coldLeads.length === 0 && <EmptyRow text="No leads going cold" />}
            <MoreLink count={coldLeads.length} limit={5} onClick={() => navigate('/leads')} />
          </ActionCard>
        )}

        {isSalesOrAdmin && (
          <ActionCard title="Leads to Contact" icon="📞" count={uncontactedLeads.length} accentColor="#38bdf8" onClick={() => navigate('/leads')}>
            {uncontactedLeads.slice(0, 5).map((lead: any) => (
              <Row key={lead.id} onClick={() => navigate('/leads')}>
                <RowLeft primary={lead.full_name} secondary={lead.phone} />
                <RowRight><span style={{ fontSize: 11, color: '#475569' }}>{timeAgo(lead.created_at)}</span></RowRight>
              </Row>
            ))}
            {uncontactedLeads.length === 0 && <EmptyRow text="No leads waiting" />}
            <MoreLink count={uncontactedLeads.length} limit={5} onClick={() => navigate('/leads')} />
          </ActionCard>
        )}

        <ActionCard title="Today's Installations" icon="🔧" count={todaysJobs.length} accentColor="#f59e0b" onClick={() => navigate('/installations')}>
          {todaysJobs.slice(0, 5).map((job: any) => (
            <Row key={job.id} onClick={() => navigate(`/installations/${job.id}`)}>
              <RowLeft primary={job.customer_name_snapshot} secondary={job.service_address_snapshot} />
              <RowRight>
                <span style={{ fontSize: 10, padding: '3px 9px', borderRadius: 20, fontWeight: 700, background: `${JOB_STATUS_COLOR[job.status] || '#64748b'}18`, color: JOB_STATUS_COLOR[job.status] || '#64748b', border: `1px solid ${JOB_STATUS_COLOR[job.status] || '#64748b'}35`, whiteSpace: 'nowrap' }}>
                  {job.status}
                </span>
              </RowRight>
            </Row>
          ))}
          {todaysJobs.length === 0 && <EmptyRow text="No installs today" />}
        </ActionCard>

        {isAdmin && (
          <ActionCard title="Low Inventory" icon="📦" count={lowInventory.length} accentColor="#2dd4bf" urgent={lowInventory.length > 0} onClick={() => navigate('/inventory')}>
            {lowInventory.slice(0, 5).map((item: any) => (
              <Row key={item.id} onClick={() => navigate('/inventory')}>
                <RowLeft primary={item.name} secondary={`${item.sku || 'No SKU'} · reorder at ${item.reorder_point}`} />
                <RowRight>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: item.qty_on_hand === 0 ? '#f87171' : '#fbbf24', lineHeight: 1 }}>{item.qty_on_hand}</div>
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
          <ActionCard title="Recent Customers" icon="👥" count={recentCustomers.length} accentColor="#4ade80" onClick={() => navigate('/customers')}>
            {recentCustomers.map((cust: any) => {
              const sc = cust.lifecycle_status === 'active' ? '#4ade80' : cust.lifecycle_status === 'at_risk' ? '#f87171' : '#94a3b8'
              return (
                <Row key={cust.id} onClick={() => navigate(`/customers/${cust.id}`)}>
                  <RowLeft primary={cust.full_name} secondary={timeAgo(cust.created_at)} />
                  <RowRight><StatusPill label={cust.lifecycle_status || 'unknown'} color={sc} /></RowRight>
                </Row>
              )
            })}
          </ActionCard>
        )}

        {isAdmin && overdueServices.length > 0 && (
          <ActionCard title="Overdue Service Items" icon="⚠️" count={overdueServices.length} accentColor="#ef4444" urgent onClick={() => navigate('/customers')}>
            {overdueServices.slice(0, 5).map((svc: any) => (
              <Row key={svc.id} onClick={() => svc.customer_id ? navigate(`/customers/${svc.customer_id}`) : undefined}>
                <RowLeft primary={`Service due ${formatShortDate(svc.due_date)}`} secondary={`Customer: ${svc.customer_id?.slice(0, 8)}...`} />
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
          ].map(action => (
            <button key={action.label} onClick={() => navigate(action.path)} style={{ fontSize: 12, padding: '8px 16px', borderRadius: 8, cursor: 'pointer', background: '#0f1923', border: '1px solid #1e3a4f', color: '#64748b', fontWeight: 500, transition: 'all 0.12s' }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = '#0d7ea3'; el.style.color = '#e2e8f0' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = '#1e3a4f'; el.style.color = '#64748b' }}
            >{action.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// CARD COMPONENTS
// ============================================================

function KPICard({ label, value, sub, icon, accentColor, urgent, onClick }: {
  label: string; value: string; sub: string; icon: string
  accentColor: string; urgent?: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick} style={{
      background: '#0f1923',
      border: `1px solid ${urgent ? `${accentColor}45` : '#1e3a4f'}`,
      borderTop: `3px solid ${accentColor}`,
      borderRadius: 12, padding: '18px 18px 16px',
      textAlign: 'left', cursor: 'pointer', width: '100%',
      transition: 'all 0.15s', position: 'relative', overflow: 'hidden',
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#162232' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#0f1923' }}
    >
      <div style={{ position: 'absolute', top: 16, right: 16, width: 36, height: 36, borderRadius: 8, background: `${accentColor}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>{icon}</div>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 900, color: accentColor, lineHeight: 1, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>{sub}</div>
    </button>
  )
}

function ActionCard({ title, icon, count, accentColor, urgent, children, onClick }: {
  title: string; icon: string; count: number; accentColor: string
  urgent?: boolean; children: React.ReactNode; onClick: () => void
}) {
  return (
    <div style={{ background: '#0f1923', border: `1px solid ${urgent && count > 0 ? `${accentColor}30` : '#1e3a4f'}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', background: 'linear-gradient(135deg, #162232 0%, #0d1a26 100%)', borderBottom: '1px solid #1e3a4f', cursor: 'pointer' }} onClick={onClick}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: `${accentColor}12`, border: `1px solid ${accentColor}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>
            {icon}
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1' }}>{title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            minWidth: 26, height: 22, borderRadius: 20, padding: '0 8px',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 800,
            background: count === 0 ? '#1e293b' : `${accentColor}18`,
            color: count === 0 ? '#334155' : accentColor,
            border: `1px solid ${count === 0 ? '#1e3a4f' : `${accentColor}25`}`,
          }}>{count}</span>
          <span style={{ color: '#1e3a4f', fontSize: 14 }}>›</span>
        </div>
      </div>
      <div>{children}</div>
    </div>
  )
}

function Row({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 16px', cursor: 'pointer', borderBottom: '1px solid #0d1a26', transition: 'background 0.1s' }}
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

function StatusPill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 10, padding: '3px 9px', borderRadius: 20, fontWeight: 700, whiteSpace: 'nowrap', background: `${color}12`, color, border: `1px solid ${color}25` }}>
      {label}
    </span>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: 12, color: '#1e3a4f' }}>{text}</div>
}

function MoreLink({ count, limit, onClick }: { count: number; limit: number; onClick: () => void }) {
  if (count <= limit) return null
  return (
    <button onClick={onClick} style={{ width: '100%', padding: '9px 16px', fontSize: 11, color: '#0d7ea3', background: 'rgba(13,126,163,0.05)', borderTop: '1px solid #0d1a26', cursor: 'pointer', textAlign: 'center', fontWeight: 600, transition: 'background 0.1s' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(13,126,163,0.1)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(13,126,163,0.05)' }}
    >View all {count} →</button>
  )
}
