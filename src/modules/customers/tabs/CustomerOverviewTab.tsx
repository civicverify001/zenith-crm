import { useState } from 'react'
import { LIFECYCLE_LABELS } from '../customers.types'
import {
  useInstalledSystems, useRentalContracts,
  useMaintenancePlans, useCustomerAddresses,
} from '../useCustomers'
import { supabase } from '../../../lib/supabase'
import { useQuery, useQueryClient } from '@tanstack/react-query'

interface Props { customer: any }

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Fetch lead origin — uses leads table, not opportunities ──
async function fetchLeadOrigin(leadId: string) {
  if (!leadId) return null
  const { data } = await supabase
    .from('leads')
    .select('source, source_detail, utm_source, utm_medium, utm_campaign, created_at, assigned_rep_id')
    .eq('id', leadId)
    .maybeSingle()
  return data
}

// ─── Fetch rep name from user_profiles ────────────────────────
async function fetchRepName(userId: string | null) {
  if (!userId) return null
  const { data } = await supabase
    .from('user_profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle()
  return data?.full_name || null
}

// ─── Fetch entity notes ───────────────────────────────────────
async function fetchEntityNotes(customerId: string) {
  const { data } = await supabase
    .from('entity_notes')
    .select('*')
    .eq('entity_type', 'customer')
    .eq('entity_id', customerId)
    .order('created_at', { ascending: false })
  return data || []
}

async function addEntityNote(customerId: string, content: string, noteType: string) {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('entity_notes').insert({
    entity_type: 'customer',
    entity_id: customerId,
    note_type: noteType,
    content,
    created_by: user?.id,
  })
  if (error) throw error
}

const SOURCE_LABELS: Record<string, string> = {
  website_form: 'Website Form',
  landing_page: 'Landing Page',
  google_ads: 'Google Ads',
  facebook_ads: 'Facebook Ads',
  referral: 'Referral',
  door_knock: 'Door Knock',
  home_show: 'Home Show',
  phone_call: 'Phone Call',
  other: 'Other',
}

const CONTACT_METHOD_LABELS: Record<string, string> = {
  phone: '📞 Phone',
  email: '✉️ Email',
  sms: '💬 SMS',
  mail: '📬 Mail',
}

export function CustomerOverviewTab({ customer }: Props) {
  const { data: systems } = useInstalledSystems(customer.id)
  const { data: contracts } = useRentalContracts(customer.id)
  const { data: plans } = useMaintenancePlans(customer.id)
  const { data: addresses } = useCustomerAddresses(customer.id)
  const queryClient = useQueryClient()

  const { data: leadOrigin } = useQuery({
    queryKey: ['lead-origin', customer.lead_id],
    queryFn: () => fetchLeadOrigin(customer.lead_id),
    enabled: !!customer.lead_id,
  })

  // Resolve assigned rep name from UUID
  const { data: repName } = useQuery({
    queryKey: ['rep-name', leadOrigin?.assigned_rep_id],
    queryFn: () => fetchRepName(leadOrigin?.assigned_rep_id || null),
    enabled: !!leadOrigin?.assigned_rep_id,
  })

  const { data: notes = [] } = useQuery({
    queryKey: ['entity-notes', 'customer', customer.id],
    queryFn: () => fetchEntityNotes(customer.id),
  })

  const [newNote, setNewNote] = useState('')
  const [noteType, setNoteType] = useState<'internal' | 'customer-facing'>('internal')
  const [addingNote, setAddingNote] = useState(false)
  const [savingNote, setSavingNote] = useState(false)

  const activeSystems   = (systems || []).filter((s: any) => s.is_active !== false)
  const purchasedCount  = activeSystems.filter((s: any) => s.ownership_type === 'purchased').length
  const rentedCount     = activeSystems.filter((s: any) => s.ownership_type === 'rented').length
  const activePlan      = (plans || []).find((p: any) => p.status === 'active')
  const activeContract  = (contracts || []).find((c: any) => c.status === 'active')
  const currentAddress  = (addresses || []).find((a: any) => a.is_current) || (addresses || [])[0]

  // ─── Service address: addresses table → customer fields → '—'
  const serviceAddress = (() => {
    if (currentAddress) {
      return [currentAddress.address_line, currentAddress.city, currentAddress.state, currentAddress.zip_code]
        .filter(Boolean).join(', ')
    }
    // Fall back to flat fields on the customer record
    const parts = [customer.address, customer.city, customer.state, customer.zip].filter(Boolean)
    return parts.length > 0 ? parts.join(', ') : '—'
  })()

  async function handleAddNote() {
    if (!newNote.trim()) return
    setSavingNote(true)
    try {
      await addEntityNote(customer.id, newNote.trim(), noteType)
      setNewNote('')
      setAddingNote(false)
      queryClient.invalidateQueries({ queryKey: ['entity-notes', 'customer', customer.id] })
    } finally {
      setSavingNote(false)
    }
  }

  return (
    <div className="space-y-4">

      {/* ── Systems summary ──────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-white">{activeSystems.length}</div>
          <div className="text-xs text-muted">Installed Systems</div>
          <div className="text-xs mt-1">
            {purchasedCount > 0 && <span style={{ color: '#4ade80' }}>{purchasedCount} purchased</span>}
            {purchasedCount > 0 && rentedCount > 0 && <span className="text-muted"> · </span>}
            {rentedCount > 0 && <span style={{ color: '#fbbf24' }}>{rentedCount} rented</span>}
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-white">
            {LIFECYCLE_LABELS[customer.lifecycle_status as keyof typeof LIFECYCLE_LABELS] || customer.lifecycle_status}
          </div>
          <div className="text-xs text-muted">Lifecycle Status</div>
          {customer.lifecycle_updated_at && (
            <div className="text-xs text-muted mt-1">Since {formatDate(customer.lifecycle_updated_at)}</div>
          )}
        </div>
      </div>

      {/* ── Active rental contract ────────────────────────── */}
      {activeContract && (
        <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}>
          <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#fbbf24' }}>Active Rental Contract</div>
          <div className="text-sm text-slate-200 mb-1">
            ${Number(activeContract.monthly_amount).toFixed(2)}/month · {activeContract.payments_made || 0} payments made
          </div>
          <div className="text-xs text-muted space-y-0.5">
            {activeContract.contract_number && <div>Contract · {activeContract.contract_number}</div>}
            <div className="flex gap-3">
              {activeContract.start_date && <span>Start: {formatDate(activeContract.start_date)}</span>}
              {activeContract.end_date
                ? <span>Ends: {formatDate(activeContract.end_date)}</span>
                : <span>End date: —</span>
              }
            </div>
            {activeContract.total_paid > 0 && (
              <div>Total paid: ${Number(activeContract.total_paid).toLocaleString()}</div>
            )}
          </div>
          {activeContract.rental_risk_status && (
            <div className="text-xs font-semibold mt-2" style={{ color: '#f87171' }}>
              ⚠️ Risk: {activeContract.rental_risk_status.replace(/_/g, ' ')}
            </div>
          )}
        </div>
      )}

      {/* ── Maintenance plan ──────────────────────────────── */}
      {activePlan ? (
        <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
          <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#4ade80' }}>Maintenance Plan</div>
          <div className="text-sm text-slate-200">
            {(activePlan as any).included_in_rental ? 'Included in Rental' : `$${(activePlan as any).price_snapshot}/year`}
          </div>
          <div className="text-xs text-muted">
            Renews {formatDate((activePlan as any).renewal_date)} · {(activePlan as any).auto_renew ? 'Auto-renew' : 'Manual renewal'}
          </div>
        </div>
      ) : (
        <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.15)' }}>
          <div className="text-xs font-bold uppercase tracking-wide mb-1 text-muted">Maintenance Plan</div>
          <div className="text-sm text-muted">No active maintenance plan — warranty may be affected</div>
        </div>
      )}

      {/* ── Contact Information ───────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="text-xs font-bold text-slate-300 uppercase tracking-wide">Contact Information</div>
        <InfoRow label="Phone" value={customer.phone || '—'} />
        {customer.email && <InfoRow label="Email" value={customer.email} />}
        <InfoRow label="Service Address" value={serviceAddress} />
        <InfoRow label="Customer Since" value={formatDate(customer.created_at)} />
        {repName && <InfoRow label="Sales Rep" value={repName} />}
        {customer.preferred_contact_method && (
          <InfoRow
            label="Preferred Contact"
            value={CONTACT_METHOD_LABELS[customer.preferred_contact_method] || customer.preferred_contact_method}
          />
        )}
      </div>

      {/* ── Communication Consent ─────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="text-xs font-bold text-slate-300 uppercase tracking-wide">Communication Consent</div>
        <div className="grid grid-cols-2 gap-3">
          <ConsentBadge label="Email Marketing" enabled={customer.email_opt_in !== false} />
          <ConsentBadge label="SMS / Text" enabled={customer.sms_opt_in === true} />
        </div>
        {customer.consent_source && (
          <InfoRow label="Consent Source" value={customer.consent_source} />
        )}
        {customer.consent_updated_at && (
          <InfoRow label="Last Updated" value={formatDate(customer.consent_updated_at)} />
        )}
        {!customer.consent_source && !customer.consent_updated_at && (
          <div className="text-xs text-muted italic">No consent record on file — update before any marketing communications</div>
        )}
      </div>

      {/* ── Lead History ──────────────────────────────────── */}
      {customer.lead_id && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="text-xs font-bold text-slate-300 uppercase tracking-wide">Lead History</div>
          <InfoRow label="Converted" value={formatDate(customer.created_at)} />
          {leadOrigin ? (
            <>
              {leadOrigin.source && (
                <InfoRow label="Lead Source" value={SOURCE_LABELS[leadOrigin.source] || leadOrigin.source} />
              )}
              {leadOrigin.source_detail && (
                <InfoRow label="Source Detail" value={leadOrigin.source_detail} />
              )}
              {leadOrigin.utm_source && (
                <InfoRow label="UTM Source" value={leadOrigin.utm_source} />
              )}
              {leadOrigin.utm_medium && (
                <InfoRow label="UTM Medium" value={leadOrigin.utm_medium} />
              )}
              {leadOrigin.utm_campaign && (
                <InfoRow label="Campaign" value={leadOrigin.utm_campaign} />
              )}
            </>
          ) : (
            <div className="text-xs text-muted italic">No source tracking data on original lead</div>
          )}
        </div>
      )}

      {/* ── Internal Notes ────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold text-slate-300 uppercase tracking-wide">
            Internal Notes {notes.length > 0 && <span className="text-muted font-normal normal-case">({notes.length})</span>}
          </div>
          {!addingNote && (
            <button
              onClick={() => setAddingNote(true)}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg"
              style={{ backgroundColor: 'rgba(96,165,250,0.12)', color: '#60a5fa' }}
            >
              + Add Note
            </button>
          )}
        </div>

        {addingNote && (
          <div className="mb-3 space-y-2">
            <textarea
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder="Write a note..."
              rows={3}
              className="w-full text-sm rounded-lg px-3 py-2 resize-none outline-none"
              style={{ backgroundColor: '#0f172a', border: '1px solid rgba(148,163,184,0.2)', color: '#e2e8f0' }}
              autoFocus
            />
            <div className="flex items-center gap-2">
              <select
                value={noteType}
                onChange={e => setNoteType(e.target.value as any)}
                className="text-xs rounded-lg px-2 py-1 outline-none"
                style={{ backgroundColor: '#1e293b', border: '1px solid rgba(148,163,184,0.2)', color: '#94a3b8' }}
              >
                <option value="internal">Internal</option>
                <option value="customer-facing">Customer-Facing</option>
              </select>
              <div className="flex gap-2 ml-auto">
                <button
                  onClick={() => { setAddingNote(false); setNewNote('') }}
                  className="text-xs px-3 py-1 rounded-lg text-muted hover:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddNote}
                  disabled={savingNote || !newNote.trim()}
                  className="text-xs px-3 py-1 rounded-lg font-semibold disabled:opacity-50"
                  style={{ backgroundColor: 'rgba(96,165,250,0.15)', color: '#60a5fa' }}
                >
                  {savingNote ? 'Saving...' : 'Save Note'}
                </button>
              </div>
            </div>
          </div>
        )}

        {notes.length === 0 && !addingNote ? (
          <div className="text-xs text-muted italic">No notes yet</div>
        ) : (
          <div className="space-y-2">
            {(notes as any[]).map((note: any) => (
              <div
                key={note.id}
                className="rounded-lg px-3 py-2.5"
                style={{
                  backgroundColor: note.note_type === 'customer-facing' ? 'rgba(34,211,238,0.05)' : 'rgba(148,163,184,0.06)',
                  border: note.note_type === 'customer-facing' ? '1px solid rgba(34,211,238,0.15)' : '1px solid rgba(148,163,184,0.12)',
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold" style={{ color: note.note_type === 'customer-facing' ? '#22d3ee' : '#64748b' }}>
                    {note.note_type === 'customer-facing' ? 'Customer-Facing' : 'Internal'}
                  </span>
                  <span className="text-xs text-muted">{formatDate(note.created_at)}</span>
                </div>
                <div className="text-sm text-slate-300 whitespace-pre-wrap">{note.content}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Legacy notes ─────────────────────────────────── */}
      {customer.notes && (
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-xs font-bold text-slate-300 uppercase tracking-wide mb-2">Legacy Notes</div>
          <div className="text-sm text-slate-300 whitespace-pre-wrap">{customer.notes}</div>
        </div>
      )}

    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-muted uppercase tracking-wide flex-shrink-0">{label}</span>
      <span className="text-sm text-slate-300 text-right">{value}</span>
    </div>
  )
}

function ConsentBadge({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-3 py-2"
      style={{
        backgroundColor: enabled ? 'rgba(74,222,128,0.08)' : 'rgba(148,163,184,0.06)',
        border: `1px solid ${enabled ? 'rgba(74,222,128,0.2)' : 'rgba(148,163,184,0.15)'}`,
      }}
    >
      <span style={{ color: enabled ? '#4ade80' : '#64748b', fontSize: 14 }}>
        {enabled ? '✓' : '✗'}
      </span>
      <div>
        <div className="text-xs font-semibold" style={{ color: enabled ? '#4ade80' : '#64748b' }}>{label}</div>
        <div className="text-xs text-muted">{enabled ? 'Opted in' : 'Not opted in'}</div>
      </div>
    </div>
  )
}
