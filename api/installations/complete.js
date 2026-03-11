// api/installations/complete.js
// Mark installation complete + charge install fee to card on file
// Called by tech/admin from InstallationDetailPage

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Only POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { job_id, completed_by } = req.body;

  if (!job_id) {
    return res.status(400).json({ error: 'job_id is required' });
  }

  try {
    // -------------------------------------------------------
    // 1. Fetch the job/installation record
    // -------------------------------------------------------
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('id, status, customer_id, opportunity_id')
      .eq('id', job_id)
      .single();

    if (jobError || !job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status === 'completed') {
      return res.status(400).json({ error: 'Job is already completed' });
    }

    // -------------------------------------------------------
    // 2. Get the install fee from the linked quote/opportunity
    //    Quote stores install_fee as a snapshotted amount
    // -------------------------------------------------------
    let installFee = 0;

    // Try to get from the opportunity's accepted quote
    if (job.opportunity_id) {
      const { data: quote } = await supabase
        .from('quotes')
        .select('id, install_fee, customer_id')
        .eq('opportunity_id', job.opportunity_id)
        .eq('status', 'accepted')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (quote?.install_fee) {
        installFee = parseFloat(quote.install_fee);
      }
    }

    // Fallback: look up from quote_line_items or document_line_items
    if (installFee === 0 && job.opportunity_id) {
      const { data: quote } = await supabase
        .from('quotes')
        .select('id')
        .eq('opportunity_id', job.opportunity_id)
        .eq('status', 'accepted')
        .limit(1)
        .single();

      if (quote) {
        const { data: lineItems } = await supabase
          .from('document_line_items')
          .select('unit_price, total, description, item_type')
          .eq('document_id', quote.id)
          .or('item_type.eq.install_fee,description.ilike.%install%');

        if (lineItems?.length > 0) {
          installFee = parseFloat(lineItems[0].total || lineItems[0].unit_price || 0);
        }
      }
    }

    // -------------------------------------------------------
    // 3. Get customer's default payment method
    // -------------------------------------------------------
    const { data: paymentMethod, error: pmError } = await supabase
      .from('payment_methods')
      .select('id, external_id, type, last_four')
      .eq('customer_id', job.customer_id)
      .eq('is_default', true)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (pmError || !paymentMethod) {
      // Still mark complete but flag no charge
      await supabase
        .from('jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by: completed_by || null,
        })
        .eq('id', job_id);

      return res.status(200).json({
        success: true,
        job_completed: true,
        charge_status: 'skipped',
        reason: 'No payment method on file',
        install_fee: installFee,
      });
    }

    // -------------------------------------------------------
    // 4. Get customer's Stripe customer ID
    // -------------------------------------------------------
    const { data: customer } = await supabase
      .from('customers')
      .select('id, stripe_customer_id, name, email')
      .eq('id', job.customer_id)
      .single();

    if (!customer?.stripe_customer_id) {
      // Mark complete, flag missing Stripe customer
      await supabase
        .from('jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by: completed_by || null,
        })
        .eq('id', job_id);

      return res.status(200).json({
        success: true,
        job_completed: true,
        charge_status: 'skipped',
        reason: 'No Stripe customer ID on record',
        install_fee: installFee,
      });
    }

    // -------------------------------------------------------
    // 5. Charge the install fee via Stripe PaymentIntent
    // -------------------------------------------------------
    let chargeResult = { status: 'skipped', reason: 'No install fee' };

    if (installFee > 0) {
      const amountCents = Math.round(installFee * 100);

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: 'usd',
          customer: customer.stripe_customer_id,
          payment_method: paymentMethod.external_id,
          off_session: true,
          confirm: true,
          description: `Install fee - Job ${job_id}`,
          metadata: {
            job_id: job_id,
            customer_id: job.customer_id,
            type: 'install_fee',
          },
        });

        // Record successful transaction
        await supabase.from('payment_transactions').insert({
          customer_id: job.customer_id,
          payment_method_id: paymentMethod.id,
          amount: installFee,
          status: paymentIntent.status === 'succeeded' ? 'succeeded' : 'pending',
          type: 'install_fee',
          external_id: paymentIntent.id,
          description: `Installation fee - ${customer.name || 'Customer'}`,
          attempted_at: new Date().toISOString(),
          completed_at: paymentIntent.status === 'succeeded' ? new Date().toISOString() : null,
        });

        chargeResult = {
          status: paymentIntent.status === 'succeeded' ? 'charged' : 'pending',
          amount: installFee,
          payment_intent_id: paymentIntent.id,
          last_four: paymentMethod.last_four,
        };
      } catch (stripeError) {
        // Record failed transaction
        await supabase.from('payment_transactions').insert({
          customer_id: job.customer_id,
          payment_method_id: paymentMethod.id,
          amount: installFee,
          status: 'failed',
          type: 'install_fee',
          description: `Installation fee - FAILED - ${customer.name || 'Customer'}`,
          attempted_at: new Date().toISOString(),
          failure_reason: stripeError.message,
        });

        chargeResult = {
          status: 'failed',
          amount: installFee,
          error: stripeError.message,
          code: stripeError.code,
        };
      }
    }

    // -------------------------------------------------------
    // 6. Mark job as completed regardless of charge outcome
    // -------------------------------------------------------
    await supabase
      .from('jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_by: completed_by || null,
        install_fee_charged: chargeResult.status === 'charged',
        install_fee_charge_status: chargeResult.status,
      })
      .eq('id', job_id);

    // -------------------------------------------------------
    // 7. Return result
    // -------------------------------------------------------
    return res.status(200).json({
      success: true,
      job_completed: true,
      charge_status: chargeResult.status,
      charge_details: chargeResult,
    });

  } catch (error) {
    console.error('Complete install error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}
