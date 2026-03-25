import { supabase } from '../lib/supabase'

// ═══════════════════════════════════════════════════════════════
// SERVICE PLAN TEMPLATES — Admin catalog CRUD
// ═══════════════════════════════════════════════════════════════

export interface ServicePlanTemplate {
  id: string
  name: string
  slug: string | null
  description: string | null
  internal_notes: string | null
  billing_cycle: 'monthly' | 'quarterly' | 'yearly' | 'one_time'
  price: number
  price_annually: number | null
  visits_per_year: number | null
  fulfillment_type: 'tech_visit' | 'shipment' | 'on_demand' | 'none'
  fulfillment_interval_months: number | null
  applies_to_categories: string[]
  requires_installed_system: boolean
  auto_activate_on_install: boolean
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string | null
}

export interface CustomerServicePlan {
  id: string
  customer_id: string
  plan_id: string
  installed_system_id: string | null
  source: 'quote' | 'manual' | 'auto_install'
  source_quote_id: string | null
  status: string
  billing_cycle: string
  price: number
  start_date: string | null
  billing_start_date: string | null
  next_billing_date: string | null
  next_service: string | null
  next_fulfillment_date: string | null
  last_billed_at: string | null
  last_fulfilled_at: string | null
  failed_billing_count: number
  activated_at: string | null
  paused_at: string | null
  pause_reason: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  expires_at: string | null
  notes: string | null
  created_at: string
  updated_at: string | null
  // Joined fields (from queries)
  plan_name?: string
  plan_fulfillment_type?: string
  system_name?: string
}

// ───────────────────────────────────────────────────────────────
// TEMPLATES — Fetch
// ───────────────────────────────────────────────────────────────

export async function fetchPlanTemplates(activeOnly = false) {
  let query = supabase
    .from('service_plans')
    .select('*')
    .order('sort_order', { ascending: true })

  if (activeOnly) {
    query = query.eq('is_active', true)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data || []) as ServicePlanTemplate[]
}

export async function fetchPlanTemplate(id: string) {
  const { data, error } = await supabase
    .from('service_plans')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data as ServicePlanTemplate
}

// ───────────────────────────────────────────────────────────────
// TEMPLATES — Create / Update / Toggle
// ───────────────────────────────────────────────────────────────

export interface CreatePlanTemplateInput {
  name: string
  slug?: string
  description?: string
  internal_notes?: string
  billing_cycle: string
  price: number
  fulfillment_type: string
  fulfillment_interval_months?: number | null
  applies_to_categories?: string[]
  requires_installed_system?: boolean
  auto_activate_on_install?: boolean
  sort_order?: number
}

export async function createPlanTemplate(input: CreatePlanTemplateInput) {
  const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

  const { data, error } = await supabase
    .from('service_plans')
    .insert({
      name: input.name,
      slug,
      description: input.description || null,
      internal_notes: input.internal_notes || null,
      billing_cycle: input.billing_cycle,
      price: input.price,
      price_annually: input.billing_cycle === 'yearly' ? input.price
        : input.billing_cycle === 'monthly' ? input.price * 12
        : input.billing_cycle === 'quarterly' ? input.price * 4
        : input.price,
      fulfillment_type: input.fulfillment_type,
      fulfillment_interval_months: input.fulfillment_interval_months ?? null,
      applies_to_categories: input.applies_to_categories || [],
      requires_installed_system: input.requires_installed_system ?? true,
      auto_activate_on_install: input.auto_activate_on_install ?? false,
      is_active: true,
      sort_order: input.sort_order ?? 0,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as ServicePlanTemplate
}

export async function updatePlanTemplate(id: string, updates: Partial<CreatePlanTemplateInput>) {
  const payload: Record<string, any> = {}

  if (updates.name !== undefined) payload.name = updates.name
  if (updates.slug !== undefined) payload.slug = updates.slug
  if (updates.description !== undefined) payload.description = updates.description
  if (updates.internal_notes !== undefined) payload.internal_notes = updates.internal_notes
  if (updates.billing_cycle !== undefined) payload.billing_cycle = updates.billing_cycle
  if (updates.price !== undefined) payload.price = updates.price
  if (updates.fulfillment_type !== undefined) payload.fulfillment_type = updates.fulfillment_type
  if (updates.fulfillment_interval_months !== undefined) payload.fulfillment_interval_months = updates.fulfillment_interval_months
  if (updates.applies_to_categories !== undefined) payload.applies_to_categories = updates.applies_to_categories
  if (updates.requires_installed_system !== undefined) payload.requires_installed_system = updates.requires_installed_system
  if (updates.auto_activate_on_install !== undefined) payload.auto_activate_on_install = updates.auto_activate_on_install
  if (updates.sort_order !== undefined) payload.sort_order = updates.sort_order

  // Auto-calc price_annually when price or cycle changes
  if (updates.price !== undefined || updates.billing_cycle !== undefined) {
    const price = updates.price ?? 0
    const cycle = updates.billing_cycle ?? 'yearly'
    payload.price_annually = cycle === 'yearly' ? price
      : cycle === 'monthly' ? price * 12
      : cycle === 'quarterly' ? price * 4
      : price
  }

  const { data, error } = await supabase
    .from('service_plans')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as ServicePlanTemplate
}

export async function togglePlanTemplateActive(id: string, isActive: boolean) {
  const { error } = await supabase
    .from('service_plans')
    .update({ is_active: isActive })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function toggleAutoActivate(id: string, autoActivate: boolean) {
  const { error } = await supabase
    .from('service_plans')
    .update({ auto_activate_on_install: autoActivate })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

// ═══════════════════════════════════════════════════════════════
// CUSTOMER SERVICE PLANS — Live subscriptions
// ═══════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────
// Fetch plans for a customer (with template name joined)
// ───────────────────────────────────────────────────────────────

export async function fetchCustomerServicePlans(customerId: string) {
  const { data, error } = await supabase
    .from('customer_service_plans')
    .select(`
      *,
      service_plans!plan_id ( name, fulfillment_type )
    `)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  // Flatten joined data
  return (data || []).map((row: any) => ({
    ...row,
    plan_name: row.service_plans?.name || 'Unknown Plan',
    plan_fulfillment_type: row.service_plans?.fulfillment_type || 'none',
    service_plans: undefined, // remove nested object
  })) as CustomerServicePlan[]
}

// ───────────────────────────────────────────────────────────────
// Check if customer has a valid payment method
// ───────────────────────────────────────────────────────────────

export async function checkPaymentMethod(customerId: string): Promise<boolean> {
  const { data } = await supabase
    .from('payment_methods')
    .select('id')
    .eq('customer_id', customerId)
    .eq('is_default', true)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  return !!data
}

// ───────────────────────────────────────────────────────────────
// Check for duplicate active plan
// ───────────────────────────────────────────────────────────────

export async function checkDuplicatePlan(
  customerId: string,
  planId: string,
  installedSystemId: string | null
): Promise<boolean> {
  let query = supabase
    .from('customer_service_plans')
    .select('id')
    .eq('customer_id', customerId)
    .eq('plan_id', planId)
    .in('status', ['active', 'pending_payment_method', 'pending_install', 'paused', 'payment_failed'])

  if (installedSystemId) {
    query = query.eq('installed_system_id', installedSystemId)
  } else {
    query = query.is('installed_system_id', null)
  }

  const { data } = await query.maybeSingle()
  return !!data
}

// ───────────────────────────────────────────────────────────────
// Activate plan — from Customer page (manual)
// ───────────────────────────────────────────────────────────────

export interface ActivatePlanInput {
  customer_id: string
  plan_id: string
  installed_system_id?: string | null
  price_override?: number | null
  billing_start?: 'immediate' | 'next_cycle'
  notes?: string
}

export async function activatePlanFromCustomerPage(input: ActivatePlanInput) {
  // 1. Fetch template
  const template = await fetchPlanTemplate(input.plan_id)
  if (!template) throw new Error('Plan template not found')
  if (!template.is_active) throw new Error('Plan template is not active')

  // 2. Duplicate check
  const isDuplicate = await checkDuplicatePlan(
    input.customer_id,
    input.plan_id,
    input.installed_system_id || null
  )
  if (isDuplicate) throw new Error('Customer already has an active plan of this type for this system')

  // 3. Payment method check
  const hasPayment = await checkPaymentMethod(input.customer_id)
  const isRecurring = template.billing_cycle !== 'one_time'
  const initialStatus = (isRecurring && !hasPayment) ? 'pending_payment_method' : 'active'

  // 4. Calculate dates
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const price = input.price_override ?? template.price

  let nextBillingDate: string | null = null
  if (initialStatus === 'active') {
    if (input.billing_start === 'next_cycle') {
      nextBillingDate = advanceDate(today, template.billing_cycle)
    } else {
      nextBillingDate = today
    }
  }

  let nextFulfillmentDate: string | null = null
  if (template.fulfillment_type === 'tech_visit' || template.fulfillment_type === 'shipment') {
    if (template.fulfillment_interval_months) {
      const fd = new Date(now)
      fd.setMonth(fd.getMonth() + template.fulfillment_interval_months)
      nextFulfillmentDate = fd.toISOString().split('T')[0]
    }
  }

  // 5. Insert
  const { data, error } = await supabase
    .from('customer_service_plans')
    .insert({
      customer_id: input.customer_id,
      plan_id: input.plan_id,
      installed_system_id: input.installed_system_id || null,
      source: 'manual',
      source_quote_id: null,
      status: initialStatus,
      billing_cycle: template.billing_cycle,
      price,
      start_date: today,
      billing_start_date: initialStatus === 'active' ? today : null,
      next_billing_date: nextBillingDate,
      next_service: nextFulfillmentDate,
      next_fulfillment_date: nextFulfillmentDate,
      activated_at: initialStatus === 'active' ? now.toISOString() : null,
      notes: input.notes || null,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new Error('Customer already has an active plan of this type for this system')
    }
    throw new Error(error.message)
  }

  // 5b. Snapshot components
  try {
    const today = new Date().toISOString().split('T')[0]
    await snapshotPlanComponents(data.id, input.plan_id, today)
  } catch (e) {
    console.error('[BEST-EFFORT] snapshotPlanComponents:', e)
  }

  // 6. Activity log
  try {
    await supabase.from('customer_activity_log').insert({
      customer_id: input.customer_id,
      event_type: 'service_plan_added',
      title: `Service plan added: ${template.name}`,
      actor_id: null,
      actor_name: null,
      metadata: {
        plan_id: input.plan_id,
        plan_name: template.name,
        source: 'manual',
        price,
        billing_cycle: template.billing_cycle,
        status: initialStatus,
      },
    })

    if (initialStatus === 'active') {
      await supabase.from('customer_activity_log').insert({
        customer_id: input.customer_id,
        event_type: 'service_plan_activated',
        title: `Service plan activated: ${template.name}`,
        actor_id: null,
        actor_name: null,
        metadata: { plan_id: input.plan_id, plan_name: template.name },
      })
    }
  } catch (e) {
    console.error('[BEST-EFFORT] activity log:', e)
  }

  return data as CustomerServicePlan
}

// ───────────────────────────────────────────────────────────────
// Pause plan
// ───────────────────────────────────────────────────────────────

export async function pausePlan(planId: string, reason?: string) {
  const { data, error } = await supabase
    .from('customer_service_plans')
    .update({
      status: 'paused',
      paused_at: new Date().toISOString(),
      pause_reason: reason || null,
    })
    .eq('id', planId)
    .in('status', ['active', 'payment_failed'])
    .select()
    .single()

  if (error) throw new Error(error.message)

  // Activity log
  try {
    await supabase.from('customer_activity_log').insert({
      customer_id: data.customer_id,
      event_type: 'service_plan_paused',
      title: 'Service plan paused',
      actor_id: null,
      metadata: { plan_id: planId, reason },
    })
  } catch (e) { console.error('[BEST-EFFORT] activity:', e) }

  return data as CustomerServicePlan
}

// ───────────────────────────────────────────────────────────────
// Resume plan (from paused)
// ───────────────────────────────────────────────────────────────

export async function resumePlan(planId: string) {
  const today = new Date().toISOString().split('T')[0]

  // Fetch current to get billing_cycle for next date calc
  const { data: current } = await supabase
    .from('customer_service_plans')
    .select('billing_cycle, customer_id')
    .eq('id', planId)
    .single()

  if (!current) throw new Error('Plan not found')

  const nextBilling = advanceDate(today, current.billing_cycle)

  const { data, error } = await supabase
    .from('customer_service_plans')
    .update({
      status: 'active',
      paused_at: null,
      pause_reason: null,
      next_billing_date: nextBilling,
      failed_billing_count: 0,
    })
    .eq('id', planId)
    .eq('status', 'paused')
    .select()
    .single()

  if (error) throw new Error(error.message)

  try {
    await supabase.from('customer_activity_log').insert({
      customer_id: current.customer_id,
      event_type: 'service_plan_activated',
      title: 'Service plan resumed',
      actor_id: null,
      metadata: { plan_id: planId },
    })
  } catch (e) { console.error('[BEST-EFFORT] activity:', e) }

  return data as CustomerServicePlan
}

// ───────────────────────────────────────────────────────────────
// Cancel plan
// ───────────────────────────────────────────────────────────────

export async function cancelPlan(planId: string, reason?: string) {
  const { data, error } = await supabase
    .from('customer_service_plans')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason || null,
    })
    .eq('id', planId)
    .in('status', ['active', 'paused', 'pending_payment_method', 'pending_install', 'payment_failed'])
    .select()
    .single()

  if (error) throw new Error(error.message)

  try {
    await supabase.from('customer_activity_log').insert({
      customer_id: data.customer_id,
      event_type: 'service_plan_cancelled',
      title: 'Service plan cancelled',
      actor_id: null,
      metadata: { plan_id: planId, reason },
    })
  } catch (e) { console.error('[BEST-EFFORT] activity:', e) }

  return data as CustomerServicePlan
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function advanceDate(dateStr: string, cycle: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  switch (cycle) {
    case 'monthly':   d.setMonth(d.getMonth() + 1); break
    case 'quarterly': d.setMonth(d.getMonth() + 3); break
    case 'yearly':    d.setFullYear(d.getFullYear() + 1); break
    case 'one_time':  return dateStr // no advancement
    default:          d.setMonth(d.getMonth() + 1)
  }
  return d.toISOString().split('T')[0]
}

// Billing cycle display labels
export const BILLING_CYCLE_LABELS: Record<string, string> = {
  monthly: '/month',
  quarterly: '/quarter',
  yearly: '/year',
  one_time: ' (one-time)',
}

export const FULFILLMENT_TYPE_LABELS: Record<string, string> = {
  tech_visit: 'Technician Visit',
  shipment: 'Filter Shipment',
  on_demand: 'On-Demand Service',
  none: 'Billing Only',
}

export const PLAN_STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  active:                  { label: 'Active',            color: '#4ade80', bgColor: 'rgba(74,222,128,0.12)' },
  pending_payment_method:  { label: 'Card Required',     color: '#fbbf24', bgColor: 'rgba(251,191,36,0.12)' },
  pending_install:         { label: 'Pending Install',   color: '#60a5fa', bgColor: 'rgba(96,165,250,0.12)' },
  paused:                  { label: 'Paused',            color: '#fbbf24', bgColor: 'rgba(251,191,36,0.12)' },
  payment_failed:          { label: 'Payment Failed',    color: '#f87171', bgColor: 'rgba(248,113,113,0.12)' },
  completed:               { label: 'Completed',         color: '#94a3b8', bgColor: 'rgba(148,163,184,0.12)' },
  cancelled:               { label: 'Cancelled',         color: '#94a3b8', bgColor: 'rgba(148,163,184,0.12)' },
  expired:                 { label: 'Expired',           color: '#94a3b8', bgColor: 'rgba(148,163,184,0.12)' },
}

// ═══════════════════════════════════════════════════════════════
// SERVICE PLAN COMPONENTS — Template component definitions
// ═══════════════════════════════════════════════════════════════

export interface ServicePlanComponent {
  id: string
  plan_id: string
  label: string
  component_code: string
  fulfillment_type: 'tech_visit' | 'shipment' | 'delivery' | 'on_demand'
  interval_months: number | null
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ComponentDraft {
  label: string
  component_code: string
  fulfillment_type: 'tech_visit' | 'shipment' | 'delivery' | 'on_demand'
  interval_months: number | null
}

export interface CustomerServicePlanComponent {
  id: string
  customer_service_plan_id: string
  plan_component_id: string | null
  label: string
  component_code: string
  fulfillment_type: 'tech_visit' | 'shipment' | 'delivery' | 'on_demand'
  interval_months: number | null
  next_due_date: string | null
  last_completed_at: string | null
  status: 'active' | 'paused' | 'cancelled' | 'completed'
  created_at: string
  updated_at: string
}

export const COMPONENT_CODES = [
  { value: 'annual_maintenance_visit',  label: 'Annual Maintenance Visit' },
  { value: 'ro_prefilter_replacement',  label: 'RO Prefilter Replacement' },
  { value: 'ro_membrane_replacement',   label: 'RO Membrane Replacement' },
  { value: 'quarterly_water_test',      label: 'Quarterly Water Test' },
  { value: 'quarterly_salt_delivery',   label: 'Quarterly Salt Delivery' },
  { value: 'emergency_support',         label: 'Emergency Support' },
  { value: 'custom',                    label: 'Custom' },
]

export const COMPONENT_FULFILLMENT_LABELS: Record<string, string> = {
  tech_visit: 'Technician Visit',
  shipment:   'Shipment',
  delivery:   'Delivery',
  on_demand:  'On-Demand',
}

// ── Fetch template components ──────────────────────────────────
export async function fetchPlanComponents(planId: string) {
  const { data, error } = await supabase
    .from('service_plan_components')
    .select('*')
    .eq('plan_id', planId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []) as ServicePlanComponent[]
}

// ── Save template components (delete + insert — templates only) ─
export async function savePlanComponents(planId: string, components: ComponentDraft[]) {
  await supabase.from('service_plan_components').delete().eq('plan_id', planId)
  if (components.length === 0) return []
  const { data, error } = await supabase
    .from('service_plan_components')
    .insert(components.map((c, i) => ({
      plan_id: planId,
      label: c.label,
      component_code: c.component_code,
      fulfillment_type: c.fulfillment_type,
      interval_months: c.interval_months,
      sort_order: i,
      is_active: true,
    })))
    .select()
  if (error) throw new Error(error.message)
  return (data || []) as ServicePlanComponent[]
}

// ── Duplicate plan (copy template + components) ────────────────
export async function duplicatePlanTemplate(id: string) {
  const original = await fetchPlanTemplate(id)
  const components = await fetchPlanComponents(id)

  const slug = original.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-copy-' + Date.now()
  const { data: newPlan, error } = await supabase
    .from('service_plans')
    .insert({ ...original, id: undefined, name: original.name + ' (Copy)', slug, created_at: undefined, updated_at: undefined })
    .select()
    .single()
  if (error) throw new Error(error.message)

  if (components.length > 0) {
    await savePlanComponents(newPlan.id, components.map(c => ({
      label: c.label,
      component_code: c.component_code,
      fulfillment_type: c.fulfillment_type,
      interval_months: c.interval_months,
    })))
  }
  return newPlan as ServicePlanTemplate
}

// ── Fetch customer plan components ─────────────────────────────
export async function fetchCustomerPlanComponents(customerServicePlanId: string) {
  const { data, error } = await supabase
    .from('customer_service_plan_components')
    .select('*')
    .eq('customer_service_plan_id', customerServicePlanId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []) as CustomerServicePlanComponent[]
}

// ── Snapshot components at activation (call after plan insert) ─
export async function snapshotPlanComponents(
  customerServicePlanId: string,
  planId: string,
  activationDate: string // YYYY-MM-DD
) {
  const components = await fetchPlanComponents(planId)
  if (components.length === 0) return []

  const rows = components.map(c => {
    let nextDueDate: string | null = null
    if (c.interval_months && c.fulfillment_type !== 'on_demand') {
      const d = new Date(activationDate + 'T12:00:00')
      d.setMonth(d.getMonth() + c.interval_months)
      nextDueDate = d.toISOString().split('T')[0]
    }
    return {
      customer_service_plan_id: customerServicePlanId,
      plan_component_id: c.id,
      label: c.label,
      component_code: c.component_code,
      fulfillment_type: c.fulfillment_type,
      interval_months: c.interval_months,
      next_due_date: nextDueDate,
      last_completed_at: null,
      status: 'active',
    }
  })

  const { data, error } = await supabase
    .from('customer_service_plan_components')
    .insert(rows)
    .select()
  if (error) throw new Error(error.message)
  return (data || []) as CustomerServicePlanComponent[]
}

// ── Update activatePlanFromCustomerPage to snapshot components ─
// NOTE: Call snapshotPlanComponents after activatePlanFromCustomerPage returns
// passing data.id, input.plan_id, today — see ServicePlansTab usage
