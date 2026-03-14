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
        .not('stage', 'in', '("won","lost","dnd","future_follow_up")'),

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
      .not('stage', 'in', '("won","lost","dnd","future_follow_up")')
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

// ─── Customers & Rentals ───────────────────────────────────────

export async function getCustomerKPIs() {
  try {
    // Run each query independently so one failure doesn't kill the rest
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

    // Get contracts
    const { data: contracts } = await supabase
      .from('contracts')
      .select('customer_id, type, monthly_amount, status, end_date')
      .in('customer_id', custIds)
      .eq('status', 'active')

    // Get installed systems
    const { data: systems } = await supabase
      .from('installed_systems')
      .select('customer_id, system_type, ownership_type')
      .in('customer_id', custIds)

    // Get last payment per customer
    const { data: payments } = await supabase
      .from('payment_transactions')
      .select('customer_id, completed_at, amount')
      .eq('status', 'succeeded')
      .in('customer_id', custIds)
      .order('completed_at', { ascending: false })

    // Build maps
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
    // Source: installed_systems.ownership_type — more reliable than contracts.type
    // because purchases do not always create a contracts row
    const { data: systems, error } = await supabase
      .from('installed_systems')
      .select('ownership_type, customer_id')
    if (error) throw error

    // Get monthly amounts for rentals from contracts
    const { data: contracts } = await supabase
      .from('contracts')
      .select('customer_id, monthly_amount, type')
      .eq('status', 'active')

    const rentalAmounts: Record<string, number> = {}
    for (const c of (contracts || [])) {
      rentalAmounts[c.customer_id] = (rentalAmounts[c.customer_id] || 0) + (Number(c.monthly_amount) || 0)
    }

    // Get purchase amounts from succeeded payment_transactions (one-time payments)
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
      if (t === 'rented')    map[t].totalValue += rentalAmounts[row.customer_id]  || 0
      if (t === 'purchased') map[t].totalValue += purchaseAmounts[row.customer_id] || 0
    }

    // Normalize key names for display
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
// Revenue = active contract monthly amounts + paid invoices (purchase)
// Cost    = vendor_cost from products, matched via installed_systems + source_quote_id
// WARNING: Only products with vendor_cost populated contribute to cost.
//          If vendor_cost is null or missing, margin will be overstated.
export async function getGrossMarginEstimate() {
  try {
    // Revenue side
    const { data: rentalContracts } = await supabase
      .from('contracts')
      .select('monthly_amount, type')
      .eq('status', 'active')
      .eq('type', 'rental')

    // Purchase revenue: use payment_transactions (succeeded, non-autopay)
    // because invoices may not reach status=paid even after Stripe payment
    const { data: purchasePayments } = await supabase
      .from('payment_transactions')
      .select('amount')
      .eq('status', 'succeeded')
      .in('type', ['deposit', 'link', 'manual'])

    const rentalRevenue   = (rentalContracts  || []).reduce((s, c) => s + (Number(c.monthly_amount) || 0), 0)
    const purchaseRevenue = (purchasePayments || []).reduce((s, p) => s + (Number(p.amount)         || 0), 0)
    const totalRevenue    = rentalRevenue + purchaseRevenue

    // Cost side — via product catalog vendor_cost
    const { data: products } = await supabase
      .from('products')
      .select('id, name, vendor_cost, retail_price, rental_price_monthly, install_fee')
      .not('vendor_cost', 'is', null)
      .gt('vendor_cost', 0)

    // How many of each product is installed (from installed_systems + system_type match)
    const { data: installedSystems } = await supabase
      .from('installed_systems')
      .select('system_type, product_catalog_id')

    // Count by product_id where available, else skip
    const productCounts: Record<string, number> = {}
    for (const sys of (installedSystems || [])) {
      if (sys.product_catalog_id) {
       productCounts[sys.product_catalog_id] = (productCounts[sys.product_catalog_id] || 0) + 1
      }
    }

    let totalCost = 0
    let coveredProducts = 0
    let uncoveredProducts = 0

    for (const p of (products || [])) {
      const qty  = productCounts[p.id] || 0
      if (qty > 0) {
        totalCost += qty * (Number(p.vendor_cost) || 0)
        coveredProducts += qty
      }
    }

    // Count installs with no product_id (uncovered)
    uncoveredProducts = (installedSystems || []).filter(s => !s.product_catalog_id).length

    const grossMargin    = totalRevenue - totalCost
    const marginPct      = totalRevenue > 0 ? (grossMargin / totalRevenue) * 100 : 0
    const costCoverage   = (installedSystems || []).length > 0
      ? Math.round((coveredProducts / (installedSystems || []).length) * 100)
      : 0

    return {
      totalRevenue,
      rentalRevenue,
      purchaseRevenue,
      totalCost,
      grossMargin,
      marginPct: Math.round(marginPct),
      costCoverage,       // % of installed systems with cost data
      uncoveredProducts,  // systems with no product_id = no cost data
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
