import { supabase } from '../lib/supabase'
import type { Job } from '../modules/dispatch/dispatch.types'

interface ActorInfo { actor_id: string; actor_name?: string }

const SYSTEM_TYPE_SKUS: Record<string, string[]> = {
  softener_only:        ['softener_standard'],
  pure_start_softener:  ['pure_start_filter', 'softener_standard'],
  advanced_softener:    ['advanced_filter', 'softener_standard'],
  dual_tank:            ['softener_premium'],
  ro_install:           ['ro_800'],
  combo_whole_home_ro:  ['carbon_whole_home', 'softener_standard', 'ro_800'],
}

function addMonths(date: string, months: number): string {
  const d = new Date(date + 'T00:00:00'); d.setMonth(d.getMonth() + months); return d.toISOString().split('T')[0]
}
function addYears(date: string, years: number): string { return addMonths(date, years * 12) }

export async function convertJobToCustomer(
  job: Job, ownershipType: 'purchased' | 'rented', actor: ActorInfo, rentalMonthly?: number
): Promise<string> {
  const { data: existing } = await supabase.from('customers').select('id').eq('job_id', job.id).maybeSingle()
  if (existing) throw new Error('Customer already exists for this job')

  const installDate = job.completed_at?.split('T')[0] || new Date().toISOString().split('T')[0]

  // Create customer
  const { data: customer, error: custErr } = await supabase.from('customers').insert({
    lead_id: job.lead_id, job_id: job.id, full_name: job.customer_name_snapshot,
    phone: job.phone_snapshot, email: job.email_snapshot, lifecycle_status: 'active',
  }).select('id').single()
  if (custErr) throw new Error(`Failed to create customer: ${custErr.message}`)
  const customerId = (customer as any).id

  // Address
  await supabase.from('customer_addresses').insert({
    customer_id: customerId, address_type: 'service', address_line: job.service_address_snapshot || '',
    is_current: true, effective_date: installDate,
  })

  // Rental contract
  let contractId: string | null = null
  if (ownershipType === 'rented' && rentalMonthly) {
    const skus = SYSTEM_TYPE_SKUS[job.system_type] || ['softener_standard']
    const { data: prods } = await supabase.from('product_catalog').select('install_fee, install_fee_exempt').in('sku', skus).eq('is_active', true)
    const totalFees = (prods || []).reduce((s: number, p: any) => s + (p.install_fee_exempt ? 0 : Number(p.install_fee || 150)), 0)

    const { data: con, error: conErr } = await supabase.from('rental_contracts').insert({
      customer_id: customerId, contract_number: `ZPS-R-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`,
      status: 'active', term_months: 36, monthly_amount: rentalMonthly,
      total_install_fees: totalFees, start_date: installDate, end_date: addMonths(installDate, 36),
    }).select('id').single()
    if (conErr) throw new Error(`Failed to create rental contract: ${conErr.message}`)
    contractId = (con as any).id
  }

  // Fetch products
  const skus = SYSTEM_TYPE_SKUS[job.system_type] || ['softener_standard']
  const { data: products } = await supabase.from('product_catalog').select('*').in('sku', skus).eq('is_active', true)
  if (!products?.length) { console.error('[CRITICAL] No products found'); return customerId }

  for (const product of products) {
    // Installed system
    const { data: sys, error: sysErr } = await supabase.from('installed_systems').insert({
      customer_id: customerId, job_id: job.id, product_catalog_id: product.id,
      ownership_type: ownershipType, system_type: job.system_type,
      sku_snapshot: product.sku, name_snapshot: product.name, serial_number: job.serial_number,
      install_date: installDate, retail_price_snapshot: product.retail_price,
      install_fee_snapshot: product.install_fee_exempt ? 0 : product.install_fee,
    }).select('id').single()
    if (sysErr) { console.error('[CRITICAL] System creation failed:', sysErr); continue }
    const systemId = (sys as any).id

    // Junction
    if (ownershipType === 'rented' && contractId) {
      await supabase.from('rental_contract_systems').insert({ rental_contract_id: contractId, installed_system_id: systemId, added_date: installDate })
    }

    // Warranty
    const py = product.warranty_parts_years; const ly = product.warranty_labor_years
    await supabase.from('warranty_records').insert({
      installed_system_id: systemId,
      parts_start_date: py ? installDate : null, parts_end_date: py ? addYears(installDate, py) : null, parts_duration_years: py,
      labor_start_date: ly ? installDate : null, labor_end_date: ly ? addYears(installDate, ly) : null, labor_duration_years: ly,
      warranty_status: 'valid',
      manufacturer_parts_warranty_note: product.category === 'uv_system' ? 'Viqua manufacturer parts warranty' : null,
    })

    // Compliance rules from DB templates
    const ownerCol = ownershipType === 'purchased' ? 'applies_to_purchased' : 'applies_to_rented'
    const { data: templates } = await supabase.from('compliance_rule_templates').select('*')
      .eq('product_catalog_id', product.id).eq('is_active', true).eq(ownerCol, true)

    if (templates) {
      for (const tmpl of templates) {
        if (tmpl.requirement_type === 'maintenance_plan_renewal' && ownershipType === 'rented') continue

        const { data: req } = await supabase.from('compliance_requirements').insert({
          installed_system_id: systemId, customer_id: customerId, source_template_id: tmpl.id,
          requirement_type: tmpl.requirement_type, interval_months: tmpl.interval_months,
          must_purchase_through_zenith: tmpl.must_purchase_through_zenith,
          proof_accepted_types: tmpl.proof_accepted_types, grace_period_months: tmpl.grace_period_months,
          affects_warranty: tmpl.affects_warranty, requires_active_plan: tmpl.requires_active_plan,
        }).select('id').single()

        if (req) {
          const dueDate = addMonths(installDate, tmpl.interval_months)
          await supabase.from('service_schedule_items').insert({
            compliance_requirement_id: (req as any).id, installed_system_id: systemId,
            customer_id: customerId, due_date: dueDate,
            grace_expiry_date: addMonths(dueDate, tmpl.grace_period_months), status: 'upcoming',
          })
        }
      }
    }
  }

  // Maintenance plan
  await supabase.from('maintenance_plans').insert({
    customer_id: customerId, status: 'active', plan_type: 'annual_standard',
    price_snapshot: ownershipType === 'rented' ? 0 : Number(products[0]?.maintenance_plan_yearly || 199),
    start_date: installDate, renewal_date: addMonths(installDate, 12),
    auto_renew: true, included_in_rental: ownershipType === 'rented',
  })

  // Activity
  await supabase.from('customer_activity_log').insert({
    customer_id: customerId, event_type: 'customer_created',
    title: 'Customer created from completed installation',
    metadata: { job_id: job.id, system_type: job.system_type, ownership_type: ownershipType, skus: products.map((p: any) => p.sku) },
    actor_id: actor.actor_id, actor_name: actor.actor_name || null,
  })

  return customerId
}
