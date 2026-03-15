import { supabase } from '../lib/supabase';

// ============================================================
// SHIPMENT SERVICE — Single owner for all shipment operations
// ============================================================

// --- Status configs ---
export const SHIPMENT_STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: string }> = {
  pending:       { label: 'Pending',       color: '#f59e0b', bgColor: '#f59e0b20', icon: '📦' },
  label_created: { label: 'Label Created', color: '#8b5cf6', bgColor: '#8b5cf620', icon: '🏷️' },
  shipped:       { label: 'Shipped',       color: '#3b82f6', bgColor: '#3b82f620', icon: '🚚' },
  in_transit:    { label: 'In Transit',    color: '#06b6d4', bgColor: '#06b6d420', icon: '✈️' },
  delivered:     { label: 'Delivered',     color: '#10b981', bgColor: '#10b98120', icon: '✅' },
  cancelled:     { label: 'Cancelled',     color: '#6b7280', bgColor: '#6b728020', icon: '❌' },
  returned:      { label: 'Returned',      color: '#ef4444', bgColor: '#ef444420', icon: '↩️' },
};

export const SHIPMENT_TYPE_LABELS: Record<string, string> = {
  filter:      'Filter Replacement',
  replacement: 'Replacement Part',
  warranty:    'Warranty Replacement',
  new_install: 'New Install',
  other:       'Other',
};

export const ADDRESS_SOURCE_LABELS: Record<string, string> = {
  service_address:  'Service Address',
  customer_primary: 'Primary Address',
  manual_override:  'Manual Override',
};

// --- Types ---
export interface Shipment {
  id: string;
  customer_id: string;
  service_schedule_id: string | null;
  product_id: string | null;
  customer_service_plan_id: string | null;
  fulfillment_due_date: string | null;
  source: string;
  type: string;
  carrier: string;
  tracking_number: string | null;
  label_url: string | null;
  status: string;
  scheduled_date: string | null;
  shipped_date: string | null;
  delivered_date: string | null;
  address_source: string | null;
  ship_to_name: string | null;
  ship_to_address: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_zip: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  product_name?: string;
  plan_name?: string;
}

export interface ShipmentFilters {
  status?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface CreateShipmentInput {
  customer_id: string;
  product_id?: string | null;
  customer_service_plan_id?: string | null;
  fulfillment_due_date?: string | null;
  source?: string;
  type: string;
  carrier?: string;
  scheduled_date?: string | null;
  ship_to_name: string;
  ship_to_address: string;
  ship_to_city: string;
  ship_to_state: string;
  ship_to_zip: string;
  address_source: string;
  notes?: string | null;
  created_by?: string | null;
}

// --- Address Resolution ---
export async function resolveShippingAddress(customerId: string): Promise<{
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  source: string;
} | null> {
  try {
    const { data: customer, error } = await supabase
      .from('customers')
      .select('full_name, address, city, state, zip, service_address, service_city, service_state, service_zip')
      .eq('id', customerId)
      .single();

    if (error || !customer) return null;

    const fullName = customer.full_name || '';

    // Priority 1: Service address (all fields must be non-null)
    if (customer.service_address && customer.service_city && customer.service_state && customer.service_zip) {
      return {
        name: fullName,
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
        name: fullName,
        address: customer.address,
        city: customer.city,
        state: customer.state,
        zip: customer.zip,
        source: 'customer_primary',
      };
    }

    // No valid address found
    return null;
  } catch (err) {
    console.error('resolveShippingAddress error:', err);
    return null;
  }
}

// --- QUERIES ---

export async function fetchShipments(filters: ShipmentFilters = {}): Promise<Shipment[]> {
  try {
    let query = supabase
      .from('shipments')
      .select(`
        *,
        customers!inner(full_name, email, phone),
        products(name)
      `)
      .order('created_at', { ascending: false });

    if (filters.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }
    if (filters.dateFrom) {
      query = query.gte('scheduled_date', filters.dateFrom);
    }
    if (filters.dateTo) {
      query = query.lte('scheduled_date', filters.dateTo);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map(mapShipmentRow);
  } catch (err) {
    console.error('fetchShipments error:', err);
    return [];
  }
}

export async function fetchShipmentsByCustomer(customerId: string): Promise<Shipment[]> {
  try {
    const { data, error } = await supabase
      .from('shipments')
      .select(`
        *,
        customers!inner(full_name, email, phone),
        products(name)
      `)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map(mapShipmentRow);
  } catch (err) {
    console.error('fetchShipmentsByCustomer error:', err);
    return [];
  }
}

export async function fetchShipmentById(id: string): Promise<Shipment | null> {
  try {
    const { data, error } = await supabase
      .from('shipments')
      .select(`
        *,
        customers!inner(full_name, email, phone),
        products(name)
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    return data ? mapShipmentRow(data) : null;
  } catch (err) {
    console.error('fetchShipmentById error:', err);
    return null;
  }
}

export async function getShipmentsDueThisWeek(): Promise<number> {
  try {
    const today = new Date();
    const endOfWeek = new Date(today);
    endOfWeek.setDate(today.getDate() + (7 - today.getDay()));

    const { count, error } = await supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .lte('scheduled_date', endOfWeek.toISOString().split('T')[0])
      .gte('scheduled_date', today.toISOString().split('T')[0]);

    if (error) throw error;
    return count || 0;
  } catch (err) {
    console.error('getShipmentsDueThisWeek error:', err);
    return 0;
  }
}

export async function getShipmentCounts(): Promise<Record<string, number>> {
  try {
    const { data, error } = await supabase
      .from('shipments')
      .select('status');

    if (error) throw error;

    const counts: Record<string, number> = { all: 0 };
    (data || []).forEach((row: { status: string }) => {
      counts.all = (counts.all || 0) + 1;
      counts[row.status] = (counts[row.status] || 0) + 1;
    });
    return counts;
  } catch (err) {
    console.error('getShipmentCounts error:', err);
    return { all: 0 };
  }
}

// --- MUTATIONS ---

export async function createShipment(input: CreateShipmentInput): Promise<Shipment | null> {
  try {
    const { data, error } = await supabase
      .from('shipments')
      .insert({
        customer_id: input.customer_id,
        product_id: input.product_id || null,
        customer_service_plan_id: input.customer_service_plan_id || null,
        fulfillment_due_date: input.fulfillment_due_date || null,
        source: input.source || 'manual',
        type: input.type,
        carrier: input.carrier || 'fedex',
        status: 'pending',
        scheduled_date: input.scheduled_date || null,
        ship_to_name: input.ship_to_name,
        ship_to_address: input.ship_to_address,
        ship_to_city: input.ship_to_city,
        ship_to_state: input.ship_to_state,
        ship_to_zip: input.ship_to_zip,
        address_source: input.address_source,
        notes: input.notes || null,
        created_by: input.created_by || null,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('createShipment error:', err);
    return null;
  }
}

export async function updateShipment(id: string, updates: {
  tracking_number?: string;
  carrier?: string;
  label_url?: string;
  scheduled_date?: string;
  ship_to_name?: string;
  ship_to_address?: string;
  ship_to_city?: string;
  ship_to_state?: string;
  ship_to_zip?: string;
  address_source?: string;
  notes?: string;
}): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('shipments')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('updateShipment error:', err);
    return false;
  }
}

// --- STATUS TRANSITIONS ---

export async function markLabelCreated(id: string, data: {
  tracking_number: string;
  label_url?: string;
}): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('shipments')
      .update({
        status: 'label_created',
        tracking_number: data.tracking_number,
        label_url: data.label_url || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .in('status', ['pending']);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('markLabelCreated error:', err);
    return false;
  }
}

export async function markShipped(id: string): Promise<{ success: boolean; planDatesAdvanced: boolean; error?: string }> {
  try {
    // Use the atomic RPC that updates shipment + plan dates in one transaction
    const { data, error } = await supabase.rpc('rpc_mark_shipment_shipped', {
      p_shipment_id: id,
    });

    if (error) throw error;

    return {
      success: data?.success ?? false,
      planDatesAdvanced: data?.plan_dates_advanced ?? false,
      error: data?.error || undefined,
    };
  } catch (err) {
    console.error('markShipped error:', err);
    return { success: false, planDatesAdvanced: false, error: 'Failed to mark shipped' };
  }
}

export async function markInTransit(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('shipments')
      .update({
        status: 'in_transit',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .in('status', ['shipped']);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('markInTransit error:', err);
    return false;
  }
}

export async function markDelivered(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('shipments')
      .update({
        status: 'delivered',
        delivered_date: new Date().toISOString().split('T')[0],
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .in('status', ['shipped', 'in_transit']);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('markDelivered error:', err);
    return false;
  }
}

export async function cancelShipment(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('shipments')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .in('status', ['pending', 'label_created']);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('cancelShipment error:', err);
    return false;
  }
}

export async function markReturned(id: string, notes?: string): Promise<boolean> {
  try {
    const updates: Record<string, unknown> = {
      status: 'returned',
      updated_at: new Date().toISOString(),
    };
    if (notes) {
      updates.notes = notes;
    }

    const { error } = await supabase
      .from('shipments')
      .update(updates)
      .eq('id', id)
      .in('status', ['delivered']);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('markReturned error:', err);
    return false;
  }
}

// --- ROW MAPPER ---

function mapShipmentRow(row: Record<string, unknown>): Shipment {
  const customers = row.customers as Record<string, string> | null;
  const products = row.products as Record<string, string> | null;

  return {
    ...(row as unknown as Shipment),
    customer_name: customers?.full_name || undefined,
    customer_email: customers?.email || undefined,
    customer_phone: customers?.phone || undefined,
    product_name: products?.name || undefined,
  };
}
