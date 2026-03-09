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
  created_at: string;
  updated_at: string;
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
// QUERIES
// ============================================================

/** Fetch all products, optionally filtered by active status and/or category */
export async function getProducts(filters?: {
  activeOnly?: boolean;
  category?: string;
}): Promise<Product[]> {
  let query = supabase
    .from('products')
    .select('*')
    .order('category')
    .order('name');

  if (filters?.activeOnly) {
    query = query.eq('is_active', true);
  }
  if (filters?.category) {
    query = query.eq('category', filters.category);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/** Fetch a single product by ID */
export async function getProduct(id: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

/** Fetch active products for use in dropdowns/selectors (lightweight) */
export async function getActiveProducts(): Promise<Pick<Product, 'id' | 'name' | 'sku' | 'category' | 'retail_price' | 'rental_price_monthly' | 'install_fee'>[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, sku, category, retail_price, rental_price_monthly, install_fee')
    .eq('is_active', true)
    .order('category')
    .order('name');

  if (error) throw error;
  return data || [];
}

/** Create a new product */
export async function createProduct(product: ProductInsert): Promise<Product> {
  const { data, error } = await supabase
    .from('products')
    .insert(product)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Update an existing product */
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

/** Get products that support rental (have rental_price_monthly) */
export async function getRentalProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .not('rental_price_monthly', 'is', null)
    .order('name');

  if (error) throw error;
  return data || [];
}

/** Get products by category for quote builder */
export async function getProductsByCategory(category: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .eq('category', category)
    .order('name');

  if (error) throw error;
  return data || [];
}
