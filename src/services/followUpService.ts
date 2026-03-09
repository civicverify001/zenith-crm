import { supabase } from '../lib/supabase';

// ============================================================
// TYPES
// ============================================================

export type FollowUpTaskType = 'general' | 'call_back' | 'google_review' | 'service_due' | 'filter_replacement' | 'renewal' | 're_engage';

export interface FollowUpTask {
  id: string;
  task_type: FollowUpTaskType;
  lead_id: string | null;
  customer_id: string | null;
  job_id: string | null;
  assigned_to: string | null;
  title: string;
  notes: string | null;
  due_date: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  lead?: { full_name: string; phone: string; stage: string } | null;
  customer?: { full_name: string; phone: string; lifecycle_status: string } | null;
  assigned_user?: { full_name: string } | null;
}

export interface CreateFollowUpParams {
  task_type: FollowUpTaskType;
  lead_id?: string | null;
  customer_id?: string | null;
  job_id?: string | null;
  assigned_to?: string | null;
  title: string;
  notes?: string | null;
  due_date: string;
}

export const TASK_TYPE_LABELS: Record<FollowUpTaskType, string> = {
  general: 'General',
  call_back: 'Call Back',
  google_review: 'Google Review',
  service_due: 'Service Due',
  filter_replacement: 'Filter Replacement',
  renewal: 'Renewal',
  re_engage: 'Re-engage',
};

export const TASK_TYPE_ICONS: Record<FollowUpTaskType, string> = {
  general: '📋',
  call_back: '📞',
  google_review: '⭐',
  service_due: '🔧',
  filter_replacement: '🔄',
  renewal: '📅',
  re_engage: '🔁',
};

// ============================================================
// QUERIES
// ============================================================

const FOLLOW_UP_SELECT = `
  *,
  lead:leads!follow_up_tasks_lead_id_fkey(full_name, phone, stage),
  customer:customers!follow_up_tasks_customer_id_fkey(full_name, phone, lifecycle_status),
  assigned_user:user_profiles!follow_up_tasks_assigned_to_fkey(full_name)
`;

// Fallback select without joins (in case FK names differ)
const FOLLOW_UP_SELECT_SIMPLE = '*';

async function queryFollowUps(query: any): Promise<FollowUpTask[]> {
  // Try with joins first, fallback to simple if FK names don't match
  try {
    const { data, error } = await query.select(FOLLOW_UP_SELECT);
    if (error) throw error;
    return data || [];
  } catch {
    const { data, error } = await query.select(FOLLOW_UP_SELECT_SIMPLE);
    if (error) throw error;
    return data || [];
  }
}

/**
 * Get all open (incomplete) follow-up tasks, sorted by due date
 */
export async function getOpenFollowUps(): Promise<FollowUpTask[]> {
  const { data, error } = await supabase
    .from('follow_up_tasks')
    .select(FOLLOW_UP_SELECT_SIMPLE)
    .is('completed_at', null)
    .order('due_date', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get overdue follow-up tasks (due date before today, not completed)
 */
export async function getOverdueFollowUps(): Promise<FollowUpTask[]> {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('follow_up_tasks')
    .select(FOLLOW_UP_SELECT_SIMPLE)
    .is('completed_at', null)
    .lt('due_date', today)
    .order('due_date', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get follow-ups due today
 */
export async function getTodayFollowUps(): Promise<FollowUpTask[]> {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('follow_up_tasks')
    .select(FOLLOW_UP_SELECT_SIMPLE)
    .is('completed_at', null)
    .eq('due_date', today)
    .order('due_date', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get follow-ups for a specific lead
 */
export async function getLeadFollowUps(leadId: string): Promise<FollowUpTask[]> {
  const { data, error } = await supabase
    .from('follow_up_tasks')
    .select(FOLLOW_UP_SELECT_SIMPLE)
    .eq('lead_id', leadId)
    .order('due_date', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get follow-ups for a specific customer
 */
export async function getCustomerFollowUps(customerId: string): Promise<FollowUpTask[]> {
  const { data, error } = await supabase
    .from('follow_up_tasks')
    .select(FOLLOW_UP_SELECT_SIMPLE)
    .eq('customer_id', customerId)
    .order('due_date', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get completed follow-ups (most recent first)
 */
export async function getCompletedFollowUps(limit = 20): Promise<FollowUpTask[]> {
  const { data, error } = await supabase
    .from('follow_up_tasks')
    .select(FOLLOW_UP_SELECT_SIMPLE)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Get follow-ups assigned to a specific user
 */
export async function getMyFollowUps(userId: string): Promise<FollowUpTask[]> {
  const { data, error } = await supabase
    .from('follow_up_tasks')
    .select(FOLLOW_UP_SELECT_SIMPLE)
    .eq('assigned_to', userId)
    .is('completed_at', null)
    .order('due_date', { ascending: true });

  if (error) throw error;
  return data || [];
}

// ============================================================
// MUTATIONS
// ============================================================

/**
 * Create a new follow-up task
 */
export async function createFollowUp(params: CreateFollowUpParams): Promise<FollowUpTask> {
  const { data, error } = await supabase
    .from('follow_up_tasks')
    .insert({
      task_type: params.task_type,
      lead_id: params.lead_id || null,
      customer_id: params.customer_id || null,
      job_id: params.job_id || null,
      assigned_to: params.assigned_to || null,
      title: params.title,
      notes: params.notes || null,
      due_date: params.due_date,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create follow-up: ${error.message}`);
  return data;
}

/**
 * Mark a follow-up as complete
 */
export async function completeFollowUp(taskId: string): Promise<FollowUpTask> {
  const { data, error } = await supabase
    .from('follow_up_tasks')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', taskId)
    .select()
    .single();

  if (error) throw new Error(`Failed to complete follow-up: ${error.message}`);
  return data;
}

/**
 * Reopen a completed follow-up
 */
export async function reopenFollowUp(taskId: string): Promise<FollowUpTask> {
  const { data, error } = await supabase
    .from('follow_up_tasks')
    .update({ completed_at: null })
    .eq('id', taskId)
    .select()
    .single();

  if (error) throw new Error(`Failed to reopen follow-up: ${error.message}`);
  return data;
}

/**
 * Update a follow-up task
 */
export async function updateFollowUp(taskId: string, updates: Partial<CreateFollowUpParams>): Promise<FollowUpTask> {
  const { data, error } = await supabase
    .from('follow_up_tasks')
    .update(updates)
    .eq('id', taskId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update follow-up: ${error.message}`);
  return data;
}

/**
 * Delete a follow-up task
 */
export async function deleteFollowUp(taskId: string): Promise<void> {
  const { error } = await supabase
    .from('follow_up_tasks')
    .delete()
    .eq('id', taskId);

  if (error) throw new Error(`Failed to delete follow-up: ${error.message}`);
}
