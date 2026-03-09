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

function formatShortDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const JOB_STATUS_BADGE: Record<string, { label: string; color: string }> = {
  scheduled:   { label: 'Scheduled',  color: 'bg-blue-900/50 text-blue-400'  },
  in_progress: { label: 'In Progress', color: 'bg-cyan-900/50 text-cyan-400' },
  complete:    { label: 'Complete',   color: 'bg-green-900/50 text-green-400' },
  cancelled:   { label: 'Cancelled',  color: 'bg-red-900/50 text-red-400'    },
}

// ============================================================
// COMPONENT
// ============================================================

export function DashboardPage() {
  const { profile, role } = useAuth()
  const navigate = useNavigate()

  const { data: newLeadsToday = [] }    = useNewLeadsToday()
  const { data: overdueFollowUps = [] } = useOverdueLeadFollowUps()
  const { data: uncontactedLeads = [] } = useUncontactedLeads()
  const { data: todaysJobs = [] }       = useTodaysJobs()
  const { data: activeLeadCount = 0 }  = useActiveLeadCounts()
  const { data: jobsThisWeek = [] }     = useJobsThisWeek()
  const { data: overdueServices = [] }  = useOverdueServices()
  const { data: recentCustomers = [] }  = useRecentCustomers()
  const { data: failedPayments = [] }   = useFailedPayments()

  const greeting = profile
    ? `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${profile.full_name.split(' ')[0]}.`
    : 'Welcome.'

  const completedJobsThisWeek = jobsThisWeek.filter((j: any) => j.status === 'complete').length
  const scheduledToday  = todaysJobs.filter((j: any) => j.status === 'scheduled').length
  const inProgressToday = todaysJobs.filter((j: any) => j.status === 'in_progress').length

  const urgentCount = overdueFollowUps.length + overdueServices.length + failedPayments.length

  const isAdmin        = role === 'admin'
  const isSalesOrAdmin = role === 'admin' || role === 'salesrep' || role === 'frontdesk'

  return (
    <div className="space-y-5 max-w-6xl">

      {/* ─── Header ──────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{greeting}</h1>
          <p className="text-muted text-sm mt-1">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        {urgentCount > 0 && (
          <div className="px-3 py-1.5 rounded-lg text-sm font-semibold"
            style={{ backgroundColor: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
            {urgentCount} item{urgentCount !== 1 ? 's' : ''} need attention
          </div>
        )}
      </div>

      {/* ─── KPI Cards ───────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          label="Active Leads"
          value={String(activeLeadCount)}
          sub={newLeadsToday.length > 0 ? `${newLeadsToday.length} new today` : 'No new today'}
          icon="⬡"
          color="#38bdf8"
          onClick={() => navigate('/leads')}
        />
        <KPICard
          label="Today's Installs"
          value={String(todaysJobs.length)}
          sub={inProgressToday > 0 ? `${inProgressToday} in progress` : scheduledToday > 0 ? `${scheduledToday} scheduled` : 'None today'}
          icon="🔧"
          color="#f59e0b"
          onClick={() => navigate('/installations')}
        />
        <KPICard
          label="Jobs This Week"
          value={String(jobsThisWeek.length)}
          sub={`${completedJobsThisWeek} completed`}
          icon="📅"
          color="#a78bfa"
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

      {/* ─── Action Queue Grid ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Failed Payments — Admin, always first */}
        {isAdmin && failedPayments.length > 0 && (
          <ActionSection
            title="Failed Payments"
            icon="💳"
            count={failedPayments.length}
            emptyText="No failed payments"
            urgentColor={true}
          >
            {failedPayments.slice(0, 5).map((tx: any) => (
              <ActionRow
                key={tx.id}
                onClick={() => navigate(`/customers/${tx.customer_id}`)}
                left={
                  <div>
                    <div className="text-sm font-medium text-white">
                      {tx.customers?.full_name || 'Unknown customer'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {tx.failure_reason || 'Payment failed'} · {timeAgo(tx.attempted_at)}
                    </div>
                  </div>
                }
                right={
                  <span className="text-sm font-semibold" style={{ color: '#f87171' }}>
                    ${Number(tx.amount).toFixed(2)}
                  </span>
                }
              />
            ))}
            {failedPayments.length > 5 && (
              <button
                onClick={() => navigate('/customers')}
                className="text-xs text-accent hover:underline mt-2 block px-4 pb-2"
              >
                View all {failedPayments.length} failed →
              </button>
            )}
          </ActionSection>
        )}

        {/* Overdue Follow-Ups — Sales/Admin */}
        {isSalesOrAdmin && (
          <ActionSection
            title="Overdue Follow-Ups"
            icon="🔥"
            count={overdueFollowUps.length}
            emptyText="No overdue follow-ups"
            urgentColor={overdueFollowUps.length > 0}
          >
            {overdueFollowUps.slice(0, 5).map((lead: any) => (
              <ActionRow
                key={lead.id}
                onClick={() => navigate('/leads')}
                left={
                  <div>
                    <div className="text-sm font-medium text-white">{lead.full_name}</div>
                    <div className="text-xs text-gray-500">{lead.phone}</div>
                  </div>
                }
                right={
                  <span className="text-xs font-medium" style={{ color: '#f87171' }}>
                    {daysOverdue(lead.followup_date)}d overdue
                  </span>
                }
              />
            ))}
            {overdueFollowUps.length > 5 && (
              <button onClick={() => navigate('/leads')} className="text-xs text-accent hover:underline mt-2 block">
                View all {overdueFollowUps.length} overdue →
              </button>
            )}
          </ActionSection>
        )}

        {/* Leads to Contact — Sales/Admin */}
        {isSalesOrAdmin && (
          <ActionSection
            title="Leads to Contact"
            icon="📞"
            count={uncontactedLeads.length}
            emptyText="No leads waiting"
          >
            {uncontactedLeads.slice(0, 5).map((lead: any) => (
              <ActionRow
                key={lead.id}
                onClick={() => navigate('/leads')}
                left={
                  <div>
                    <div className="text-sm font-medium text-white">{lead.full_name}</div>
                    <div className="text-xs text-gray-500">{lead.phone}</div>
                  </div>
                }
                right={
                  <span className="text-xs text-gray-400">{timeAgo(lead.created_at)}</span>
                }
              />
            ))}
            {uncontactedLeads.length > 5 && (
              <button onClick={() => navigate('/leads')} className="text-xs text-accent hover:underline mt-2 block">
                View all {uncontactedLeads.length} leads →
              </button>
            )}
          </ActionSection>
        )}

        {/* Today's Installations — All roles */}
        <ActionSection
          title="Today's Installations"
          icon="🔧"
          count={todaysJobs.length}
          emptyText="No installs scheduled today"
        >
          {todaysJobs.slice(0, 5).map((job: any) => (
            <ActionRow
              key={job.id}
              onClick={() => navigate(`/installations/${job.id}`)}
              left={
                <div>
                  <div className="text-sm font-medium text-white">{job.customer_name_snapshot}</div>
                  <div className="text-xs text-gray-500 truncate max-w-[200px]">{job.service_address_snapshot}</div>
                </div>
              }
              right={
                <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${JOB_STATUS_BADGE[job.status]?.color || 'bg-gray-700 text-gray-400'}`}>
                  {JOB_STATUS_BADGE[job.status]?.label || job.status}
                </span>
              }
            />
          ))}
        </ActionSection>

        {/* Recent Customers — Admin */}
        {isAdmin && (
          <ActionSection
            title="Recent Customers"
            icon="👥"
            count={recentCustomers.length}
            emptyText="No customers yet"
          >
            {recentCustomers.map((cust: any) => (
              <ActionRow
                key={cust.id}
                onClick={() => navigate(`/customers/${cust.id}`)}
                left={
                  <div>
                    <div className="text-sm font-medium text-white">{cust.full_name}</div>
                    <div className="text-xs text-gray-500">{timeAgo(cust.created_at)}</div>
                  </div>
                }
                right={
                  <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                    cust.lifecycle_status === 'active'  ? 'bg-green-900/50 text-green-400' :
                    cust.lifecycle_status === 'at_risk' ? 'bg-red-900/50 text-red-400' :
                    cust.lifecycle_status === 'churned' ? 'bg-gray-700 text-gray-500' :
                    'bg-gray-700 text-gray-400'
                  }`}>
                    {cust.lifecycle_status || 'unknown'}
                  </span>
                }
              />
            ))}
          </ActionSection>
        )}

        {/* Overdue Service Items — Admin */}
        {isAdmin && overdueServices.length > 0 && (
          <ActionSection
            title="Overdue Service Items"
            icon="⚠️"
            count={overdueServices.length}
            emptyText="All services current"
            urgentColor={true}
          >
            {overdueServices.slice(0, 5).map((svc: any) => (
              <ActionRow
                key={svc.id}
                onClick={() => svc.customer_id ? navigate(`/customers/${svc.customer_id}`) : undefined}
                left={
                  <div>
                    <div className="text-sm font-medium text-white">Service due {formatShortDate(svc.due_date)}</div>
                    <div className="text-xs text-gray-500">Customer ID: {svc.customer_id?.slice(0, 8)}...</div>
                  </div>
                }
                right={
                  <span className="text-xs font-medium" style={{ color: '#f87171' }}>
                    {daysOverdue(svc.due_date)}d overdue
                  </span>
                }
              />
            ))}
          </ActionSection>
        )}

      </div>

      {/* ─── Quick Actions ───────────────────────────────── */}
      {isSalesOrAdmin && (
        <div className="flex flex-wrap gap-2 pt-2">
          <QuickAction label="+ New Lead"      onClick={() => navigate('/leads')}     />
          <QuickAction label="View Pipeline"   onClick={() => navigate('/leads')}     />
          <QuickAction label="Dispatch Board"  onClick={() => navigate('/dispatch')}  />
          <QuickAction label="All Customers"   onClick={() => navigate('/customers')} />
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
      className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 text-left hover:bg-gray-800/80 hover:border-gray-600 transition-all"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">{icon}</span>
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-3xl font-bold" style={{ color }}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{sub}</div>
    </button>
  )
}

function ActionSection({ title, icon, count, emptyText, urgentColor, children }: {
  title: string; icon: string; count: number; emptyText: string; urgentColor?: boolean; children: React.ReactNode
}) {
  return (
    <div className={`bg-gray-800/50 border rounded-xl overflow-hidden ${
      urgentColor ? 'border-red-700/40' : 'border-gray-700'
    }`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
        <div className="flex items-center gap-2">
          <span className="text-sm">{icon}</span>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          count === 0    ? 'bg-gray-700 text-gray-400' :
          urgentColor    ? 'bg-red-900/50 text-red-400' :
          'bg-gray-700 text-gray-300'
        }`}>
          {count}
        </span>
      </div>
      <div className="divide-y divide-gray-700/50">
        {count === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-500">{emptyText}</div>
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
      className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700/30 transition-colors text-left"
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
      className="text-xs px-3 py-2 bg-gray-800 border border-gray-700 text-gray-300 rounded-lg hover:bg-gray-700 hover:text-white transition-colors"
    >
      {label}
    </button>
  )
}
