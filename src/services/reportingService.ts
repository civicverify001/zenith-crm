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

// ─── Executive KPIs ────────────────────────────────────────────
export async function getExecutiveKPIs(range: DateRange) {
  try {
    const [
      activeLeadsRes,
      contractsRes,
      paymentsRes,
      installsRes,
      failedRes,
      unsignedRes,
      unassignedRes,
    ] = await Promise.all([
      supabase.from('leads')
        .select('*', { count: 'exact', head: true })
        .not('stage', 'in', '(won,lost,dnd,future_follow_up)'),

      supabase.from('contracts')
        .select('monthly_amount')
        .eq('status', 'active'),

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

    const mrr = (contractsRes.data || []).reduce(
      (s, c) => s + (Number(c.monthly_amount) || 0), 0
    )
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
    const [contractsRes, overdueRes, failedRes, collectedRes] = await Promise.all([
      supabase.from('contracts').select('monthly_amount').eq('status', 'active'),
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

    return {
      mrr:                  (contractsRes.data || []).reduce((s, c) => s + (Number(c.monthly_amount) || 0), 0),
      overdueTotal:         (overdueRes.data  || []).reduce((s, i) => s + (Number(i.amount)         || 0), 0),
      cashCollected:        (collectedRes.data || []).reduce((s, p) => s + (Number(p.amount)        || 0), 0),
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
    return (data || []).reverse() // oldest first for chart
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
      .select('id, amount, status, type, failure_reason, attempted_at, completed_at, customer_id, customers!inner(full_name)')
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
        .eq('status', 'complete').eq('proof_approved', false),
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

    // Build week buckets
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
      .select('id, customer_name_snapshot, system_type, status, scheduled_date, completed_at, assigned_technician_name, proof_approved, service_address_snapshot')
      .gte('scheduled_date', range.start)
      .lte('scheduled_date', range.end + 'T23:59:59')
      .order('scheduled_date', { ascending: false })
      .limit(limit)
    if (error) throw error
    return data || []
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

// Won/Lost use updated_at — labeled approximate in UI
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
      .not('stage', 'in', '(won,lost,dnd,future_follow_up)')
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
      // 1. Leads with null or blank source
      supabase.from('leads')
        .select('id, full_name, created_at, stage')
        .or('source.is.null,source.eq.')
        .not('stage', 'in', '(won,lost,dnd)')
        .order('created_at', { ascending: false })
        .limit(50),

      // 2. Non-draft quotes missing commercial_type
      supabase.from('quotes')
        .select('id, quote_number, created_at, status')
        .is('commercial_type', null)
        .not('status', 'eq', 'draft')
        .order('created_at', { ascending: false })
        .limit(50),

      // 3. Jobs complete, proof not approved
      supabase.from('jobs')
        .select('id, customer_name_snapshot, completed_at, scheduled_date')
        .eq('status', 'complete')
        .eq('proof_approved', false)
        .order('completed_at', { ascending: false })
        .limit(50),

      // 4. All customers (filter no-system client-side)
      supabase.from('customers')
        .select('id, full_name, created_at, lifecycle_status')
        .order('created_at', { ascending: false })
        .limit(300),

      // 5. Active rental contracts signed 35+ days ago
      supabase.from('contracts')
        .select('id, contract_number, customer_id, monthly_amount, created_at, customers!inner(full_name)')
        .eq('status', 'active')
        .eq('type', 'rental')
        .lte('created_at', new Date(Date.now() - 35 * 86400000).toISOString())
        .limit(200),

      // 6. Invoices overdue 60+ days
      supabase.from('invoices')
        .select('id, amount, due_date, status, customer_id, customers!inner(full_name)')
        .eq('status', 'overdue')
        .lte('due_date', new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0])
        .order('due_date', { ascending: true })
        .limit(50),
    ])

    // Client-side: customers with no installed system
    let customersNoSystem: any[] = []
    if (customersRes.data?.length) {
      const { data: systems } = await supabase.from('installed_systems').select('customer_id')
      const withSystem = new Set((systems || []).map((s: any) => s.customer_id))
      customersNoSystem = customersRes.data.filter((c: any) => !withSystem.has(c.id)).slice(0, 50)
    }

    // Client-side: active rental contracts with no recent payment (account-level)
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
