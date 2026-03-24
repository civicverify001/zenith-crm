import { useInstalledSystems, useWarrantyRecords } from '../useCustomers'
import { OWNERSHIP_LABELS } from '../customers.types'
import { supabase } from '../../../lib/supabase'

interface Props { customerId: string }

const WARRANTY_STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  valid:   { bg: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', label: 'Valid' },
  warning: { bg: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', label: 'Warning' },
  void:    { bg: 'rgba(239, 68, 68, 0.15)', color: '#f87171', label: 'Void' },
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmt(n: number | null | undefined) {
  if (!n) return null
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function InstalledSystemsTab({ customerId }: Props) {
  const { data: systems, isLoading } = useInstalledSystems(customerId)
  const { data: warranties } = useWarrantyRecords(customerId)

  // monthly_amount_snapshot is now read directly from each installed_systems row
  // (written by api/installations/complete.js since the monthly_amount_snapshot migration)

  if (isLoading) return <p className="text-sm text-muted text-center py-8">Loading systems...</p>
  if (!systems?.length) return <p className="text-sm text-muted text-center py-8">No installed systems.</p>

  const active = (systems as any[]).filter(s => s.is_active !== false)
  const inactive = (systems as any[]).filter(s => s.is_active === false)

  const warrantyMap: Record<string, any> = {}
  for (const w of (warranties || []) as any[]) {
    warrantyMap[w.installed_system_id] = w
  }

  return (
    <div className="space-y-3">
      {active.length === 0 && <p className="text-sm text-muted text-center py-4">No active systems.</p>}
      {active.map(sys => {
        const warranty = warrantyMap[sys.id]
        const wStatus = warranty?.warranty_status || 'valid'
        const wStyle = WARRANTY_STATUS_STYLES[wStatus] || WARRANTY_STATUS_STYLES.valid
        const isRental = sys.ownership_type === 'rented'
        const isPurchased = sys.ownership_type === 'purchased'

        const ownershipColor = isPurchased
          ? { bg: 'rgba(34,197,94,0.15)', color: '#4ade80' }
          : { bg: 'rgba(245,158,11,0.15)', color: '#fbbf24' }

        return (
          <div key={sys.id} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-white">{sys.name_snapshot || sys.system_type}</h4>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{
                  backgroundColor: ownershipColor.bg, color: ownershipColor.color,
                }}>
                  {OWNERSHIP_LABELS[sys.ownership_type as keyof typeof OWNERSHIP_LABELS] || sys.ownership_type}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{
                  backgroundColor: wStyle.bg, color: wStyle.color,
                }}>
                  {wStyle.label}
                </span>
              </div>
            </div>

            {sys.converted_from_rental && (
              <div className="text-xs mb-2" style={{ color: '#38bdf8' }}>
                Converted from rental {sys.conversion_date ? `on ${formatDate(sys.conversion_date)}` : ''}
              </div>
            )}

            {/* Pricing summary bar */}
            {isRental && (sys.monthly_amount_snapshot || sys.install_fee_snapshot) && (
              <div className="flex items-center gap-4 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-3">
                {sys.monthly_amount_snapshot && (
                  <div>
                    <div style={{ fontSize: 10, color: '#fbbf24', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Monthly Rental</div>
                    <div className="text-sm font-bold text-amber-300">{fmt(sys.monthly_amount_snapshot)}/mo</div>
                  </div>
                )}
                {sys.install_fee_snapshot > 0 && (
                  <div>
                    <div style={{ fontSize: 10, color: '#fbbf24', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Install Fee Paid</div>
                    <div className="text-sm font-bold text-amber-300">{fmt(sys.install_fee_snapshot)}</div>
                  </div>
                )}
              </div>
            )}

            {isPurchased && sys.retail_price_snapshot && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, background: '#0a2a3a', border: '1px solid #1e3a4f', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#4ade80' }}>Purchase Price</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>{fmt(sys.retail_price_snapshot)}</div>
                </div>
                {sys.install_fee_snapshot > 0 && (
                  <div>
                    <div className="text-[10px] text-green-400/70 font-semibold uppercase tracking-wide">Install Fee Paid</div>
                    <div className="text-sm font-bold text-green-300">{fmt(sys.install_fee_snapshot)}</div>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {sys.sku_snapshot && <Field label="SKU" value={sys.sku_snapshot} />}
              {sys.serial_number && <Field label="Serial" value={sys.serial_number} />}
              <Field label="Installed" value={formatDate(sys.install_date)} />
            </div>

            {/* Warranty details */}
            {warranty && (
              <div className="mt-3 pt-2 border-t border-border">
                <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1">Warranty</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {warranty.parts_duration_years && (
                    <Field label="Parts" value={`${warranty.parts_duration_years}yr — expires ${formatDate(warranty.parts_end_date)}`} />
                  )}
                  {warranty.labor_duration_years && (
                    <Field label="Labor" value={`${warranty.labor_duration_years}yr — expires ${formatDate(warranty.labor_end_date)}`} />
                  )}
                </div>
                {warranty.manufacturer_parts_warranty_note && (
                  <div className="text-xs text-muted mt-1">Note: {warranty.manufacturer_parts_warranty_note}</div>
                )}
                {warranty.warranty_status === 'void' && warranty.status_reason && (
                  <div className="text-xs mt-1" style={{ color: '#f87171' }}>Void reason: {warranty.status_reason}</div>
                )}
                {warranty.warranty_status === 'warning' && warranty.status_reason && (
                  <div className="text-xs mt-1" style={{ color: '#fbbf24' }}>Warning: {warranty.status_reason}</div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Inactive / removed systems */}
      {inactive.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Inactive / Removed Systems</div>
          {inactive.map(sys => (
            <div key={sys.id} className="bg-card/50 border border-border/50 rounded-xl p-3 opacity-60 mb-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">{sys.name_snapshot || sys.system_type}</span>
                <span className="text-xs text-muted">Removed</span>
              </div>
            </div>
          ))}
        </div>
      )}
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
