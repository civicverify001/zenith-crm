import { supabase } from '../lib/supabase';

// ============================================================
// TYPES
// ============================================================

export interface ChecklistTemplate {
  id: string;
  name: string;
  type: 'installer' | 'handover' | 'site_survey';
  system_type: 'ro' | 'softener' | 'whole_home' | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  sections?: ChecklistSection[];
}

export interface ChecklistSection {
  id: string;
  template_id: string;
  title: string;
  letter_label: string | null;
  is_conditional: boolean;
  condition_label: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  items?: ChecklistItem[];
}

export interface ChecklistItem {
  id: string;
  section_id: string;
  item_text: string;
  field_type: 'checkbox' | 'text' | 'dropdown' | 'photo' | 'number';
  options: string[];
  is_required: boolean;
  requires_photo: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface ChecklistResponse {
  id: string;
  template_id: string;
  entity_type: 'lead' | 'job' | 'customer';
  entity_id: string;
  section_id: string;
  item_id: string;
  response_value: string | null;
  photo_url: string | null;
  responded_by: string | null;
  responded_at: string;
  created_at: string;
}

// ============================================================
// TEMPLATE QUERIES
// ============================================================

export async function fetchTemplates(filters?: {
  type?: string;
  system_type?: string | null;
  is_active?: boolean;
}): Promise<ChecklistTemplate[]> {
  try {
    let query = supabase
      .from('checklist_templates')
      .select('*')
      .order('sort_order', { ascending: true });

    if (filters?.type) {
      query = query.eq('type', filters.type);
    }
    if (filters?.system_type !== undefined) {
      if (filters.system_type === null) {
        query = query.is('system_type', null);
      } else {
        query = query.eq('system_type', filters.system_type);
      }
    }
    if (filters?.is_active !== undefined) {
      query = query.eq('is_active', filters.is_active);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('fetchTemplates error:', err);
    return [];
  }
}

export async function fetchTemplateById(id: string): Promise<ChecklistTemplate | null> {
  try {
    const { data, error } = await supabase
      .from('checklist_templates')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('fetchTemplateById error:', err);
    return null;
  }
}

/**
 * Fetch a full template with all sections and items nested.
 * Used by ChecklistRenderer and admin preview.
 */
export async function fetchTemplateWithSections(templateId: string): Promise<ChecklistTemplate | null> {
  try {
    const { data: template, error: tErr } = await supabase
      .from('checklist_templates')
      .select('*')
      .eq('id', templateId)
      .single();
    if (tErr) throw tErr;
    if (!template) return null;

    const { data: sections, error: sErr } = await supabase
      .from('checklist_sections')
      .select('*')
      .eq('template_id', templateId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (sErr) throw sErr;

    const sectionIds = (sections || []).map((s: ChecklistSection) => s.id);

    let items: ChecklistItem[] = [];
    if (sectionIds.length > 0) {
      const { data: itemData, error: iErr } = await supabase
        .from('checklist_items')
        .select('*')
        .in('section_id', sectionIds)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (iErr) throw iErr;
      items = itemData || [];
    }

    // Nest items under their sections
    const sectionsWithItems = (sections || []).map((section: ChecklistSection) => ({
      ...section,
      items: items.filter((item: ChecklistItem) => item.section_id === section.id),
    }));

    return { ...template, sections: sectionsWithItems };
  } catch (err) {
    console.error('fetchTemplateWithSections error:', err);
    return null;
  }
}

/**
 * Find templates matching a system type.
 * Returns templates where system_type matches OR system_type is null (applies to all).
 */
export async function fetchTemplatesForSystem(
  systemType: string,
  type?: 'installer' | 'handover' | 'site_survey'
): Promise<ChecklistTemplate[]> {
  try {
    let query = supabase
      .from('checklist_templates')
      .select('*')
      .eq('is_active', true)
      .or(`system_type.eq.${systemType},system_type.is.null`)
      .order('sort_order', { ascending: true });

    if (type) {
      query = query.eq('type', type);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('fetchTemplatesForSystem error:', err);
    return [];
  }
}

// ============================================================
// TEMPLATE MUTATIONS
// ============================================================

export async function createTemplate(input: {
  name: string;
  type: 'installer' | 'handover' | 'site_survey';
  system_type: 'ro' | 'softener' | 'whole_home' | null;
  sort_order?: number;
}): Promise<ChecklistTemplate | null> {
  try {
    const { data, error } = await supabase
      .from('checklist_templates')
      .insert({
        name: input.name,
        type: input.type,
        system_type: input.system_type,
        sort_order: input.sort_order || 0,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('createTemplate error:', err);
    return null;
  }
}

export async function updateTemplate(
  id: string,
  updates: Partial<Pick<ChecklistTemplate, 'name' | 'type' | 'system_type' | 'is_active' | 'sort_order'>>
): Promise<ChecklistTemplate | null> {
  try {
    const { data, error } = await supabase
      .from('checklist_templates')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('updateTemplate error:', err);
    return null;
  }
}

export async function deleteTemplate(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('checklist_templates')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('deleteTemplate error:', err);
    return false;
  }
}

// ============================================================
// SECTION QUERIES & MUTATIONS
// ============================================================

export async function fetchSections(templateId: string): Promise<ChecklistSection[]> {
  try {
    const { data, error } = await supabase
      .from('checklist_sections')
      .select('*')
      .eq('template_id', templateId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('fetchSections error:', err);
    return [];
  }
}

export async function createSection(input: {
  template_id: string;
  title: string;
  letter_label?: string | null;
  is_conditional?: boolean;
  condition_label?: string | null;
  sort_order?: number;
}): Promise<ChecklistSection | null> {
  try {
    const { data, error } = await supabase
      .from('checklist_sections')
      .insert({
        template_id: input.template_id,
        title: input.title,
        letter_label: input.letter_label || null,
        is_conditional: input.is_conditional || false,
        condition_label: input.condition_label || null,
        sort_order: input.sort_order || 0,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('createSection error:', err);
    return null;
  }
}

export async function updateSection(
  id: string,
  updates: Partial<Pick<ChecklistSection, 'title' | 'letter_label' | 'is_conditional' | 'condition_label' | 'sort_order' | 'is_active'>>
): Promise<ChecklistSection | null> {
  try {
    const { data, error } = await supabase
      .from('checklist_sections')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('updateSection error:', err);
    return null;
  }
}

export async function deleteSection(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('checklist_sections')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('deleteSection error:', err);
    return false;
  }
}

/**
 * Reorder sections within a template.
 * Accepts array of { id, sort_order } pairs.
 */
export async function reorderSections(
  updates: { id: string; sort_order: number }[]
): Promise<boolean> {
  try {
    for (const u of updates) {
      const { error } = await supabase
        .from('checklist_sections')
        .update({ sort_order: u.sort_order })
        .eq('id', u.id);
      if (error) throw error;
    }
    return true;
  } catch (err) {
    console.error('reorderSections error:', err);
    return false;
  }
}

// ============================================================
// ITEM QUERIES & MUTATIONS
// ============================================================

export async function fetchItems(sectionId: string): Promise<ChecklistItem[]> {
  try {
    const { data, error } = await supabase
      .from('checklist_items')
      .select('*')
      .eq('section_id', sectionId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('fetchItems error:', err);
    return [];
  }
}

export async function createItem(input: {
  section_id: string;
  item_text: string;
  field_type?: 'checkbox' | 'text' | 'dropdown' | 'photo' | 'number';
  options?: string[];
  is_required?: boolean;
  requires_photo?: boolean;
  sort_order?: number;
}): Promise<ChecklistItem | null> {
  try {
    const { data, error } = await supabase
      .from('checklist_items')
      .insert({
        section_id: input.section_id,
        item_text: input.item_text,
        field_type: input.field_type || 'checkbox',
        options: input.options || [],
        is_required: input.is_required || false,
        requires_photo: input.requires_photo || false,
        sort_order: input.sort_order || 0,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('createItem error:', err);
    return null;
  }
}

export async function updateItem(
  id: string,
  updates: Partial<Pick<ChecklistItem, 'item_text' | 'field_type' | 'options' | 'is_required' | 'requires_photo' | 'sort_order' | 'is_active'>>
): Promise<ChecklistItem | null> {
  try {
    const { data, error } = await supabase
      .from('checklist_items')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('updateItem error:', err);
    return null;
  }
}

export async function deleteItem(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('checklist_items')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('deleteItem error:', err);
    return false;
  }
}

export async function reorderItems(
  updates: { id: string; sort_order: number }[]
): Promise<boolean> {
  try {
    for (const u of updates) {
      const { error } = await supabase
        .from('checklist_items')
        .update({ sort_order: u.sort_order })
        .eq('id', u.id);
      if (error) throw error;
    }
    return true;
  } catch (err) {
    console.error('reorderItems error:', err);
    return false;
  }
}

// ============================================================
// RESPONSE QUERIES
// ============================================================

/**
 * Fetch all responses for a given entity (lead, job, or customer).
 * Optionally filter by template.
 */
export async function fetchResponses(
  entityType: 'lead' | 'job' | 'customer',
  entityId: string,
  templateId?: string
): Promise<ChecklistResponse[]> {
  try {
    let query = supabase
      .from('checklist_responses')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('responded_at', { ascending: true });

    if (templateId) {
      query = query.eq('template_id', templateId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('fetchResponses error:', err);
    return [];
  }
}

/**
 * Get completion stats for an entity against a template.
 * Returns { total, completed, percentage }.
 */
export async function getCompletionStats(
  templateId: string,
  entityType: 'lead' | 'job' | 'customer',
  entityId: string
): Promise<{ total: number; completed: number; percentage: number }> {
  try {
    // Get all required items for this template
    const template = await fetchTemplateWithSections(templateId);
    if (!template || !template.sections) {
      return { total: 0, completed: 0, percentage: 0 };
    }

    let totalRequired = 0;
    const requiredItemIds: string[] = [];

    for (const section of template.sections) {
      if (!section.items) continue;
      for (const item of section.items) {
        if (item.is_required) {
          totalRequired++;
          requiredItemIds.push(item.id);
        }
      }
    }

    if (totalRequired === 0) {
      return { total: 0, completed: 0, percentage: 100 };
    }

    // Get responses for required items
    const { data: responses, error } = await supabase
      .from('checklist_responses')
      .select('item_id, response_value')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .eq('template_id', templateId)
      .in('item_id', requiredItemIds);
    if (error) throw error;

    const completedCount = (responses || []).filter(
      (r: { item_id: string; response_value: string | null }) => r.response_value !== null && r.response_value !== ''
    ).length;

    return {
      total: totalRequired,
      completed: completedCount,
      percentage: Math.round((completedCount / totalRequired) * 100),
    };
  } catch (err) {
    console.error('getCompletionStats error:', err);
    return { total: 0, completed: 0, percentage: 0 };
  }
}

// ============================================================
// RESPONSE MUTATIONS
// ============================================================

/**
 * Save a single response. Uses upsert logic:
 * if a response exists for this item+entity, it gets replaced.
 */
export async function saveResponse(input: {
  template_id: string;
  entity_type: 'lead' | 'job' | 'customer';
  entity_id: string;
  section_id: string;
  item_id: string;
  response_value: string | null;
  photo_url?: string | null;
  responded_by?: string | null;
}): Promise<ChecklistResponse | null> {
  try {
    // Delete existing response for this item+entity (unique index enforces one per item per entity)
    await supabase
      .from('checklist_responses')
      .delete()
      .eq('item_id', input.item_id)
      .eq('entity_type', input.entity_type)
      .eq('entity_id', input.entity_id);

    // Insert new response
    const { data, error } = await supabase
      .from('checklist_responses')
      .insert({
        template_id: input.template_id,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        section_id: input.section_id,
        item_id: input.item_id,
        response_value: input.response_value,
        photo_url: input.photo_url || null,
        responded_by: input.responded_by || null,
        responded_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('saveResponse error:', err);
    return null;
  }
}

/**
 * Bulk save responses — used when tech submits an entire section or checklist at once.
 * Deletes existing responses for these items first, then inserts all.
 */
export async function bulkSaveResponses(
  templateId: string,
  entityType: 'lead' | 'job' | 'customer',
  entityId: string,
  responses: {
    section_id: string;
    item_id: string;
    response_value: string | null;
    photo_url?: string | null;
  }[],
  respondedBy?: string | null
): Promise<boolean> {
  try {
    const itemIds = responses.map((r) => r.item_id);

    // Delete existing responses for these items
    if (itemIds.length > 0) {
      const { error: delErr } = await supabase
        .from('checklist_responses')
        .delete()
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .in('item_id', itemIds);
      if (delErr) throw delErr;
    }

    // Insert all new responses
    const rows = responses.map((r) => ({
      template_id: templateId,
      entity_type: entityType,
      entity_id: entityId,
      section_id: r.section_id,
      item_id: r.item_id,
      response_value: r.response_value,
      photo_url: r.photo_url || null,
      responded_by: respondedBy || null,
      responded_at: new Date().toISOString(),
    }));

    const { error: insErr } = await supabase
      .from('checklist_responses')
      .insert(rows);
    if (insErr) throw insErr;

    return true;
  } catch (err) {
    console.error('bulkSaveResponses error:', err);
    return false;
  }
}

/**
 * Delete all responses for an entity against a specific template.
 * Used when resetting a checklist.
 */
export async function clearResponses(
  templateId: string,
  entityType: 'lead' | 'job' | 'customer',
  entityId: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('checklist_responses')
      .delete()
      .eq('template_id', templateId)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('clearResponses error:', err);
    return false;
  }
}
