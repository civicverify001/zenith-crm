import { supabase } from '../lib/supabase';
import { uploadMedia, getMediaByEntity, linkMediaToEntity, type MediaRecord, type MediaMetadata } from './mediaService';

// ============================================================
// TYPES
// ============================================================

export interface SiteSurvey {
  id: string;
  customer_id: string | null;
  opportunity_id: string | null;
  job_id: string | null;
  survey_date: string;
  system_type: string | null;
  checklist_data: Record<string, any>;
  feasibility_status: 'pending' | 'feasible' | 'conditional' | 'not_feasible';
  feasibility_notes: string | null;
  surveyed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SurveyPhotoPrompt {
  key: string;            // Unique identifier: 'under_sink', 'water_line', etc.
  label: string;          // Display label
  description: string;    // Help text for the rep
  required: boolean;
  photo_type: string;     // Maps to metadata.photo_type
}

export type FeasibilityStatus = 'pending' | 'feasible' | 'conditional' | 'not_feasible';

// ============================================================
// PHOTO PROMPT DEFINITIONS BY SYSTEM TYPE
// ============================================================

const SURVEY_PROMPTS: Record<string, SurveyPhotoPrompt[]> = {
  ro: [
    { key: 'under_sink', label: 'Under-Sink Photo', description: 'Show the space under the sink where the RO unit will be installed', required: true, photo_type: 'under_sink' },
    { key: 'outlet_ro', label: 'Electrical Outlet', description: 'Show the nearest electrical outlet to the install location', required: true, photo_type: 'outlet' },
    { key: 'drain_ro', label: 'Drain Connection', description: 'Show the drain connection point under the sink', required: false, photo_type: 'drain' },
    { key: 'general_ro', label: 'Additional Photo', description: 'Any other relevant site condition', required: false, photo_type: 'other' },
  ],
  softener: [
    { key: 'water_line', label: 'Main Water Line', description: 'Show the main water line entry point where the softener will connect', required: true, photo_type: 'water_line' },
    { key: 'drain_softener', label: 'Drain / Backwash', description: 'Show the drain for backwash discharge', required: true, photo_type: 'drain' },
    { key: 'outlet_softener', label: 'Electrical Outlet (110V)', description: 'Show the nearest 110V outlet', required: true, photo_type: 'outlet' },
    { key: 'space_softener', label: 'Installation Space', description: 'Show the area where the softener will sit', required: false, photo_type: 'space' },
    { key: 'general_softener', label: 'Additional Photo', description: 'Any other relevant site condition', required: false, photo_type: 'other' },
  ],
  whole_home_filter: [
    { key: 'main_line', label: 'Main Water Line', description: 'Show the main water line where the filter will be installed', required: true, photo_type: 'main_line' },
    { key: 'space_whf', label: 'Installation Space', description: 'Show the installation area with clearance visible', required: true, photo_type: 'space' },
    { key: 'outlet_whf', label: 'Electrical Outlet', description: 'Only needed if the system requires power', required: false, photo_type: 'outlet' },
    { key: 'general_whf', label: 'Additional Photo', description: 'Any other relevant site condition', required: false, photo_type: 'other' },
  ],
  general: [
    { key: 'general_site', label: 'Site Photo', description: 'Show the proposed installation area', required: true, photo_type: 'general' },
    { key: 'general_additional_1', label: 'Additional Photo 1', description: 'Additional site documentation', required: false, photo_type: 'other' },
    { key: 'general_additional_2', label: 'Additional Photo 2', description: 'Additional site documentation', required: false, photo_type: 'other' },
    { key: 'general_additional_3', label: 'Additional Photo 3', description: 'Additional site documentation', required: false, photo_type: 'other' },
  ],
};

/**
 * Get photo prompts for a system type.
 * Falls back to 'general' if type is unknown.
 */
export function getPromptsForSystemType(systemType: string | null): SurveyPhotoPrompt[] {
  if (!systemType) return SURVEY_PROMPTS.general;
  return SURVEY_PROMPTS[systemType] || SURVEY_PROMPTS.general;
}

// ============================================================
// SYSTEM TYPE RESOLUTION — Fallback chain
// ============================================================

export interface SystemTypeContext {
  explicitOverride?: string | null;     // 1. Rep manually selects
  opportunityProductType?: string | null; // 2. From opportunity's primary product requires_survey_type
  jobSystemType?: string | null;        // 3. From job's product/system type
}

/**
 * Resolve the effective system type using the fallback chain:
 * 1. Explicit override selected by rep
 * 2. Opportunity primary product requires_survey_type
 * 3. Job product/system type
 * 4. null (triggers fallback dropdown in UI)
 */
export function resolveSystemType(ctx: SystemTypeContext): string | null {
  if (ctx.explicitOverride) return ctx.explicitOverride;
  if (ctx.opportunityProductType) return ctx.opportunityProductType;
  if (ctx.jobSystemType) return ctx.jobSystemType;
  return null;
}

// ============================================================
// MINIMUM COMPLETE LOGIC
// ============================================================

export interface SurveyCompleteness {
  totalRequired: number;
  capturedRequired: number;
  totalOptional: number;
  capturedOptional: number;
  isMinimumComplete: boolean;  // All required photos present
  missingRequired: string[];   // Keys of missing required prompts
  percentage: number;          // 0-100 across all prompts
}

/**
 * Evaluate survey completeness against photo prompts.
 * A survey is "minimum complete" when ALL required photos are present.
 */
export function evaluateCompleteness(
  prompts: SurveyPhotoPrompt[],
  photos: MediaRecord[]
): SurveyCompleteness {
  const capturedKeys = new Set(
    photos.map(p => (p.metadata as MediaMetadata)?.prompt_key).filter(Boolean)
  );

  const requiredPrompts = prompts.filter(p => p.required);
  const optionalPrompts = prompts.filter(p => !p.required);

  const missingRequired = requiredPrompts
    .filter(p => !capturedKeys.has(p.key))
    .map(p => p.key);

  const capturedRequired = requiredPrompts.length - missingRequired.length;
  const capturedOptional = optionalPrompts.filter(p => capturedKeys.has(p.key)).length;
  const totalAll = prompts.length;
  const capturedAll = capturedRequired + capturedOptional;

  return {
    totalRequired: requiredPrompts.length,
    capturedRequired,
    totalOptional: optionalPrompts.length,
    capturedOptional,
    isMinimumComplete: missingRequired.length === 0,
    missingRequired,
    percentage: totalAll > 0 ? Math.round((capturedAll / totalAll) * 100) : 0,
  };
}

// ============================================================
// PERMISSIONS
// ============================================================

export type SurveyPermission = 'full_edit' | 'upload_only' | 'read_only';

/**
 * Determine what a user can do with a survey based on their role and context.
 *
 * - admin / salesrep: full_edit (status, notes, upload, delete own photos)
 * - technician: upload_only (can add supplemental photos, view everything, cannot edit status/notes)
 * - read_only: customer detail context, or any role viewing historical data
 */
export function getSurveyPermission(
  userRole: string | null,
  context: 'lead' | 'job' | 'customer'
): SurveyPermission {
  // Customer detail is always read-only
  if (context === 'customer') return 'read_only';

  // Role-based for lead and job contexts
  switch (userRole) {
    case 'admin':
    case 'salesrep':
      return 'full_edit';
    case 'technician':
      return 'upload_only';
    case 'frontdesk':
      return 'read_only';
    default:
      return 'read_only';
  }
}

// ============================================================
// CRUD — Site Surveys
// ============================================================

const STORAGE_BUCKET = 'site-survey-photos';

/**
 * Get or create a survey record for the given context.
 * ALWAYS call this before uploading photos so every upload attaches to a real survey_id.
 * Upserts: if a survey already exists for this opportunity/job, returns it.
 */
export async function getOrCreateSurvey(params: {
  opportunityId?: string | null;
  jobId?: string | null;
  customerId?: string | null;
  systemType?: string | null;
  userId?: string | null;
}): Promise<SiteSurvey> {
  const { opportunityId, jobId, customerId, systemType, userId } = params;

  // Try to find existing survey by opportunity or job
  let existing: SiteSurvey | null = null;

  if (opportunityId) {
    const { data } = await supabase
      .from('site_surveys')
      .select('*')
      .eq('opportunity_id', opportunityId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    existing = data;
  }

  if (!existing && jobId) {
    const { data } = await supabase
      .from('site_surveys')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    existing = data;
  }

  if (existing) return existing;

  // Create new survey
  const { data, error } = await supabase
    .from('site_surveys')
    .insert({
      opportunity_id: opportunityId || null,
      job_id: jobId || null,
      customer_id: customerId || null,
      system_type: systemType || null,
      survey_date: new Date().toISOString().split('T')[0],
      feasibility_status: 'pending',
      feasibility_notes: null,
      surveyed_by: userId || null,
      checklist_data: {},
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create survey: ${error.message}`);
  return data;
}

/**
 * Get a survey by ID
 */
export async function getSurvey(surveyId: string): Promise<SiteSurvey | null> {
  const { data, error } = await supabase
    .from('site_surveys')
    .select('*')
    .eq('id', surveyId)
    .single();

  if (error) return null;
  return data;
}

/**
 * Get survey for an opportunity
 */
export async function getSurveyByOpportunity(opportunityId: string): Promise<SiteSurvey | null> {
  const { data } = await supabase
    .from('site_surveys')
    .select('*')
    .eq('opportunity_id', opportunityId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Get survey for a job
 */
export async function getSurveyByJob(jobId: string): Promise<SiteSurvey | null> {
  const { data } = await supabase
    .from('site_surveys')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Get surveys for a customer (may have multiple from different installs)
 */
export async function getSurveysByCustomer(customerId: string): Promise<SiteSurvey[]> {
  const { data, error } = await supabase
    .from('site_surveys')
    .select('*')
    .eq('customer_id', customerId)
    .order('survey_date', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Update survey status and notes.
 * Only allowed for admin/salesrep (enforced in UI via getSurveyPermission).
 */
export async function updateSurvey(
  surveyId: string,
  updates: {
    feasibility_status?: FeasibilityStatus;
    feasibility_notes?: string;
    system_type?: string;
  }
): Promise<SiteSurvey> {
  const { data, error } = await supabase
    .from('site_surveys')
    .update(updates)
    .eq('id', surveyId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update survey: ${error.message}`);
  return data;
}

// ============================================================
// PHOTO UPLOAD — With full provenance
// ============================================================

/**
 * Upload a survey photo with full metadata provenance.
 * Creates the survey record first if it doesn't exist (upsert-before-upload).
 *
 * @param surveyId - The existing survey ID (from getOrCreateSurvey)
 * @param file - The image file
 * @param prompt - The prompt definition this photo answers
 * @param context - Where the photo was captured (lead or job)
 * @param systemType - The system type in effect when captured
 * @param userId - The uploading user's ID
 * @param additionalEntityLinks - Extra entities to link this photo to (lead, job, customer)
 */
export async function uploadSurveyPhoto(params: {
  surveyId: string;
  file: File;
  prompt: SurveyPhotoPrompt;
  capturedContext: 'lead' | 'job';
  systemType: string | null;
  userId: string;
  additionalEntityLinks?: Array<{ entity_type: string; entity_id: string }>;
}): Promise<MediaRecord> {
  const {
    surveyId,
    file,
    prompt,
    capturedContext,
    systemType,
    userId,
    additionalEntityLinks = [],
  } = params;

  // Build storage path: site-survey-photos/{survey_id}/{prompt_key}_{timestamp}.{ext}
  const ext = file.name.split('.').pop() || 'jpg';
  const timestamp = Date.now();
  const storagePath = `${surveyId}/${prompt.key}_${timestamp}.${ext}`;

  // Build metadata with full provenance
  const metadata: MediaMetadata = {
    photo_type: prompt.photo_type,
    prompt_key: prompt.key,
    required_at_capture: prompt.required,
    captured_context: capturedContext,
    system_type_at_capture: systemType || 'unknown',
  };

  // Upload via generic mediaService
  const media = await uploadMedia({
    bucket: STORAGE_BUCKET,
    path: storagePath,
    file,
    entityType: 'site_survey',
    entityId: surveyId,
    fileType: 'photo',
    metadata,
    userId,
    additionalLinks: additionalEntityLinks.map(link => ({
      entity_type: link.entity_type,
      entity_id: link.entity_id,
      context: 'reference' as const,
    })),
  });

  return media;
}

/**
 * Get all photos for a survey
 */
export async function getSurveyPhotos(surveyId: string): Promise<MediaRecord[]> {
  return getMediaByEntity('site_survey', surveyId);
}

// ============================================================
// CONVERSION HELPER
// ============================================================

/**
 * Link all survey media to a customer record during lead → customer conversion.
 * Call this from customerConversionService.
 */
export async function linkSurveyToCustomer(
  opportunityId: string,
  customerId: string
): Promise<void> {
  // Find the survey for this opportunity
  const survey = await getSurveyByOpportunity(opportunityId);
  if (!survey) return;

  // Update survey with customer_id
  await supabase
    .from('site_surveys')
    .update({ customer_id: customerId })
    .eq('id', survey.id);

  // Get all survey photos and link them to the customer
  const photos = await getSurveyPhotos(survey.id);
  for (const photo of photos) {
    await linkMediaToEntity(photo.id, 'customer', customerId, 'reference');
  }
}
