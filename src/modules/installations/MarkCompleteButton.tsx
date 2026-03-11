// ============================================================
// FILE 1: Add to src/services/installationsService.ts
// (append this function to your existing service file)
// ============================================================

/**
 * Mark installation complete and charge install fee to card on file.
 * Returns charge status so UI can show appropriate feedback.
 */
export async function completeInstallation(jobId: string, completedBy?: string) {
  const response = await fetch('/api/installations/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_id: jobId,
      completed_by: completedBy,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to complete installation');
  }

  return data;
}


// ============================================================
// FILE 2: src/modules/installations/MarkCompleteButton.tsx
// Drop-in component for InstallationDetailPage
// ============================================================

import React, { useState } from 'react';

interface MarkCompleteButtonProps {
  jobId: string;
  jobStatus: string;
  installFee: number | null;
  customerName: string;
  completedBy?: string; // current user ID
  onCompleted?: (result: any) => void;
}

export default function MarkCompleteButton({
  jobId,
  jobStatus,
  installFee,
  customerName,
  completedBy,
  onCompleted,
}: MarkCompleteButtonProps) {
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [result, setResult] = useState<any>(null);

  // Already completed
  if (jobStatus === 'completed') {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg">
        <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span className="text-green-700 font-medium">Installation Complete</span>
      </div>
    );
  }

  const handleComplete = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/installations/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, completed_by: completedBy }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to complete installation');
      }

      setResult(data);
      setShowConfirm(false);
      onCompleted?.(data);
    } catch (err: any) {
      setResult({ success: false, error: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Show result after action
  if (result) {
    if (result.success) {
      const cs = result.charge_status;
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg">
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-green-700 font-medium">Installation Marked Complete</span>
          </div>

          {cs === 'charged' && (
            <div className="px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
              Install fee of <strong>${result.charge_details.amount.toFixed(2)}</strong> charged
              to card ending in {result.charge_details.last_four}
            </div>
          )}
          {cs === 'failed' && (
            <div className="px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              Install fee charge failed: {result.charge_details.error}.
              <br />Job marked complete — charge will need manual retry.
            </div>
          )}
          {cs === 'skipped' && (
            <div className="px-4 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700 text-sm">
              Install fee not charged: {result.charge_details?.reason || 'No install fee on this job'}.
              <br />Job marked complete.
            </div>
          )}
        </div>
      );
    } else {
      return (
        <div className="space-y-2">
          <div className="px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            Error: {result.error}
          </div>
          <button
            onClick={() => { setResult(null); setShowConfirm(false); }}
            className="text-sm text-gray-500 underline"
          >
            Try again
          </button>
        </div>
      );
    }
  }

  // Confirmation dialog
  if (showConfirm) {
    return (
      <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
        <p className="text-sm font-medium text-gray-800">
          Mark this installation as complete?
        </p>
        {installFee && installFee > 0 ? (
          <p className="text-sm text-gray-600">
            This will charge <strong>${installFee.toFixed(2)}</strong> (install fee)
            to <strong>{customerName}</strong>'s card on file.
          </p>
        ) : (
          <p className="text-sm text-gray-600">
            No install fee to charge for this job.
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleComplete}
            disabled={loading}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Processing...
              </>
            ) : (
              'Yes, Complete & Charge'
            )}
          </button>
          <button
            onClick={() => setShowConfirm(false)}
            disabled={loading}
            className="px-4 py-2 bg-white text-gray-600 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Default: show the button
  return (
    <button
      onClick={() => setShowConfirm(true)}
      className="px-5 py-2.5 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 shadow-sm flex items-center gap-2 transition-colors"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
      Mark Complete{installFee && installFee > 0 ? ` & Charge $${installFee.toFixed(2)}` : ''}
    </button>
  );
}
