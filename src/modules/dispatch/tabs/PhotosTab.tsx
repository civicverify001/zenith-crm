import { useJobPhotos } from '../useJobs'
import type { JobPhoto } from '../dispatch.types'

interface Props {
  jobId: string
}

export function PhotosTab({ jobId }: Props) {
  const { data: photos, isLoading } = useJobPhotos(jobId)

  if (isLoading) return <p className="text-sm text-muted text-center py-8">Loading photos...</p>

  return (
    <div className="space-y-4">
      {/* Upload placeholder — Supabase Storage integration in future */}
      <div className="border-2 border-dashed border-border rounded-xl p-6 text-center">
        <div className="text-2xl mb-2">📷</div>
        <div className="text-sm text-muted">Photo uploads will be available when Supabase Storage is connected.</div>
        <div className="text-xs text-muted mt-1">For now, photos are tracked as URL references.</div>
      </div>

      {/* Photo grid */}
      {photos && photos.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {(photos as JobPhoto[]).map(photo => (
            <div key={photo.id} className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="aspect-square bg-surface flex items-center justify-center text-muted text-3xl">
                📷
              </div>
              <div className="p-2">
                <div className="text-xs text-slate-300 capitalize">{photo.category.replace(/_/g, ' ')}</div>
                {photo.caption && <div className="text-xs text-muted">{photo.caption}</div>}
                <div className="text-xs text-muted mt-1">
                  {new Date(photo.created_at).toLocaleDateString()}
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
