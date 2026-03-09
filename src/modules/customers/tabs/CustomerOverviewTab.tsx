import { LIFECYCLE_LABELS } from '../customers.types'
import { useInstalledSystems, useRentalContracts, useMaintenancePlans, useCustomerAddresses } from '../useCustomers'

interface Props { customer: any }

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function CustomerOverviewTab({ customer }: Props) {
  const { data: systems } = useInstalledSystems(customer.id)
  const { data: contracts } = useRentalContracts(customer.id)
  const { data: plans } = useMaintenancePlans(customer.id)
  const { data: addresses } = useCustomerAddresses(customer.id)

  const activeSystems = (systems || []).filter((s: any) => s.is_active !== false)
  const purchasedCount = activeSystems.filter((s: any) => s.ownership_type === 'purchased').length
  const rentedCount = activeSystems.filter((s: any) => s.ownership_type === 'rented').length
  const activePlan = (plans || []).find((p: any) => p.status === 'active')
  const activeContract = (contracts || []).find((c: any) => c.status === 'active')
  const currentAddress = (addresses || []).find((a: any) => a.is_current) || (addresses || [])[0]

  return (
    <div className="space-y-4">
      {/* Systems summary */}
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

      {/* Active rental */}
      {activeContract && (
        <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(245, 158, 11, 0.06)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
          <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#fbbf24' }}>Active Rental Contract</div>
          <div className="text-sm text-slate-200">
            ${Number(activeContract.monthly_amount).toFixed(2)}/month · {activeContract.payments_made || 0} payments made
          </div>
          <div className="text-xs text-muted">
            Contract {activeContract.contract_number} · Ends {formatDate(activeContract.end_date)}
          </div>
          {activeContract.total_paid > 0 && (
            <div className="text-xs text-muted mt-1">Total paid: ${Number(activeContract.total_paid).toLocaleString()}</div>
          )}
          {activeContract.rental_risk_status && (
            <div className="text-xs font-semibold mt-1" style={{ color: '#f87171' }}>
              ⚠️ Risk: {activeContract.rental_risk_status.replace(/_/g, ' ')}
            </div>
          )}
        </div>
      )}

      {/* Maintenance plan */}
      {activePlan ? (
        <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(34, 197, 94, 0.06)', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
          <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#4ade80' }}>Maintenance Plan</div>
          <div className="text-sm text-slate-200">
            {(activePlan as any).included_in_rental ? 'Included in Rental' : `$${(activePlan as any).price_snapshot}/year`}
          </div>
          <div className="text-xs text-muted">
            Renews {formatDate((activePlan as any).renewal_date)} · {(activePlan as any).auto_renew ? 'Auto-renew' : 'Manual renewal'}
          </div>
        </div>
      ) : (
        <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(148, 163, 184, 0.06)', border: '1px solid rgba(148, 163, 184, 0.15)' }}>
          <div className="text-xs font-bold uppercase tracking-wide mb-1 text-muted">Maintenance Plan</div>
          <div className="text-sm text-muted">No active maintenance plan — warranty may be affected</div>
        </div>
      )}

      {/* Contact info */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="text-xs font-bold text-slate-300 uppercase tracking-wide">Contact Information</div>
        <InfoRow label="Phone" value={customer.phone} />
        {customer.email && <InfoRow label="Email" value={customer.email} />}
        <InfoRow label="Service Address" value={
          currentAddress
            ? [currentAddress.address_line, currentAddress.city, currentAddress.state, currentAddress.zip_code].filter(Boolean).join(', ') || customer.service_address
            : customer.service_address || '—'
        } />
        <InfoRow label="Customer Since" value={formatDate(customer.created_at)} />
        {customer.lead_id && <InfoRow label="Source" value="Converted from lead" />}
      </div>

      {/* Notes */}
      {customer.notes && (
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-xs font-bold text-slate-300 uppercase tracking-wide mb-2">Notes</div>
          <div className="text-sm text-slate-300 whitespace-pre-wrap">{customer.notes}</div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between">
      <span className="text-xs text-muted uppercase tracking-wide">{label}</span>
      <span className="text-sm text-slate-300 text-right">{value}</span>
    </div>
  )
}
