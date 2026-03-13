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
      const today = new Date().toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('jobs')
        .select('id, customer_name_snapshot, service_address_snapshot, system_type, status, scheduled_date, assigned_technician_name')
        .eq('scheduled_date', today)
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
      const startOfWeek = new Date(now)
      startOfWeek.setDate(now.getDate() - now.getDay())
      const endOfWeek = new Date(startOfWeek)
      endOfWeek.setDate(startOfWeek.getDate() + 6)
      const { data, error } = await supabase
        .from('jobs')
        .select('id, status')
        .gte('scheduled_date', startOfWeek.toISOString().split('T')[0])
        .lte('scheduled_date', endOfWeek.toISOString().split('T')[0])
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
        .gte('visit_date', today)
        .lte('visit_date', nextWeek)
        .not('status', 'eq', 'cancelled')
        .order('visit_date', { ascending: true })
        .order('visit_hour', { ascending: true })
        .limit(10)

      if (!isAdmin) {
        query = query.eq('assigned_rep_id', userId)
      }

      const { data: visits, error } = await query
      if (error) throw error
      if (!visits || visits.length === 0) return []

      const leadIds = [...new Set(visits.map((v: any) => v.lead_id).filter(Boolean))]
      const { data: leads } = await supabase
        .from('leads')
        .select('id, full_name, phone')
        .in('id', leadIds)

      const leadMap = Object.fromEntries((leads || []).map((l: any) => [l.id, l]))

      return visits
        .map((v: any) => ({ ...v, lead: leadMap[v.lead_id] || null }))
        .filter((v: any) => v.lead !== null)
    },
    enabled: !!userId,
    refetchInterval: 60_000,
  })
}

// ── NEW: Upcoming Renewals ────────────────────────────────────────
function useUpcomingRenewals() {
  return useQuery({
    queryKey: ['dashboard', 'upcoming_renewals'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('contracts')
        .select('id, contract_number, status, end_date, monthly_amount, type, customer_id, customers!inner(full_name, phone)')
        .eq('status', 'active')
        .gte('end_date', today)
        .lte('end_date', in30)
        .order('end_date', { ascending: true })
        .limit(10)
      if (error) throw error
      return data || []
    },
    refetchInterval: 60_000,
  })
}

// ── NEW: Pending Proof Review ─────────────────────────────────────
function usePendingProofReview() {
  return useQuery({
    queryKey: ['dashboard', 'pending_proof_review'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, customer_name_snapshot, service_address_snapshot, system_type, status, scheduled_date, assigned_technician_name')
        .eq('status', 'complete')
        .eq('proof_approved', false)
        .order('scheduled_date', { ascending: false })
        .limit(10)
      if (error) throw error
      return data || []
    },
    refetchInterval: 30_000,
  })
}

// ── NEW: Calendar events (site visits + jobs for the week) ────────
function useWeekCalendarEvents(userId: string | undefined, role: string | null) {
  return useQuery({
    queryKey: ['dashboard', 'week_calendar', userId, role],
    queryFn: async () => {
      const now = new Date()
      const startOfWeek = new Date(now)
      startOfWeek.setDate(now.getDate() - now.getDay())
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(startOfWeek)
        d.setDate(startOfWeek.getDate() + i)
        return d.toISOString().split('T')[0]
      })
      const start = days[0]
      const end = days[6]

      const results: Record<string, { visits: any[]; jobs: any[] }> = {}
      for (const d of days) results[d] = { visits: [], jobs: [] }

      // Fetch site visits (sales reps + admin)
      if (role === 'admin' || role === 'salesrep' || role === 'frontdesk') {
        let visitQuery = supabase
          .from('site_visits')
          .select('id, lead_id, assigned_rep_id, visit_date, visit_hour, status')
          .gte('visit_date', start)
          .lte('visit_date', end)
          .not('status', 'eq', 'cancelled')

        if (role !== 'admin') {
          visitQuery = visitQuery.eq('assigned_rep_id', userId)
        }

        const { data: visits } = await visitQuery
        const leadIds = [...new Set((visits || []).map((v: any) => v.lead_id).filter(Boolean))]
        let leadMap: Record<string, any> = {}
        if (leadIds.length) {
          const { data: leads } = await supabase.from('leads').select('id, full_name').in('id', leadIds)
          leadMap = Object.fromEntries((leads || []).map((l: any) => [l.id, l]))
        }
        for (const v of (visits || [])) {
          if (results[v.visit_date]) {
            results[v.visit_date].visits.push({ ...v, lead: leadMap[v.lead_id] || null })
          }
        }
      }

      // Fetch jobs (technicians + admin)
      if (role === 'admin' || role === 'technician') {
        let jobQuery = supabase
          .from('jobs')
          .select('id, customer_name_snapshot, status, scheduled_date, assigned_technician_name, system_type')
          .gte('scheduled_date', start)
          .lte('scheduled_date', end)
          .not('status', 'eq', 'cancelled')

        if (role === 'technician' && userId) {
          // filter by assigned technician — best effort match on name or id
        }

        const { data: jobs } = await jobQuery
        for (const j of (jobs || [])) {
          if (results[j.scheduled_date]) {
            results[j.scheduled_date].jobs.push(j)
          }
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
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const mins = Math.floor((now - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
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
  return dateStr === new Date().toISOString().split('T')[0]
}

function isTomorrow(dateStr: string): boolean {
  return dateStr === new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
}

function visitDayLabel(dateStr: string): string {
  if (isToday(dateStr)) return 'Today'
  if (isTomorrow(dateStr)) return 'Tomorrow'
  return formatShortDate(dateStr)
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const JOB_STATUS_COLOR: Record<string, string> = {
  scheduled:   '#60a5fa',
  in_progress: '#22d3ee',
  complete:    '#4ade80',
  cancelled:   '#64748b',
}

// ============================================================
// WEEK CALENDAR WIDGET
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
    <div style={{
      background: '#162232',
      border: '1px solid #1e3a4f',
      borderRadius: 16,
      overflow: 'hidden',
      gridColumn: '1 / -1',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', borderBottom: '1px solid #1e3a4f',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>📆</span>
          <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>
            {role === 'technician' ? 'My Install Schedule' : role === 'salesrep' ? 'My Visit Schedule' : 'This Week'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {showVisits && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22d3ee', display: 'inline-block' }} />
              <span style={{ fontSize: 11, color: '#64748b' }}>Site Visits</span>
            </div>
          )}
          {showJobs && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fb923c', display: 'inline-block' }} />
              <span style={{ fontSize: 11, color: '#64748b' }}>Installs</span>
            </div>
          )}
        </div>
      </div>

      {/* 7-day grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #1e3a4f' }}>
        {days.map((day, i) => {
          const visits = events[day]?.visits || []
          const jobs   = events[day]?.jobs   || []
          const total  = (showVisits ? visits.length : 0) + (showJobs ? jobs.length : 0)
          const todayFlag = isToday(day)
          const isSelected = selectedDay === day

          return (
            <button
              key={day}
              onClick={() => setSelectedDay(isSelected ? null : day)}
              style={{
                padding: '10px 6px',
                borderRight: i < 6 ? '1px solid #1e3a4f' : 'none',
                background: isSelected ? 'rgba(13,126,163,0.15)' : todayFlag ? 'rgba(255,255,255,0.03)' : 'transparent',
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'background 0.15s',
              }}
            >
              <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>
                {DAY_LABELS[new Date(day + 'T00:00:00').getDay()]}
              </div>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 6px',
                background: todayFlag ? '#0d7ea3' : 'transparent',
                color: todayFlag ? '#fff' : '#e2e8f0',
                fontWeight: todayFlag ? 700 : 500,
                fontSize: 13,
              }}>
                {new Date(day + 'T00:00:00').getDate()}
              </div>
              {/* Dots */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: 3, minHeight: 8 }}>
                {showVisits && visits.length > 0 && (
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', background: '#22d3ee',
                    display: 'inline-block', flexShrink: 0,
                  }} />
                )}
                {showJobs && jobs.length > 0 && (
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', background: '#fb923c',
                    display: 'inline-block', flexShrink: 0,
                  }} />
                )}
              </div>
              {total > 0 && (
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>{total}</div>
              )}
            </button>
          )
        })}
      </div>

      {/* Selected day detail */}
      {selectedDay && selectedEvents && (
        <div style={{ padding: '14px 20px' }}>
          <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
            {isToday(selectedDay) ? 'Today' : isTomorrow(selectedDay) ? 'Tomorrow' : formatShortDate(selectedDay)}
            {' — '}
            {(showVisits ? selectedEvents.visits.length : 0) + (showJobs ? selectedEvents.jobs.length : 0)} event(s)
          </div>

          {showVisits && selectedEvents.visits.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {selectedEvents.visits.map((v: any) => (
                <div
                  key={v.id}
                  onClick={() => navigate('/leads')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', borderRadius: 8, marginBottom: 4,
                    background: 'rgba(34,211,238,0.06)',
                    border: '1px solid rgba(34,211,238,0.15)',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22d3ee', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>
                      {v.lead?.full_name || 'Unknown lead'}
                    </div>
                    <div style={{ color: '#64748b', fontSize: 11 }}>{formatHour(v.visit_hour)} · Site Visit</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showJobs && selectedEvents.jobs.length > 0 && (
            <div>
              {selectedEvents.jobs.map((j: any) => (
                <div
                  key={j.id}
                  onClick={() => navigate(`/installations/${j.id}`)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', borderRadius: 8, marginBottom: 4,
                    background: 'rgba(251,146,60,0.06)',
                    border: '1px solid rgba(251,146,60,0.15)',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fb923c', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {j.customer_name_snapshot}
                    </div>
                    <div style={{ color: '#64748b', fontSize: 11 }}>
                      {j.system_type || 'Install'} ·{' '}
                      <span style={{ color: JOB_STATUS_COLOR[j.status] || '#64748b' }}>{j.status}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {(showVisits ? selectedEvents.visits.length : 0) + (showJobs ? selectedEvents.jobs.length : 0) === 0 && (
            <div style={{ color: '#334155', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>Nothing scheduled</div>
          )}
        </div>
      )}

      {!selectedDay && (
        <div style={{ padding: '10px 20px', color: '#334155', fontSize: 12, textAlign: 'center' }}>
          Tap a day to see details
        </div>
      )}
    </div>
  )
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export function DashboardPage() {
  const { profile, role } = useAuth()
  const navigate = useNavigate()

  const isAdmin        = role === 'admin'
  const isSalesOrAdmin = role === 'admin' || role === 'salesrep' || role === 'frontdesk'
  const isTechOrAdmin  = role === 'admin' || role === 'technician'

  const { data: newLeadsToday = [] }    = useNewLeadsToday()
  const { data: overdueFollowUps = [] } = useOverdueLeadFollowUps()
  const { data: uncontactedLeads = [] } = useUncontactedLeads()
  const { data: todaysJobs = [] }       = useTodaysJobs()
  const { data: activeLeadCount = 0 }  = useActiveLeadCounts()
  const { data: jobsThisWeek = [] }     = useJobsThisWeek()
  const { data: overdueServices = [] }  = useOverdueServices()
  const { data: recentCustomers = [] }  = useRecentCustomers()
  const { data: failedPayments = [] }   = useFailedPayments()
  const { data: upcomingVisits = [] }   = useMyUpcomingVisits(profile?.id, isAdmin)
  const { data: upcomingRenewals = [] } = useUpcomingRenewals()
  const { data: pendingProof = [] }     = usePendingProofReview()

  const greeting = profile
    ? `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${profile.full_name.split(' ')[0]}.`
    : 'Welcome.'

  const completedJobsThisWeek = jobsThisWeek.filter((j: any) => j.status === 'complete').length
  const scheduledToday  = todaysJobs.filter((j: any) => j.status === 'scheduled').length
  const inProgressToday = todaysJobs.filter((j: any) => j.status === 'in_progress').length
  const urgentCount = overdueFollowUps.length + overdueServices.length + failedPayments.length + pendingProof.length

  return (
    <div style={{ maxWidth: 1100, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ─── Header ──────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 22, margin: 0 }}>{greeting}</h1>
          <p style={{ color: '#64748b', fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        {urgentCount > 0 && (
          <div style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            backgroundColor: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171',
          }}>
            {urgentCount} item{urgentCount !== 1 ? 's' : ''} need attention
          </div>
        )}
      </div>

      {/* ─── KPI Cards ───────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}
        className="lg:grid-cols-4">
        <KPICard
          label="Active Leads"
          value={String(activeLeadCount)}
          sub={newLeadsToday.length > 0 ? `${newLeadsToday.length} new today` : 'No new today'}
          icon="⬡" color="#38bdf8"
          onClick={() => navigate('/leads')}
        />
        <KPICard
          label="Today's Installs"
          value={String(todaysJobs.length)}
          sub={inProgressToday > 0 ? `${inProgressToday} in progress` : scheduledToday > 0 ? `${scheduledToday} scheduled` : 'None today'}
          icon="🔧" color="#f59e0b"
          onClick={() => navigate('/installations')}
        />
        <KPICard
          label="Jobs This Week"
          value={String(jobsThisWeek.length)}
          sub={`${completedJobsThisWeek} completed`}
          icon="📅" color="#a78bfa"
          onClick={() => navigate('/dispatch')}
        />
        <KPICard
          label="Failed Payments"
          value={String(failedPayments.length)}
          sub={failedPayments.length > 0 ? 'Last 48 hours' : 'All clear'}
          icon="💳"
          color={failedPayments.length > 0 ? '#f87171' : '#4ade80'}
          onClick={() => navigate('/customers')}
        />
      </div>

      {/* ─── Week Calendar ───────────────────────────────── */}
      <WeekCalendar userId={profile?.id} role={role} />

      {/* ─── Action Queue Grid ───────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1, 1fr)', gap: 16 }}
        className="lg:grid-cols-2">

        {/* Failed Payments */}
        {isAdmin && failedPayments.length > 0 && (
          <ActionSection title="Failed Payments" icon="💳" count={failedPayments.length} emptyText="No failed payments" urgentColor>
            {failedPayments.slice(0, 5).map((tx: any) => (
              <ActionRow key={tx.id} onClick={() => navigate(`/customers/${tx.customer_id}`)}
                left={
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{tx.customers?.full_name || 'Unknown customer'}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{tx.failure_reason || 'Payment failed'} · {timeAgo(tx.attempted_at)}</div>
                  </div>
                }
                right={<span style={{ fontSize: 13, fontWeight: 700, color: '#f87171' }}>${Number(tx.amount).toFixed(2)}</span>}
              />
            ))}
            {failedPayments.length > 5 && (
              <button onClick={() => navigate('/customers')} style={{ fontSize: 11, color: '#0d7ea3', padding: '8px 16px', display: 'block' }}>
                View all {failedPayments.length} failed →
              </button>
            )}
          </ActionSection>
        )}

        {/* Pending Proof Review — NEW */}
        {isTechOrAdmin && pendingProof.length > 0 && (
          <ActionSection title="Pending Proof Review" icon="📸" count={pendingProof.length} emptyText="No pending proof reviews" urgentColor>
            {pendingProof.slice(0, 5).map((job: any) => (
              <ActionRow key={job.id} onClick={() => navigate(`/installations/${job.id}`)}
                left={
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{job.customer_name_snapshot}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{job.service_address_snapshot}</div>
                  </div>
                }
                right={
                  <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 12, fontWeight: 600, background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)', whiteSpace: 'nowrap' }}>
                    Review
                  </span>
                }
              />
            ))}
            {pendingProof.length > 5 && (
              <button onClick={() => navigate('/installations')} style={{ fontSize: 11, color: '#0d7ea3', padding: '8px 16px', display: 'block' }}>
                View all {pendingProof.length} →
              </button>
            )}
          </ActionSection>
        )}

        {/* Upcoming Renewals — NEW */}
        {isAdmin && (
          <ActionSection title="Upcoming Renewals" icon="↻" count={upcomingRenewals.length} emptyText="No renewals in next 30 days">
            {upcomingRenewals.slice(0, 5).map((c: any) => (
              <ActionRow key={c.id} onClick={() => navigate(`/customers/${c.customer_id}`)}
                left={
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{c.customers?.full_name}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      {c.contract_number} · ${Number(c.monthly_amount || 0).toFixed(2)}/mo
                    </div>
                  </div>
                }
                right={
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: daysUntil(c.end_date) <= 7 ? '#f87171' : '#fbbf24' }}>
                      {daysUntil(c.end_date)}d
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>{formatShortDate(c.end_date)}</div>
                  </div>
                }
              />
            ))}
            {upcomingRenewals.length > 5 && (
              <button onClick={() => navigate('/customers')} style={{ fontSize: 11, color: '#0d7ea3', padding: '8px 16px', display: 'block' }}>
                View all {upcomingRenewals.length} →
              </button>
            )}
          </ActionSection>
        )}

        {/* My Upcoming Site Visits */}
        {isSalesOrAdmin && (
          <ActionSection
            title={isAdmin ? 'Upcoming Site Visits' : 'My Upcoming Visits'}
            icon="📍" count={upcomingVisits.length} emptyText="No site visits scheduled this week"
          >
            {upcomingVisits.slice(0, 6).map((visit: any) => {
              const isVisitToday = isToday(visit.visit_date)
              return (
                <ActionRow key={visit.id} onClick={() => navigate('/leads')}
                  left={
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{visit.lead?.full_name || 'Unknown'}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{visit.lead?.phone || ''}</div>
                    </div>
                  }
                  right={
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: isVisitToday ? '#34d399' : '#94a3b8' }}>
                        {visitDayLabel(visit.visit_date)}
                      </div>
                      <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{formatHour(visit.visit_hour)}</div>
                    </div>
                  }
                />
              )
            })}
            {upcomingVisits.length > 6 && (
              <button onClick={() => navigate('/leads')} style={{ fontSize: 11, color: '#0d7ea3', padding: '8px 16px', display: 'block' }}>
                View all {upcomingVisits.length} visits →
              </button>
            )}
          </ActionSection>
        )}

        {/* Overdue Follow-Ups */}
        {isSalesOrAdmin && (
          <ActionSection title="Overdue Follow-Ups" icon="🔥" count={overdueFollowUps.length} emptyText="No overdue follow-ups" urgentColor={overdueFollowUps.length > 0}>
            {overdueFollowUps.slice(0, 5).map((lead: any) => (
              <ActionRow key={lead.id} onClick={() => navigate('/leads')}
                left={
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{lead.full_name}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{lead.phone}</div>
                  </div>
                }
                right={<span style={{ fontSize: 11, fontWeight: 600, color: '#f87171' }}>{daysOverdue(lead.followup_date)}d overdue</span>}
              />
            ))}
            {overdueFollowUps.length > 5 && (
              <button onClick={() => navigate('/leads')} style={{ fontSize: 11, color: '#0d7ea3', padding: '8px 16px', display: 'block' }}>
                View all {overdueFollowUps.length} overdue →
              </button>
            )}
          </ActionSection>
        )}

        {/* Leads to Contact */}
        {isSalesOrAdmin && (
          <ActionSection title="Leads to Contact" icon="📞" count={uncontactedLeads.length} emptyText="No leads waiting">
            {uncontactedLeads.slice(0, 5).map((lead: any) => (
              <ActionRow key={lead.id} onClick={() => navigate('/leads')}
                left={
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{lead.full_name}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{lead.phone}</div>
                  </div>
                }
                right={<span style={{ fontSize: 11, color: '#64748b' }}>{timeAgo(lead.created_at)}</span>}
              />
            ))}
            {uncontactedLeads.length > 5 && (
              <button onClick={() => navigate('/leads')} style={{ fontSize: 11, color: '#0d7ea3', padding: '8px 16px', display: 'block' }}>
                View all {uncontactedLeads.length} leads →
              </button>
            )}
          </ActionSection>
        )}

        {/* Today's Installations */}
        <ActionSection title="Today's Installations" icon="🔧" count={todaysJobs.length} emptyText="No installs scheduled today">
          {todaysJobs.slice(0, 5).map((job: any) => (
            <ActionRow key={job.id} onClick={() => navigate(`/installations/${job.id}`)}
              left={
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{job.customer_name_snapshot}</div>
                  <div style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                    {job.service_address_snapshot}
                  </div>
                </div>
              }
              right={
                <span style={{
                  fontSize: 10, padding: '3px 8px', borderRadius: 12, fontWeight: 600, whiteSpace: 'nowrap',
                  background: `${JOB_STATUS_COLOR[job.status] || '#64748b'}18`,
                  color: JOB_STATUS_COLOR[job.status] || '#64748b',
                  border: `1px solid ${JOB_STATUS_COLOR[job.status] || '#64748b'}35`,
                }}>
                  {job.status}
                </span>
              }
            />
          ))}
        </ActionSection>

        {/* Recent Customers */}
        {isAdmin && (
          <ActionSection title="Recent Customers" icon="👥" count={recentCustomers.length} emptyText="No customers yet">
            {recentCustomers.map((cust: any) => {
              const statusColor = cust.lifecycle_status === 'active' ? '#4ade80' : cust.lifecycle_status === 'at_risk' ? '#f87171' : '#94a3b8'
              return (
                <ActionRow key={cust.id} onClick={() => navigate(`/customers/${cust.id}`)}
                  left={
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{cust.full_name}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{timeAgo(cust.created_at)}</div>
                    </div>
                  }
                  right={
                    <span style={{
                      fontSize: 10, padding: '3px 8px', borderRadius: 12, fontWeight: 600,
                      background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}35`,
                    }}>
                      {cust.lifecycle_status || 'unknown'}
                    </span>
                  }
                />
              )
            })}
          </ActionSection>
        )}

        {/* Overdue Service Items */}
        {isAdmin && overdueServices.length > 0 && (
          <ActionSection title="Overdue Service Items" icon="⚠️" count={overdueServices.length} emptyText="All services current" urgentColor>
            {overdueServices.slice(0, 5).map((svc: any) => (
              <ActionRow key={svc.id} onClick={() => svc.customer_id ? navigate(`/customers/${svc.customer_id}`) : undefined}
                left={
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>Service due {formatShortDate(svc.due_date)}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>Customer: {svc.customer_id?.slice(0, 8)}...</div>
                  </div>
                }
                right={<span style={{ fontSize: 11, fontWeight: 600, color: '#f87171' }}>{daysOverdue(svc.due_date)}d overdue</span>}
              />
            ))}
          </ActionSection>
        )}

      </div>

      {/* ─── Quick Actions ───────────────────────────────── */}
      {isSalesOrAdmin && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
          <QuickAction label="+ New Lead"     onClick={() => navigate('/leads')}     />
          <QuickAction label="View Pipeline"  onClick={() => navigate('/leads')}     />
          <QuickAction label="Dispatch Board" onClick={() => navigate('/dispatch')}  />
          <QuickAction label="All Customers"  onClick={() => navigate('/customers')} />
          {isAdmin && <QuickAction label="Product Catalog" onClick={() => navigate('/products')} />}
        </div>
      )}

    </div>
  )
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function KPICard({ label, value, sub, icon, color, onClick }: {
  label: string; value: string; sub: string; icon: string; color: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14,
        padding: '16px', textAlign: 'left', cursor: 'pointer', width: '100%',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#0d7ea3' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1e3a4f' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>{sub}</div>
    </button>
  )
}

function ActionSection({ title, icon, count, emptyText, urgentColor, children }: {
  title: string; icon: string; count: number; emptyText: string; urgentColor?: boolean; children?: React.ReactNode
}) {
  const borderColor = urgentColor && count > 0 ? 'rgba(239,68,68,0.3)' : '#1e3a4f'
  const badgeBg     = count === 0 ? '#1e3a4f' : urgentColor ? 'rgba(239,68,68,0.15)' : '#1e3a4f'
  const badgeColor  = count === 0 ? '#64748b' : urgentColor ? '#f87171' : '#e2e8f0'

  return (
    <div style={{ background: '#162232', border: `1px solid ${borderColor}`, borderRadius: 14, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid #1e3a4f',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>{icon}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{title}</span>
        </div>
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 700,
          background: badgeBg, color: badgeColor,
        }}>
          {count}
        </span>
      </div>
      <div style={{ borderTop: 'none' }}>
        {count === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: '#334155' }}>{emptyText}</div>
        ) : children}
      </div>
    </div>
  )
}

function ActionRow({ onClick, left, right }: {
  onClick: () => void; left: React.ReactNode; right: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '11px 16px', cursor: 'pointer', textAlign: 'left',
        borderBottom: '1px solid #1e3a4f', background: 'transparent', transition: 'background 0.12s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >
      {left}
      {right}
    </button>
  )
}

function QuickAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 12, padding: '8px 14px', background: '#162232',
        border: '1px solid #1e3a4f', color: '#94a3b8', borderRadius: 8,
        cursor: 'pointer', transition: 'all 0.12s',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = '#0d7ea3'
        el.style.color = '#e2e8f0'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = '#1e3a4f'
        el.style.color = '#94a3b8'
      }}
    >
      {label}
    </button>
  )
}
