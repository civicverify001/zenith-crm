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

const REVIEW_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  pending:  { label: 'Pending Review', bg: 'rgba(251,191,36,0.15)', text: '#fbbf24' },
  approved: { label: 'Approved', bg: 'rgba(74,222,128,0.15)', text: '#4ade80' },
  rejected: { label: 'Rejected', bg: 'rgba(248,113,113,0.15)', text: '#f87171' },
}

export function PhotosTab({ jobId }: Props) {
  const { user, role } = useAuth()
  const qc = useQueryClient()
  const { data: photos, isLoading } = useJobPhotos(jobId)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [category, setCategory] = useState<PhotoCategory>('general')
  const [error, setError] = useState('')
  const [reviewingPhoto, setReviewingPhoto] = useState<any>(null)
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewPending, setReviewPending] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('all')

  const isAdmin = role === 'admin'

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

      const { error: dbError } = await supabase.from('job_photos').insert({
        job_id: jobId,
        photo_url: photoUrl,
        caption: file.name,
        category,
        uploaded_by: user?.id,
        review_status: 'pending',
      })

      if (dbError) throw new Error(dbError.message)

      qc.invalidateQueries({ queryKey: JOB_KEYS.photos(jobId) })
      qc.invalidateQueries({ queryKey: ['job_completion', jobId] })
    } catch (err: any) {
      setError(`Upload failed: ${err.message}`)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleReview(photoId: string, status: 'approved' | 'rejected') {
    setReviewPending(true)
    try {
      const { error: err } = await supabase
        .from('job_photos')
        .update({
          review_status: status,
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
          review_notes: reviewNotes || null,
        })
        .eq('id', photoId)

      if (err) throw new Error(err.message)

      qc.invalidateQueries({ queryKey: JOB_KEYS.photos(jobId) })
      setReviewingPhoto(null)
      setReviewNotes('')
    } catch (err: any) {
      setError(`Review failed: ${err.message}`)
    } finally {
      setReviewPending(false)
    }
  }

  if (isLoading) return <p className="text-sm text-muted text-center py-8">Loading photos...</p>

  const allPhotos = (photos || []) as any[]
  const pendingCount = allPhotos.filter(p => (p.review_status || 'pending') === 'pending').length
  const rejectedCount = allPhotos.filter(p => p.review_status === 'rejected').length

  const filteredPhotos = filterStatus === 'all'
    ? allPhotos
    : allPhotos.filter(p => (p.review_status || 'pending') === filterStatus)

  return (
    <div className="space-y-4">
      {/* Admin review summary */}
      {isAdmin && allPhotos.length > 0 && (
        <div className="flex items-center gap-3 text-xs">
          <span className="text-gray-400">Filter:</span>
          {[
            { value: 'all', label: `All (${allPhotos.length})` },
            { value: 'pending', label: `Pending (${pendingCount})`, color: '#fbbf24' },
            { value: 'approved', label: `Approved (${allPhotos.length - pendingCount - rejectedCount})`, color: '#4ade80' },
            { value: 'rejected', label: `Rejected (${rejectedCount})`, color: '#f87171' },
          ].map(f => (
            <button
              key={f.value}
              onClick={() => setFilterStatus(f.value)}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                filterStatus === f.value
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Pending review banner */}
      {isAdmin && pendingCount > 0 && (
        <div className="rounded-lg px-4 py-2.5 text-sm font-semibold flex items-center gap-2"
          style={{ backgroundColor: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24' }}>
          <span>📋</span>
          <span>{pendingCount} photo{pendingCount !== 1 ? 's' : ''} pending review</span>
        </div>
      )}

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
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} />
        {error && <div className="text-xs text-red-400 mt-2">{error}</div>}
      </div>

      {/* Photo grid */}
      {filteredPhotos.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {filteredPhotos.map((photo: any) => {
            const reviewStatus = photo.review_status || 'pending'
            const style = REVIEW_STYLES[reviewStatus] || REVIEW_STYLES.pending

            return (
              <div key={photo.id} className={`bg-card border rounded-lg overflow-hidden ${
                reviewStatus === 'rejected' ? 'border-red-700/40' :
                reviewStatus === 'approved' ? 'border-green-700/40' :
                'border-border'
              }`}>
                {/* Photo */}
                <div className="relative group cursor-pointer" onClick={() => setLightboxUrl(photo.photo_url)}>
                  <img
                    src={photo.photo_url}
                    alt={photo.caption || 'Job photo'}
                    className="w-full aspect-square object-cover"
                    onError={e => {
                      (e.target as HTMLImageElement).className = 'w-full aspect-square bg-surface'
                    }}
                  />
                  {/* Review badge overlay */}
                  <div className="absolute top-2 right-2">
                    <span className="text-[10px] px-2 py-0.5 rounded font-semibold"
                      style={{ backgroundColor: style.bg, color: style.text }}>
                      {style.label}
                    </span>
                  </div>
                </div>

                {/* Info */}
                <div className="p-2">
                  <div className="text-xs text-slate-300 capitalize">{photo.category?.replace(/_/g, ' ')}</div>
                  <div className="text-xs text-muted mt-0.5">
                    {new Date(photo.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  {photo.review_notes && (
                    <div className="text-xs mt-1 italic" style={{ color: style.text }}>
                      {photo.review_notes}
                    </div>
                  )}

                  {/* Admin review buttons */}
                  {isAdmin && reviewStatus === 'pending' && (
                    <div className="flex gap-1.5 mt-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleReview(photo.id, 'approved') }}
                        className="flex-1 text-[10px] py-1 rounded font-semibold transition-colors"
                        style={{ backgroundColor: 'rgba(74,222,128,0.15)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)' }}
                      >
                        ✓ Approve
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setReviewingPhoto(photo) }}
                        className="flex-1 text-[10px] py-1 rounded font-semibold transition-colors"
                        style={{ backgroundColor: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}
                      >
                        ✕ Reject
                      </button>
                    </div>
                  )}

                  {/* Already reviewed info */}
                  {reviewStatus !== 'pending' && photo.reviewed_at && (
                    <div className="text-[10px] text-gray-500 mt-1">
                      Reviewed {new Date(photo.reviewed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-sm text-muted text-center py-4">
          {filterStatus !== 'all' ? `No ${filterStatus} photos.` : 'No photos uploaded yet.'}
        </p>
      )}

      {/* Reject modal — requires notes */}
      {reviewingPhoto && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-sm p-5">
            <h3 className="font-bold text-white mb-2">Reject Photo</h3>
            <p className="text-xs text-gray-400 mb-3">
              {reviewingPhoto.category?.replace(/_/g, ' ')} — uploaded {new Date(reviewingPhoto.created_at).toLocaleDateString()}
            </p>
            <img src={reviewingPhoto.photo_url} className="w-full h-32 object-cover rounded mb-3" />
            <label className="block text-xs text-gray-400 mb-1">Reason for rejection (required)</label>
            <textarea
              value={reviewNotes}
              onChange={e => setReviewNotes(e.target.value)}
              placeholder="Photo is blurry, wrong angle, wrong category..."
              rows={2}
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-red-500 focus:border-red-500 resize-none"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setReviewingPhoto(null); setReviewNotes('') }}
                className="flex-1 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleReview(reviewingPhoto.id, 'rejected')}
                disabled={!reviewNotes.trim() || reviewPending}
                className="flex-1 py-2 text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
                style={{ backgroundColor: 'rgba(248,113,113,0.2)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}
              >
                {reviewPending ? 'Rejecting...' : 'Reject Photo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-8 cursor-pointer"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="Photo" className="max-w-full max-h-full object-contain rounded-lg" />
          <button className="absolute top-6 right-6 text-white text-2xl hover:text-gray-300" onClick={() => setLightboxUrl(null)}>×</button>
        </div>
      )}
    </div>
  )
}
