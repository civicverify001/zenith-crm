const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { lead_id } = req.body;
  if (!lead_id) return res.status(400).json({ error: 'lead_id is required' });

  try {
    // 1. Check if job already exists
    const { data: existing } = await supabase
      .from('jobs').select('id, status').eq('lead_id', lead_id).limit(1).maybeSingle();
    if (existing) return res.status(200).json({ success: true, job_id: existing.id, already_existed: true });

    // 2. Fetch lead
    const { data: lead, error: leadErr } = await supabase
      .from('leads').select('*').eq('id', lead_id).single();
    if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found', detail: leadErr?.message });

    // 3. Build address
    const address = [lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ');

    // 4. Create job — minimal columns only
    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .insert({
        lead_id: lead.id,
        status: 'ready_to_schedule',
        job_type: 'standard_install',
        system_type: 'softener_only',
        scheduled_date: null,
        customer_name_snapshot: lead.full_name || 'Unknown',
        phone_snapshot: lead.phone || '',
        email_snapshot: lead.email || null,
        service_address_snapshot: address || null,
      })
      .select('id')
      .single();

    if (jobErr) {
      if (jobErr.code === '23505') return res.status(200).json({ success: true, already_existed: true });
      return res.status(500).json({ error: 'Job insert failed', detail: jobErr.message });
    }

    // 5. Update lead
    await supabase.from('leads').update({ job_created: true }).eq('id', lead_id);

    console.log('[AUTO-JOB] Created job', job.id, 'for lead', lead_id);
    return res.status(200).json({ success: true, job_id: job.id });

  } catch (err) {
    console.error('[AUTO-JOB] Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
