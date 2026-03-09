import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import {
  getOrCreateSurvey,
  getSurveyByOpportunity,
  getSurveyByJob,
  getSurveysByCustomer,
  updateSurvey,
  uploadSurveyPhoto,
  getSurveyPhotos,
  getPromptsForSystemType,
  evaluateCompleteness,
  resolveSystemType,
  getSurveyPermission,
  type SiteSurvey,
  type SurveyPhotoPrompt,
  type SurveyCompleteness,
  type SurveyPermission,
  type FeasibilityStatus,
  type SystemTypeContext,
} from '../../services/siteSurveyService';
import type { MediaRecord } from '../../services/mediaService';

// ============================================================
// PROPS
// ============================================================

interface SiteSurveyCaptureProps {
  /** The context this component is rendered in */
  context: 'lead' | 'job' | 'customer';

  /** IDs for linking — provide whichever are available */
  opportunityId?: string | null;
  jobId?: string | null;
  customerId?: string | null;

  /** System type context for fallback chain */
  systemTypeContext?: SystemTypeContext;

  /** Optional: collapse by default */
  defaultCollapsed?: boolean;
}

// ============================================================
// SYSTEM TYPE OPTIONS
// ============================================================

const SYSTEM_TYPE_OPTIONS = [
  { value: 'ro', label: 'Reverse Osmosis (RO)' },
  { value: 'softener', label: 'Water Softener' },
  { value: 'whole_home_filter', label: 'Whole Home Filter' },
];

const FEASIBILITY_OPTIONS: { value: FeasibilityStatus; label: string; color: string }[] = [
  { value: 'pending', label: 'Pending', color: 'bg-yellow-900/50 text-yellow-400' },
  { value: 'feasible', label: 'Feasible', color: 'bg-green-900/50 text-green-400' },
  { value: 'conditional', label: 'Conditional', color: 'bg-orange-900/50 text-orange-400' },
  { value: 'not_feasible', label: 'Not Feasible', color: 'bg-red-900/50 text-red-400' },
];

// ============================================================
// COMPONENT
// ============================================================

export default function SiteSurveyCapture({
  context,
  opportunityId,
  jobId,
  customerId,
  systemTypeContext = {},
  defaultCollapsed = false,
}: SiteSurveyCaptureProps) {
  const { session, role, profile } = useAuth();
  const userId = session?.user?.id || null;

  // ─── State ───────────────────────────────────────────────
  const [survey, setSurvey] = useState<SiteSurvey | null>(null);
  const [photos, setPhotos] = useState<MediaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null); // prompt key currently uploading
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // Editable fields (for full_edit permission)
  const [feasibilityStatus, setFeasibilityStatus] = useState<FeasibilityStatus>('pending');
  const [feasibilityNotes, setFeasibilityNotes] = useState('');
  const [overrideSystemType, setOverrideSystemType] = useState<string | null>(null);

  // Lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // ─── Derived ─────────────────────────────────────────────
  const permission: SurveyPermission = getSurveyPermission(role, context);

  const effectiveSystemType = resolveSystemType({
    explicitOverride: overrideSystemType,
    opportunityProductType: systemTypeContext.opportunityProductType,
    jobSystemType: systemTypeContext.jobSystemType,
  });

  const prompts = getPromptsForSystemType(effectiveSystemType);
  const completeness: SurveyCompleteness = evaluateCompleteness(prompts, photos);

  const canEdit = permission === 'full_edit';
  const canUpload = permission === 'full_edit' || permission === 'upload_only';
  const isReadOnly = permission === 'read_only';

  // ─── Load Data ───────────────────────────────────────────
  const loadSurvey = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let existingSurvey: SiteSurvey | null = null;

      if (context === 'customer' && customerId) {
        const surveys = await getSurveysByCustomer(customerId);
        existingSurvey = surveys[0] || null; // Most recent
      } else if (opportunityId) {
        existingSurvey = await getSurveyByOpportunity(opportunityId);
      } else if (jobId) {
        existingSurvey = await getSurveyByJob(jobId);
      }

      if (existingSurvey) {
        setSurvey(existingSurvey);
        setFeasibilityStatus(existingSurvey.feasibility_status);
        setFeasibilityNotes(existingSurvey.feasibility_notes || '');
        if (existingSurvey.system_type) {
          setOverrideSystemType(existingSurvey.system_type);
        }

        // Load photos
        const surveyPhotos = await getSurveyPhotos(existingSurvey.id);
        setPhotos(surveyPhotos);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [context, customerId, opportunityId, jobId]);

  useEffect(() => {
    loadSurvey();
  }, [loadSurvey]);

  // ─── Ensure survey exists before upload ──────────────────
  async function ensureSurvey(): Promise<SiteSurvey> {
    if (survey) return survey;

    const newSurvey = await getOrCreateSurvey({
      opportunityId,
      jobId,
      customerId,
      systemType: effectiveSystemType,
      userId,
    });

    setSurvey(newSurvey);
    return newSurvey;
  }

  // ─── Upload Handler ──────────────────────────────────────
  async function handlePhotoUpload(prompt: SurveyPhotoPrompt, file: File) {
    if (!canUpload) return;
    setUploading(prompt.key);
    setError(null);

    try {
      // Upsert survey BEFORE upload
      const activeSurvey = await ensureSurvey();

      // Build entity links for cross-module visibility
      const additionalEntityLinks: Array<{ entity_type: string; entity_id: string }> = [];
      if (opportunityId) additionalEntityLinks.push({ entity_type: 'lead', entity_id: opportunityId });
      if (jobId) additionalEntityLinks.push({ entity_type: 'job', entity_id: jobId });
      if (customerId) additionalEntityLinks.push({ entity_type: 'customer', entity_id: customerId });

      const media = await uploadSurveyPhoto({
        surveyId: activeSurvey.id,
        file,
        prompt,
        capturedContext: context === 'customer' ? 'lead' : context,
        systemType: effectiveSystemType,
        userId: userId!,
        additionalEntityLinks,
      });

      setPhotos(prev => [...prev, media]);
    } catch (err: any) {
      setError(`Upload failed: ${err.message}`);
    } finally {
      setUploading(null);
    }
  }

  // ─── Save Status & Notes ─────────────────────────────────
  async function handleSave() {
    if (!canEdit || !survey) return;
    setSaving(true);
    setError(null);

    try {
      const updated = await updateSurvey(survey.id, {
        feasibility_status: feasibilityStatus,
        feasibility_notes: feasibilityNotes || undefined,
        system_type: effectiveSystemType || undefined,
      });
      setSurvey(updated);
    } catch (err: any) {
      setError(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────
  function getPhotoForPrompt(promptKey: string): MediaRecord | null {
    return photos.find(p => (p.metadata as any)?.prompt_key === promptKey) || null;
  }

  function triggerFileInput(promptKey: string) {
    const input = document.getElementById(`photo-input-${promptKey}`) as HTMLInputElement;
    if (input) input.click();
  }

  // ─── Render ──────────────────────────────────────────────

  if (loading) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <div className="text-gray-400 text-sm">Loading site survey...</div>
      </div>
    );
  }

  // No survey exists and user is read-only
  if (!survey && isReadOnly) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">📋</span>
          <h3 className="text-white font-semibold">Site Survey</h3>
        </div>
        <p className="text-gray-500 text-sm">No site survey on file.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
      {/* ── Header ─────────────────────────────────────────── */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-800/80 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">📋</span>
          <h3 className="text-white font-semibold text-sm">Site Survey</h3>

          {/* Completeness badge */}
          {survey && (
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${
              completeness.isMinimumComplete
                ? 'bg-green-900/50 text-green-400'
                : 'bg-yellow-900/50 text-yellow-400'
            }`}>
              {completeness.isMinimumComplete
                ? `Complete (${completeness.percentage}%)`
                : `${completeness.capturedRequired}/${completeness.totalRequired} required`
              }
            </span>
          )}

          {/* Feasibility badge */}
          {survey && survey.feasibility_status !== 'pending' && (
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${
              FEASIBILITY_OPTIONS.find(o => o.value === survey.feasibility_status)?.color || ''
            }`}>
              {FEASIBILITY_OPTIONS.find(o => o.value === survey.feasibility_status)?.label}
            </span>
          )}
        </div>

        <span className="text-gray-500 text-sm">{collapsed ? '▸' : '▾'}</span>
      </button>

      {/* ── Body ───────────────────────────────────────────── */}
      {!collapsed && (
        <div className="px-4 pb-4 space-y-4">

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* System Type Selector — shows if no type resolved and user can edit */}
          {!effectiveSystemType && canEdit && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">System Type</label>
              <select
                value={overrideSystemType || ''}
                onChange={e => setOverrideSystemType(e.target.value || null)}
                className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 w-full max-w-xs focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select system type...</option>
                {SYSTEM_TYPE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* System type override toggle — even when auto-resolved */}
          {effectiveSystemType && canEdit && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500">Survey type:</span>
              <span className={`px-2 py-0.5 rounded font-medium ${
                effectiveSystemType === 'ro' ? 'bg-cyan-900/50 text-cyan-300' :
                effectiveSystemType === 'softener' ? 'bg-blue-900/50 text-blue-300' :
                'bg-purple-900/50 text-purple-300'
              }`}>
                {SYSTEM_TYPE_OPTIONS.find(o => o.value === effectiveSystemType)?.label || effectiveSystemType}
              </span>
              <select
                value={overrideSystemType || ''}
                onChange={e => setOverrideSystemType(e.target.value || null)}
                className="bg-gray-800 border border-gray-600 text-gray-400 text-xs rounded px-2 py-1 ml-2"
              >
                <option value="">Auto-detect</option>
                {SYSTEM_TYPE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>Override: {opt.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* ── Photo Prompts Grid ─────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            {prompts.map(prompt => {
              const existing = getPhotoForPrompt(prompt.key);
              const isUploading = uploading === prompt.key;

              return (
                <div
                  key={prompt.key}
                  className={`border rounded-lg p-3 transition-colors ${
                    existing
                      ? 'border-green-700/50 bg-green-900/10'
                      : prompt.required
                        ? 'border-red-700/30 bg-red-900/5'
                        : 'border-gray-700 bg-gray-800/30'
                  }`}
                >
                  {/* Prompt header */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-200">{prompt.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      existing
                        ? 'bg-green-900/50 text-green-400'
                        : prompt.required
                          ? 'bg-red-900/50 text-red-400'
                          : 'bg-gray-700 text-gray-400'
                    }`}>
                      {existing ? '✓ Captured' : prompt.required ? 'Required' : 'Optional'}
                    </span>
                  </div>

                  {/* Description */}
                  <p className="text-[11px] text-gray-500 mb-2 leading-relaxed">{prompt.description}</p>

                  {/* Photo display or upload button */}
                  {existing ? (
                    <div className="relative group">
                      <img
                        src={existing.url}
                        alt={prompt.label}
                        className="w-full h-24 object-cover rounded cursor-pointer"
                        onClick={() => setLightboxUrl(existing.url)}
                      />
                      <div className="absolute bottom-1 left-1 text-[9px] bg-black/70 text-gray-300 px-1 rounded">
                        {new Date(existing.created_at).toLocaleDateString()}
                        {' · '}
                        {(existing.metadata as any)?.captured_context || 'unknown'}
                      </div>
                      {/* Re-upload option for canUpload users */}
                      {canUpload && (
                        <button
                          onClick={() => triggerFileInput(prompt.key)}
                          className="absolute top-1 right-1 bg-black/70 hover:bg-black/90 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          Replace
                        </button>
                      )}
                    </div>
                  ) : canUpload ? (
                    <button
                      onClick={() => triggerFileInput(prompt.key)}
                      disabled={isUploading}
                      className="w-full h-24 border-2 border-dashed border-gray-600 hover:border-blue-500 rounded flex flex-col items-center justify-center gap-1 text-gray-500 hover:text-blue-400 transition-colors disabled:opacity-50"
                    >
                      {isUploading ? (
                        <span className="text-xs">Uploading...</span>
                      ) : (
                        <>
                          <span className="text-xl">📷</span>
                          <span className="text-[11px]">Tap to capture</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="w-full h-24 border-2 border-dashed border-gray-700 rounded flex items-center justify-center">
                      <span className="text-xs text-gray-600">Not captured</span>
                    </div>
                  )}

                  {/* Hidden file input */}
                  {canUpload && (
                    <input
                      id={`photo-input-${prompt.key}`}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) await handlePhotoUpload(prompt, file);
                        e.target.value = ''; // Reset for re-upload
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Feasibility Section ────────────────────────── */}
          <div className="border-t border-gray-700 pt-4 space-y-3">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Feasibility Assessment</h4>

            {/* Status */}
            {canEdit ? (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Status</label>
                <div className="flex gap-2">
                  {FEASIBILITY_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setFeasibilityStatus(opt.value)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                        feasibilityStatus === opt.value
                          ? opt.color + ' ring-1 ring-current'
                          : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Status:</span>
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                  FEASIBILITY_OPTIONS.find(o => o.value === (survey?.feasibility_status || 'pending'))?.color || ''
                }`}>
                  {FEASIBILITY_OPTIONS.find(o => o.value === (survey?.feasibility_status || 'pending'))?.label}
                </span>
              </div>
            )}

            {/* Notes */}
            {canEdit ? (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Feasibility Notes</label>
                <textarea
                  value={feasibilityNotes}
                  onChange={e => setFeasibilityNotes(e.target.value)}
                  placeholder="No outlet under sink, need electrician first. Drain access limited..."
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                />
              </div>
            ) : survey?.feasibility_notes ? (
              <div>
                <span className="text-xs text-gray-500">Notes:</span>
                <p className="text-sm text-gray-300 mt-1">{survey.feasibility_notes}</p>
              </div>
            ) : null}

            {/* Save button — only for full_edit */}
            {canEdit && survey && (
              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-500">
                  {survey.surveyed_by && `Surveyed ${new Date(survey.survey_date).toLocaleDateString()}`}
                </div>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {saving ? 'Saving...' : 'Save Survey'}
                </button>
              </div>
            )}

            {/* Read-only metadata footer */}
            {isReadOnly && survey && (
              <div className="text-xs text-gray-600 pt-2 border-t border-gray-700/50">
                Surveyed {new Date(survey.survey_date).toLocaleDateString()}
                {survey.system_type && ` · ${SYSTEM_TYPE_OPTIONS.find(o => o.value === survey.system_type)?.label || survey.system_type}`}
              </div>
            )}
          </div>

          {/* ── Completeness Summary ───────────────────────── */}
          {photos.length > 0 && (
            <div className="border-t border-gray-700 pt-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-gray-700 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      completeness.isMinimumComplete ? 'bg-green-500' : 'bg-yellow-500'
                    }`}
                    style={{ width: `${completeness.percentage}%` }}
                  />
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  {completeness.capturedRequired}/{completeness.totalRequired} required
                  {completeness.capturedOptional > 0 && ` · ${completeness.capturedOptional} bonus`}
                </span>
              </div>
              {completeness.missingRequired.length > 0 && (
                <p className="text-[11px] text-red-400/70 mt-1">
                  Missing: {completeness.missingRequired.map(k =>
                    prompts.find(p => p.key === k)?.label || k
                  ).join(', ')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Lightbox ───────────────────────────────────────── */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-8 cursor-pointer"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt="Survey photo"
            className="max-w-full max-h-full object-contain rounded-lg"
          />
          <button
            className="absolute top-6 right-6 text-white text-2xl hover:text-gray-300"
            onClick={() => setLightboxUrl(null)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
