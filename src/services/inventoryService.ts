// ============================================================
// src/services/inventoryService.ts
// Phase A Step 2 — Inventory Foundation Service Layer
//
// 4 source-of-truth functions:
//   1. commitForFulfillment(jobId)  — reserve stock or create reorder demand
//   2. receiveStock(...)            — receive physical stock, retry short jobs
//   3. unreserveStock(jobId)        — release reserved stock on cancellation
//   4. checkJobReadiness(jobId)     — read-only readiness check
//
// Design rules:
//   - jobs.source_quote_id is the ONLY path to line items
//   - reservation_key = job_id:product_id:fulfillment_committed
//   - all functions are idempotent (safe to call on retry/refresh)
//   - atomic stock changes go through Supabase RPCs (SELECT FOR UPDATE)
// ============================================================

import { supabase } from '../lib/supabase';

// ────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────

export type InventoryStatus = 'not_required' | 'pending_check' | 'reserved' | 'short' | 'ready' | 'n_a';

export interface InventoryReadinessItem {
  product_id: string;
  product_name: string;
  quantity_needed: number;
  quantity_available: number;
  reserved: boolean;
  short: boolean;
  shortage_amount: number;
  reorder_request_id: string | null;
}

export interface InventoryReadiness {
  ready: boolean;
  status: InventoryStatus;
  items: InventoryReadinessItem[];
  checked_at: string;
}

export interface ReorderRequestFilters {
  status?: string;
  product_id?: string;
  job_id?: string;
  request_type?: 'job_shortage' | 'stock_replenishment';
}

// ────────────────────────────────────────────────────────────
// 1. commitForFulfillment(jobId)
//
// Single entry point. Called ONCE when deal is committed:
//   - Purchase: payment confirmed
//   - Rental: card saved + agreement signed
//
// Reads line items via jobs.source_quote_id → document_line_items.
// For each product with track_inventory = true:
//   - Builds reservation_key (idempotency guard)
//   - Calls rpc_reserve_stock (atomic, serialized)
//   - If short → creates reorder_request
// Sets jobs.inventory_status and inventory_checked_at.
// ────────────────────────────────────────────────────────────

export async function commitForFulfillment(jobId: string): Promise<{
  status: InventoryStatus;
  results: { product_id: string; product_name: string; result: string }[];
}> {
  // 1. Load job with source_quote_id
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('id, source_quote_id, inventory_status')
    .eq('id', jobId)
    .single();

  if (jobErr || !job) throw new Error(`Job not found: ${jobId}`);
  if (!job.source_quote_id) throw new Error(`Job ${jobId} has no source_quote_id`);

  // 2. Load line items from the frozen source quote
  const { data: lineItems, error: liErr } = await supabase
    .from('document_line_items')
    .select('id, product_id, quantity, description')
    .eq('document_id', job.source_quote_id)
    .not('product_id', 'is', null);

  if (liErr) throw new Error(`Failed to load line items: ${liErr.message}`);
  if (!lineItems || lineItems.length === 0) {
    // No line items with products — mark as not required
    await supabase
      .from('jobs')
      .update({ inventory_status: 'not_required', inventory_checked_at: new Date().toISOString() })
      .eq('id', jobId);

    return { status: 'not_required', results: [] };
  }

  // 3. Load product details for inventory-tracked items
  const productIds = [...new Set(lineItems.map(li => li.product_id).filter(Boolean))] as string[];

  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, name, track_inventory, vendor_id, vendor_sku')
    .in('id', productIds);

  if (prodErr) throw new Error(`Failed to load products: ${prodErr.message}`);

  // Build a lookup
  const productMap = new Map((products || []).map(p => [p.id, p]));

  // 4. Filter to only inventory-tracked products
  const trackedItems = lineItems.filter(li => {
    const prod = productMap.get(li.product_id);
    return prod?.track_inventory === true;
  });

  if (trackedItems.length === 0) {
    await supabase
      .from('jobs')
      .update({ inventory_status: 'not_required', inventory_checked_at: new Date().toISOString() })
      .eq('id', jobId);

    return { status: 'not_required', results: [] };
  }

  // 5. Reserve stock for each tracked item
  const results: { product_id: string; product_name: string; result: string }[] = [];
  let anyShort = false;

  for (const li of trackedItems) {
    const prod = productMap.get(li.product_id)!;
    const qty = li.quantity || 1;
    const reservationKey = `${jobId}:${li.product_id}:fulfillment_committed`;

    // Call atomic RPC
    const { data: rpcResult, error: rpcErr } = await supabase
      .rpc('rpc_reserve_stock', {
        p_product_id: li.product_id,
        p_job_id: jobId,
        p_quantity: qty,
        p_reservation_key: reservationKey,
      });

    if (rpcErr) {
      console.error(`Reserve RPC failed for ${prod.name}:`, rpcErr);
      results.push({ product_id: li.product_id, product_name: prod.name, result: 'error' });
      anyShort = true;
      continue;
    }

    const result = rpcResult as string; // 'reserved', 'short', or 'already_reserved'
    results.push({ product_id: li.product_id, product_name: prod.name, result });

    if (result === 'short') {
      anyShort = true;

      // Get vendor info for snapshot
      let vendorName: string | null = null;
      if (prod.vendor_id) {
        const { data: vendor } = await supabase
          .from('product_vendors')
          .select('name')
          .eq('id', prod.vendor_id)
          .single();
        vendorName = vendor?.name || null;
      }

      // Get current available to calculate shortage
      const { data: inv } = await supabase
        .from('inventory')
        .select('quantity_available')
        .eq('product_id', li.product_id)
        .single();

      const available = inv?.quantity_available || 0;
      const shortfall = qty - Math.max(0, available);

      // Create reorder request (idempotent — unique index on job_id + product_id for open requests)
      const { error: reorderErr } = await supabase
        .from('reorder_requests')
        .upsert({
          product_id: li.product_id,
          job_id: jobId,
          request_type: 'job_shortage',
          quantity_needed: shortfall > 0 ? shortfall : qty,
          vendor_name: vendorName,
          vendor_sku: prod.vendor_sku || null,
          vendor_id: prod.vendor_id || null,
          status: 'open',
        }, {
          onConflict: 'job_id,product_id',
          ignoreDuplicates: true,
        });

      if (reorderErr) {
        console.error(`Reorder request failed for ${prod.name}:`, reorderErr);
      }
    }
  }

  // 6. Set job inventory status
  const finalStatus: InventoryStatus = anyShort ? 'short' : 'reserved';

  await supabase
    .from('jobs')
    .update({
      inventory_status: finalStatus,
      inventory_checked_at: new Date().toISOString(),
      inventory_reservation_key: `${jobId}:fulfillment_committed`,
    })
    .eq('id', jobId);

  return { status: finalStatus, results };
}


// ────────────────────────────────────────────────────────────
// 2. receiveStock(productId, quantity, ...)
//
// Called when physical stock arrives (receiving confirmation).
// Updates inventory, logs transaction.
// Then retries reservations for any short jobs waiting on this product.
// ────────────────────────────────────────────────────────────

export async function receiveStock(
  productId: string,
  quantity: number,
  options?: {
    purchaseOrderItemId?: string;
    notes?: string;
    receivedBy?: string;
  }
): Promise<{
  received: number;
  jobsRetried: string[];
}> {
  if (quantity <= 0) throw new Error('Quantity must be positive');

  // 1. Call atomic receive RPC
  const { data: received, error: recvErr } = await supabase
    .rpc('rpc_receive_stock', {
      p_product_id: productId,
      p_quantity: quantity,
      p_reference_type: options?.purchaseOrderItemId ? 'purchase_order_item' : null,
      p_reference_id: options?.purchaseOrderItemId || null,
      p_notes: options?.notes || null,
      p_created_by: options?.receivedBy || null,
    });

  if (recvErr) throw new Error(`Receive stock failed: ${recvErr.message}`);

  // 2. Update PO item if linked
  if (options?.purchaseOrderItemId) {
    const { data: poItem } = await supabase
      .from('purchase_order_items')
      .select('id, quantity_ordered, quantity_received, purchase_order_id')
      .eq('id', options.purchaseOrderItemId)
      .single();

    if (poItem) {
      const newReceived = (poItem.quantity_received || 0) + quantity;
      const itemStatus = newReceived >= poItem.quantity_ordered ? 'received' : 'partial';

      await supabase
        .from('purchase_order_items')
        .update({
          quantity_received: newReceived,
          status: itemStatus,
          received_at: itemStatus === 'received' ? new Date().toISOString() : null,
        })
        .eq('id', poItem.id);

      // Check if all PO items are received → mark PO as received
      const { data: allItems } = await supabase
        .from('purchase_order_items')
        .select('status')
        .eq('purchase_order_id', poItem.purchase_order_id);

      if (allItems && allItems.every(i => i.status === 'received')) {
        await supabase
          .from('purchase_orders')
          .update({ status: 'received', received_at: new Date().toISOString() })
          .eq('id', poItem.purchase_order_id);
      } else if (allItems && allItems.some(i => i.status === 'received' || i.status === 'partial')) {
        await supabase
          .from('purchase_orders')
          .update({ status: 'partial' })
          .eq('id', poItem.purchase_order_id);
      }
    }
  }

  // 3. Find open reorder requests for this product and retry reservations
  const { data: openRequests } = await supabase
    .from('reorder_requests')
    .select('id, job_id, quantity_needed')
    .eq('product_id', productId)
    .eq('request_type', 'job_shortage')
    .in('status', ['open', 'grouped', 'ordered']);

  const jobsRetried: string[] = [];

  if (openRequests && openRequests.length > 0) {
    for (const req of openRequests) {
      if (!req.job_id) continue;

      const reservationKey = `${req.job_id}:${productId}:fulfillment_committed`;

      // Try to reserve again (idempotent — RPC checks if already reserved)
      const { data: retryResult } = await supabase
        .rpc('rpc_reserve_stock', {
          p_product_id: productId,
          p_job_id: req.job_id,
          p_quantity: req.quantity_needed,
          p_reservation_key: reservationKey,
        });

      if (retryResult === 'reserved' || retryResult === 'already_reserved') {
        // Mark reorder request as fulfilled
        await supabase
          .from('reorder_requests')
          .update({ status: 'fulfilled', fulfilled_at: new Date().toISOString() })
          .eq('id', req.id);

        // Check if ALL reorder requests for this job are now fulfilled
        const { data: remainingShorts } = await supabase
          .from('reorder_requests')
          .select('id')
          .eq('job_id', req.job_id)
          .eq('request_type', 'job_shortage')
          .in('status', ['open', 'grouped', 'ordered']);

        if (!remainingShorts || remainingShorts.length === 0) {
  // All shortages resolved — move job to ready_to_schedule
  await supabase
    .from('jobs')
    .update({
      inventory_status: 'reserved',
      inventory_checked_at: new Date().toISOString(),
      status: 'ready_to_schedule',
    })
    .eq('id', req.job_id);
}

        jobsRetried.push(req.job_id);
      }
    }
  }

  return { received: quantity, jobsRetried };
}


// ────────────────────────────────────────────────────────────
// 3. unreserveStock(jobId, reason)
//
// Called when a job is cancelled after inventory was reserved.
// Releases all reservations for this job.
// Cancels any open reorder requests.
// Sets job.inventory_status = 'n_a'.
// ────────────────────────────────────────────────────────────

export async function unreserveStock(
  jobId: string,
  reason: string = 'Job cancelled'
): Promise<{
  unreserved: number;
  reordersCancelled: number;
}> {
  // 1. Find all reservation transactions for this job
  const { data: reservations } = await supabase
    .from('inventory_transactions')
    .select('reservation_key, product_id')
    .eq('job_id', jobId)
    .eq('type', 'reserve');

  let unreservedCount = 0;

  if (reservations && reservations.length > 0) {
    for (const res of reservations) {
      if (!res.reservation_key) continue;

      const { data: result } = await supabase
        .rpc('rpc_unreserve_stock', {
          p_reservation_key: res.reservation_key,
          p_reason: reason,
        });

      if (result === 'unreserved') {
        unreservedCount++;
      }
    }
  }

  // 2. Cancel open reorder requests for this job
  const { data: cancelled } = await supabase
    .from('reorder_requests')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason,
    })
    .eq('job_id', jobId)
    .eq('request_type', 'job_shortage')
    .in('status', ['open', 'grouped', 'ordered'])
    .select('id');

  // 3. Update job status
  await supabase
    .from('jobs')
    .update({
      inventory_status: 'n_a',
      inventory_checked_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  return {
    unreserved: unreservedCount,
    reordersCancelled: cancelled?.length || 0,
  };
}


// ────────────────────────────────────────────────────────────
// 4. checkJobReadiness(jobId)
//
// Read-only check. Used by:
//   - CompletionReadinessPanel
//   - Scheduling gate
//   - Job detail page
//
// Returns whether all tracked products are reserved.
// ────────────────────────────────────────────────────────────

export async function checkJobReadiness(jobId: string): Promise<InventoryReadiness> {
  // 1. Load job
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('id, source_quote_id, inventory_status, inventory_checked_at')
    .eq('id', jobId)
    .single();

  if (jobErr || !job) throw new Error(`Job not found: ${jobId}`);

  // No source quote = not applicable
  if (!job.source_quote_id) {
    return {
      ready: true,
      status: 'not_required',
      items: [],
      checked_at: job.inventory_checked_at || new Date().toISOString(),
    };
  }

  // 2. Load line items from frozen source quote
  const { data: lineItems } = await supabase
    .from('document_line_items')
    .select('product_id, quantity')
    .eq('document_id', job.source_quote_id)
    .not('product_id', 'is', null);

  if (!lineItems || lineItems.length === 0) {
    return {
      ready: true,
      status: 'not_required',
      items: [],
      checked_at: job.inventory_checked_at || new Date().toISOString(),
    };
  }

  // 3. Load products
  const productIds = [...new Set(lineItems.map(li => li.product_id).filter(Boolean))] as string[];

  const { data: products } = await supabase
    .from('products')
    .select('id, name, track_inventory')
    .in('id', productIds);

  const productMap = new Map((products || []).map(p => [p.id, p]));

  // 4. Check each tracked item
  const items: InventoryReadinessItem[] = [];
  let allReserved = true;
  let hasTracked = false;

  for (const li of lineItems) {
    const prod = productMap.get(li.product_id);
    if (!prod?.track_inventory) continue;

    hasTracked = true;
    const qty = li.quantity || 1;
    const reservationKey = `${jobId}:${li.product_id}:fulfillment_committed`;

    // Check if reserved
    const { data: resTx } = await supabase
      .from('inventory_transactions')
      .select('id')
      .eq('reservation_key', reservationKey)
      .eq('type', 'reserve')
      .limit(1);

    // Check if unreserved (cancelled)
    const { data: unresTx } = await supabase
      .from('inventory_transactions')
      .select('id')
      .eq('reservation_key', reservationKey)
      .eq('type', 'unreserve')
      .limit(1);

    const isReserved = (resTx && resTx.length > 0) && (!unresTx || unresTx.length === 0);

    // Get current inventory level
    const { data: inv } = await supabase
      .from('inventory')
      .select('quantity_available')
      .eq('product_id', li.product_id)
      .single();

    const available = inv?.quantity_available || 0;

    // Check for open reorder request
    const { data: reorderReq } = await supabase
      .from('reorder_requests')
      .select('id')
      .eq('job_id', jobId)
      .eq('product_id', li.product_id)
      .eq('request_type', 'job_shortage')
      .in('status', ['open', 'grouped', 'ordered'])
      .limit(1);

    const isShort = !isReserved;
    if (isShort) allReserved = false;

    items.push({
      product_id: li.product_id,
      product_name: prod.name,
      quantity_needed: qty,
      quantity_available: available,
      reserved: isReserved,
      short: isShort,
      shortage_amount: isShort ? Math.max(0, qty - available) : 0,
      reorder_request_id: reorderReq?.[0]?.id || null,
    });
  }

  if (!hasTracked) {
    return {
      ready: true,
      status: 'not_required',
      items: [],
      checked_at: new Date().toISOString(),
    };
  }

  const status: InventoryStatus = allReserved ? 'reserved' : 'short';

  return {
    ready: allReserved,
    status,
    items,
    checked_at: new Date().toISOString(),
  };
}


// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────

/** Get inventory record for a product */
export async function getInventoryForProduct(productId: string) {
  const { data, error } = await supabase
    .from('inventory')
    .select('*')
    .eq('product_id', productId)
    .single();

  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
  return data;
}

/** Get inventory for all products (for admin list view) */
export async function getAllInventory() {
  const { data, error } = await supabase
    .from('inventory')
    .select(`
      *,
      products:product_id (id, name, sku, category, track_inventory)
    `)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/** Get reorder requests with filters */
export async function getReorderRequests(filters?: ReorderRequestFilters) {
  let query = supabase
    .from('reorder_requests')
    .select(`
      *,
      products:product_id (id, name, sku),
      jobs:job_id (id, customer_name_snapshot)
    `)
    .order('created_at', { ascending: false });

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.product_id) query = query.eq('product_id', filters.product_id);
  if (filters?.job_id) query = query.eq('job_id', filters.job_id);
  if (filters?.request_type) query = query.eq('request_type', filters.request_type);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/** Ensure an inventory row exists for a product (creates with 0s if missing) */
export async function seedInventoryRow(productId: string) {
  const existing = await getInventoryForProduct(productId);
  if (existing) return existing;

  const { data, error } = await supabase
    .from('inventory')
    .insert({
      product_id: productId,
      quantity_on_hand: 0,
      quantity_reserved: 0,
      quantity_available: 0,
      quantity_on_order: 0,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Get transaction history for a product */
export async function getInventoryTransactions(productId: string, limit = 50) {
  const { data, error } = await supabase
    .from('inventory_transactions')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/** Manual stock adjustment (admin only) */
export async function adjustStock(
  productId: string,
  adjustment: number,
  notes: string,
  adjustedBy?: string
): Promise<void> {
  if (adjustment === 0) return;

  if (adjustment > 0) {
    // Adding stock — use receive RPC
    await supabase.rpc('rpc_receive_stock', {
      p_product_id: productId,
      p_quantity: adjustment,
      p_reference_type: 'manual_adjust',
      p_reference_id: null,
      p_notes: notes,
      p_created_by: adjustedBy || null,
    });
  } else {
    // Removing stock — direct update (no RPC needed, this is admin action)
    const { data: inv } = await supabase
      .from('inventory')
      .select('id, quantity_on_hand, quantity_available')
      .eq('product_id', productId)
      .single();

    if (!inv) throw new Error('No inventory record for this product');

    const removeQty = Math.abs(adjustment);
    if (removeQty > inv.quantity_available) {
      throw new Error(`Cannot remove ${removeQty} — only ${inv.quantity_available} available`);
    }

    await supabase
      .from('inventory')
      .update({
        quantity_on_hand: inv.quantity_on_hand - removeQty,
        quantity_available: inv.quantity_available - removeQty,
      })
      .eq('id', inv.id);

    await supabase
      .from('inventory_transactions')
      .insert({
        product_id: productId,
        type: 'adjust',
        quantity: -removeQty,
        notes,
        created_by: adjustedBy || null,
      });
  }
}
