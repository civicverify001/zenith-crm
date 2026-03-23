// api/cron/lifecycle.js
// Vercel Cron Job — runs daily at 7 AM EST (12 UTC)
// Section 1: Updates customer lifecycle_status for Kanban board
// Section 2: Auto-creates draft POs for products below reorder point
// Section 3: 14-day service due reminder SMS (gated by automation_settings)
//
// Add to vercel.json crons array:
// { "path": "/api/cron/lifecycle", "schedule": "0 12 * * *" }

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const APP_URL = process.env.VITE_APP_URL || 'https://zenith-crm-ten.vercel.app'

export default async function handler(req, res) {
  const authHeader = req.headers.authorization
  const cronSecret = process.env.CRON_SECRET
  const isCron = req.headers['x-vercel-cron'] === '1'
  const isManual = cronSecret && authHeader === `Bearer ${cronSecret}`

  if (!isCron && !isManual) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const results = {
    // Section 1: Lifecycle
    customers_checked: 0,
    customers_updated: 0,
    lifecycle_errors: [],
    // Section 2: Auto-PO
    products_checked: 0,
    pos_created: 0,
    auto_po_errors: [],
    // Section 3: Service reminders
    service_reminders_sent: 0,
    service_reminders_skipped: 0,
    service_reminder_errors: [],
  }

  try {
    const today = new Date().toISOString().split('T')[0]
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
    const sixtyDaysFromNow = new Date(Date.now() + 60 * 86400000).toISOString().split('T')[0]

    // ══════════════════════════════════════════════════════════
    // SECTION 1: CUSTOMER LIFECYCLE STATUS
    // Bulk-fetch all relevant data, compute status per customer,
    // batch-update only changed records.
    // ══════════════════════════════════════════════════════════

    // 1a. Fetch all customers
    const { data: customers, error: custErr } = await supabase
      .from('customers')
      .select('id, lifecycle_status, created_at')

    if (custErr) {
      console.error('[lifecycle] Failed to fetch customers:', custErr.message)
      return res.status(500).json({ error: 'Failed to fetch customers', detail: custErr.message })
    }

    if (!customers || customers.length === 0) {
      console.log('[lifecycle] No customers found')
      return res.status(200).json({ message: 'No customers to process', ...results })
    }

    // 1b. Bulk-fetch all service plans (active + payment_failed)
    const { data: allPlans } = await supabase
      .from('customer_service_plans')
      .select('id, customer_id, status, next_service, next_fulfillment_date, plan_id')
      .in('status', ['active', 'payment_failed', 'pending_payment_method'])

    // Build maps: customer_id -> plans
    const plansByCustomer = {}
    for (const p of (allPlans || [])) {
      if (!plansByCustomer[p.customer_id]) plansByCustomer[p.customer_id] = []
      plansByCustomer[p.customer_id].push(p)
    }

    // 1c. Bulk-fetch all active contracts
    const { data: allContracts } = await supabase
      .from('contracts')
      .select('id, customer_id, status, end_date, type')
      .eq('status', 'active')

    const contractsByCustomer = {}
    for (const c of (allContracts || [])) {
      if (!contractsByCustomer[c.customer_id]) contractsByCustomer[c.customer_id] = []
      contractsByCustomer[c.customer_id].push(c)
    }

    // 1d. Bulk-fetch all active installed systems
    const { data: allSystems } = await supabase
      .from('installed_systems')
      .select('id, customer_id, is_active')
      .eq('is_active', true)

    const systemsByCustomer = {}
    for (const s of (allSystems || [])) {
      if (!systemsByCustomer[s.customer_id]) systemsByCustomer[s.customer_id] = []
      systemsByCustomer[s.customer_id].push(s)
    }

    // 1e. Bulk-fetch failed payment transactions in last 30 days
    const { data: failedTx } = await supabase
      .from('payment_transactions')
      .select('customer_id')
      .eq('status', 'failed')
      .gte('attempted_at', thirtyDaysAgo)

    const customersWithFailedPayments = new Set()
    for (const tx of (failedTx || [])) {
      customersWithFailedPayments.add(tx.customer_id)
    }

    // 1f. Compute lifecycle status for each customer
    const updates = [] // { id, newStatus }

    for (const cust of customers) {
      results.customers_checked++

      try {
        const plans = plansByCustomer[cust.id] || []
        const contracts = contractsByCustomer[cust.id] || []
        const systems = systemsByCustomer[cust.id] || []

        const hasPaymentFailed = customersWithFailedPayments.has(cust.id)
        const hasSuspendedPlan = plans.some(p => p.status === 'payment_failed')

        // Check service due: any plan with next_service or next_fulfillment_date <= today
        const hasServiceDue = plans.some(p => {
          if (p.status !== 'active') return false
          if (p.next_service && p.next_service <= today) return true
          if (p.next_fulfillment_date && p.next_fulfillment_date <= today) return true
          return false
        })

        // Check renewal due: any contract ending within 60 days
        const hasRenewalDue = contracts.some(c => {
          if (!c.end_date) return false
          return c.end_date <= sixtyDaysFromNow && c.end_date >= today
        })

        // Check upsell: has active system but no active service plan
        const hasActiveSystem = systems.length > 0
        const hasActivePlan = plans.some(p => p.status === 'active')
        const hasActiveContract = contracts.length > 0

        // Check inactive: no active contracts, no active plans, no active systems
        const isInactive = !hasActiveContract && !hasActivePlan && !hasActiveSystem

        // Priority: at_risk > service_due > renewal_due > upsell > active > inactive
        let newStatus = 'active'

        if (hasPaymentFailed || hasSuspendedPlan) {
          newStatus = 'at_risk'
        } else if (hasServiceDue) {
          newStatus = 'service_due'
        } else if (hasRenewalDue) {
          newStatus = 'renewal_due'
        } else if (isInactive) {
          newStatus = 'inactive'
        } else if (hasActiveSystem && !hasActivePlan && hasActiveContract) {
          newStatus = 'upsell'
        }

        if (newStatus !== cust.lifecycle_status) {
          updates.push({ id: cust.id, oldStatus: cust.lifecycle_status, newStatus })
        }
      } catch (err) {
        results.lifecycle_errors.push({ customer_id: cust.id, reason: err.message })
      }
    }

    // 1g. Batch-update changed customers
    for (const upd of updates) {
      try {
        await supabase
          .from('customers')
          .update({
            lifecycle_status: upd.newStatus,
            lifecycle_updated_at: new Date().toISOString(),
          })
          .eq('id', upd.id)

        await supabase.from('customer_activity_log').insert({
          customer_id: upd.id,
          event_type: 'lifecycle_changed',
          title: `Lifecycle: ${upd.oldStatus || 'unknown'} → ${upd.newStatus}`,
          actor_id: null,
          actor_name: 'System (lifecycle cron)',
          metadata: { from: upd.oldStatus, to: upd.newStatus },
        }).then(() => {}).catch(() => {})

        results.customers_updated++
      } catch (err) {
        results.lifecycle_errors.push({ customer_id: upd.id, reason: err.message })
      }
    }

    console.log(`[lifecycle] Section 1 complete: ${results.customers_checked} checked, ${results.customers_updated} updated`)

    // ══════════════════════════════════════════════════════════
    // SECTION 2: AUTO-PO ON REORDER POINT
    // For each tracked product below reorder point,
    // create a draft PO if no open PO already exists.
    // ══════════════════════════════════════════════════════════

    const { data: inventoryRows } = await supabase
      .from('inventory')
      .select('product_id, quantity_available, reorder_point')

    if (inventoryRows && inventoryRows.length > 0) {
      const belowReorder = inventoryRows.filter(
        inv => inv.reorder_point > 0 && inv.quantity_available <= inv.reorder_point
      )

      if (belowReorder.length > 0) {
        const productIds = belowReorder.map(inv => inv.product_id)

        const { data: openPOItems } = await supabase
          .from('purchase_order_items')
          .select('product_id, purchase_order_id, purchase_orders!inner(status)')
          .in('product_id', productIds)

        const productsWithOpenPO = new Set()
        for (const item of (openPOItems || [])) {
          const poStatus = item.purchase_orders?.status
          if (poStatus === 'draft' || poStatus === 'submitted' || poStatus === 'partial') {
            productsWithOpenPO.add(item.product_id)
          }
        }

        const needPO = belowReorder.filter(inv => !productsWithOpenPO.has(inv.product_id))

        if (needPO.length > 0) {
          results.products_checked = needPO.length

          const needIds = needPO.map(inv => inv.product_id)
          const { data: products } = await supabase
            .from('products')
            .select('id, name, sku, vendor_cost')
            .in('id', needIds)

          const productMap = {}
          for (const p of (products || [])) productMap[p.id] = p

          const poNumber = `PO-${new Date().getFullYear()}-AUTO-${String(Math.floor(Math.random() * 9000) + 1000)}`

          const poItems = needPO.map(inv => {
            const prod = productMap[inv.product_id]
            const qtyNeeded = Math.max(1, (inv.reorder_point * 2) - Math.max(0, inv.quantity_available))
            return {
              product_id: inv.product_id,
              quantity_ordered: qtyNeeded,
              unit_cost: prod?.vendor_cost || 0,
            }
          })

          const subtotal = poItems.reduce((s, i) => s + (i.unit_cost * i.quantity_ordered), 0)

          try {
            const { data: newPO, error: poErr } = await supabase
              .from('purchase_orders')
              .insert({
                po_number: poNumber,
                status: 'draft',
                subtotal,
                notes: `Auto-generated by lifecycle cron — ${needPO.length} product(s) below reorder point`,
              })
              .select('id')
              .single()

            if (poErr) {
              console.error('[lifecycle] Auto-PO creation failed:', poErr.message)
              results.auto_po_errors.push({ reason: poErr.message })
            } else if (newPO) {
              const itemsWithPO = poItems.map(i => ({
                ...i,
                purchase_order_id: newPO.id,
              }))

              const { error: itemErr } = await supabase
                .from('purchase_order_items')
                .insert(itemsWithPO)

              if (itemErr) {
                console.error('[lifecycle] Auto-PO items insert failed:', itemErr.message)
                results.auto_po_errors.push({ reason: itemErr.message })
              } else {
                results.pos_created = 1
                console.log(`[lifecycle] Auto-PO created: ${poNumber} with ${poItems.length} items, total: $${subtotal.toFixed(2)}`)
              }
            }
          } catch (poCreateErr) {
            console.error('[lifecycle] Auto-PO error:', poCreateErr.message)
            results.auto_po_errors.push({ reason: poCreateErr.message })
          }
        } else {
          console.log('[lifecycle] Section 2: all low-stock products already have open POs')
        }
      } else {
        console.log('[lifecycle] Section 2: no products below reorder point')
      }
    }

    console.log(`[lifecycle] Section 2 complete: ${results.products_checked} products need reorder, ${results.pos_created} PO(s) created`)

    // ══════════════════════════════════════════════════════════
    // SECTION 3: 14-DAY SERVICE DUE REMINDER SMS
    // Find active plans where service is due in exactly 14 days.
    // Check automation_settings + DND before sending.
    // Uses /api/automations/trigger (fire-and-forget per customer).
    // ══════════════════════════════════════════════════════════

    try {
      // Check automation setting first — skip entire section if disabled
      const { data: reminderSetting } = await supabase
        .from('automation_settings')
        .select('enabled, sms_template')
        .eq('key', 'service_due_14day_reminder')
        .single()

      if (reminderSetting?.enabled === false) {
        console.log('[lifecycle] Section 3: service_due_14day_reminder disabled — skipping')
      } else {
        // Target date: 14 days from today
        const fourteenDaysOut = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]

        // Find plans due on that exact date
        const { data: duePlans14 } = await supabase
          .from('customer_service_plans')
          .select('id, customer_id, plan_id, next_service, next_fulfillment_date')
          .eq('status', 'active')
          .or(`next_service.eq.${fourteenDaysOut},next_fulfillment_date.eq.${fourteenDaysOut}`)

        console.log(`[lifecycle] Section 3: ${duePlans14?.length || 0} plans due in 14 days`)

        if (duePlans14 && duePlans14.length > 0) {
          // Load plan names
          const planIds14 = [...new Set(duePlans14.map(p => p.plan_id))]
          const { data: planTemplates14 } = await supabase
            .from('service_plans')
            .select('id, name')
            .in('id', planIds14)
          const planNameMap14 = {}
          for (const t of (planTemplates14 || [])) planNameMap14[t.id] = t.name

          // Deduplicate: one reminder per customer per day (multiple plans = one SMS)
          const customersSeen = new Set()

          for (const plan of duePlans14) {
            if (customersSeen.has(plan.customer_id)) continue
            customersSeen.add(plan.customer_id)

            try {
              // Load customer + phone
              const { data: customer } = await supabase
                .from('customers')
                .select('id, full_name, phone, lead_id')
                .eq('id', plan.customer_id)
                .single()

              if (!customer?.phone) {
                results.service_reminders_skipped++
                continue
              }

              // DND check via lead
              const leadId = customer.lead_id
              if (leadId) {
                const { data: lead } = await supabase
                  .from('leads').select('stage').eq('id', leadId).single()
                if (lead?.stage === 'dnd') {
                  console.log(`[lifecycle] S3 skipped DND: ${customer.full_name}`)
                  results.service_reminders_skipped++
                  continue
                }
              }

              const firstName = (customer.full_name || 'there').split(' ')[0]
              const planName = planNameMap14[plan.plan_id] || 'service visit'
              const serviceDateLabel = new Date(fourteenDaysOut + 'T12:00:00').toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric',
              })

              // Call trigger endpoint (fire-and-forget)
              fetch(`${APP_URL}/api/automations/trigger`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  key: 'service_due_14day_reminder',
                  to: customer.phone,
                  entity_type: 'customer',
                  entity_id: customer.id,
                  variables: {
                    name: firstName,
                    plan_name: planName,
                    date: serviceDateLabel,
                  },
                }),
              }).then(r => {
                if (r.ok) {
                  results.service_reminders_sent++
                  console.log(`[lifecycle] S3 reminder sent: ${customer.full_name}`)
                } else {
                  results.service_reminders_skipped++
                }
              }).catch(e => {
                console.error('[lifecycle] S3 trigger error:', e.message)
                results.service_reminder_errors.push({ customer_id: customer.id, reason: e.message })
              })

            } catch (custErr) {
              console.error('[lifecycle] S3 customer error:', custErr.message)
              results.service_reminder_errors.push({ customer_id: plan.customer_id, reason: custErr.message })
            }
          }

          // Brief pause to let fire-and-forget requests initiate
          await new Promise(r => setTimeout(r, 500))
        }
      }
    } catch (s3Err) {
      console.error('[lifecycle] Section 3 error:', s3Err.message)
      results.service_reminder_errors.push({ reason: s3Err.message })
    }

    console.log(`[lifecycle] Section 3 complete: ${results.service_reminders_sent} sent, ${results.service_reminders_skipped} skipped`)

    // ══════════════════════════════════════════════════════════
    // SECTION 4: FILTER DUE — 45-DAY ADVANCE REMINDER SMS
    // Active shipment plans where next_fulfillment_date = 45 days out
    // ══════════════════════════════════════════════════════════

    try {
      const { data: filterSetting } = await supabase
        .from('automation_settings')
        .select('enabled, sms_template')
        .eq('key', 'filter_due_reminder')
        .single()

      if (filterSetting?.enabled === false) {
        console.log('[lifecycle] Section 4: filter_due_reminder disabled — skipping')
      } else {
        const fortyFiveDaysOut = new Date(Date.now() + 45 * 86400000).toISOString().split('T')[0]

        const { data: filterPlans } = await supabase
          .from('customer_service_plans')
          .select('id, customer_id, plan_id, next_fulfillment_date')
          .eq('status', 'active')
          .eq('next_fulfillment_date', fortyFiveDaysOut)

        const { data: planTemplates } = await supabase
          .from('service_plans')
          .select('id, fulfillment_type')
          .eq('fulfillment_type', 'shipment')

        const shipmentPlanIds = new Set((planTemplates || []).map(p => p.id))

        const shipmentPlans = (filterPlans || []).filter(p => shipmentPlanIds.has(p.plan_id))

        console.log(`[lifecycle] Section 4: ${shipmentPlans.length} filter reminders due`)

        const customersSeen4 = new Set()

        for (const plan of shipmentPlans) {
          if (customersSeen4.has(plan.customer_id)) continue
          customersSeen4.add(plan.customer_id)

          try {
            const { data: customer } = await supabase
              .from('customers')
              .select('id, full_name, phone, lead_id')
              .eq('id', plan.customer_id)
              .single()

            if (!customer?.phone) continue

            // DND check
            if (customer.lead_id) {
              const { data: lead } = await supabase
                .from('leads').select('stage').eq('id', customer.lead_id).single()
              if (lead?.stage === 'dnd') continue
            }

            const firstName = (customer.full_name || 'there').split(' ')[0]
            const dateLabel = new Date(fortyFiveDaysOut + 'T12:00:00').toLocaleDateString('en-US', {
              month: 'long', day: 'numeric',
            })

            fetch(`${APP_URL}/api/automations/trigger`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                key: 'filter_due_reminder',
                to: customer.phone,
                entity_type: 'customer',
                entity_id: customer.id,
                variables: { name: firstName, date: dateLabel },
              }),
            }).then(r => {
              if (r.ok) console.log(`[lifecycle] S4 filter reminder sent: ${customer.full_name}`)
            }).catch(e => console.error('[lifecycle] S4 trigger error:', e.message))

          } catch (custErr) {
            console.error('[lifecycle] S4 customer error:', custErr.message)
          }
        }

        // Brief pause for fire-and-forget requests
        if (shipmentPlans.length > 0) await new Promise(r => setTimeout(r, 300))
      }
    } catch (s4Err) {
      console.error('[lifecycle] Section 4 error:', s4Err.message)
    }

    console.log('[lifecycle] Section 4 complete')

    // ══════════════════════════════════════════════════════════
    // SECTION 4: FILTER DUE — 45-DAY ADVANCE REMINDER SMS
    // Shipment-type plans where next_fulfillment_date = 45 days out
    // ══════════════════════════════════════════════════════════

    try {
      const { data: filterSetting } = await supabase
        .from('automation_settings')
        .select('enabled')
        .eq('key', 'filter_due_reminder')
        .single()

      if (filterSetting?.enabled === false) {
        console.log('[lifecycle] Section 4: filter_due_reminder disabled — skipping')
      } else {
        const fortyFiveDaysOut = new Date(Date.now() + 45 * 86400000).toISOString().split('T')[0]

        const { data: filterDuePlans } = await supabase
          .from('customer_service_plans')
          .select('id, customer_id, plan_id, next_fulfillment_date')
          .eq('status', 'active')
          .eq('next_fulfillment_date', fortyFiveDaysOut)

        // Filter to shipment-type plans only
        let shipmentPlanIds: string[] = []
        if (filterDuePlans && filterDuePlans.length > 0) {
          const planIds = [...new Set(filterDuePlans.map((p: any) => p.plan_id))]
          const { data: planTypes } = await supabase
            .from('service_plans').select('id, fulfillment_type').in('id', planIds)
          const shipmentIds = new Set((planTypes || []).filter((p: any) => p.fulfillment_type === 'shipment').map((p: any) => p.id))
          shipmentPlanIds = (filterDuePlans || []).filter((p: any) => shipmentIds.has(p.plan_id)).map((p: any) => p.customer_id)
        }

        const duePlans = (filterDuePlans || []).filter((p: any) => shipmentPlanIds.includes(p.customer_id))
        console.log(`[lifecycle] Section 4: ${duePlans.length} filter due reminders`)

        const filterCustomersSeen = new Set()
        for (const plan of duePlans) {
          if (filterCustomersSeen.has(plan.customer_id)) continue
          filterCustomersSeen.add(plan.customer_id)

          try {
            const { data: customer } = await supabase
              .from('customers').select('id, full_name, phone, lead_id').eq('id', plan.customer_id).single()

            if (!customer?.phone) continue

            const leadId = customer.lead_id
            if (leadId) {
              const { data: lead } = await supabase.from('leads').select('stage').eq('id', leadId).single()
              if (lead?.stage === 'dnd') continue
            }

            const firstName = (customer.full_name || 'there').split(' ')[0]
            const dateLabel = new Date(fortyFiveDaysOut + 'T12:00:00').toLocaleDateString('en-US', {
              weekday: 'long', month: 'long', day: 'numeric',
            })

            fetch(`${APP_URL}/api/automations/trigger`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                key: 'filter_due_reminder',
                to: customer.phone,
                entity_type: 'customer',
                entity_id: customer.id,
                variables: { name: firstName, date: dateLabel },
              }),
            }).then(() => {}).catch(e => console.error('[lifecycle] S4 trigger error:', e.message))

          } catch (err: any) {
            console.error('[lifecycle] S4 customer error:', err.message)
          }
        }

        await new Promise(r => setTimeout(r, 300))
        console.log(`[lifecycle] Section 4 complete: ${duePlans.length} filter reminders queued`)
      }
    } catch (s4Err: any) {
      console.error('[lifecycle] Section 4 error:', s4Err.message)
    }

    // ── Summary log ──────────────────────────────────────────
    if (results.customers_updated > 0 || results.pos_created > 0 || results.service_reminders_sent > 0) {
      const subject = [
        results.customers_updated > 0 ? `${results.customers_updated} lifecycle updates` : null,
        results.pos_created > 0 ? `${results.pos_created} auto-PO created` : null,
        results.service_reminders_sent > 0 ? `${results.service_reminders_sent} service reminders sent` : null,
      ].filter(Boolean).join(', ')

      await supabase.from('email_log').insert({
        customer_id: '00000000-0000-0000-0000-000000000000',
        email_type: 'lifecycle_summary',
        to_address: 'system@zenithpuresolutions.com',
        subject: `Lifecycle cron: ${subject}`,
        status: 'sent',
        sent_at: new Date().toISOString(),
      }).then(() => {}).catch(() => {})
    }

    return res.status(200).json({ message: 'Lifecycle cron complete', date: today, ...results })

  } catch (err) {
    console.error('[lifecycle] Cron error:', err)
    return res.status(500).json({ error: 'Internal server error', message: err.message })
  }
}
