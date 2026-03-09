import type { Lead } from './leads.types'

interface Props {
  lead: Lead
}

function formatCurrency(val: number | null | undefined): string {
  if (!val) return '—'
  return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(str: string | null | undefined): string {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function StatusBadge({ active, activeLabel, inactiveLabel }: { active: boolean; activeLabel: string; inactiveLabel: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
      active ? 'bg-green/20 text-green' : 'bg-muted/20 text-muted'
    }`}>
      {active ? activeLabel : inactiveLabel}
    </span>
  )
}

export function AgreementSignedPanel({ lead }: Props) {
  const installPrefLabel: Record<string, string> = {
    asap: 'ASAP',
    specific_date: 'Specific Date',
    flexible: 'Flexible',
  }

  const paymentLabel: Record<string, string> = {
    cash: 'Cash',
    check: 'Check',
    card: 'Card',
    financing: 'Financing',
  }

  return (
    <div className="bg-green/5 border border-green/20 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-green text-sm">✅</span>
        <h4 className="text-sm font-bold text-green">Agreement Details</h4>
      </div>

      {/* Quote total - prominent */}
      <div className="text-center py-2">
        <div className="text-xs text-muted uppercase tracking-wide">Quote Total</div>
        <div className="text-2xl font-bold text-white mt-0.5">
          {formatCurrency(lead.quote_total)}
        </div>
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-muted">Signed By</div>
          <div className="text-sm text-slate-200">{lead.signed_by || '—'}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Signed At</div>
          <div className="text-sm text-slate-200">{formatDate(lead.signed_at)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Payment</div>
          <div className="text-sm text-slate-200">
            {lead.payment_method ? paymentLabel[lead.payment_method] || lead.payment_method : '—'}
            {lead.financing_provider && (
              <span className="text-xs text-muted ml-1">({lead.financing_provider})</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted">Deposit</div>
          <div className="text-sm text-slate-200">{formatCurrency(lead.deposit_amount)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Install Pref.</div>
          <div className="text-sm text-slate-200">
            {lead.install_preference ? installPrefLabel[lead.install_preference] || lead.install_preference : '—'}
            {lead.install_preferred_date && (
              <span className="text-xs text-muted ml-1">
                ({new Date(lead.install_preferred_date).toLocaleDateString()})
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted">Agreement File</div>
          <div className="text-sm">
            {lead.agreement_file_url ? (
              <a href={lead.agreement_file_url} target="_blank" rel="noopener noreferrer"
                className="text-accent hover:underline">View PDF</a>
            ) : (
              <span className="text-muted">No file</span>
            )}
          </div>
        </div>
      </div>

      {/* Status flags */}
      <div className="flex items-center gap-2 pt-2 border-t border-green/10">
        <StatusBadge active={!!lead.job_created} activeLabel="Job Created" inactiveLabel="Job Pending" />
        <StatusBadge active={!!lead.inventory_reserved} activeLabel="Inventory Reserved" inactiveLabel="Not Reserved" />
      </div>
    </div>
  )
}
