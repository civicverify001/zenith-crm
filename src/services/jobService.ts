import { supabase } from '../lib/supabase'
import type { Job, SystemType, JobStatus, FormType } from '../modules/dispatch/dispatch.types'
import { getRequiredForms } from '../modules/dispatch/dispatch.types'
import type { Lead } from '../modules/leads/leads.types'
import { convertJobToCustomer } from './customerConversionService'

interface ActorInfo {
  actor_id: string
  actor_name?: string
}

const JOB_SELECT = `*`

// ═══════════════════════════════════════════════════════════════
// ACTIVITY LOG (append-only, best-effort — never blocks main flow)
// ═══════════════════════════════════════════════════════════════
async function logJobActivity(entry: {
  job_id: string
  event_type: string
  title: string
  metadata?: Record<string, any>
  actor_id: string
  actor_name?: string
  from_status?: string
  to_status?: string
}) {
  const { error } = await supabase.from('job_activity_log').insert({
    job_id: entry.job_id,
    event_type: entry.event_type,
    title: entry.title,
    metadata: entry.metadata || {},
    actor_id: entry.actor_id,
    actor_name: entry.actor_name || null,
    from_status: entry.from_status || null,
    to_status: entry.to_status || null,
  })
  if (error) console.error('[BEST-EFFORT] Job activity log failed:', error)
}

// ═══════════════════════════════════════════════════════════════
// CREATE INSTALL JOB FROM LEAD
// ═══════════════════════════════════════════════════════════════
export async function createInstallJobFromLead(
  lead: Lead,
  systemType: SystemType,
  scheduledDate: string | null,
  needsFaucetHole: boolean,
  actor: ActorInfo
): Promise<Job> {
  // ── Validation ──
  if (!lead.signed_at) throw new Error('Lead must have a signed agreement')
  if (!lead.full_name) throw new Error('Lead must have a name')
  if (!lead.phone) throw new Error('Lead must have a phone number')

  const address = [lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')
  if (!address) throw new Error('Lead must have a service address')

  // ── Step 1: Duplicate prevention ──
  const { data: existingJob } = await supabase
    .from('jobs')
    .select('id')
    .eq('lead_id', lead.id)
    .limit(1)
    .maybeSingle()

  if (existingJob) {
    throw new Error('A job already exists for this lead. Cannot create duplicate.')
  }

  // ── Step 2: Create job row (REQUIRED) ──
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .insert({
      lead_id: lead.id,
      status: 'scheduled',
      job_type: 'standard_install',
      system_type: systemType,
      scheduled_date: scheduledDate,
      requires_new_faucet_hole: needsFaucetHole,
      customer_name_snapshot: lead.full_name,
      phone_snapshot: lead.phone,
      email_snapshot: lead.email || null,
      service_address_snapshot: address,
      equipment_summary: lead.equipment_summary || null,
      quote_total_snapshot: lead.quote_total,
      payment_method_snapshot: lead.payment_method,
      created_by: actor.actor_id,
    })
    .select(JOB_SELECT)
    .single()

  if (jobError) {
    if (jobError.code === '23505') {
      throw new Error('A job already exists for this lead (concurrent creation detected).')
    }
    throw new Error(`Failed to create job: ${jobError.message}`)
  }

  const createdJob = job as Job

  // ── Step 3: Generate checklist items from template (REQUIRED) ──
  const { data: template } = await supabase
    .from('checklist_templates')
    .select('id, version')
    .eq('system_type', systemType)
    .eq('is_active', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (template) {
    const { data: templateItems, error: tiError } = await supabase
      .from('checklist_template_items')
      .select('*')
      .eq('template_id', template.id)
      .order('sort_order')

    if (tiError) {
      console.error('[CRITICAL] Failed to fetch template items:', tiError)
    } else if (templateItems && templateItems.length > 0) {
      const checklistRows = templateItems.map((item: any) => ({
        job_id: createdJob.id,
        template_id: template.id,
        template_version: template.version,
        section: item.section,
        item_text: item.item_text,
        sort_order: item.sort_order,
        is_required: item.is_required,
        requires_photo: item.requires_photo,
        requires_tech_verification: item.requires_tech_verification,
      }))

      const { error: clError } = await supabase
        .from('job_checklist_items')
        .insert(checklistRows)

      if (clError) {
        console.error('[CRITICAL] Failed to insert checklist items:', clError)
      }
    }
  } else {
    console.warn(`[WARNING] No active checklist template found for system type: ${systemType}`)
  }

  // ── Step 4: Generate required forms (REQUIRED) ──
  const requiredForms = getRequiredForms(systemType, needsFaucetHole)
  if (requiredForms.length > 0) {
    const formRows = requiredForms.map((formType: FormType) => ({
      job_id: createdJob.id,
      form_type: formType,
      required: true,
      requires_signature: true,
      status: 'pending',
    }))

    const { error: formError } = await supabase
      .from('job_required_forms')
      .insert(formRows)

    if (formError) {
      console.error('[CRITICAL] Failed to insert required forms:', formError)
    }
  }

  // ── Step 5: Update lead bridge field (BEST-EFFORT) ──
  const { error: leadError } = await supabase
    .from('leads')
    .update({ job_created: true })
    .eq('id', lead.id)

  if (leadError) {
    console.error('[BEST-EFFORT] Failed to update lead.job_created:', leadError)
  }

  // ── Step 6: Log activity on lead (BEST-EFFORT) ──
  await supabase.from('lead_activity_log').insert({
    lead_id: lead.id,
    event_type: 'job_created',
    title: 'Install job created',
    metadata: {
      job_id: createdJob.id,
      system_type: systemType,
      scheduled_date: scheduledDate,
    },
    actor_id: actor.actor_id,
    actor_name: actor.actor_name || null,
  }).then(({ error }) => {
    if (error) console.error('[BEST-EFFORT] Lead activity log failed:', error)
  })

  // ── Step 7: Log activity on job (BEST-EFFORT) ──
  await logJobActivity({
    job_id: createdJob.id,
    event_type: 'job_created',
    title: 'Job created from lead',
    metadata: {
      lead_id: lead.id,
      customer_name: lead.full_name,
      system_type: systemType,
    },
    ...actor,
  })

  return createdJob
}

// ═══════════════════════════════════════════════════════════════
// ASSIGN TECHNICIAN
// ═══════════════════════════════════════════════════════════════
export async function assignTechnician(
  jobId: string,
  techId: string,
  actor: ActorInfo
): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .update({
      assigned_technician_id: techId,
      assigned_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .select(JOB_SELECT)
    .single()

  if (error) throw new Error(`Failed to assign technician: ${error.message}`)

  await logJobActivity({
    job_id: jobId,
    event_type: 'tech_assigned',
    title: 'Technician assigned',
    metadata: { technician_id: techId },
    ...actor,
  })

  return data as Job
}

// ═══════════════════════════════════════════════════════════════
// UPDATE JOB STATUS
// ═══════════════════════════════════════════════════════════════
const ALLOWED_STATUS_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  scheduled: ['waiting_for_stock', 'in_progress'],
  waiting_for_stock: ['in_progress', 'scheduled'],
  in_progress: ['complete', 'waiting_for_stock'],
  complete: [],
}

export async function updateJobStatus(
  jobId: string,
  newStatus: JobStatus,
  currentJob: Job,
  actor: ActorInfo
): Promise<Job> {
  const allowed = ALLOWED_STATUS_TRANSITIONS[currentJob.status]
  if (!allowed.includes(newStatus)) {
    throw new Error(`Cannot move from ${currentJob.status} to ${newStatus}`)
  }

  // Pre-conditions
  if (newStatus === 'in_progress' && !currentJob.assigned_technician_id) {
    throw new Error('Technician must be assigned before starting')
  }

  // ── PHASE A STEP 5: Inventory gate — block start if stock not ready ──
  if (newStatus === 'in_progress') {
    const invStatus = (currentJob as any).inventory_status
    if (invStatus === 'short') {
      throw new Error('Cannot start installation — inventory not ready. Materials are on order.')
    }
    if (invStatus === 'pending_check') {
      throw new Error('Cannot start installation — inventory check is still pending.')
    }
  }

  if (newStatus === 'complete') {
    if (!currentJob.started_at) {
      throw new Error('Job must be started (in_progress) before completing')
    }
    const issues = await validateJobCompletion(jobId)
    if (issues.length > 0) {
      throw new Error(`Cannot complete job:\n• ${issues.join('\n• ')}`)
    }
  }

  const updateData: Record<string, any> = { status: newStatus }
  if (newStatus === 'in_progress' && !currentJob.started_at) {
    updateData.started_at = new Date().toISOString()
  }
  if (newStatus === 'complete') {
    updateData.completed_at = new Date().toISOString()
    updateData.ready_for_customer_conversion = true
  }

  const { data, error } = await supabase
    .from('jobs')
    .update(updateData)
    .eq('id', jobId)
    .select(JOB_SELECT)
    .single()

  if (error) throw new Error(`Failed to update job status: ${error.message}`)

  await logJobActivity({
    job_id: jobId,
    event_type: newStatus === 'complete' ? 'job_completed' : 'status_change',
    title: newStatus === 'complete' ? 'Job completed' : `Status changed to ${newStatus.replace(/_/g, ' ')}`,
    metadata: { from_status: currentJob.status, to_status: newStatus },
    ...actor,
    from_status: currentJob.status,
    to_status: newStatus,
  })

  // Auto-convert to customer on completion (BEST-EFFORT)
  if (newStatus === 'complete') {
    try {
      let ownershipType: 'purchased' | 'rented' = 'purchased'
      let leadData: any = null
      if (currentJob.lead_id) {
        const { data: ld } = await supabase
          .from('leads')
          .select('payment_method, rental_monthly_amount, rental_term_months')
          .eq('id', currentJob.lead_id)
          .single()
        leadData = ld
        if (leadData?.payment_method === 'rental') {
          ownershipType = 'rented'
        }
      }
      if (ownershipType === 'rented' && leadData?.rental_monthly_amount) {
        await convertJobToCustomer(data as Job, 'rented', actor, leadData.rental_monthly_amount)
      } else {
        await convertJobToCustomer(data as Job, ownershipType, actor)
      }
    } catch (convErr: any) {
      console.error('[BEST-EFFORT] Customer conversion failed:', convErr.message)
    }
  }

  return data as Job
}

// ═══════════════════════════════════════════════════════════════
// COMPLETION VALIDATION (real evidence-based)
// ═══════════════════════════════════════════════════════════════
export interface CompletionStatus {
  checklistTotal: number
  checklistCompleted: number
  photosRequired: number
  photosProvided: number
  verificationRequired: number
  verificationCompleted: number
  formsRequired: number
  formsCompleted: number
  generalPhotos: number
  inventoryStatus: string | null  // NEW: inventory_status from job
  issues: string[]
  ready: boolean
}

export async function getCompletionStatus(jobId: string): Promise<CompletionStatus> {
  const status: CompletionStatus = {
    checklistTotal: 0, checklistCompleted: 0,
    photosRequired: 0, photosProvided: 0,
    verificationRequired: 0, verificationCompleted: 0,
    formsRequired: 0, formsCompleted: 0,
    generalPhotos: 0, inventoryStatus: null,
    issues: [], ready: false,
  }

  // Checklist items
  const { data: items } = await supabase
    .from('job_checklist_items')
    .select('*')
    .eq('job_id', jobId)
    .eq('is_required', true)

  if (items) {
    status.checklistTotal = items.length
    status.checklistCompleted = items.filter((i: any) => i.completed).length
    status.photosRequired = items.filter((i: any) => i.requires_photo).length
    status.photosProvided = items.filter((i: any) => i.requires_photo && i.photo_url).length
    status.verificationRequired = items.filter((i: any) => i.requires_tech_verification).length
    status.verificationCompleted = items.filter((i: any) => i.requires_tech_verification && i.tech_verified).length

    if (status.checklistCompleted < status.checklistTotal) {
      status.issues.push(`${status.checklistTotal - status.checklistCompleted} required checklist items incomplete`)
    }
    if (status.photosProvided < status.photosRequired) {
      status.issues.push(`${status.photosRequired - status.photosProvided} checklist items missing required photos`)
    }
    if (status.verificationCompleted < status.verificationRequired) {
      status.issues.push(`${status.verificationRequired - status.verificationCompleted} items need technician verification`)
    }
  }

  // Required forms
  const { data: forms } = await supabase
    .from('job_required_forms')
    .select('*')
    .eq('job_id', jobId)
    .eq('required', true)

  if (forms) {
    status.formsRequired = forms.length
    status.formsCompleted = forms.filter((f: any) => f.status === 'completed').length

    if (status.formsCompleted < status.formsRequired) {
      status.issues.push(`${status.formsRequired - status.formsCompleted} required forms incomplete`)
    }

    const sigRequired = forms.filter((f: any) => f.requires_signature)
    const sigMissing = sigRequired.filter((f: any) => !f.signature_verified)
    if (sigMissing.length > 0) {
      status.issues.push(`${sigMissing.length} forms missing customer signature`)
    }
  }

  // General photos
  const { count } = await supabase
    .from('job_photos')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)

  status.generalPhotos = count || 0
  if (status.generalPhotos === 0) {
    status.issues.push('At least 1 job photo required')
  }

  // ── PHASE A STEP 4: Inventory readiness check ──
  const { data: jobData } = await supabase
    .from('jobs')
    .select('inventory_status')
    .eq('id', jobId)
    .single()

  status.inventoryStatus = jobData?.inventory_status || null

  if (jobData?.inventory_status === 'short') {
    status.issues.push('Inventory not ready — materials on order')
  }
  if (jobData?.inventory_status === 'pending_check') {
    status.issues.push('Inventory check pending')
  }

  status.ready = status.issues.length === 0
  return status
}

// Legacy wrapper for updateJobStatus
async function validateJobCompletion(jobId: string): Promise<string[]> {
  const status = await getCompletionStatus(jobId)
  return status.issues
}

// ═══════════════════════════════════════════════════════════════
// UPDATE JOB FIELDS
// ═══════════════════════════════════════════════════════════════
export async function updateJobField(
  jobId: string,
  field: 'notes' | 'serial_number' | 'scheduled_date',
  value: string | null,
  actor: ActorInfo
): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .update({ [field]: value })
    .eq('id', jobId)
    .select(JOB_SELECT)
    .single()

  if (error) throw new Error(`Failed to update ${field}: ${error.message}`)
  return data as Job
}

// ═══════════════════════════════════════════════════════════════
// FETCH HELPERS
// ═══════════════════════════════════════════════════════════════
export async function fetchJobsByStatus(): Promise<Record<JobStatus, Job[]>> {
  const { data, error } = await supabase
    .from('jobs')
    .select(JOB_SELECT)
    .order('scheduled_date', { ascending: true, nullsFirst: false })

  if (error) throw new Error(`Failed to fetch jobs: ${error.message}`)

  const grouped: Record<string, Job[]> = {
    scheduled: [], waiting_for_stock: [], in_progress: [], complete: [],
  }
  for (const job of (data || []) as Job[]) {
    if (grouped[job.status]) grouped[job.status].push(job)
  }
  return grouped as Record<JobStatus, Job[]>
}

export async function fetchJob(id: string): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .select(JOB_SELECT)
    .eq('id', id)
    .single()

  if (error) throw new Error(`Failed to fetch job: ${error.message}`)
  return data as Job
}

export async function fetchJobActivity(jobId: string) {
  const { data, error } = await supabase
    .from('job_activity_log')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw new Error(`Failed to fetch job activity: ${error.message}`)
  return data || []
}

export async function fetchJobChecklist(jobId: string) {
  const { data, error } = await supabase
    .from('job_checklist_items')
    .select('*')
    .eq('job_id', jobId)
    .order('sort_order')

  if (error) throw new Error(`Failed to fetch checklist: ${error.message}`)
  return data || []
}

export async function fetchJobRequiredForms(jobId: string) {
  const { data, error } = await supabase
    .from('job_required_forms')
    .select('*')
    .eq('job_id', jobId)

  if (error) throw new Error(`Failed to fetch required forms: ${error.message}`)
  return data || []
}

export async function fetchJobFormResponses(jobId: string) {
  const { data, error } = await supabase
    .from('job_form_responses')
    .select('*')
    .eq('job_id', jobId)

  if (error) throw new Error(`Failed to fetch form responses: ${error.message}`)
  return data || []
}

export async function fetchJobPhotos(jobId: string) {
  const { data, error } = await supabase
    .from('job_photos')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to fetch photos: ${error.message}`)
  return data || []
}

// ═══════════════════════════════════════════════════════════════
// CHECKLIST ITEM MUTATIONS
// ═══════════════════════════════════════════════════════════════
export async function completeChecklistItem(
  itemId: string,
  jobId: string,
  actor: ActorInfo,
  photoUrl?: string
) {
  const { error } = await supabase
    .from('job_checklist_items')
    .update({
      completed: true,
      completed_at: new Date().toISOString(),
      completed_by: actor.actor_id,
      ...(photoUrl ? { photo_url: photoUrl } : {}),
    })
    .eq('id', itemId)

  if (error) throw new Error(`Failed to complete checklist item: ${error.message}`)

  await logJobActivity({
    job_id: jobId,
    event_type: 'checklist_item_completed',
    title: 'Checklist item completed',
    metadata: { item_id: itemId, has_photo: !!photoUrl },
    ...actor,
  })
}

export async function uncompleteChecklistItem(itemId: string) {
  const { error } = await supabase
    .from('job_checklist_items')
    .update({
      completed: false,
      completed_at: null,
      completed_by: null,
    })
    .eq('id', itemId)

  if (error) throw new Error(`Failed to uncomplete checklist item: ${error.message}`)
}

export async function verifyChecklistItem(itemId: string, jobId: string, actor: ActorInfo) {
  const { error } = await supabase
    .from('job_checklist_items')
    .update({
      tech_verified: true,
      tech_verified_at: new Date().toISOString(),
    })
    .eq('id', itemId)

  if (error) throw new Error(`Failed to verify checklist item: ${error.message}`)

  await logJobActivity({
    job_id: jobId,
    event_type: 'tech_verification',
    title: 'Tech verification completed',
    metadata: { item_id: itemId },
    ...actor,
  })
}

// ═══════════════════════════════════════════════════════════════
// FORM SUBMISSIONS
// ═══════════════════════════════════════════════════════════════
export async function submitFormResponse(
  jobId: string,
  formType: string,
  responseData: Record<string, any>,
  signatureUrl: string | null,
  actor: ActorInfo
) {
  const { error: respError } = await supabase
    .from('job_form_responses')
    .upsert({
      job_id: jobId,
      form_type: formType,
      response_data: responseData,
      customer_signature_url: signatureUrl,
      submitted_by: actor.actor_id,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'job_id,form_type' })

  if (respError) throw new Error(`Failed to save form response: ${respError.message}`)

  const hasRealSignature = !!signatureUrl && !signatureUrl.startsWith('local_')
  const { error: formError } = await supabase
    .from('job_required_forms')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_by: actor.actor_id,
      signature_verified: hasRealSignature || !!signatureUrl,
    })
    .eq('job_id', jobId)
    .eq('form_type', formType)

  if (formError) throw new Error(`Failed to update form status: ${formError.message}`)

  const eventType = formType.includes('consent') ? 'consent_submitted' : 'handover_submitted'
  await logJobActivity({
    job_id: jobId,
    event_type: eventType,
    title: `${formType.replace(/_/g, ' ')} submitted`,
    metadata: { form_type: formType, has_signature: !!signatureUrl },
    ...actor,
  })
}

// ═══════════════════════════════════════════════════════════════
// FETCH TECHNICIANS
// ═══════════════════════════════════════════════════════════════
export async function fetchTechnicians() {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, full_name, role')
    .in('role', ['admin', 'technician'])
    .eq('is_active', true)
    .order('full_name')

  if (error) throw new Error(`Failed to fetch technicians: ${error.message}`)
  return data || []
}
