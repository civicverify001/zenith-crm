import { supabase } from '../lib/supabase'
import { updateCustomerLifecycle } from './lifecycleService'

interface ActorInfo { actor_id: string; actor_name?: string }

function addMonths(date: string, months: number): string {
  const d = new Date(date + 'T00:00:00'); d.setMonth(d.getMonth() + months); return d.toISOString().split('T')[0]
}
function today(): string { return new Date().toISOString().split('T')[0] }

// ═══════════════════════════════════════════════════════════════
// CALCULATE BUYOUT (step 1 of 2 — does NOT execute)
// Uses CURRENT retail prices, not snapshots
// Stores typed audit record in buyout_calculations
// ═══════════════════════════════════════════════════════════════
export async function calculateBuyout(contractId: string, calculatedBy: string): Promise<any> {
  const { data: contract } = await supabase.from('rental_contracts').select('*').eq('id', contractId).single()
  if (!contract) throw new Error('Contract not found')
  if (contract.buyout_completed) throw new Error('Contract already bought out')

  // Fetch systems via junction
  const { data: junctions } = await supabase.from('rental_contract_systems').select('installed_system_id')
    .eq('rental_contract_id', contractId).is('removed_date', null)

  const systemIds = (junctions || []).map((j: any) => j.installed_system_id)
  if (!systemIds.length) throw new Error('No active systems on this contract')

  // Get product catalog IDs from systems
  const { data: systems } = await supabase.from('installed_systems').select('product_catalog_id').in('id', systemIds)
  const catalogIds = (systems || []).map((s: any) => s.product_catalog_id).filter(Boolean)

  // Fetch CURRENT retail prices
  let currentRetailTotal = 0
  if (catalogIds.length > 0) {
    const { data: products } = await supabase.from('product_catalog').select('retail_price').in('id', catalogIds)
    currentRetailTotal = (products || []).reduce((sum: number, p: any) => sum + Number(p.retail_price), 0)
  }

  const totalPaid = Number(contract.total_paid)
  const totalInstallFees = Number(contract.total_install_fees)
  const rawCredit = totalPaid * 0.50
  const creditCap = currentRetailTotal * 0.50
  const appliedCredit = Math.min(rawCredit, creditCap)
  const installReimb = totalInstallFees
  const buyoutPrice = Math.max(currentRetailTotal - installReimb - appliedCredit, 0)

  // Store typed audit record
  const { data: calc, error } = await supabase.from('buyout_calculations').insert({
    rental_contract_id: contractId, calculated_by: calculatedBy,
    current_retail_total: currentRetailTotal, total_install_fees: totalInstallFees,
    total_rental_paid: totalPaid, payments_made_count: contract.payments_made,
    raw_rental_credit: rawCredit, rental_credit_cap: creditCap,
    applied_rental_credit: appliedCredit, install_reimbursement: installReimb,
    buyout_price: buyoutPrice, was_executed: false,
  }).select('*').single()

  if (error) throw new Error(`Buyout calculation failed: ${error.message}`)

  // Log
  await supabase.from('customer_activity_log').insert({
    customer_id: contract.customer_id, event_type: 'buyout_calculated',
    title: `Buyout calculated: $${buyoutPrice.toFixed(2)}`,
    metadata: { calculation_id: (calc as any).id, buyout_price: buyoutPrice },
    actor_id: calculatedBy, actor_name: null,
  }).then(() => {}).catch(() => {})

  return calc
}

// ═══════════════════════════════════════════════════════════════
// EXECUTE BUYOUT (step 2 of 2)
// FIX #1: Explicit rented → purchased on every linked system
// ═══════════════════════════════════════════════════════════════
export async function executeBuyout(calculationId: string, actor: ActorInfo): Promise<void> {
  // Verify calculation
  const { data: calc } = await supabase.from('buyout_calculations').select('*').eq('id', calculationId).single()
  if (!calc) throw new Error('Calculation not found')
  if (calc.was_executed) throw new Error('Buyout already executed')

  // Mark calculation executed
  await supabase.from('buyout_calculations').update({
    was_executed: true, executed_at: new Date().toISOString(), executed_by: actor.actor_id,
  }).eq('id', calculationId)

  // Update contract
  await supabase.from('rental_contracts').update({
    buyout_completed: true, buyout_date: today(), status: 'completed', rental_risk_status: null,
  }).eq('id', calc.rental_contract_id)

  // Fetch ALL systems on this contract via junction
  const { data: junctions } = await supabase.from('rental_contract_systems').select('installed_system_id')
    .eq('rental_contract_id', calc.rental_contract_id).is('removed_date', null)

  const systemIds = (junctions || []).map((j: any) => j.installed_system_id)
  const t = today()

  // FIX #1: Explicit ownership transition per system
  for (const sysId of systemIds) {
    // Change ownership: rented → purchased
    await supabase.from('installed_systems').update({
      ownership_type: 'purchased',
      converted_from_rental: true,
      conversion_date: t,
    }).eq('id', sysId)

    // Add maintenance_plan_renewal compliance requirements (purchased systems need this)
    const { data: system } = await supabase.from('installed_systems').select('product_catalog_id, customer_id').eq('id', sysId).single()
    if (system?.product_catalog_id) {
      const { data: templates } = await supabase.from('compliance_rule_templates').select('*')
        .eq('product_catalog_id', system.product_catalog_id)
        .eq('requirement_type', 'maintenance_plan_renewal')
        .eq('applies_to_purchased', true).eq('is_active', true)

      for (const tmpl of (templates || [])) {
        const { data: req } = await supabase.from('compliance_requirements').insert({
          installed_system_id: sysId, customer_id: system.customer_id,
          source_template_id: tmpl.id, requirement_type: tmpl.requirement_type,
          interval_months: tmpl.interval_months, must_purchase_through_zenith: tmpl.must_purchase_through_zenith,
          proof_accepted_types: tmpl.proof_accepted_types, grace_period_months: tmpl.grace_period_months,
          affects_warranty: tmpl.affects_warranty, requires_active_plan: tmpl.requires_active_plan,
        }).select('id').single()

        if (req) {
          const dueDate = addMonths(t, tmpl.interval_months)
          await supabase.from('service_schedule_items').insert({
            compliance_requirement_id: (req as any).id, installed_system_id: sysId,
            customer_id: system.customer_id, due_date: dueDate,
            grace_expiry_date: addMonths(dueDate, tmpl.grace_period_months), status: 'upcoming',
          })
        }
      }
    }
  }

  // Close junction rows
  await supabase.from('rental_contract_systems').update({ removed_date: t, removal_reason: 'buyout_completed' })
    .eq('rental_contract_id', calc.rental_contract_id).is('removed_date', null)

  // Create paid maintenance plan (no longer included in rental)
  const { data: contract } = await supabase.from('rental_contracts').select('customer_id').eq('id', calc.rental_contract_id).single()
  if (contract) {
    // Expire old included-in-rental plan
    await supabase.from('maintenance_plans').update({ status: 'expired' })
      .eq('customer_id', contract.customer_id).eq('included_in_rental', true)

    // Create new paid plan
    await supabase.from('maintenance_plans').insert({
      customer_id: contract.customer_id, status: 'active', plan_type: 'annual_standard',
      price_snapshot: 199, start_date: t, renewal_date: addMonths(t, 12),
      auto_renew: true, included_in_rental: false,
    })

    await supabase.from('customer_activity_log').insert({
      customer_id: contract.customer_id, event_type: 'buyout_completed',
      title: `Rental buyout completed — $${Number(calc.buyout_price).toFixed(2)}`,
      metadata: { calculation_id: calculationId, buyout_price: calc.buyout_price, systems_converted: systemIds.length },
      actor_id: actor.actor_id, actor_name: actor.actor_name || null,
    }).then(() => {}).catch(() => {})

    await updateCustomerLifecycle(contract.customer_id)
  }
}