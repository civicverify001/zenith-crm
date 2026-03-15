// ============================================================
// ZENITH CRM OS — FULFILLMENT CRON
// api/cron/fulfillment.js
// Runs daily. Creates pending shipment rows for due service plans.
// Does NOT advance plan dates — that happens on markShipped (RPC).
// ============================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Missing Supabase env vars' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const today = new Date().toISOString().split('T')[0];
  const results = { created: 0, skipped_duplicate: 0, skipped_no_address: 0, skipped_no_product: 0, errors: [] };

  try {
    console.log(`[fulfillment] Starting fulfillment cron for ${today}`);

    // ============================================================
    // STEP 1: Find all eligible service plans
    // Conditions:
    //   - plan status = active
    //   - fulfillment_type is shipment-based
    //   - next_fulfillment_date <= today
    //   - linked service_plans template has a product_id
    //   - no existing non-cancelled shipment for this plan + due date
    // ============================================================
    const { data: duePlans, error: planError } = await supabase
      .from('customer_service_plans')
      .select(`
        id,
        customer_id,
        plan_id,
        next_fulfillment_date,
        service_plans!inner(
          id,
          name,
          product_id,
          fulfillment_type,
          fulfillment_interval_months
        )
      `)
      .eq('status', 'active')
      .lte('next_fulfillment_date', today);

    if (planError) {
      console.error('[fulfillment] Error fetching due plans:', planError);
      return res.status(500).json({ error: 'Failed to fetch due plans', detail: planError.message });
    }

    if (!duePlans || duePlans.length === 0) {
      console.log('[fulfillment] No plans due for fulfillment');
      return res.status(200).json({ message: 'No plans due', results });
    }

    console.log(`[fulfillment] Found ${duePlans.length} plans due for fulfillment check`);

    // ============================================================
    // STEP 2: Filter to shipment-based plans with products
    // ============================================================
    const shipmentTypes = ['shipment', 'ship_filter'];
    const eligiblePlans = duePlans.filter(p => {
      const sp = p.service_plans;
      if (!sp) return false;
      if (!shipmentTypes.includes(sp.fulfillment_type)) return false;
      if (!sp.product_id) {
        results.skipped_no_product++;
        console.log(`[fulfillment] Skipped plan ${p.id} — no product_id on template`);
        return false;
      }
      return true;
    });

    console.log(`[fulfillment] ${eligiblePlans.length} eligible shipment plans after filtering`);

    // ============================================================
    // STEP 3: For each eligible plan, create a pending shipment
    // ============================================================
    for (const plan of eligiblePlans) {
      const sp = plan.service_plans;
      const dueDate = plan.next_fulfillment_date;

      try {
        // Check for existing non-cancelled shipment (belt — index is suspenders)
        const { data: existing, error: existError } = await supabase
          .from('shipments')
          .select('id')
          .eq('customer_service_plan_id', plan.id)
          .eq('fulfillment_due_date', dueDate)
          .neq('status', 'cancelled')
          .limit(1);

        if (existError) {
          console.error(`[fulfillment] Error checking existing shipment for plan ${plan.id}:`, existError);
          results.errors.push({ plan_id: plan.id, error: existError.message });
          continue;
        }

        if (existing && existing.length > 0) {
          results.skipped_duplicate++;
          console.log(`[fulfillment] Skipped plan ${plan.id} — shipment already exists for due date ${dueDate}`);
          continue;
        }

        // Resolve shipping address
        const address = await resolveAddress(supabase, plan.customer_id);

        if (!address) {
          results.skipped_no_address++;
          console.log(`[fulfillment] Plan ${plan.id} — no address found, creating with missing address flag`);
        }

        // Create the pending shipment
        const { error: insertError } = await supabase
          .from('shipments')
          .insert({
            customer_id: plan.customer_id,
            product_id: sp.product_id,
            customer_service_plan_id: plan.id,
            fulfillment_due_date: dueDate,
            source: 'cron_fulfillment',
            type: 'filter',
            carrier: 'fedex',
            status: 'pending',
            scheduled_date: dueDate,
            ship_to_name: address ? address.name : null,
            ship_to_address: address ? address.address : null,
            ship_to_city: address ? address.city : null,
            ship_to_state: address ? address.state : null,
            ship_to_zip: address ? address.zip : null,
            address_source: address ? address.source : null,
            notes: address ? null : 'Address missing — manual entry required',
            created_by: null,
          });

        if (insertError) {
          // Catch unique constraint violation (duplicate) gracefully
          if (insertError.code === '23505') {
            results.skipped_duplicate++;
            console.log(`[fulfillment] Plan ${plan.id} — duplicate caught by unique index for due date ${dueDate}`);
          } else {
            results.errors.push({ plan_id: plan.id, error: insertError.message });
            console.error(`[fulfillment] Error creating shipment for plan ${plan.id}:`, insertError);
          }
          continue;
        }

        results.created++;
        console.log(`[fulfillment] Created pending shipment for plan ${plan.id}, product ${sp.product_id}, due ${dueDate}`);

      } catch (err) {
        results.errors.push({ plan_id: plan.id, error: err.message || 'Unknown error' });
        console.error(`[fulfillment] Unexpected error for plan ${plan.id}:`, err);
      }
    }

    console.log(`[fulfillment] Complete. Created: ${results.created}, Skipped duplicates: ${results.skipped_duplicate}, No address: ${results.skipped_no_address}, No product: ${results.skipped_no_product}, Errors: ${results.errors.length}`);

    return res.status(200).json({ message: 'Fulfillment cron complete', results });

  } catch (err) {
    console.error('[fulfillment] Fatal error:', err);
    return res.status(500).json({ error: 'Fulfillment cron failed', detail: err.message });
  }
}

// ============================================================
// Address resolution helper
// Priority: service_address → primary address → null
// ============================================================
async function resolveAddress(supabase, customerId) {
  try {
    const { data: customer, error } = await supabase
      .from('customers')
      .select('full_name, address, city, state, zip, service_address, service_city, service_state, service_zip')
      .eq('id', customerId)
      .single();

    if (error || !customer) return null;

    const name = customer.full_name || '';

    // Priority 1: Service address
    if (customer.service_address && customer.service_city && customer.service_state && customer.service_zip) {
      return {
        name,
        address: customer.service_address,
        city: customer.service_city,
        state: customer.service_state,
        zip: customer.service_zip,
        source: 'service_address',
      };
    }

    // Priority 2: Primary address
    if (customer.address && customer.city && customer.state && customer.zip) {
      return {
        name,
        address: customer.address,
        city: customer.city,
        state: customer.state,
        zip: customer.zip,
        source: 'customer_primary',
      };
    }

    return null;
  } catch (err) {
    console.error('[fulfillment] resolveAddress error:', err);
    return null;
  }
}
