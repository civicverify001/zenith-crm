import { useInstalledSystems } from '../useCustomers'
import type { InstalledSystem } from '../customers.types'
import { OWNERSHIP_LABELS, WARRANTY_LABELS, WARRANTY_COLORS } from '../customers.types'

interface Props { customerId: string }

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function InstalledSystemsTab({ customerId }: Props) {
  const { data: systems, isLoading } = useInstalledSystems(customerId)

  if (isLoading) return <p className="text-sm text-muted text-center py-8">Loading systems...</p>
  if (!systems?.length) return <p className="text-sm text-muted text-center py-8">No installed systems.</p>

  return (
    <div className="space-y-3">
      {(systems as InstalledSystem[]).filter(s => s.is_active).map(sys => (
        <div key={sys.id} className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-white">{sys.name_snapshot}</h4>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                sys.ownership_type === 'purchased' ? 'bg-green/20 text-green' : 'bg-amber/20 text-amber'
              }`}>
                {OWNERSHIP_LABELS[sys.ownership_type]}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${WARRANTY_COLORS[sys.warranty_status]}`}>
                {WARRANTY_LABELS[sys.warranty_status]}
              </span>
            </div>
          </div>

          {sys.converted_from_rental && (
            <div className="text-xs text-accent mb-2">
              Converted from rental {sys.conversion_date ? `on ${formatDate(sys.conversion_date)}` : ''}
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            {sys.sku_snapshot && <Field label="SKU" value={sys.sku_snapshot} />}
            {sys.serial_number && <Field label="Serial" value={sys.serial_number} />}
            <Field label="Installed" value={formatDate(sys.install_date)} />
            {sys.retail_price_snapshot && <Field label="Retail Price" value={`$${Number(sys.retail_price_snapshot).toLocaleString()}`} />}
          </div>

          {/* Warranty details */}
          {(sys.warranty_parts_years || sys.warranty_labor_years) && (
            <div className="mt-3 pt-2 border-t border-border">
              <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1">Warranty</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {sys.warranty_parts_years ? (
                  <Field label="Parts" value={`${sys.warranty_parts_years}yr — expires ${formatDate(sys.warranty_parts_expiry)}`} />
                ) : (
                  <Field label="Parts" value="Manufacturer warranty (see notes)" />
                )}
                {sys.warranty_labor_years && (
                  <Field label="Labor" value={`${sys.warranty_labor_years}yr — expires ${formatDate(sys.warranty_labor_expiry)}`} />
                )}
              </div>
              {sys.warranty_status === 'void' && sys.warranty_void_reason && (
                <div className="text-xs text-red mt-1">Void reason: {sys.warranty_void_reason}</div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted">{label}: </span>
      <span className="text-slate-300">{value}</span>
    </div>
  )
}
