// src/services/contractsService.ts

import { supabase } from '../lib/supabase'

// ─── Types ────────────────────────────────────────────────────

export type ContractType   = 'rental' | 'purchase' | 'financed'
export type ContractStatus = 'active' | 'pending' | 'cancelled' | 'completed' | 'expired'

export interface Contract {
  id: string
  reference_number: string
  customer_id: string
  quote_id: string | null
  type: ContractType
  status: ContractStatus
  system_type: string | null
  equipment_description: string | null
  monthly_amount: number | null
  total_amount: number | null
  amount_paid: number
  start_date: string | null
  end_date: string | null
  term_months: number | null
  payment_day: number
  buyout_formula: string | null
  buyout_amount: number | null
  notes: string | null
  signed_at: string | null
  cancelled_at: string | null
  cancelled_reason: string | null
  created_at: string
  updated_at: string
  // Joined
  customer_name?: string
  customer_phone?: string
  customer_email?: string
}

export type CreateContractInput = Omit<Contract,
  'id' | 'reference_number' | 'amount_paid' | 'created_at' | 'updated_at' | 'customer_name' | 'customer_phone' | 'customer_email'>

// ─── Status / type display maps ───────────────────────────────

export const STATUS_LABELS: Record<ContractStatus, string> = {
  active:    'Active',
  pending:   'Pending Signature',
  cancelled: 'Cancelled',
  completed: 'Completed',
  expired:   'Expired',
}

export const STATUS_COLORS: Record<ContractStatus, string> = {
  active:    '#22c55e',
  pending:   '#f59e0b',
  cancelled: '#ef4444',
  completed: '#6366f1',
  expired:   '#94a3b8',
}

export const TYPE_LABELS: Record<ContractType, string> = {
  rental:   'Rental',
  purchase: 'Purchase',
  financed: 'Financed',
}

export const TYPE_COLORS: Record<ContractType, string> = {
  rental:   '#0ea5e9',
  purchase: '#a855f7',
  financed: '#f59e0b',
}

// ─── Queries ──────────────────────────────────────────────────

export async function fetchContracts(filters?: { status?: ContractStatus; type?: ContractType }) {
  let q = supabase
    .from('contracts')
    .select(`
      *,
      customers ( full_name, phone, email )
    `)
    .order('created_at', { ascending: false })

  if (filters?.status) q = q.eq('status', filters.status)
  if (filters?.type)   q = q.eq('type', filters.type)

  const { data, error } = await q
  if (error) throw error

  return (data || []).map(row => ({
    ...row,
    customer_name:  row.customers?.full_name  ?? '—',
    customer_phone: row.customers?.phone      ?? '—',
    customer_email: row.customers?.email      ?? '—',
  })) as Contract[]
}

export async function fetchContractsByCustomer(customerId: string) {
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as Contract[]
}

export async function fetchContractById(id: string) {
  const { data, error } = await supabase
    .from('contracts')
    .select(`*, customers ( full_name, phone, email )`)
    .eq('id', id)
    .single()
  if (error) throw error
  return {
    ...data,
    customer_name:  data.customers?.full_name  ?? '—',
    customer_phone: data.customers?.phone      ?? '—',
    customer_email: data.customers?.email      ?? '—',
  } as Contract
}

// ─── Mutations ────────────────────────────────────────────────

export async function createContract(input: CreateContractInput) {
  const { data, error } = await supabase
    .from('contracts')
    .insert(input)
    .select()
    .single()
  if (error) throw error
  return data as Contract
}

/** Create a contract directly from an accepted quote */
export async function createContractFromQuote(quoteId: string, customerId: string) {
  // Fetch quote data
  const { data: quote, error: qErr } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .single()
  if (qErr) throw qErr

  const input: CreateContractInput = {
    customer_id:            customerId,
    quote_id:               quoteId,
    type:                   (quote.commercial_type || 'rental') as ContractType,
    status:                 'active',
    system_type:            quote.system_type || null,
    equipment_description:  quote.notes || null,
    monthly_amount:         quote.commercial_type === 'rental' ? parseFloat(quote.subtotal) : null,
    total_amount:           parseFloat(quote.total),
    start_date:             new Date().toISOString().slice(0, 10),
    end_date:               null,
    term_months:            36,
    payment_day:            1,
    buyout_formula:         'retail_minus_payments',
    buyout_amount:          null,
    notes:                  null,
    signed_at:              new Date().toISOString(),
    cancelled_at:           null,
    cancelled_reason:       null,
    created_by:             null,
  }

  return createContract(input)
}

export async function updateContractStatus(id: string, status: ContractStatus, reason?: string) {
  const patch: Record<string, any> = { status }
  if (status === 'cancelled') {
    patch.cancelled_at     = new Date().toISOString()
    patch.cancelled_reason = reason || null
  }
  if (status === 'active') patch.signed_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('contracts')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Contract
}

export async function updateContract(id: string, patch: Partial<Contract>) {
  const { data, error } = await supabase
    .from('contracts')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Contract
}

// ─── Computed helpers ─────────────────────────────────────────

/** Months elapsed since start_date */
export function monthsElapsed(contract: Contract): number {
  if (!contract.start_date) return 0
  const start = new Date(contract.start_date)
  const now   = new Date()
  return Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()))
}

/** Remaining buyout value = total - amount_paid (floor 0) */
export function buyoutRemaining(contract: Contract): number {
  if (!contract.total_amount) return 0
  return Math.max(0, contract.total_amount - (contract.amount_paid || 0))
}
