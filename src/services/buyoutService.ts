import { supabase } from '../lib/supabase'
import { updateCustomerLifecycle } from './lifecycleService'

interface ActorInfo { actor_id: string; actor_name?: string }

function addMonths(date: string, months: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setMonth(d.getMonth() + months)
  return d.toISOString().split('T')[0]
}
function today(): string { return new Date().toISOString().split('T')[0] }

// ═══════════════════════════════════════════════════════════════
// CALCULATE BUYOUT (step 1 of 2 — does NOT execute)
// Uses retail_price_snapshot from installed_systems — no products join needed
// ═══════════════════════════════════════════════════════════════
export async function calculateBuyout(contractId: string, calculatedBy: string): Promise<any> {
  // ── Load contract ──────────────────────────────────────────
  const { data: contract, error: contractErr } = await supabase
    .from('contracts')
    .select('id, customer_id, monthly_amount, start_date, status, type')
    .eq('id', contractId)
    .single()

  if (contractErr || !contract) throw new Error('Contract not found')
  if (contract.status === 'completed') throw new Error('Contract already bought out')

  // ── Derive payment totals from payment_transactions ────────
  const { data: txs } = await supabase
    .from('payment_transactions')
    .select('amount, type, status')
    .eq('customer_id', contract.customer_id)
    .eq('status', 'succeeded')

  const allTxs = txs || []
  const rentalTxs  = allTxs.filter((t: any) => t.type === 'autopay' || t.type === 'rental')
  const installTxs = allTxs.filter((t: any) => t.type === 'install_fee')

  const totalPaid        = rentalTxs.reduce((sum: number, t: any) => sum + Number(t.amount), 0)
  const paymentsMade     = rentalTxs.length
  const totalInstallFees = installTxs.reduce((sum: number, t: any) => sum + Number(t.amount), 0)

  // ── Get rented installed systems — use retail_price_snapshot ─
  const { data: systems } = await supabase
    .from('installed_systems')
    .select('id, product_catalog_id, retail_price_snapshot')
    .eq('customer_id', contract.customer_id)
    .eq('ownership_type', 'rented')
    .eq('is_active', true)

  const activeSystems = systems || []
  if (!activeSystems.length) throw new Error('No active rented systems on this account')

  // Use snapshotted retail prices — no products table join needed
  const currentRetailTotal = activeSystems.reduce(
    (sum: number, s: any) => sum + Number(s.retail_price_snapshot || 0), 0
  )

  // ── Buyout formula: retail - install reimb - rental credit ─
  const rawCredit     = totalPaid * 0.50
  const creditCap     = currentRetailTotal * 0.50
  const appliedCredit = Math.min(rawCredit, creditCap)
  const installReimb  = totalInstallFees
  const buyoutPrice   = Math.max(currentRetailTotal - installReimb - appliedCredit, 0)

  // ── Store calculation record ───────────────────────────────
  const { data: calc, error: calcErr } = await supabase
    .from('buyout_calculations')
    .insert({
      rental_contract_id:    contractId,
      calculated_by:         calculatedBy,
      current_retail_total:  currentRetailTotal,
      total_install_fees:    totalInstallFees,
      total_rental_paid:     totalPaid,
      payments_made_count:   paymentsMade,
      raw_rental_credit:     rawCredit,
      rental_credit_cap:     creditCap,
      applied_rental_credit: appliedCredit,
      install_reimbursement: installReimb,
      buyout_price:          buyoutPrice,
      was_executed:          false,
    })
    .select('*')
    .single()

  if (calcErr) throw new Error(`Buyout calculation failed: ${calcErr.message}`)

  // ── Log activity ───────────────────────────────────────────
  await supabase.from('customer_activity_log').insert({
    customer_id: contract.customer_id,
    event_type:  'buyout_calculated',
    title:       `Buyout calculated: $${buyoutPrice.toFixed(2)}`,
    metadata:    { calculation_id: (calc as any).id, buyout_price: buyoutPrice },
    actor_id:    calculatedBy,
    actor_name:  null,
  }).then(() => {}).catch(() => {})

  return calc
}

// ═══════════════════════════════════════════════════════════════
// EXECUTE BUYOUT (step 2 of 2)
// Updates contracts.status = 'completed'
// Updates installed_systems ownership_type rented → purchased
// ═══════════════════════════════════════════════════════════════
export async function executeBuyout(calculationId: string, actor: ActorInfo): Promise<void> {
  // ── Verify calculation ─────────────────────────────────────
  const { data: calc, error: calcErr } = await supabase
    .from('buyout_calculations')
    .select('*')
    .eq('id', calculationId)
    .single()

  if (calcErr || !calc) throw new Error('Calculation not found')
  if (calc.was_executed) throw new Error('Buyout already executed')

  const contractId = calc.rental_contract_id

  // ── Mark calculation executed ──────────────────────────────
  await supabase.from('buyout_calculations').update({
    was_executed: true,
    executed_at:  new Date().toISOString(),
    executed_by:  actor.actor_id,
  }).eq('id', calculationId)

  // ── Update contract status ─────────────────────────────────
  await supabase.from('contracts').update({
    status:     'completed',
    updated_at: new Date().toISOString(),
  }).eq('id', contractId)

  // ── Load contract for customer_id ─────────────────────────
  const { data: contract } = await supabase
    .from('contracts')
    .select('customer_id')
    .eq('id', contractId)
    .single()

  if (!contract) throw new Error('Contract not found during execute')

  const customerId = contract.customer_id
  const t = today()

  // ── Convert all rented systems → purchased ─────────────────
  const { data: systems } = await supabase
    .from('installed_systems')
    .select('id, product_catalog_id')
    .eq('customer_id', customerId)
    .eq('ownership_type', 'rented')
    .eq('is_active', true)

  const systemIds = (systems || []).map((s: any) => s.id)

  for (const sysId of systemIds) {
    // Flip ownership
    await supabase.from('installed_systems').update({
      ownership_type: 'purchased',
    }).eq('id', sysId)

    // Add compliance requirements for purchased systems
    const { data: system } = await supabase
      .from('installed_systems')
      .select('product_catalog_id, customer_id')
      .eq('id', sysId)
      .single()

    if (system?.product_catalog_id) {
      const { data: templates } = await supabase
        .from('compliance_rule_templates')
        .select('*')
        .eq('product_catalog_id', system.product_catalog_id)
        .eq('requirement_type', 'maintenance_plan_renewal')
        .eq('applies_to_purchased', true)
        .eq('is_active', true)

      for (const tmpl of (templates || [])) {
        const { data: req } = await supabase
          .from('compliance_requirements')
          .insert({
            installed_system_id:          sysId,
            customer_id:                  system.customer_id,
            source_template_id:           tmpl.id,
            requirement_type:             tmpl.requirement_type,
            interval_months:              tmpl.interval_months,
            must_purchase_through_zenith: tmpl.must_purchase_through_zenith,
            proof_accepted_types:         tmpl.proof_accepted_types,
            grace_period_months:          tmpl.grace_period_months,
            affects_warranty:             tmpl.affects_warranty,
            requires_active_plan:         tmpl.requires_active_plan,
          })
          .select('id')
          .single()

        if (req) {
          const dueDate = addMonths(t, tmpl.interval_months)
          await supabase.from('service_schedule_items').insert({
            compliance_requirement_id: (req as any).id,
            installed_system_id:       sysId,
            customer_id:               system.customer_id,
            due_date:                  dueDate,
            grace_expiry_date:         addMonths(dueDate, tmpl.grace_period_months),
            status:                    'upcoming',
          })
        }
      }
    }
  }

  // ── Expire old rental maintenance plan ─────────────────────
  await supabase.from('maintenance_plans').update({ status: 'expired' })
    .eq('customer_id', customerId)
    .eq('included_in_rental', true)

  // ── Create new paid annual plan ────────────────────────────
  await supabase.from('maintenance_plans').insert({
    customer_id:        customerId,
    status:             'active',
    plan_type:          'annual_standard',
    price_snapshot:     199,
    start_date:         t,
    renewal_date:       addMonths(t, 12),
    auto_renew:         true,
    included_in_rental: false,
  })

  // ── Log activity ───────────────────────────────────────────
  await supabase.from('customer_activity_log').insert({
    customer_id: customerId,
    event_type:  'buyout_completed',
    title:       `Rental buyout completed — $${Number(calc.buyout_price).toFixed(2)}`,
    metadata:    {
      calculation_id:    calculationId,
      buyout_price:      calc.buyout_price,
      systems_converted: systemIds.length,
    },
    actor_id:   actor.actor_id,
    actor_name: actor.actor_name || null,
  }).then(() => {}).catch(() => {})

  await updateCustomerLifecycle(customerId)
}
