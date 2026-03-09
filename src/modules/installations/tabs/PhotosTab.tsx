import { useState, useRef } from 'react'
import { useJobPhotos } from '../../dispatch/useJobs'
import type { JobPhoto, PhotoCategory } from '../../dispatch/dispatch.types'
import { uploadJobFile } from '../../../services/storageService'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../hooks/useAuth'
import { useQueryClient } from '@tanstack/react-query'
import { JOB_KEYS } from '../../dispatch/useJobs'

interface Props {
  jobId: string
}

const CATEGORIES: { value: PhotoCategory; label: string }[] = [
  { value: 'before_install', label: 'Before Install' },
  { value: 'after_install', label: 'After Install' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'general', label: 'General' },
]

export function PhotosTab({ jobId }: Props) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: photos, isLoading } = useJobPhotos(jobId)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [category, setCategory] = useState<PhotoCategory>('general')
  const [error, setError] = useState('')

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Only image files are allowed')
      return
    }
    setError('')
    setUploading(true)

    try {
      const photoUrl = await uploadJobFile(jobId, file, 'photos')

      // Save record to job_photos table
      const { error: dbError } = await supabase.from('job_photos').insert({
        job_id: jobId,
        photo_url: photoUrl,
        caption: file.name,
        category,
        uploaded_by: user?.id,
      })

      if (dbError) throw new Error(dbError.message)

      // Refresh photos + completion status
      qc.invalidateQueries({ queryKey: JOB_KEYS.photos(jobId) })
      qc.invalidateQueries({ queryKey: ['job_completion', jobId] })
    } catch (err: any) {
      setError(`Upload failed: ${err.message}`)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (isLoading) return <p className="text-sm text-muted text-center py-8">Loading photos...</p>

  return (
    <div className="space-y-4">
      {/* Upload area */}
      <div className="border-2 border-dashed border-border rounded-xl p-4">
        <div className="flex items-center gap-3 mb-3">
          <select
            value={category}
            onChange={e => setCategory(e.target.value as PhotoCategory)}
            className="bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-accent"
          >
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-xs px-3 py-1.5 bg-accent hover:bg-sky-400 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
          >
            {uploading ? 'Uploading...' : '📷 Upload Photo'}
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
        {error && <div className="text-xs text-red-400 mt-2">{error}</div>}
      </div>

      {/* Photo grid */}
      {photos && photos.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {(photos as JobPhoto[]).map(photo => (
            <div key={photo.id} className="bg-card border border-border rounded-lg overflow-hidden">
              <img
                src={photo.photo_url}
                alt={photo.caption || 'Job photo'}
                className="w-full aspect-square object-cover"
                onError={e => {
                  (e.target as HTMLImageElement).src = ''
                  ;(e.target as HTMLImageElement).className = 'w-full aspect-square bg-surface flex items-center justify-center'
                }}
              />
              <div className="p-2">
                <div className="text-xs text-slate-300 capitalize">{photo.category.replace(/_/g, ' ')}</div>
                {photo.caption && <div className="text-xs text-muted truncate">{photo.caption}</div>}
                <div className="text-xs text-muted mt-1">
                  {new Date(photo.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted text-center py-4">No photos uploaded yet.</p>
      )}
    </div>
  )
}
