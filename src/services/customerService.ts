import { supabase } from '../lib/supabase'

// ═══════════════════════════════════════════════════════════════
// CUSTOMER CRUD + FETCH HELPERS
// ═══════════════════════════════════════════════════════════════

export async function fetchCustomers() {
  const { data, error } = await supabase.from('customers').select('*').order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function fetchCustomer(id: string) {
  const { data, error } = await supabase.from('customers').select('*').eq('id', id).single()
  if (error) throw new Error(error.message)
  return data
}

export async function fetchCustomerAddresses(customerId: string) {
  const { data, error } = await supabase.from('customer_addresses').select('*').eq('customer_id', customerId).order('effective_date', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function fetchInstalledSystems(customerId: string) {
  const { data, error } = await supabase.from('installed_systems').select('*').eq('customer_id', customerId).order('install_date', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function fetchWarrantyRecords(customerId: string) {
  const { data: systems } = await supabase.from('installed_systems').select('id').eq('customer_id', customerId)
  if (!systems?.length) return []
  const ids = systems.map((s: any) => s.id)
  const { data, error } = await supabase.from('warranty_records').select('*').in('installed_system_id', ids)
  if (error) throw new Error(error.message)
  return data || []
}

export async function fetchRentalContracts(customerId: string) {
  const { data, error } = await supabase.from('rental_contracts').select('*').eq('customer_id', customerId)
  if (error) throw new Error(error.message)
  return data || []
}

export async function fetchRentalContractSystems(contractId: string) {
  const { data, error } = await supabase.from('rental_contract_systems').select('*').eq('rental_contract_id', contractId)
  if (error) throw new Error(error.message)
  return data || []
}

export async function fetchRentalPayments(contractId: string) {
  const { data, error } = await supabase.from('rental_payments').select('*').eq('rental_contract_id', contractId).order('payment_date', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function fetchMaintenancePlans(customerId: string) {
  const { data, error } = await supabase.from('maintenance_plans').select('*').eq('customer_id', customerId)
  if (error) throw new Error(error.message)
  return data || []
}

export async function fetchComplianceRequirements(customerId: string) {
  const { data, error } = await supabase.from('compliance_requirements').select('*').eq('customer_id', customerId).eq('is_active', true)
  if (error) throw new Error(error.message)
  return data || []
}

export async function fetchServiceScheduleItems(customerId: string) {
  const { data, error } = await supabase.from('service_schedule_items').select('*').eq('customer_id', customerId).order('due_date')
  if (error) throw new Error(error.message)
  return data || []
}

export async function fetchServiceCompletions(customerId: string) {
  const { data, error } = await supabase.from('service_completions').select('*').eq('customer_id', customerId).order('completed_date', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function fetchComplianceProofs(customerId: string) {
  const { data, error } = await supabase.from('compliance_proofs').select('*').eq('customer_id', customerId).order('submitted_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function fetchBuyoutCalculations(contractId: string) {
  const { data, error } = await supabase.from('buyout_calculations').select('*').eq('rental_contract_id', contractId).order('calculated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function fetchCustomerActivity(customerId: string) {
  const { data, error } = await supabase.from('customer_activity_log').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(100)
  if (error) return []
  return data || []
}

export async function fetchProductCatalog() {
  const { data, error } = await supabase.from('product_catalog').select('*').eq('is_active', true).order('name')
  if (error) throw new Error(error.message)
  return data || []
}
