import type { Customer } from '../customers.types'
import { LIFECYCLE_LABELS, LIFECYCLE_COLORS } from '../customers.types'
import { useInstalledSystems, useRentalContracts, useMaintenancePlans } from '../useCustomers'

interface Props { customer: Customer }

export function CustomerOverviewTab({ customer }: Props) {
  const { data: systems } = useInstalledSystems(customer.id)
  const { data: contracts } = useRentalContracts(customer.id)
  const { data: plans } = useMaintenancePlans(customer.id)

  const purchasedCount = (systems || []).filter(s => s.ownership_type === 'purchased' && s.is_active).length
  const rentedCount = (systems || []).filter(s => s.ownership_type === 'rented' && s.is_active).length
  const warrantyIssues = (systems || []).filter(s => s.warranty_status !== 'valid').length
  const activePlan = (plans || []).find((p: any) => p.status === 'active')
  const activeContract = (contracts || []).find(c => c.status === 'active')

  return (
    <div className="space-y-4">
      {/* Status summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-white">{(systems || []).filter(s => s.is_active).length}</div>
          <div className="text-xs text-muted">Installed Systems</div>
          {purchasedCount > 0 && <div className="text-xs text-green mt-1">{purchasedCount} purchased</div>}
          {rentedCount > 0 && <div className="text-xs text-amber mt-1">{rentedCount} rented</div>}
        </div>
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <div className={`text-2xl font-bold ${warrantyIssues > 0 ? 'text-amber' : 'text-green'}`}>
            {warrantyIssues > 0 ? `${warrantyIssues} issue${warrantyIssues !== 1 ? 's' : ''}` : '✓'}
          </div>
          <div className="text-xs text-muted">Warranty Status</div>
        </div>
      </div>

      {/* Rental summary */}
      {activeContract && (
        <div className="bg-amber/5 border border-amber/20 rounded-xl p-3">
          <div className="text-xs font-bold text-amber uppercase tracking-wide mb-1">Active Rental</div>
          <div className="text-sm text-slate-200">${activeContract.monthly_amount}/month · {activeContract.payments_made} payments made</div>
          <div className="text-xs text-muted">Contract {activeContract.contract_number} · Ends {activeContract.end_date}</div>
        </div>
      )}

      {/* Maintenance plan */}
      {activePlan && (
        <div className="bg-green/5 border border-green/20 rounded-xl p-3">
          <div className="text-xs font-bold text-green uppercase tracking-wide mb-1">Maintenance Plan</div>
          <div className="text-sm text-slate-200">
            {(activePlan as any).included_in_rental ? 'Included in Rental' : `$${(activePlan as any).price_snapshot}/year`}
          </div>
          <div className="text-xs text-muted">Renews {(activePlan as any).renewal_date} · {(activePlan as any).auto_renew ? 'Auto-renew' : 'Manual'}</div>
        </div>
      )}

      {/* Contact info */}
      <InfoRow label="Phone" value={customer.phone} />
      {customer.email && <InfoRow label="Email" value={customer.email} />}
      <InfoRow label="Service Address" value={customer.service_address} />
      {customer.city && <InfoRow label="City" value={[customer.city, customer.state, customer.zip_code].filter(Boolean).join(', ')} />}
      <InfoRow label="Customer Since" value={new Date(customer.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} />
      {customer.notes && (
        <div>
          <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1">Notes</div>
          <div className="text-sm text-slate-300 bg-card border border-border rounded-lg p-3 whitespace-pre-wrap">{customer.notes}</div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-0.5">{label}</div>
      <div className="text-sm text-slate-300">{value}</div>
    </div>
  )
}
