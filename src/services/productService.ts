import { supabase } from '../lib/supabase';

// ============================================================
// TYPES
// ============================================================
export interface Product {
  id: string;
  name: string;
  sku: string | null;
  category: 'ro' | 'softener' | 'whole_home_filter' | 'replacement_filter' | 'accessory' | 'service';
  description: string | null;
  retail_price: number | null;
  rental_price_monthly: number | null;
  install_fee: number;
  maintenance_price_monthly: number | null;
  filter_interval_months: number | null;
  buyout_formula: 'retail_minus_payments' | 'fixed_schedule' | 'custom' | null;
  warranty_months: number;
  requires_survey_type: string | null;
  is_active: boolean;
  track_inventory?: boolean;
  created_at: string;
  updated_at: string;
  // Vendor fields — only populated for admin role. Always null for non-admin.
  vendor_name?: string | null;
  vendor_sku?: string | null;
  vendor_cost?: number | null;
  vendor_id?: string | null;
}

export type ProductInsert = Omit<Product, 'id' | 'created_at' | 'updated_at'>;
export type ProductUpdate = Partial<ProductInsert>;

export const CATEGORY_LABELS: Record<string, string> = {
  ro: 'Reverse Osmosis',
  softener: 'Water Softener',
  whole_home_filter: 'Whole Home Filter',
  replacement_filter: 'Replacement Filter',
  accessory: 'Accessory',
  service: 'Service',
};

export const BUYOUT_LABELS: Record<string, string> = {
  retail_minus_payments: 'Retail Minus Payments',
  fixed_schedule: 'Fixed Schedule',
  custom: 'Custom',
};

// ============================================================
// ROLE GUARD
// canViewProcurementFields — true only for admin
// canEditProcurementFields — true only for admin
// Use these in UI components for field-level visibility.
// ============================================================

export function canViewProcurementFields(role: string | null | undefined): boolean {
  return role === 'admin';
}

export function canEditProcurementFields(role: string | null | undefined): boolean {
  return role === 'admin';
}

// ============================================================
// COLUMN SETS
// Non-admin queries explicitly exclude vendor fields so they are
// never included in the network response — not just hidden in UI.
// Admin queries use the products table directly (full access).
// Non-admin queries use products_safe view (vendor fields nulled at DB).
// ============================================================

// Safe columns — no procurement data
const SAFE_COLUMNS = [
  'id', 'name', 'sku', 'category', 'description',
  'retail_price', 'rental_price_monthly', 'install_fee',
  'maintenance_price_monthly', 'filter_interval_months',
  'buyout_formula', 'warranty_months', 'requires_survey_type',
  'is_active', 'track_inventory', 'created_at', 'updated_at',
].join(', ');

// Admin columns — full including procurement
const ADMIN_COLUMNS = '*';

// Pick the right table and columns based on role
function productQuery(isAdmin: boolean) {
  return isAdmin
    ? supabase.from('products').select(ADMIN_COLUMNS)
    : supabase.from('products_safe').select(SAFE_COLUMNS);
}

// ============================================================
// QUERIES
// ============================================================

/** Fetch all products. isAdmin controls whether vendor fields are included. */
export async function getProducts(
  filters?: { activeOnly?: boolean; category?: string },
  isAdmin = false
): Promise<Product[]> {
  let query = productQuery(isAdmin)
    .order('category')
    .order('name');

  if (filters?.activeOnly) query = query.eq('is_active', true);
  if (filters?.category)   query = query.eq('category', filters.category);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/** Fetch a single product by ID */
export async function getProduct(id: string, isAdmin = false): Promise<Product | null> {
  const { data, error } = await productQuery(isAdmin)
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Fetch active products for dropdowns/selectors (lightweight, no vendor fields ever).
 * Vendor fields are never needed in dropdowns — price snapshots only.
 */
export async function getActiveProducts(): Promise<Pick<Product,
  'id' | 'name' | 'sku' | 'category' | 'retail_price' | 'rental_price_monthly' | 'install_fee'
>[]> {
  const { data, error } = await supabase
    .from('products_safe')
    .select('id, name, sku, category, retail_price, rental_price_monthly, install_fee')
    .eq('is_active', true)
    .order('category')
    .order('name');

  if (error) throw error;
  return data || [];
}

/** Create a new product — admin only operation */
export async function createProduct(product: ProductInsert): Promise<Product> {
  const { data, error } = await supabase
    .from('products')
    .insert(product)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Update an existing product — admin only operation */
export async function updateProduct(id: string, updates: ProductUpdate): Promise<Product> {
  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Soft-delete: deactivate a product (never hard delete — contracts reference it) */
export async function deactivateProduct(id: string): Promise<void> {
  const { error } = await supabase
    .from('products')
    .update({ is_active: false })
    .eq('id', id);

  if (error) throw error;
}

/** Reactivate a deactivated product */
export async function reactivateProduct(id: string): Promise<void> {
  const { error } = await supabase
    .from('products')
    .update({ is_active: true })
    .eq('id', id);

  if (error) throw error;
}

/** Get products that support rental — no vendor fields */
export async function getRentalProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products_safe')
    .select(SAFE_COLUMNS)
    .eq('is_active', true)
    .not('rental_price_monthly', 'is', null)
    .order('name');

  if (error) throw error;
  return data || [];
}

/** Get products by category for quote builder — no vendor fields */
export async function getProductsByCategory(category: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products_safe')
    .select(SAFE_COLUMNS)
    .eq('is_active', true)
    .eq('category', category)
    .order('name');

  if (error) throw error;
  return data || [];
}
