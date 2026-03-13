import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';

interface DocumentRow {
  id: string;
  type: 'agreement' | 'quote' | 'invoice' | 'install';
  label: string;
  referenceNumber: string;
  date: string | null;
  status: string;
  commercialType?: string;
}

interface DocumentsTabProps {
  customerId: string;
}

const TYPE_CONFIG: Record<DocumentRow['type'], {
  icon: string;
  color: string;
  bg: string;
  border: string;
  statusColor: string;
  statusBg: string;
}> = {
  agreement: {
    icon: '📄',
    color: '#a78bfa',
    bg: 'rgba(167,139,250,0.08)',
    border: 'rgba(167,139,250,0.25)',
    statusColor: '#a78bfa',
    statusBg: 'rgba(167,139,250,0.15)',
  },
  quote: {
    icon: '📋',
    color: '#38bdf8',
    bg: 'rgba(56,189,248,0.08)',
    border: 'rgba(56,189,248,0.25)',
    statusColor: '#38bdf8',
    statusBg: 'rgba(56,189,248,0.15)',
  },
  invoice: {
    icon: '🧾',
    color: '#4ade80',
    bg: 'rgba(74,222,128,0.08)',
    border: 'rgba(74,222,128,0.25)',
    statusColor: '#4ade80',
    statusBg: 'rgba(74,222,128,0.15)',
  },
  install: {
    icon: '🔧',
    color: '#fb923c',
    bg: 'rgba(251,146,60,0.08)',
    border: 'rgba(251,146,60,0.25)',
    statusColor: '#fb923c',
    statusBg: 'rgba(251,146,60,0.15)',
  },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

export default function DocumentsTab({ customerId }: DocumentsTabProps) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!customerId) return;
    fetchDocuments();
  }, [customerId]);

  async function fetchDocuments() {
    setLoading(true);
    setError(null);

    try {
      const [agreementsRes, quotesRes, invoicesRes, jobsRes] = await Promise.all([
        supabase
          .from('agreements')
          .select('id, reference_number, signed_at, status, commercial_type')
          .eq('customer_id', customerId)
          .not('signed_at', 'is', null)
          .order('signed_at', { ascending: false }),

        supabase
          .from('quotes')
          .select('id, reference_number, created_at, status, commercial_type')
          .eq('customer_id', customerId)
          .in('status', ['accepted', 'signed'])
          .order('created_at', { ascending: false }),

        supabase
          .from('invoices')
          .select('id, reference_number, paid_at, created_at, status')
          .eq('customer_id', customerId)
          .in('status', ['paid', 'partial'])
          .order('paid_at', { ascending: false }),

        supabase
          .from('jobs')
          .select('id, completed_at, status')
          .eq('customer_id', customerId)
          .eq('status', 'complete')
          .order('completed_at', { ascending: false }),
      ]);

      const rows: DocumentRow[] = [];

      if (agreementsRes.data) {
        agreementsRes.data.forEach((a) => {
          rows.push({
            id: a.id,
            type: 'agreement',
            label: a.commercial_type === 'rental' ? 'Rental Agreement' : 'Purchase Agreement',
            referenceNumber: a.reference_number ?? `AGR-${a.id.slice(0, 8).toUpperCase()}`,
            date: a.signed_at,
            status: 'Signed',
            commercialType: a.commercial_type,
          });
        });
      }

      if (quotesRes.data) {
        quotesRes.data.forEach((q) => {
          rows.push({
            id: q.id,
            type: 'quote',
            label: 'Accepted Quote',
            referenceNumber: q.reference_number ?? `Q-${q.id.slice(0, 8).toUpperCase()}`,
            date: q.created_at,
            status: capitalize(q.status),
            commercialType: q.commercial_type,
          });
        });
      }

      if (invoicesRes.data) {
        invoicesRes.data.forEach((inv) => {
          rows.push({
            id: inv.id,
            type: 'invoice',
            label: 'Invoice',
            referenceNumber: inv.reference_number ?? `INV-${inv.id.slice(0, 8).toUpperCase()}`,
            date: inv.paid_at ?? inv.created_at,
            status: capitalize(inv.status),
          });
        });
      }

      if (jobsRes.data) {
        jobsRes.data.forEach((j) => {
          rows.push({
            id: j.id,
            type: 'install',
            label: 'Installer Sign-Off',
            referenceNumber: `JOB-${j.id.slice(0, 8).toUpperCase()}`,
            date: j.completed_at,
            status: 'Complete',
          });
        });
      }

      // Sort all rows by date descending
      rows.sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });

      setDocuments(rows);
    } catch (err) {
      console.error('DocumentsTab fetch error:', err);
      setError('Failed to load documents.');
    } finally {
      setLoading(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: '#64748b' }}>
        Loading documents…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: '16px',
        background: 'rgba(239,68,68,0.1)',
        border: '1px solid rgba(239,68,68,0.3)',
        borderRadius: '8px',
        color: '#f87171',
        fontSize: '14px',
      }}>
        {error}
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div style={{
        padding: '48px 0',
        textAlign: 'center',
        color: '#64748b',
        fontSize: '14px',
      }}>
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>📁</div>
        No signed documents on file yet.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

      {/* Header count */}
      <div style={{
        fontSize: '13px',
        color: '#64748b',
        marginBottom: '4px',
      }}>
        {documents.length} document{documents.length !== 1 ? 's' : ''} on file
      </div>

      {documents.map((doc) => {
        const cfg = TYPE_CONFIG[doc.type];
        return (
          <div
            key={`${doc.type}-${doc.id}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 18px',
              background: cfg.bg,
              border: `1px solid ${cfg.border}`,
              borderRadius: '10px',
              gap: '12px',
            }}
          >
            {/* Left: icon + info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1, minWidth: 0 }}>

              {/* Icon circle */}
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: `rgba(${cfg.color.replace('#', '').match(/.{2}/g)?.map(h => parseInt(h, 16)).join(',') ?? '100,100,100'},0.15)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
                flexShrink: 0,
              }}>
                {cfg.icon}
              </div>

              {/* Text */}
              <div style={{ minWidth: 0 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                }}>
                  <span style={{
                    color: '#f1f5f9',
                    fontWeight: 600,
                    fontSize: '14px',
                  }}>
                    {doc.label}
                  </span>

                  {/* Status badge */}
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: cfg.statusColor,
                    background: cfg.statusBg,
                    padding: '2px 8px',
                    borderRadius: '20px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}>
                    {doc.status}
                  </span>

                  {/* Commercial type badge if present */}
                  {doc.commercialType && (
                    <span style={{
                      fontSize: '11px',
                      color: '#94a3b8',
                      background: 'rgba(148,163,184,0.1)',
                      padding: '2px 8px',
                      borderRadius: '20px',
                      textTransform: 'capitalize',
                    }}>
                      {doc.commercialType}
                    </span>
                  )}
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  marginTop: '4px',
                  flexWrap: 'wrap',
                }}>
                  <span style={{ fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace' }}>
                    {doc.referenceNumber}
                  </span>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    {formatDate(doc.date)}
                  </span>
                </div>
              </div>
            </div>

            {/* Right: Download button (Coming Soon) */}
            <button
              disabled
              title="PDF download coming in Phase 2"
              style={{
                padding: '8px 14px',
                background: 'rgba(100,116,139,0.1)',
                border: '1px solid rgba(100,116,139,0.2)',
                borderRadius: '8px',
                color: '#475569',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'not-allowed',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span style={{ fontSize: '13px' }}>⬇️</span>
              Download
            </button>
          </div>
        );
      })}

      {/* Phase 2 note */}
      <div style={{
        marginTop: '8px',
        padding: '10px 14px',
        background: 'rgba(56,189,248,0.05)',
        border: '1px solid rgba(56,189,248,0.15)',
        borderRadius: '8px',
        fontSize: '12px',
        color: '#64748b',
      }}>
        📎 PDF downloads available in Phase 2. All documents are saved and accessible.
      </div>
    </div>
  );
}
