// src/services/fulfillmentService.ts
// SINGLE OWNER: All fulfillment_requests CRUD lives here.
// Only autopay.js also writes to this table (on successful charge).

import { supabase } from '../lib/supabase'

// ── Types ────────────────────────────────────────────────────────

export type FulfillmentType = 'tech_visit' | 'maintenance_visit' | 'shipment'

export type FulfillmentStatus =
  | 'paid_awaiting_schedule'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled'

export interface FulfillmentRequest {
  id: string
  customer_id: string
  customer_service_plan_id: string
  type: FulfillmentType
  status: FulfillmentStatus
  payment_transaction_id: string | null
  job_id: string | null
  shipment_id: string | null
  due_date: string
  scheduled_date: string | null
  completed_at: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // Joined fields
  customers?: { id: string; full_name: string; phone: string; email: string }
  customer_service_plans?: {
    id: string
    plan_name: string
    status: string
    next_fulfillment_date: string | null
    service_plans?: { id: string; name: string; fulfillment_type: string }
  }
}

export interface CreateFulfillmentInput {
  customer_id: string
  customer_service_plan_id: string
  type: FulfillmentType
  payment_transaction_id?: string | null
  due_date?: string
  notes?: string | null
  created_by?: string | null
}

// ── Queries ──────────────────────────────────────────────────────

const SELECT_WITH_JOINS = `
  *,
  customers!inner(id, full_name, phone, email),
  customer_service_plans!inner(
    id, plan_name, status, next_fulfillment_date,
    service_plans(id, name, fulfillment_type)
  )
`

export async function fetchFulfillmentRequests(filters?: {
  status?: FulfillmentStatus | FulfillmentStatus[]
  type?: FulfillmentType
  customerId?: string
}) {
  let query = supabase
    .from('fulfillment_requests')
    .select(SELECT_WITH_JOINS)
    .order('due_date', { ascending: true })
    .order('created_at', { ascending: true })

  if (filters?.status) {
    if (Array.isArray(filters.status)) {
      query = query.in('status', filters.status)
    } else {
      query = query.eq('status', filters.status)
    }
  }
  if (filters?.type) query = query.eq('type', filters.type)
  if (filters?.customerId) query = query.eq('customer_id', filters.customerId)

  const { data, error } = await query
  if (error) throw error
  return data as FulfillmentRequest[]
}

export async function fetchFulfillmentById(id: string) {
  const { data, error } = await supabase
    .from('fulfillment_requests')
    .select(SELECT_WITH_JOINS)
    .eq('id', id)
    .single()
  if (error) throw error
  return data as FulfillmentRequest
}

export async function fetchByCustomer(customerId: string) {
  const { data, error } = await supabase
    .from('fulfillment_requests')
    .select(SELECT_WITH_JOINS)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as FulfillmentRequest[]
}

// ── Dashboard Counts ─────────────────────────────────────────────

export async function getAwaitingScheduleCount() {
  const { count, error } = await supabase
    .from('fulfillment_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'paid_awaiting_schedule')
  if (error) throw error
  return count ?? 0
}

export async function getAwaitingScheduleList() {
  const { data, error } = await supabase
    .from('fulfillment_requests')
    .select(SELECT_WITH_JOINS)
    .eq('status', 'paid_awaiting_schedule')
    .order('due_date', { ascending: true })
    .limit(20)
  if (error) throw error
  return data as FulfillmentRequest[]
}

export async function getScheduledThisWeek() {
  const now = new Date()
  const startOfWeek = new Date(now)
  startOfWeek.setDate(now.getDate() - now.getDay())
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 6)

  const { data, error } = await supabase
    .from('fulfillment_requests')
    .select(SELECT_WITH_JOINS)
    .eq('status', 'scheduled')
    .gte('scheduled_date', startOfWeek.toISOString().split('T')[0])
    .lte('scheduled_date', endOfWeek.toISOString().split('T')[0])
    .order('scheduled_date', { ascending: true })
  if (error) throw error
  return data as FulfillmentRequest[]
}

export async function getOverdueFulfillments() {
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  const { data, error } = await supabase
    .from('fulfillment_requests')
    .select(SELECT_WITH_JOINS)
    .eq('status', 'paid_awaiting_schedule')
    .lte('due_date', sevenDaysAgo.toISOString().split('T')[0])
    .order('due_date', { ascending: true })
  if (error) throw error
  return data as FulfillmentRequest[]
}

// ── Mutations ────────────────────────────────────────────────────

export async function createFulfillmentRequest(input: CreateFulfillmentInput) {
  const { data, error } = await supabase
    .from('fulfillment_requests')
    .insert({
      customer_id: input.customer_id,
      customer_service_plan_id: input.customer_service_plan_id,
      type: input.type,
      status: 'paid_awaiting_schedule',
      payment_transaction_id: input.payment_transaction_id ?? null,
      due_date: input.due_date ?? new Date().toISOString().split('T')[0],
      notes: input.notes ?? null,
      created_by: input.created_by ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// ── Status Transitions ───────────────────────────────────────────

export async function markScheduled(
  id: string,
  jobId: string,
  scheduledDate: string
) {
  const { data, error } = await supabase
    .from('fulfillment_requests')
    .update({
      status: 'scheduled',
      job_id: jobId,
      scheduled_date: scheduledDate,
    })
    .eq('id', id)
    .eq('status', 'paid_awaiting_schedule')
    .select()
    .single()
  if (error) throw error
  return data
}

export async function markInProgress(id: string) {
  const { data, error } = await supabase
    .from('fulfillment_requests')
    .update({ status: 'in_progress' })
    .eq('id', id)
    .eq('status', 'scheduled')
    .select()
    .single()
  if (error) throw error
  return data
}

export async function markCompleted(id: string) {
  // 1. Update the fulfillment request
  const { data: fr, error: frError } = await supabase
    .from('fulfillment_requests')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('status', ['scheduled', 'in_progress'])
    .select('*, customer_service_plans(id, next_fulfillment_date, service_plans(fulfillment_interval_months))')
    .single()
  if (frError) throw frError

  // 2. Advance the plan's next_fulfillment_date
  const csp = fr.customer_service_plans
  if (csp) {
    const intervalMonths = csp.service_plans?.fulfillment_interval_months
    if (intervalMonths) {
      const baseDate = csp.next_fulfillment_date
        ? new Date(csp.next_fulfillment_date)
        : new Date()
      baseDate.setMonth(baseDate.getMonth() + intervalMonths)

      const { error: updateError } = await supabase
        .from('customer_service_plans')
        .update({
          last_fulfilled_at: new Date().toISOString(),
          next_fulfillment_date: baseDate.toISOString().split('T')[0],
        })
        .eq('id', csp.id)
      if (updateError) {
        console.error('Failed to advance plan dates:', updateError)
      }
    }
  }

  return fr
}

export async function cancelRequest(id: string, reason?: string) {
  const { data, error } = await supabase
    .from('fulfillment_requests')
    .update({
      status: 'cancelled',
      notes: reason || null,
    })
    .eq('id', id)
    .in('status', ['paid_awaiting_schedule', 'scheduled'])
    .select()
    .single()
  if (error) throw error
  return data
}

// ── Service Plan Items (multi-product) ───────────────────────────

export interface ServicePlanItem {
  id: string
  service_plan_id: string
  product_id: string
  quantity: number
  sort_order: number
  created_at: string
  products?: { id: string; name: string; sku: string; category: string }
}

export async function fetchPlanItems(servicePlanId: string) {
  const { data, error } = await supabase
    .from('service_plan_items')
    .select('*, products(id, name, sku, category)')
    .eq('service_plan_id', servicePlanId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data as ServicePlanItem[]
}

export async function addPlanItem(servicePlanId: string, productId: string, quantity = 1) {
  // Get max sort_order
  const { data: existing } = await supabase
    .from('service_plan_items')
    .select('sort_order')
    .eq('service_plan_id', servicePlanId)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1

  const { data, error } = await supabase
    .from('service_plan_items')
    .insert({
      service_plan_id: servicePlanId,
      product_id: productId,
      quantity,
      sort_order: nextOrder,
    })
    .select('*, products(id, name, sku, category)')
    .single()
  if (error) throw error
  return data as ServicePlanItem
}

export async function updatePlanItem(itemId: string, updates: { quantity?: number; sort_order?: number }) {
  const { data, error } = await supabase
    .from('service_plan_items')
    .update(updates)
    .eq('id', itemId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function removePlanItem(itemId: string) {
  const { error } = await supabase
    .from('service_plan_items')
    .delete()
    .eq('id', itemId)
  if (error) throw error
}
