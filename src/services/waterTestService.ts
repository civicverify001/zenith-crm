import { supabase } from '../lib/supabase';

// ============================================================
// TYPES
// ============================================================

export interface WaterTest {
  id: string;
  lead_id: string | null;
  job_id: string | null;
  hardness_gpg: number | null;
  iron_mgl: number | null;
  tds_ppm: number | null;
  ph: number | null;
  chlorine_mgl: number | null;
  sulfur_present: boolean | null;
  water_source: string | null;
  notes: string | null;
  tested_by: string | null;
  tested_at: string | null;
  test_type: 'initial' | 'post_install' | 'routine';
  raw_data: Record<string, unknown>;
  location: string | null;
  recommendations: WaterTestRecommendation[];
  updated_at: string | null;
}

export interface WaterTestRecommendation {
  product_category: string;
  reason: string;
  reading_name: string;
  reading_value: number;
  threshold: number;
  urgency: 'recommended' | 'strongly_recommended' | 'urgent';
}

export interface WaterTestInput {
  lead_id?: string | null;
  job_id?: string | null;
  hardness_gpg?: number | null;
  iron_mgl?: number | null;
  tds_ppm?: number | null;
  ph?: number | null;
  chlorine_mgl?: number | null;
  sulfur_present?: boolean | null;
  water_source?: string | null;
  notes?: string | null;
  tested_by?: string | null;
  test_type?: 'initial' | 'post_install' | 'routine';
  location?: string | null;
  raw_data?: Record<string, unknown>;
}

// ============================================================
// RECOMMENDATION ENGINE
// ============================================================

/**
 * Generate product recommendations based on water test readings.
 * Simple threshold-based rules matching Zenith's product categories.
 */
export function generateRecommendations(input: {
  hardness_gpg?: number | null;
  iron_mgl?: number | null;
  tds_ppm?: number | null;
  ph?: number | null;
  chlorine_mgl?: number | null;
  sulfur_present?: boolean | null;
}): WaterTestRecommendation[] {
  const recs: WaterTestRecommendation[] = [];

  // Hardness > 7 gpg → recommend softener
  if (input.hardness_gpg != null && input.hardness_gpg > 7) {
    const urgency = input.hardness_gpg > 15 ? 'strongly_recommended' : 'recommended';
    recs.push({
      product_category: 'softener',
      reason: `Water hardness is ${input.hardness_gpg} gpg (threshold: 7 gpg). A water softener will prevent scale buildup and extend appliance life.`,
      reading_name: 'hardness_gpg',
      reading_value: input.hardness_gpg,
      threshold: 7,
      urgency,
    });
  }

  // TDS > 300 ppm → recommend RO
  if (input.tds_ppm != null && input.tds_ppm > 300) {
    const urgency = input.tds_ppm > 500 ? 'strongly_recommended' : 'recommended';
    recs.push({
      product_category: 'ro',
      reason: `Total dissolved solids is ${input.tds_ppm} ppm (threshold: 300 ppm). A reverse osmosis system will provide clean drinking water.`,
      reading_name: 'tds_ppm',
      reading_value: input.tds_ppm,
      threshold: 300,
      urgency,
    });
  }

  // Iron > 0.3 ppm → recommend iron filter
  if (input.iron_mgl != null && input.iron_mgl > 0.3) {
    const urgency = input.iron_mgl > 1.0 ? 'strongly_recommended' : 'recommended';
    recs.push({
      product_category: 'iron_filter',
      reason: `Iron level is ${input.iron_mgl} ppm (threshold: 0.3 ppm). An iron filter will prevent staining and metallic taste.`,
      reading_name: 'iron_mgl',
      reading_value: input.iron_mgl,
      threshold: 0.3,
      urgency,
    });
  }

  // pH < 6.5 → recommend acid neutralizer
  if (input.ph != null && input.ph < 6.5) {
    const urgency = input.ph < 5.5 ? 'strongly_recommended' : 'recommended';
    recs.push({
      product_category: 'acid_neutralizer',
      reason: `pH is ${input.ph} (threshold: below 6.5). An acid neutralizer will protect plumbing from corrosion.`,
      reading_name: 'ph',
      reading_value: input.ph,
      threshold: 6.5,
      urgency,
    });
  }

  // Chlorine > 1.0 ppm → recommend carbon filter / whole home filter
  if (input.chlorine_mgl != null && input.chlorine_mgl > 1.0) {
    const urgency = input.chlorine_mgl > 3.0 ? 'strongly_recommended' : 'recommended';
    recs.push({
      product_category: 'whole_home_filter',
      reason: `Chlorine level is ${input.chlorine_mgl} ppm (threshold: 1.0 ppm). A whole home carbon filter will remove chlorine taste and smell.`,
      reading_name: 'chlorine_mgl',
      reading_value: input.chlorine_mgl,
      threshold: 1.0,
      urgency,
    });
  }

  // Sulfur present → flag for treatment
  if (input.sulfur_present === true) {
    recs.push({
      product_category: 'sulfur_treatment',
      reason: 'Sulfur (hydrogen sulfide) detected. Treatment recommended to eliminate rotten egg smell.',
      reading_name: 'sulfur_present',
      reading_value: 1,
      threshold: 0,
      urgency: 'strongly_recommended',
    });
  }

  return recs;
}

// ============================================================
// QUERIES
// ============================================================

export async function fetchByLead(leadId: string): Promise<WaterTest[]> {
  try {
    const { data, error } = await supabase
      .from('water_tests')
      .select('*')
      .eq('lead_id', leadId)
      .order('tested_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('fetchByLead error:', err);
    return [];
  }
}

export async function fetchByJob(jobId: string): Promise<WaterTest[]> {
  try {
    const { data, error } = await supabase
      .from('water_tests')
      .select('*')
      .eq('job_id', jobId)
      .order('tested_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('fetchByJob error:', err);
    return [];
  }
}

/**
 * Fetch all water tests for a customer.
 * Caller passes lead_ids and job_ids belonging to the customer.
 */
export async function fetchByCustomer(
  leadIds: string[],
  jobIds: string[]
): Promise<WaterTest[]> {
  try {
    const allTests: WaterTest[] = [];

    if (leadIds.length > 0) {
      const { data, error } = await supabase
        .from('water_tests')
        .select('*')
        .in('lead_id', leadIds)
        .order('tested_at', { ascending: false });
      if (error) throw error;
      if (data) allTests.push(...data);
    }

    if (jobIds.length > 0) {
      const { data, error } = await supabase
        .from('water_tests')
        .select('*')
        .in('job_id', jobIds)
        .order('tested_at', { ascending: false });
      if (error) throw error;
      if (data) allTests.push(...data);
    }

    // Deduplicate by id
    const seen = new Set<string>();
    return allTests.filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  } catch (err) {
    console.error('fetchByCustomer error:', err);
    return [];
  }
}

export async function fetchById(id: string): Promise<WaterTest | null> {
  try {
    const { data, error } = await supabase
      .from('water_tests')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('fetchById error:', err);
    return null;
  }
}

// ============================================================
// MUTATIONS
// ============================================================

export async function createWaterTest(input: WaterTestInput): Promise<WaterTest | null> {
  try {
    const recommendations = generateRecommendations({
      hardness_gpg: input.hardness_gpg,
      iron_mgl: input.iron_mgl,
      tds_ppm: input.tds_ppm,
      ph: input.ph,
      chlorine_mgl: input.chlorine_mgl,
      sulfur_present: input.sulfur_present,
    });

    const { data, error } = await supabase
      .from('water_tests')
      .insert({
        lead_id: input.lead_id || null,
        job_id: input.job_id || null,
        hardness_gpg: input.hardness_gpg ?? null,
        iron_mgl: input.iron_mgl ?? null,
        tds_ppm: input.tds_ppm ?? null,
        ph: input.ph ?? null,
        chlorine_mgl: input.chlorine_mgl ?? null,
        sulfur_present: input.sulfur_present ?? null,
        water_source: input.water_source || null,
        notes: input.notes || null,
        tested_by: input.tested_by || null,
        tested_at: new Date().toISOString(),
        test_type: input.test_type || 'initial',
        location: input.location || null,
        raw_data: input.raw_data || {},
        recommendations,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('createWaterTest error:', err);
    return null;
  }
}

export async function updateWaterTest(
  id: string,
  input: Partial<WaterTestInput>
): Promise<WaterTest | null> {
  try {
    const current = await fetchById(id);
    if (!current) throw new Error('Water test not found');

    const merged = {
      hardness_gpg: input.hardness_gpg !== undefined ? input.hardness_gpg : current.hardness_gpg,
      iron_mgl: input.iron_mgl !== undefined ? input.iron_mgl : current.iron_mgl,
      tds_ppm: input.tds_ppm !== undefined ? input.tds_ppm : current.tds_ppm,
      ph: input.ph !== undefined ? input.ph : current.ph,
      chlorine_mgl: input.chlorine_mgl !== undefined ? input.chlorine_mgl : current.chlorine_mgl,
      sulfur_present: input.sulfur_present !== undefined ? input.sulfur_present : current.sulfur_present,
    };

    const recommendations = generateRecommendations(merged);

    const updatePayload: Record<string, unknown> = { recommendations };
    if (input.hardness_gpg !== undefined) updatePayload.hardness_gpg = input.hardness_gpg;
    if (input.iron_mgl !== undefined) updatePayload.iron_mgl = input.iron_mgl;
    if (input.tds_ppm !== undefined) updatePayload.tds_ppm = input.tds_ppm;
    if (input.ph !== undefined) updatePayload.ph = input.ph;
    if (input.chlorine_mgl !== undefined) updatePayload.chlorine_mgl = input.chlorine_mgl;
    if (input.sulfur_present !== undefined) updatePayload.sulfur_present = input.sulfur_present;
    if (input.water_source !== undefined) updatePayload.water_source = input.water_source;
    if (input.notes !== undefined) updatePayload.notes = input.notes;
    if (input.tested_by !== undefined) updatePayload.tested_by = input.tested_by;
    if (input.test_type !== undefined) updatePayload.test_type = input.test_type;
    if (input.location !== undefined) updatePayload.location = input.location;
    if (input.raw_data !== undefined) updatePayload.raw_data = input.raw_data;
    if (input.lead_id !== undefined) updatePayload.lead_id = input.lead_id;
    if (input.job_id !== undefined) updatePayload.job_id = input.job_id;

    const { data, error } = await supabase
      .from('water_tests')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('updateWaterTest error:', err);
    return null;
  }
}

export async function deleteWaterTest(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('water_tests')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('deleteWaterTest error:', err);
    return false;
  }
}

// ============================================================
// COMPARISON HELPERS
// ============================================================

/**
 * Get before/after comparison for a customer.
 * Returns the earliest "initial" test and the latest "post_install" test.
 */
export function getBeforeAfterComparison(tests: WaterTest[]): {
  before: WaterTest | null;
  after: WaterTest | null;
} {
  const initials = tests
    .filter((t) => t.test_type === 'initial')
    .sort((a, b) => new Date(a.tested_at || '').getTime() - new Date(b.tested_at || '').getTime());

  const postInstalls = tests
    .filter((t) => t.test_type === 'post_install')
    .sort((a, b) => new Date(b.tested_at || '').getTime() - new Date(a.tested_at || '').getTime());

  return {
    before: initials[0] || null,
    after: postInstalls[0] || null,
  };
}

/**
 * Reading labels for display.
 */
export const READING_LABELS: Record<string, { label: string; unit: string; good_direction: 'lower' | 'higher' | 'range' }> = {
  hardness_gpg: { label: 'Hardness', unit: 'gpg', good_direction: 'lower' },
  iron_mgl: { label: 'Iron', unit: 'ppm', good_direction: 'lower' },
  tds_ppm: { label: 'TDS', unit: 'ppm', good_direction: 'lower' },
  ph: { label: 'pH', unit: '', good_direction: 'range' },
  chlorine_mgl: { label: 'Chlorine', unit: 'ppm', good_direction: 'lower' },
};

export function formatReading(key: string, value: number | null | boolean): string {
  if (value === null || value === undefined) return '—';
  if (key === 'sulfur_present') return value ? 'Detected' : 'Not detected';
  if (typeof value === 'number') {
    const info = READING_LABELS[key];
    return info ? `${value} ${info.unit}`.trim() : String(value);
  }
  return String(value);
}
