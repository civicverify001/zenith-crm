// api/installations/complete.js
// Mark installation complete + charge install fee to card on file

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { job_id, completed_by } = req.body;
  if (!job_id) return res.status(400).json({ error: 'job_id is required' });

  try {
    // ── 1. Fetch the job ──────────────────────────────────────
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('id, status, lead_id, customer_name_snapshot')
      .eq('id', job_id)
      .single();

    if (jobError || !job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status === 'complete') {
      return res.status(400).json({ error: 'Job is already complete' });
    }

    // ── 2. Get install fee from accepted quote ────────────────
    let installFee = 0;
    let customerId = null;

    if (job.lead_id) {
      const { data: quote } = await supabase
        .from('quotes')
        .select('install_fee, monthly_amount')
        .eq('opportunity_id', job.lead_id)
        .eq('status', 'accepted')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (quote?.install_fee) {
        installFee = parseFloat(quote.install_fee);
      }

      // Get customer linked to this lead
      const { data: customer } = await supabase
        .from('customers')
        .select('id')
        .eq('lead_id', job.lead_id)
        .maybeSingle();

      customerId = customer?.id || null;
    }

    // ── 3. Mark job complete (always happens) ─────────────────
    const { error: updateError } = await supabase
      .from('jobs')
      .update({
        status: 'complete',
        completed_at: new Date().toISOString(),
        ready_for_customer_conversion: true,
      })
      .eq('id', job_id);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to mark job complete', detail: updateError.message });
    }

    // Log activity
    await supabase.from('job_activity_log').insert({
      job_id,
      event_type: 'job_completed',
      title: 'Job marked complete',
      metadata: { completed_by: completed_by || null, install_fee: installFee },
      actor_id: completed_by || job_id,
      actor_name: null,
    }).catch(e => console.error('[BEST-EFFORT] activity log:', e.message));

    // ── 4. Charge install fee if customer + payment method exist ──
    if (!customerId || installFee <= 0) {
      return res.status(200).json({
        success: true,
        job_completed: true,
        charge_status: installFee <= 0 ? 'no_fee' : 'no_customer',
        install_fee: installFee,
      });
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('id, stripe_customer_id, full_name, email')
      .eq('id', customerId)
      .single();

    if (!customer?.stripe_customer_id) {
      return res.status(200).json({
        success: true,
        job_completed: true,
        charge_status: 'skipped',
        reason: 'No Stripe customer ID',
        install_fee: installFee,
      });
    }

    const { data: paymentMethod } = await supabase
      .from('payment_methods')
      .select('id, external_id, last_four')
      .eq('customer_id', customerId)
      .eq('is_default', true)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (!paymentMethod?.external_id) {
      return res.status(200).json({
        success: true,
        job_completed: true,
        charge_status: 'skipped',
        reason: 'No payment method on file',
        install_fee: installFee,
      });
    }

    // ── 5. Stripe charge ──────────────────────────────────────
    let chargeResult = {};
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(installFee * 100),
        currency: 'usd',
        customer: customer.stripe_customer_id,
        payment_method: paymentMethod.external_id,
        off_session: true,
        confirm: true,
        description: `Install fee — Job ${job_id}`,
        metadata: { job_id, customer_id: customerId, type: 'install_fee' },
      });

      await supabase.from('payment_transactions').insert({
        customer_id: customerId,
        payment_method_id: paymentMethod.id,
        amount: installFee,
        status: paymentIntent.status === 'succeeded' ? 'succeeded' : 'pending',
        type: 'manual',
        external_id: paymentIntent.id,
        description: `Installation fee — ${customer.full_name || 'Customer'}`,
        attempted_at: new Date().toISOString(),
        completed_at: paymentIntent.status === 'succeeded' ? new Date().toISOString() : null,
      });

      chargeResult = {
        status: paymentIntent.status === 'succeeded' ? 'charged' : 'pending',
        amount: installFee,
        payment_intent_id: paymentIntent.id,
        last_four: paymentMethod.last_four,
      };
    } catch (stripeErr) {
      await supabase.from('payment_transactions').insert({
        customer_id: customerId,
        payment_method_id: paymentMethod.id,
        amount: installFee,
        status: 'failed',
        type: 'manual',
        description: `Installation fee FAILED — ${customer.full_name || 'Customer'}`,
        attempted_at: new Date().toISOString(),
        failure_reason: stripeErr.message,
      });

      chargeResult = { status: 'failed', error: stripeErr.message, amount: installFee };
    }

    return res.status(200).json({
      success: true,
      job_completed: true,
      charge_status: chargeResult.status,
      charge_details: chargeResult,
    });

  } catch (err) {
    console.error('complete install error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
};
