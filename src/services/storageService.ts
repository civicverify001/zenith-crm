import { supabase } from '../lib/supabase'

const BUCKET = 'job-files'

export type FileCategory = 'photos' | 'checklist-evidence' | 'signatures' | 'consent-signatures'

/**
 * Upload a file to Supabase Storage under job-files bucket.
 * Path: {category}/{jobId}/{timestamp}_{filename}
 * Returns the public URL on success, throws on failure.
 */
export async function uploadJobFile(
  jobId: string,
  file: File,
  category: FileCategory
): Promise<string> {
  const timestamp = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${category}/${jobId}/${timestamp}_${safeName}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })

  if (error) throw new Error(`Upload failed: ${error.message}`)

  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(path)

  return urlData.publicUrl
}

/**
 * Upload a signature image (from canvas data URL).
 * Converts base64 to blob before uploading.
 */
export async function uploadSignature(
  jobId: string,
  dataUrl: string,
  formType: string
): Promise<string> {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  const file = new File([blob], `${formType}_signature.png`, { type: 'image/png' })
  return uploadJobFile(jobId, file, 'signatures')
}

/**
 * Delete a file from storage.
 */
export async function deleteJobFile(path: string): Promise<void> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([path])

  if (error) console.error('Delete failed:', error)
}
