import { supabase } from '../lib/supabase';

// ============================================================
// TYPES
// ============================================================

export interface MediaRecord {
  id: string;
  entity_type: string;
  entity_id: string;
  file_type: 'photo' | 'document' | 'receipt' | 'signature' | 'other';
  url: string;
  filename: string | null;
  metadata: MediaMetadata;
  uploaded_by: string | null;
  created_at: string;
}

export interface MediaMetadata {
  photo_type?: string;          // 'under_sink', 'water_line', 'main_line', 'outlet', 'drain', 'space', 'general', 'other'
  prompt_key?: string;          // Matches the prompt definition key exactly
  required_at_capture?: boolean;// Was this a required photo when captured?
  captured_context?: 'lead' | 'job' | 'customer' | 'standalone';
  system_type_at_capture?: string; // 'ro', 'softener', 'whole_home_filter', etc.
  uploaded_at?: string;         // ISO timestamp of upload moment
  [key: string]: any;
}

export interface MediaLink {
  id: string;
  media_id: string;
  entity_type: string;
  entity_id: string;
  context: 'primary' | 'reference' | 'thumbnail';
  created_at: string;
}

export interface UploadParams {
  bucket: string;
  path: string;
  file: File;
  entityType: string;
  entityId: string;
  fileType?: 'photo' | 'document' | 'receipt' | 'signature' | 'other';
  metadata?: MediaMetadata;
  userId?: string;
  additionalLinks?: Array<{ entity_type: string; entity_id: string; context?: string }>;
}

// ============================================================
// STORAGE — Upload to Supabase Storage
// ============================================================

/**
 * Upload a file to Supabase Storage and create media + media_links records.
 * Returns the created media record.
 */
export async function uploadMedia(params: UploadParams): Promise<MediaRecord> {
  const {
    bucket,
    path,
    file,
    entityType,
    entityId,
    fileType = 'photo',
    metadata = {},
    userId,
    additionalLinks = [],
  } = params;

  // 1. Upload file to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  // 2. Get public URL
  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
  const url = urlData.publicUrl;

  // 3. Stamp provenance into metadata
  const enrichedMetadata: MediaMetadata = {
    ...metadata,
    uploaded_at: new Date().toISOString(),
  };

  // 4. Create media record
  const { data: media, error: mediaError } = await supabase
    .from('media')
    .insert({
      entity_type: entityType,
      entity_id: entityId,
      file_type: fileType,
      url,
      filename: file.name,
      metadata: enrichedMetadata,
      uploaded_by: userId || null,
    })
    .select()
    .single();

  if (mediaError) throw new Error(`Media record failed: ${mediaError.message}`);

  // 5. Create additional media_links for cross-module visibility
  if (additionalLinks.length > 0) {
    const links = additionalLinks.map(link => ({
      media_id: media.id,
      entity_type: link.entity_type,
      entity_id: link.entity_id,
      context: link.context || 'reference',
    }));

    const { error: linkError } = await supabase
      .from('media_links')
      .insert(links);

    if (linkError) {
      console.error('Media links creation failed:', linkError.message);
      // Non-fatal — media record still exists
    }
  }

  return media;
}

// ============================================================
// FETCH — Get media by entity
// ============================================================

/**
 * Get all media directly attached to an entity (via media.entity_type + entity_id)
 */
export async function getMediaByEntity(
  entityType: string,
  entityId: string
): Promise<MediaRecord[]> {
  const { data, error } = await supabase
    .from('media')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get all media linked to an entity via media_links (cross-module references).
 * This includes media that was originally uploaded to a different entity
 * but linked to this one for visibility.
 */
export async function getLinkedMedia(
  entityType: string,
  entityId: string
): Promise<MediaRecord[]> {
  // Get media IDs from media_links
  const { data: links, error: linkError } = await supabase
    .from('media_links')
    .select('media_id')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId);

  if (linkError) throw linkError;
  if (!links || links.length === 0) return [];

  const mediaIds = links.map(l => l.media_id);

  const { data, error } = await supabase
    .from('media')
    .select('*')
    .in('id', mediaIds)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get ALL media for an entity — both direct attachments and linked references.
 * Deduplicates by media.id.
 */
export async function getAllMediaForEntity(
  entityType: string,
  entityId: string
): Promise<MediaRecord[]> {
  const [direct, linked] = await Promise.all([
    getMediaByEntity(entityType, entityId),
    getLinkedMedia(entityType, entityId),
  ]);

  // Deduplicate
  const seen = new Set<string>();
  const result: MediaRecord[] = [];
  for (const item of [...direct, ...linked]) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }

  return result.sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

// ============================================================
// LINKS — Create cross-module references
// ============================================================

/**
 * Add a media_link so existing media appears on another entity's context.
 * Idempotent — skips if link already exists.
 */
export async function linkMediaToEntity(
  mediaId: string,
  entityType: string,
  entityId: string,
  context: 'primary' | 'reference' | 'thumbnail' = 'reference'
): Promise<void> {
  // Check if link already exists
  const { data: existing } = await supabase
    .from('media_links')
    .select('id')
    .eq('media_id', mediaId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .maybeSingle();

  if (existing) return; // Already linked

  const { error } = await supabase
    .from('media_links')
    .insert({ media_id: mediaId, entity_type: entityType, entity_id: entityId, context });

  if (error) throw error;
}

/**
 * Bulk-link all media from one entity to another.
 * Used during lead → customer conversion to carry survey photos forward.
 */
export async function linkAllMediaToNewEntity(
  sourceEntityType: string,
  sourceEntityId: string,
  targetEntityType: string,
  targetEntityId: string
): Promise<number> {
  const media = await getMediaByEntity(sourceEntityType, sourceEntityId);
  let linked = 0;

  for (const item of media) {
    await linkMediaToEntity(item.id, targetEntityType, targetEntityId);
    linked++;
  }

  return linked;
}

// ============================================================
// DELETE
// ============================================================

/**
 * Delete a media record and its storage file.
 * Also cascades to media_links via ON DELETE CASCADE.
 */
export async function deleteMedia(mediaId: string, bucket: string): Promise<void> {
  // Get the record first to find the storage path
  const { data: media, error: fetchError } = await supabase
    .from('media')
    .select('url')
    .eq('id', mediaId)
    .single();

  if (fetchError) throw fetchError;

  // Extract storage path from URL
  if (media?.url) {
    const urlParts = media.url.split(`/storage/v1/object/public/${bucket}/`);
    if (urlParts.length > 1) {
      await supabase.storage.from(bucket).remove([urlParts[1]]);
    }
  }

  // Delete media record (cascades to media_links)
  const { error } = await supabase
    .from('media')
    .delete()
    .eq('id', mediaId);

  if (error) throw error;
}
