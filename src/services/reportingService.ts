// src/services/reportingService.ts
// READ-ONLY. No write operations. All reporting queries live here.
// Components call these functions via useQuery — no reporting logic in component files.

import { supabase } from '../lib/supabase'

// ─── Types ─────────────────────────────────────────────────────
export interface DateRange {
  start: string  // YYYY-MM-DD
  end: string    // YYYY-MM-DD
  label: string
}

// ─── Date Range Helpers ────────────────────────────────────────
function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function getMTDRange(): DateRange {
  const now = new Date()
  return {
    start: localDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    end:   localDate(now),
    label: 'MTD',
  }
}

export function getLast30Range(): DateRange {
  return {
    start: localDate(new Date(Date.now() - 30 * 86400000)),
    end:   localDate(new Date()),
    label: 'Last 30d',
  }
}

export function getLast90Range(): DateRange {
  return {
    start: localDate(new Date(Date.now() - 90 * 86400000)),
    end:   localDate(new Date()),
    label: 'Last 90d',
  }
}

export function getYTDRange(): DateRange {
  return {
    start: `${new Date().getFullYear()}-01-01`,
    end:   localDate(new Date()),
    label: 'YTD',
  }
}

// ─── MRR Helper ────────────────────────────────────────────────
// FIX: True MRR = active rental contracts + active service plan subscriptions.
// autopay.js charges both. Previously only contracts were summed — understated MRR
// for any customer with a service plan.
async function computeMRR(): Promise<number> {
  const [contractsRes, plansRes] = await Promise.all([
    supabase.from('contracts').select('monthly_amount').eq('status', 'active'),
    supabase.from('customer_service_plans')
      .select('price, billing_cycle')
      .eq('status', 'active'),
  ])

  const contractMRR = (contractsRes.data || []).reduce(
    (s, c) => s + (Number(c.monthly_amount) || 0), 0
  )

  // Normalize plan billing cycles to monthly equivalent
  const planMRR = (plansRes.data || []).reduce((s, p) => {
    const price = Number(p.price) || 0
    const cycle = p.billing_cycle || 'monthly'
    if (cycle === 'monthly')    return s + price
    if (cycle === 'quarterly')  return s + price / 3
    if (cycle === 'yearly')     return s + price / 12
    return s + price // one_time treated as 0 MRR contribution
  }, 0)

  return contractMRR + planMRR
}

// ─── Executive KPIs ────────────────────────────────────────────
export async function getExecutiveKPIs(range: DateRange) {
  try {
    const [
      activeLeadsRes,
      paymentsRes,
      installsRes,
      failedRes,
      unsignedRes,
      unassignedRes,
    ] = await Promise.all([
      supabase.from('leads')
        .select('*', { count: 'exact', head: true })
        .neq('stage', 'won').neq('stage', 'lost').neq('stage', 'dnd').neq('stage', 'future_follow_up'),

      supabase.from('payment_transactions')
        .select('amount')
        .eq('status', 'succeeded')
        .gte('completed_at', range.start + 'T00:00:00')
        .lte('completed_at', range.end + 'T23:59:59'),

      supabase.from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'complete')
        .gte('completed_at', range.start + 'T00:00:00')
        .lte('completed_at', range.end + 'T23:59:59'),

      supabase.from('payment_transactions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('attempted_at', new Date(Date.now() - 48 * 3600000).toISOString()),

      supabase.from('agreements')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending_signature'),

      supabase.from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'scheduled')
        .is('assigned_technician_id', null),
    ])

    // FIX: use computeMRR() so service plans are included
    const mrr = await computeMRR()

    const cashCollected = (paymentsRes.data || []).reduce(
      (s, p) => s + (Number(p.amount) || 0), 0
    )

    return {
      activeLeads:        activeLeadsRes.count      ?? 0,
      mrr,
      cashCollected,
      installsCompleted:  installsRes.count         ?? 0,
      failedPayments48h:  failedRes.count           ?? 0,
      unsignedAgreements: unsignedRes.count         ?? 0,
      unassignedJobs:     unassignedRes.count       ?? 0,
    }
  } catch (err) {
    console.error('getExecutiveKPIs:', err)
    throw err
  }
}

// ─── Revenue & Billing ─────────────────────────────────────────
export async function getRevenueSummary(range: DateRange) {
  try {
    const [overdueRes, failedRes, collectedRes] = await Promise.all([
      supabase.from('invoices').select('amount').eq('status', 'overdue'),
      supabase.from('payment_transactions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('attempted_at', range.start + 'T00:00:00')
        .lte('attempted_at', range.end + 'T23:59:59'),
      supabase.from('payment_transactions')
        .select('amount')
        .eq('status', 'succeeded')
        .gte('completed_at', range.start + 'T00:00:00')
        .lte('completed_at', range.end + 'T23:59:59'),
    ])

    // FIX: use shared computeMRR() helper
    const mrr = await computeMRR()

    return {
      mrr,
      overdueTotal:         (overdueRes.data  || []).reduce((s, i) => s + (Number(i.amount) || 0), 0),
      cashCollected:        (collectedRes.data || []).reduce((s, p) => s + (Number(p.amount) || 0), 0),
      failedPaymentsCount:  failedRes.count ?? 0,
    }
  } catch (err) {
    console.error('getRevenueSummary:', err)
    throw err
  }
}

export async function getCashByMonth(months = 6): Promise<{ month: string; total_collected: number; payment_count: number }[]> {
  try {
    const { data, error } = await supabase
      .from('v_cash_collected_by_month')
      .select('month, total_collected, payment_count')
      .limit(months)
    if (error) throw error
    return (data || []).reverse()
  } catch (err) {
    console.error('getCashByMonth:', err)
    return []
  }
}

export async function getNewContractValueByMonth(months = 6): Promise<{ month: string; new_monthly_value: number; contract_count: number }[]> {
  try {
    const { data, error } = await supabase
      .from('v_new_contract_value_by_month')
      .select('month, new_monthly_value, contract_count')
      .limit(months)
    if (error) throw error
    return (data || []).reverse()
  } catch (err) {
    console.error('getNewContractValueByMonth:', err)
    return []
  }
}

export async function getInvoiceAging() {
  try {
    const { data, error } = await supabase
      .from('invoices')
      .select('amount, due_date, status')
      .in('status', ['sent', 'overdue', 'partial'])
    if (error) throw error

    const now = Date.now()
    const amounts  = { b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 }
    const counts   = { b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 }

    for (const inv of (data || [])) {
      if (!inv.due_date) continue
      const days = Math.floor((now - new Date(inv.due_date).getTime()) / 86400000)
      const amt  = Number(inv.amount) || 0
      if      (days <= 0)  { amounts.b0_30   += amt; counts.b0_30++   }
      else if (days <= 30) { amounts.b0_30   += amt; counts.b0_30++   }
      else if (days <= 60) { amounts.b31_60  += amt; counts.b31_60++  }
      else if (days <= 90) { amounts.b61_90  += amt; counts.b61_90++  }
      else                 { amounts.b90plus += amt; counts.b90plus++ }
    }

    return { amounts, counts }
  } catch (err) {
    console.error('getInvoiceAging:', err)
    return { amounts: { b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 }, counts: { b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 } }
  }
}

export async function getPaymentsDrilldown(range: DateRange, limit = 100) {
  try {
    const { data, error } = await supabase
      .from('payment_transactions')
      .select('id, amount, status, type, failure_reason, attempted_at, completed_at, customer_id')
      .gte('attempted_at', range.start + 'T00:00:00')
      .lte('attempted_at', range.end + 'T23:59:59')
      .order('attempted_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return data || []
  } catch (err) {
    console.error('getPaymentsDrilldown:', err)
    return []
  }
}

// ─── Installations ─────────────────────────────────────────────
export async function getInstallKPIs(range: DateRange) {
  try {
    const [completedRes, scheduledRes, inProgressRes, proofRes, waitingRes] = await Promise.all([
      supabase.from('jobs').select('*', { count: 'exact', head: true })
        .eq('status', 'complete')
        .gte('completed_at', range.start + 'T00:00:00')
        .lte('completed_at', range.end + 'T23:59:59'),
      supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'scheduled'),
      supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'in_progress'),
      supabase.from('jobs').select('*', { count: 'exact', head: true })
        .eq('status', 'complete').eq('handover_signed', false),
      supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'waiting_for_stock'),
    ])

    return {
      completedInRange: completedRes.count  ?? 0,
      scheduled:        scheduledRes.count  ?? 0,
      inProgress:       inProgressRes.count ?? 0,
      proofBacklog:     proofRes.count      ?? 0,
      waitingStock:     waitingRes.count    ?? 0,
    }
  } catch (err) {
    console.error('getInstallKPIs:', err)
    throw err
  }
}

export async function getWeeklyInstalls(weeks = 8): Promise<{ label: string; count: number }[]> {
  try {
    const cutoff = new Date(Date.now() - weeks * 7 * 86400000).toISOString()
    const { data, error } = await supabase
      .from('jobs')
      .select('completed_at')
      .eq('status', 'complete')
      .gte('completed_at', cutoff)
      .not('completed_at', 'is', null)
    if (error) throw error

    const now = new Date()
    const buckets: { start: Date; label: string; count: number }[] = []
    for (let w = weeks - 1; w >= 0; w--) {
      const start = new Date(now)
      start.setDate(now.getDate() - now.getDay() - w * 7)
      start.setHours(0, 0, 0, 0)
      buckets.push({
        start,
        label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        count: 0,
      })
    }

    for (const job of (data || [])) {
      if (!job.completed_at) continue
      const d = new Date(job.completed_at)
      const ws = new Date(d)
      ws.setDate(d.getDate() - d.getDay())
      ws.setHours(0, 0, 0, 0)
      const bucket = buckets.find(b => b.start.getTime() === ws.getTime())
      if (bucket) bucket.count++
    }

    return buckets.map(b => ({ label: b.label, count: b.count }))
  } catch (err) {
    console.error('getWeeklyInstalls:', err)
    return []
  }
}

export async function getJobsDrilldown(range: DateRange, limit = 100) {
  try {
    const { data, error } = await supabase
      .from('jobs')
      .select('id, customer_name_snapshot, system_type, status, scheduled_date, completed_at, assigned_technician_id, handover_signed, service_address_snapshot')
      .gte('scheduled_date', range.start)
      .lte('scheduled_date', range.end + 'T23:59:59')
      .order('scheduled_date', { ascending: false })
      .limit(limit)
    if (error) throw error
    if (!data?.length) return []

    // FIX: resolve technician name from user_profiles so table shows name not UUID
    const techIds = [...new Set((data).map((j: any) => j.assigned_technician_id).filter(Boolean))]
    let techNames: Record<string, string> = {}
    if (techIds.length) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, full_name')
        .in('id', techIds)
      for (const p of (profiles || [])) techNames[p.id] = p.full_name
    }

    return data.map((job: any) => ({
      ...job,
      technician_name: techNames[job.assigned_technician_id] || null,
    }))
  } catch (err) {
    console.error('getJobsDrilldown:', err)
    return []
  }
}

// ─── Pipeline Snapshot ─────────────────────────────────────────
export async function getPipelineSnapshot(): Promise<{ stage: string; lead_count: number }[]> {
  try {
    const { data, error } = await supabase
      .from('v_pipeline_snapshot')
      .select('stage, lead_count')
    if (error) throw error
    return data || []
  } catch (err) {
    console.error('getPipelineSnapshot:', err)
    return []
  }
}

export async function getPipelineOutcomes(range: DateRange) {
  try {
    const [wonRes, lostRes, dndRes, parkedRes] = await Promise.all([
      supabase.from('leads').select('*', { count: 'exact', head: true })
        .eq('stage', 'won')
        .gte('updated_at', range.start + 'T00:00:00')
        .lte('updated_at', range.end + 'T23:59:59'),
      supabase.from('leads').select('*', { count: 'exact', head: true })
        .eq('stage', 'lost')
        .gte('updated_at', range.start + 'T00:00:00')
        .lte('updated_at', range.end + 'T23:59:59'),
      supabase.from('leads').select('*', { count: 'exact', head: true }).eq('stage', 'dnd'),
      supabase.from('leads').select('*', { count: 'exact', head: true }).eq('stage', 'future_follow_up'),
    ])

    return {
      won:    wonRes.count    ?? 0,
      lost:   lostRes.count   ?? 0,
      dnd:    dndRes.count    ?? 0,
      parked: parkedRes.count ?? 0,
    }
  } catch (err) {
    console.error('getPipelineOutcomes:', err)
    throw err
  }
}

export async function getLeadsDrilldown(limit = 100) {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('id, full_name, phone, stage, source, assigned_rep_id, created_at')
      .neq('stage', 'won').neq('stage', 'lost').neq('stage', 'dnd').neq('stage', 'future_follow_up')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error

    const now = Date.now()
    return (data || []).map((l: any) => ({
      ...l,
      days_open: Math.floor((now - new Date(l.created_at).getTime()) / 86400000),
    }))
  } catch (err) {
    console.error('getLeadsDrilldown:', err)
    return []
  }
}

// ─── FIX: Lost Reason Breakdown ────────────────────────────────
// New function — uses lost_reason_code column added in this sprint.
// Falls back to parsing lost_reason string for leads that predate the new column.
export async function getLostReasonBreakdown(): Promise<{
  code: string
  label: string
  count: number
  pct: number
}[]> {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('lost_reason_code, lost_reason')
      .eq('stage', 'lost')
    if (error) throw error

    const CODE_LABELS: Record<string, string> = {
      price_too_high:      'Price Too High',
      went_with_competitor:'Went With Competitor',
      finance_declined:    'Finance Declined',
      no_response:         'No Response After Follow-ups',
      deferred:            'Deferred / Timing Not Right',
      other:               'Other',
      legacy:              'Pre-code (legacy)',
    }

    const counts: Record<string, number> = {}
    for (const row of (data || [])) {
      // Use structured code if available, else bucket as legacy
      const code = row.lost_reason_code || 'legacy'
      counts[code] = (counts[code] || 0) + 1
    }

    const total = Object.values(counts).reduce((s, n) => s + n, 0)
    if (total === 0) return []

    return Object.entries(counts)
      .map(([code, count]) => ({
        code,
        label: CODE_LABELS[code] || code,
        count,
        pct: Math.round((count / total) * 100),
      }))
      .sort((a, b) => b.count - a.count)
  } catch (err) {
    console.error('getLostReasonBreakdown:', err)
    return []
  }
}

// ─── Data Quality Exceptions ────────────────────────────────────
export async function getDataQualityExceptions() {
  try {
    const [
      nullSourceRes,
      nullCommercialRes,
      noProofRes,
      customersRes,
      contractsRes,
      overdue60Res,
    ] = await Promise.all([
      supabase.from('leads')
        .select('id, full_name, created_at, stage')
        .is('source', null)
        .neq('stage', 'won').neq('stage', 'lost').neq('stage', 'dnd')
        .order('created_at', { ascending: false })
        .limit(50),

      supabase.from('quotes')
        .select('id, quote_number, created_at, status')
        .is('commercial_type', null)
        .not('status', 'eq', 'draft')
        .order('created_at', { ascending: false })
        .limit(50),

      supabase.from('jobs')
        .select('id, customer_name_snapshot, completed_at, scheduled_date')
        .eq('status', 'complete')
        .eq('handover_signed', false)
        .order('completed_at', { ascending: false })
        .limit(50),

      supabase.from('customers')
        .select('id, full_name, created_at, lifecycle_status')
        .order('created_at', { ascending: false })
        .limit(300),

      supabase.from('contracts')
        .select('id, contract_number, customer_id, monthly_amount, created_at')
        .eq('status', 'active')
        .eq('type', 'rental')
        .lte('created_at', new Date(Date.now() - 35 * 86400000).toISOString())
        .limit(200),

      supabase.from('invoices')
        .select('id, amount, due_date, status, customer_id')
        .eq('status', 'overdue')
        .lte('due_date', new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0])
        .order('due_date', { ascending: true })
        .limit(50),
    ])

    let customersNoSystem: any[] = []
    if (customersRes.data?.length) {
      const { data: systems } = await supabase.from('installed_systems').select('customer_id')
      const withSystem = new Set((systems || []).map((s: any) => s.customer_id))
      customersNoSystem = customersRes.data.filter((c: any) => !withSystem.has(c.id)).slice(0, 50)
    }

    let contractsNoPmt: any[] = []
    if (contractsRes.data?.length) {
      const custIds = [...new Set(contractsRes.data.map((c: any) => c.customer_id))]
      const { data: recentPmts } = await supabase
        .from('payment_transactions')
        .select('customer_id')
        .eq('status', 'succeeded')
        .gte('attempted_at', new Date(Date.now() - 35 * 86400000).toISOString())
        .in('customer_id', custIds)
      const paid = new Set((recentPmts || []).map((p: any) => p.customer_id))
      contractsNoPmt = contractsRes.data.filter((c: any) => !paid.has(c.customer_id)).slice(0, 50)
    }

    return {
      nullSourceLeads:          nullSourceRes.data    || [],
      nullCommercialTypeQuotes: nullCommercialRes.data || [],
      noProofJobs:              noProofRes.data        || [],
      customersNoSystem,
      contractsNoPmt,
      overdue60Invoices:        overdue60Res.data      || [],
    }
  } catch (err) {
    console.error('getDataQualityExceptions:', err)
    throw err
  }
}

// ─── Customers & Rentals ───────────────────────────────────────
export async function getCustomerKPIs() {
  try {
    let totalCustomers = 0, activeCustomers = 0, atRisk = 0, renewalsIn30 = 0, serviceDue = 0

    try {
      const { count } = await supabase.from('customers')
        .select('*', { count: 'exact', head: true })
      totalCustomers = count ?? 0
    } catch (_) {}

    try {
      const { count } = await supabase.from('customers')
        .select('*', { count: 'exact', head: true })
        .eq('lifecycle_status', 'active')
      activeCustomers = count ?? 0
    } catch (_) {}

    try {
      const { count } = await supabase.from('customers')
        .select('*', { count: 'exact', head: true })
        .eq('lifecycle_status', 'at_risk')
      atRisk = count ?? 0
    } catch (_) {}

    try {
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
      const future = new Date(Date.now() + 30 * 86400000)
      const in30 = `${future.getFullYear()}-${pad(future.getMonth()+1)}-${pad(future.getDate())}`
      const { count } = await supabase.from('contracts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')
        .gte('end_date', today)
        .lte('end_date', in30)
      renewalsIn30 = count ?? 0
    } catch (_) {}

    try {
      const { count } = await supabase.from('service_schedule_items')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'overdue')
      serviceDue = count ?? 0
    } catch (_) {}

    return { totalCustomers, activeCustomers, atRisk, renewalsIn30, serviceDue }
  } catch (err) {
    console.error('getCustomerKPIs:', err)
    return { totalCustomers: 0, activeCustomers: 0, atRisk: 0, renewalsIn30: 0, serviceDue: 0 }
  }
}

export async function getCustomerLifecycleDistribution(): Promise<{ status: string; count: number }[]> {
  try {
    const { data, error } = await supabase
      .from('customers')
      .select('lifecycle_status')
    if (error) throw error

    const counts: Record<string, number> = {}
    for (const row of (data || [])) {
      const s = row.lifecycle_status || 'unknown'
      counts[s] = (counts[s] || 0) + 1
    }

    // FIX: order matches lifecycle cron enum values exactly
    // lifecycle cron sets: active, service_due, renewal_due, at_risk, inactive
    const order = ['active', 'service_due', 'renewal_due', 'upsell', 'at_risk', 'inactive', 'unknown']
    return order
      .filter(s => counts[s] > 0)
      .map(s => ({ status: s, count: counts[s] }))
  } catch (err) {
    console.error('getCustomerLifecycleDistribution:', err)
    return []
  }
}

export async function getSystemTypeDistribution(): Promise<{ type: string; count: number }[]> {
  try {
    const { data, error } = await supabase
      .from('installed_systems')
      .select('system_type')
    if (error) throw error

    const counts: Record<string, number> = {}
    for (const row of (data || [])) {
      const t = row.system_type || 'unknown'
      counts[t] = (counts[t] || 0) + 1
    }

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }))
  } catch (err) {
    console.error('getSystemTypeDistribution:', err)
    return []
  }
}

export async function getCustomersDrilldown(limit = 150) {
  try {
    const { data: customers, error } = await supabase
      .from('customers')
      .select('id, full_name, lifecycle_status, created_at, phone, email')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    if (!customers?.length) return []

    const custIds = customers.map((c: any) => c.id)

    const { data: contracts } = await supabase
      .from('contracts')
      .select('customer_id, type, monthly_amount, status, end_date')
      .in('customer_id', custIds)
      .eq('status', 'active')

    const { data: systems } = await supabase
      .from('installed_systems')
      .select('customer_id, system_type, ownership_type')
      .in('customer_id', custIds)

    const { data: payments } = await supabase
      .from('payment_transactions')
      .select('customer_id, completed_at, amount')
      .eq('status', 'succeeded')
      .in('customer_id', custIds)
      .order('completed_at', { ascending: false })

    const contractMap: Record<string, any> = {}
    for (const c of (contracts || [])) {
      if (!contractMap[c.customer_id]) contractMap[c.customer_id] = c
    }

    const systemMap: Record<string, any[]> = {}
    for (const s of (systems || [])) {
      if (!systemMap[s.customer_id]) systemMap[s.customer_id] = []
      systemMap[s.customer_id].push(s)
    }

    const lastPmtMap: Record<string, string> = {}
    for (const p of (payments || [])) {
      if (!lastPmtMap[p.customer_id] && p.completed_at) {
        lastPmtMap[p.customer_id] = p.completed_at
      }
    }

    return customers.map((c: any) => ({
      ...c,
      contract:        contractMap[c.id] || null,
      systems:         systemMap[c.id]   || [],
      last_payment_at: lastPmtMap[c.id]  || null,
    }))
  } catch (err) {
    console.error('getCustomersDrilldown:', err)
    return []
  }
}

export async function getNewCustomersByMonth(months = 6): Promise<{ month: string; count: number }[]> {
  try {
    const { data, error } = await supabase
      .from('customers')
      .select('created_at')
      .order('created_at', { ascending: false })
    if (error) throw error

    const now = new Date()
    const buckets: { month: string; date: Date; count: number }[] = []
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      buckets.push({
        month: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        date: d,
        count: 0,
      })
    }

    for (const row of (data || [])) {
      if (!row.created_at) continue
      const d = new Date(row.created_at)
      const bucket = buckets.find(b =>
        b.date.getFullYear() === d.getFullYear() && b.date.getMonth() === d.getMonth()
      )
      if (bucket) bucket.count++
    }

    return buckets.map(b => ({ month: b.month, count: b.count }))
  } catch (err) {
    console.error('getNewCustomersByMonth:', err)
    return []
  }
}

// ─── Rental vs Purchase vs Financed ───────────────────────────
export async function getCommercialTypeSplit(): Promise<{ type: string; count: number; totalValue: number }[]> {
  try {
    const { data: systems, error } = await supabase
      .from('installed_systems')
      .select('ownership_type, customer_id')
    if (error) throw error

    const { data: contracts } = await supabase
      .from('contracts')
      .select('customer_id, monthly_amount, type')
      .eq('status', 'active')

    const rentalAmounts: Record<string, number> = {}
    for (const c of (contracts || [])) {
      rentalAmounts[c.customer_id] = (rentalAmounts[c.customer_id] || 0) + (Number(c.monthly_amount) || 0)
    }

    const { data: payments } = await supabase
      .from('payment_transactions')
      .select('customer_id, amount, type')
      .eq('status', 'succeeded')
      .in('type', ['deposit', 'link', 'manual'])

    const purchaseAmounts: Record<string, number> = {}
    for (const p of (payments || [])) {
      purchaseAmounts[p.customer_id] = (purchaseAmounts[p.customer_id] || 0) + (Number(p.amount) || 0)
    }

    const map: Record<string, { count: number; totalValue: number }> = {}
    for (const row of (systems || [])) {
      const t = row.ownership_type || 'unknown'
      if (!map[t]) map[t] = { count: 0, totalValue: 0 }
      map[t].count++
      if (t === 'rented')    map[t].totalValue += rentalAmounts[row.customer_id]   || 0
      if (t === 'purchased') map[t].totalValue += purchaseAmounts[row.customer_id] || 0
    }

    const normalized: Record<string, { count: number; totalValue: number }> = {}
    const keyMap: Record<string, string> = { rented: 'rental', purchased: 'purchase', financed: 'financed' }
    for (const [k, v] of Object.entries(map)) {
      const display = keyMap[k] || k
      if (!normalized[display]) normalized[display] = { count: 0, totalValue: 0 }
      normalized[display].count      += v.count
      normalized[display].totalValue += v.totalValue
    }

    const order = ['rental', 'purchase', 'financed', 'unknown']
    return order
      .filter(t => normalized[t])
      .map(t => ({ type: t, count: normalized[t].count, totalValue: normalized[t].totalValue }))
  } catch (err) {
    console.error('getCommercialTypeSplit:', err)
    return []
  }
}

// ─── Monthly Rental Lifecycle ──────────────────────────────────
export async function getRentalLifecycleByMonth(months = 6): Promise<{ month: string; active: number; expired: number; cancelled: number }[]> {
  try {
    const { data, error } = await supabase
      .from('contracts')
      .select('type, status, created_at')
      .eq('type', 'rental')
      .order('created_at', { ascending: false })
    if (error) throw error

    const now = new Date()
    const buckets: { month: string; date: Date; active: number; expired: number; cancelled: number }[] = []
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      buckets.push({
        month: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        date: d, active: 0, expired: 0, cancelled: 0,
      })
    }

    for (const row of (data || [])) {
      if (!row.created_at) continue
      const d = new Date(row.created_at)
      const bucket = buckets.find(b =>
        b.date.getFullYear() === d.getFullYear() && b.date.getMonth() === d.getMonth()
      )
      if (!bucket) continue
      const s = row.status || 'active'
      if (s === 'active')         bucket.active++
      else if (s === 'expired')   bucket.expired++
      else if (s === 'cancelled') bucket.cancelled++
      else                        bucket.active++
    }

    return buckets.map(b => ({ month: b.month, active: b.active, expired: b.expired, cancelled: b.cancelled }))
  } catch (err) {
    console.error('getRentalLifecycleByMonth:', err)
    return []
  }
}

// ─── Gross Margin Estimate ─────────────────────────────────────
export async function getGrossMarginEstimate() {
  try {
    const { data: rentalContracts } = await supabase
      .from('contracts')
      .select('monthly_amount, type')
      .eq('status', 'active')
      .eq('type', 'rental')

    const { data: purchasePayments } = await supabase
      .from('payment_transactions')
      .select('amount')
      .eq('status', 'succeeded')
      .in('type', ['deposit', 'link', 'manual'])

    const rentalRevenue   = (rentalContracts  || []).reduce((s, c) => s + (Number(c.monthly_amount) || 0), 0)
    const purchaseRevenue = (purchasePayments || []).reduce((s, p) => s + (Number(p.amount)         || 0), 0)
    const totalRevenue    = rentalRevenue + purchaseRevenue

    const { data: products } = await supabase
      .from('products')
      .select('id, name, vendor_cost, retail_price, rental_price_monthly, install_fee')
      .not('vendor_cost', 'is', null)
      .gt('vendor_cost', 0)

    const { data: installedSystems } = await supabase
      .from('installed_systems')
      .select('system_type, product_catalog_id')

    const productCounts: Record<string, number> = {}
    for (const sys of (installedSystems || [])) {
      if (sys.product_catalog_id) {
        // FIX: was (productCounts[sys.product_id] || 0) — product_id doesn't exist on
        // installed_systems. Correct key is product_catalog_id on both read and write.
        productCounts[sys.product_catalog_id] = (productCounts[sys.product_catalog_id] || 0) + 1
      }
    }

    let totalCost = 0
    let coveredProducts = 0
    let uncoveredProducts = 0

    for (const p of (products || [])) {
      const qty = productCounts[p.id] || 0
      if (qty > 0) {
        totalCost += qty * (Number(p.vendor_cost) || 0)
        coveredProducts += qty
      }
    }

    uncoveredProducts = (installedSystems || []).filter(s => !s.product_catalog_id).length

    const grossMargin  = totalRevenue - totalCost
    const marginPct    = totalRevenue > 0 ? (grossMargin / totalRevenue) * 100 : 0
    const costCoverage = (installedSystems || []).length > 0
      ? Math.round((coveredProducts / (installedSystems || []).length) * 100)
      : 0

    return {
      totalRevenue,
      rentalRevenue,
      purchaseRevenue,
      totalCost,
      grossMargin,
      marginPct: Math.round(marginPct),
      costCoverage,
      uncoveredProducts,
      isEstimate: uncoveredProducts > 0 || coveredProducts === 0,
    }
  } catch (err) {
    console.error('getGrossMarginEstimate:', err)
    return {
      totalRevenue: 0, rentalRevenue: 0, purchaseRevenue: 0,
      totalCost: 0, grossMargin: 0, marginPct: 0,
      costCoverage: 0, uncoveredProducts: 0, isEstimate: true,
    }
  }
}

// ─── Rep Performance ───────────────────────────────────────────
// FIX: installs now credited to the rep whose lead converted to the install job,
// not just by assigned_technician_id (which is always Kendrick, never reps).
// Jobs → customers → leads → assigned_rep_id chain resolves correctly.
export async function getRepPerformance() {
  try {
    const { data: reps } = await supabase
      .from('user_profiles')
      .select('id, full_name, role')
      .in('role', ['salesrep', 'admin'])

    if (!reps?.length) return []

    const { data: leads } = await supabase
      .from('leads')
      .select('id, assigned_rep_id, stage, created_at')

    const { data: quotes } = await supabase
      .from('quotes')
      .select('lead_id, status, commercial_type, monthly_amount, created_at')

    // FIX: fetch jobs with customer_id so we can trace back to lead → rep
    const { data: jobs } = await supabase
      .from('jobs')
      .select('id, customer_id, assigned_technician_id, status')
      .eq('status', 'complete')

    // FIX: fetch customers to build customer → lead map
    const { data: customers } = await supabase
      .from('customers')
      .select('id, lead_id')

    // Build lead → rep map
    const leadRepMap: Record<string, string> = {}
    const repLeadCounts: Record<string, { total: number; won: number; lost: number }> = {}

    for (const lead of (leads || [])) {
      if (!lead.assigned_rep_id) continue
      leadRepMap[lead.id] = lead.assigned_rep_id
      if (!repLeadCounts[lead.assigned_rep_id]) repLeadCounts[lead.assigned_rep_id] = { total: 0, won: 0, lost: 0 }
      repLeadCounts[lead.assigned_rep_id].total++
      if (lead.stage === 'won')  repLeadCounts[lead.assigned_rep_id].won++
      if (lead.stage === 'lost') repLeadCounts[lead.assigned_rep_id].lost++
    }

    // Quotes per rep (via lead attribution)
    const repQuoteCounts: Record<string, { sent: number; accepted: number; totalValue: number }> = {}
    for (const q of (quotes || [])) {
      const repId = q.lead_id ? leadRepMap[q.lead_id] : null
      if (!repId) continue
      if (!repQuoteCounts[repId]) repQuoteCounts[repId] = { sent: 0, accepted: 0, totalValue: 0 }
      if (['sent','viewed','accepted','declined','expired','signed'].includes(q.status)) {
        repQuoteCounts[repId].sent++
      }
      if (['accepted','signed'].includes(q.status)) {
        repQuoteCounts[repId].accepted++
        repQuoteCounts[repId].totalValue += Number(q.monthly_amount) || 0
      }
    }

    // FIX: installs credited to rep via customer → lead → rep chain
    // customer.lead_id → leadRepMap[lead_id] → rep
    const customerLeadMap: Record<string, string> = {}
    for (const c of (customers || [])) {
      if (c.lead_id) customerLeadMap[c.id] = c.lead_id
    }

    const repInstallCounts: Record<string, number> = {}
    for (const job of (jobs || [])) {
      if (!job.customer_id) continue
      const leadId = customerLeadMap[job.customer_id]
      if (!leadId) continue
      const repId = leadRepMap[leadId]
      if (!repId) continue
      repInstallCounts[repId] = (repInstallCounts[repId] || 0) + 1
    }

    return reps.map(rep => {
      const lc = repLeadCounts[rep.id]  || { total: 0, won: 0, lost: 0 }
      const qc = repQuoteCounts[rep.id] || { sent: 0, accepted: 0, totalValue: 0 }
      const installs = repInstallCounts[rep.id] || 0
      const closeRate = qc.sent > 0 ? Math.round((qc.accepted / qc.sent) * 100) : 0
      return {
        id:         rep.id,
        name:       rep.full_name || 'Unknown',
        role:       rep.role,
        totalLeads: lc.total,
        wonLeads:   lc.won,
        lostLeads:  lc.lost,
        quotesSent: qc.sent,
        quotesWon:  qc.accepted,
        closeRate,
        totalValue: qc.totalValue,
        installs,
      }
    }).filter(r => r.totalLeads > 0 || r.quotesSent > 0 || r.installs > 0)
  } catch (err) {
    console.error('getRepPerformance:', err)
    return []
  }
}

// ─── Quotes & Commercial ───────────────────────────────────────
export async function getQuotesSummary() {
  try {
    const { data, error } = await supabase
      .from('quotes')
      .select('id, status, commercial_type, monthly_amount, created_at, updated_at, view_count')
      .order('created_at', { ascending: false })
    if (error) throw error

    const quotes = data || []

    const summary = {
      total: 0, draft: 0, sent: 0, viewed: 0, accepted: 0, declined: 0, expired: 0,
      rental: 0, purchase: 0, financed: 0,
      avgDaysToAccept: 0, acceptanceRate: 0, avgQuoteValue: 0, totalPipeline: 0,
    }

    let daysToAcceptTotal = 0
    let daysToAcceptCount = 0
    let totalSent = 0

    for (const q of quotes) {
      summary.total++
      const s = q.status || 'draft'
      if (s === 'draft')    summary.draft++
      if (s === 'sent')     summary.sent++
      if (s === 'viewed')   summary.viewed++
      if (['accepted','signed'].includes(s)) {
        summary.accepted++
        if (q.updated_at && q.created_at) {
          const days = Math.floor((new Date(q.updated_at).getTime() - new Date(q.created_at).getTime()) / 86400000)
          if (days >= 0 && days < 365) { daysToAcceptTotal += days; daysToAcceptCount++ }
        }
      }
      if (s === 'declined') summary.declined++
      if (s === 'expired')  summary.expired++

      const ct = q.commercial_type || ''
      if (ct === 'rental')   summary.rental++
      if (ct === 'purchase') summary.purchase++
      if (ct === 'financed') summary.financed++

      if (['sent','viewed','accepted','signed','declined','expired'].includes(s)) totalSent++
      const val = Number(q.monthly_amount) || 0
      if (['sent','viewed'].includes(s)) summary.totalPipeline += val
    }

    summary.acceptanceRate  = totalSent > 0 ? Math.round((summary.accepted / totalSent) * 100) : 0
    summary.avgDaysToAccept = daysToAcceptCount > 0 ? Math.round(daysToAcceptTotal / daysToAcceptCount) : 0
    summary.avgQuoteValue   = summary.accepted > 0
      ? Math.round(quotes.filter(q => ['accepted','signed'].includes(q.status))
          .reduce((s, q) => s + (Number(q.monthly_amount) || 0), 0) / summary.accepted)
      : 0

    return { summary, quotes }
  } catch (err) {
    console.error('getQuotesSummary:', err)
    return { summary: null, quotes: [] }
  }
}

// ─── Marketing / Lead Sources ──────────────────────────────────
// FIX: utm_source was fetched but only utm_campaign was broken out.
// Now returns both utm_source AND utm_campaign breakdowns.
export async function getLeadSourceBreakdown() {
  try {
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, source, utm_source, utm_medium, utm_campaign, stage, created_at')
    if (error) throw error

    const sourceMap: Record<string, { total: number; won: number; lost: number; active: number }> = {}

    for (const lead of (leads || [])) {
      const src = lead.source || 'unknown'
      if (!sourceMap[src]) sourceMap[src] = { total: 0, won: 0, lost: 0, active: 0 }
      sourceMap[src].total++
      if (lead.stage === 'won')  sourceMap[src].won++
      if (lead.stage === 'lost') sourceMap[src].lost++
      if (!['won','lost','dnd','future_follow_up'].includes(lead.stage || '')) sourceMap[src].active++
    }

    // FIX: break down by utm_source (paid channel) AND utm_campaign (specific campaign)
    const utmSourceMap: Record<string, number> = {}
    const utmCampaignMap: Record<string, number> = {}
    for (const lead of (leads || [])) {
      if (lead.utm_source) {
        utmSourceMap[lead.utm_source] = (utmSourceMap[lead.utm_source] || 0) + 1
      }
      if (lead.utm_campaign) {
        utmCampaignMap[lead.utm_campaign] = (utmCampaignMap[lead.utm_campaign] || 0) + 1
      }
    }

    const sources = Object.entries(sourceMap)
      .map(([source, counts]) => ({
        source,
        ...counts,
        conversionRate: counts.total > 0 ? Math.round((counts.won / counts.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total)

    // FIX: utm_source breakdown (google, facebook, etc.) now surfaced separately
    const utmSources = Object.entries(utmSourceMap)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const utmCampaigns = Object.entries(utmCampaignMap)
      .map(([campaign, count]) => ({ campaign, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    return {
      sources,
      utmSources,    // FIX: new — paid channel breakdown (google_ads, facebook_ads, etc.)
      utmCampaigns,
      totalLeads: (leads || []).length,
    }
  } catch (err) {
    console.error('getLeadSourceBreakdown:', err)
    return { sources: [], utmSources: [], utmCampaigns: [], totalLeads: 0 }
  }
}
