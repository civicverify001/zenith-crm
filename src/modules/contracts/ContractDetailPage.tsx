// src/modules/contracts/ContractDetailPage.tsx
// ContractDetailPage v1 — /contracts/:id
// Built against REAL schema columns (verified March 13 2026):
//   id, contract_number, customer_id, quote_id, type, status,
//   monthly_amount, start_date, end_date, terms_snapshot,
//   line_items_snapshot, signed_at, notes, created_at, updated_at,
//   billing_day, last_billed_at, retail_price_snapshot (Gap 15)
//
// Access: admin (full + cancel), frontdesk (read), salesrep (read), technician (blocked)
// NOTE: Does NOT use contractsService.ts types — service interface mismatches real DB.
//       Queries supabase directly with local types matched to actual columns.
// NOTE: Cancel writes status='cancelled' only — cancelled_at/reason not in schema.

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { usePermissions } from '../../hooks/usePermissions'

// ─── Real DB types ─────────────────────────────────────────────

interface RealContract {
  id: string
  contract_number: string | null
  customer_id: string
  quote_id: string | null
  type: 'rental' | 'purchase' | 'financed'
  status: 'active' | 'pending' | 'cancelled' | 'completed' | 'expired'
  monthly_amount: number | null
  start_date: string | null
  end_date: string | null
  terms_snapshot: any
  line_items_snapshot: any
  signed_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  billing_day: number | null
  last_billed_at: string | null
  retail_price_snapshot: number | null
  customer_name?: string
  customer_phone?: string
  customer_email?: string
}

interface PaymentTx {
  id: string
  amount: number
  status: string
  type: string
  description: string | null
  attempted_at: string
  failure_reason: string | null
}

interface InstalledSystem {
  id: string
  system_type: string
  name_snapshot: string
  ownership_type: string
  install_date: string | null
  is_active: boolean
}

interface Agreement {
  id: string
  status: string
  created_at: string
  quote_id: string | null
}

// ─── Display maps ──────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  active: 'Active', pending: 'Pending Signature',
  cancelled: 'Cancelled', completed: 'Completed', expired: 'Expired',
}
const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e', pending: '#f59e0b',
  cancelled: '#ef4444', completed: '#6366f1', expired: '#94a3b8',
}
const TYPE_LABELS: Record<string, string> = {
  rental: 'Rental', purchase: 'Purchase', financed: 'Financed',
}
const TYPE_COLORS: Record<string, string> = {
  rental: '#0ea5e9', purchase: '#a855f7', financed: '#f59e0b',
}
const TX_COLORS: Record<string, string> = {
  succeeded: '#22c55e', failed: '#ef4444', pending: '#f59e0b', refunded: '#6366f1',
}

// ─── Helpers ───────────────────────────────────────────────────

function fmt(val: number | null | undefined) {
  if (val == null) return '—'
  return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(val: string | null | undefined) {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Sub-components ────────────────────────────────────────────

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 20,
      fontSize: 12, fontWeight: 600, letterSpacing: '0.02em',
      background: color + '22', color, border: `1px solid ${color}44`,
    }}>{label}</span>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 12, padding: '20px 24px', ...style }}>
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#64748b', margin: '0 0 14px' }}>
      {children}
    </p>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #1e3a4f' }}>
      <span style={{ fontSize: 13, color: '#64748b' }}>{label}</span>
      <span style={{ fontSize: 14, color: '#e2e8f0', fontWeight: 500 }}>{value ?? '—'}</span>
    </div>
  )
}

// ─── Buyout Calculator Card (Gap 15) ───────────────────────────

function BuyoutCalculatorCard({ contract, payments }: { contract: RealContract; payments: PaymentTx[] }) {
  if (contract.type !== 'rental') return null

  const retailPrice = contract.retail_price_snapshot
  const succeededPayments = payments.filter(p => p.status === 'succeeded')
  const totalPaid = succeededPayments.reduce((sum, p) => sum + Number(p.amount), 0)
  const paymentCount = succeededPayments.length
  const creditFromPayments = totalPaid * 0.5
  const buyoutAmount = retailPrice ? Math.max(0, retailPrice - creditFromPayments) : null

  return (
    <Card style={{ border: '1px solid #0ea5e933' }}>
      <SectionTitle>Buyout Calculator</SectionTitle>

      {!retailPrice ? (
        <p style={{ margin: 0, fontSize: 13, color: '#64748b', fontStyle: 'italic' }}>
          Retail price not recorded on this contract. Re-run Mark Complete on the installation to populate,
          or add <code style={{ color: '#94a3b8' }}>retail_price_snapshot</code> manually in the database.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Retail price */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#94a3b8' }}>Retail Price (catalog)</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{fmt(retailPrice)}</span>
          </div>

          {/* Total paid */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#94a3b8' }}>Total Payments Made</span>
            <span style={{ fontSize: 14, fontWeight: 500, color: '#22c55e' }}>
              {fmt(totalPaid)} <span style={{ fontSize: 11, color: '#64748b' }}>({paymentCount} payments)</span>
            </span>
          </div>

          {/* 50% credit */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#94a3b8' }}>50% Payment Credit</span>
            <span style={{ fontSize: 14, fontWeight: 500, color: '#f59e0b' }}>– {fmt(creditFromPayments)}</span>
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid #0ea5e933', margin: '4px 0' }} />

          {/* Buyout amount */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>Buyout Amount</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: '#0ea5e9' }}>{fmt(buyoutAmount)}</span>
          </div>

          {/* Formula explanation */}
          <div style={{ background: '#0ea5e90a', border: '1px solid #0ea5e922', borderRadius: 8, padding: '10px 12px', marginTop: 4 }}>
            <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
              Formula: Retail Price – (50% × Total Payments) = Buyout Amount
            </p>
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── Main Page ─────────────────────────────────────────────────

export default function ContractDetailPage() {
  const { id }       = useParams<{ id: string }>()
  const navigate     = useNavigate()
  const { role }     = usePermissions()

  useEffect(() => {
    if (role === 'technician') navigate('/', { replace: true })
  }, [role, navigate])

  const [contract,   setContract]   = useState<RealContract | null>(null)
  const [payments,   setPayments]   = useState<PaymentTx[]>([])
  const [systems,    setSystems]    = useState<InstalledSystem[]>([])
  const [agreement,  setAgreement]  = useState<Agreement | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [cancelOpen,  setCancelOpen]  = useState(false)
  const [cancelling,  setCancelling]  = useState(false)
  const [activating,  setActivating]  = useState(false)

  useEffect(() => {
    if (!id || role === 'technician') return
    loadAll(id)
  }, [id, role])

  async function loadAll(contractId: string) {
    setLoading(true)
    setError(null)
    try {
      const { data: c, error: cErr } = await supabase
        .from('contracts')
        .select(`
          id, contract_number, customer_id, quote_id, type, status,
          monthly_amount, start_date, end_date, terms_snapshot,
          line_items_snapshot, signed_at, notes, created_at, updated_at,
          billing_day, last_billed_at, retail_price_snapshot,
          customers ( full_name, phone, email )
        `)
        .eq('id', contractId)
        .single()

      if (cErr || !c) throw new Error(cErr?.message || 'Contract not found')

      const contract: RealContract = {
        ...c,
        customer_name:  (c as any).customers?.full_name ?? '—',
        customer_phone: (c as any).customers?.phone     ?? '—',
        customer_email: (c as any).customers?.email     ?? '—',
      }
      setContract(contract)

      const cid = contract.customer_id

      // Payments — account-level, customer_id only
      const { data: txs } = await supabase
        .from('payment_transactions')
        .select('id, amount, status, type, description, attempted_at, failure_reason')
        .eq('customer_id', cid)
        .order('attempted_at', { ascending: false })
        .limit(50)
      setPayments((txs || []) as PaymentTx[])

      // Installed systems
      const { data: sys } = await supabase
        .from('installed_systems')
        .select('id, system_type, name_snapshot, ownership_type, install_date, is_active')
        .eq('customer_id', cid)
        .order('install_date', { ascending: false })
      setSystems((sys || []) as InstalledSystem[])

      // Agreement — quote_id-linked first, customer fallback
      let found: Agreement | null = null
      if (contract.quote_id) {
        const { data: ag } = await supabase
          .from('agreements')
          .select('id, status, created_at, quote_id')
          .eq('quote_id', contract.quote_id)
          .eq('status', 'signed')
          .limit(1)
          .maybeSingle()
        found = ag || null
      }
      if (!found) {
        const { data: ag } = await supabase
          .from('agreements')
          .select('id, status, created_at, quote_id')
          .eq('customer_id', cid)
          .eq('status', 'signed')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        found = ag || null
      }
      setAgreement(found)

    } catch (e: any) {
      setError(e.message || 'Failed to load contract')
    } finally {
      setLoading(false)
    }
  }

  async function handleCancel() {
    if (!contract) return
    setCancelling(true)
    try {
      const { error } = await supabase
        .from('contracts')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', contract.id)
      if (error) throw error
      setCancelOpen(false)
      await loadAll(contract.id)
    } catch (e: any) {
      alert('Cancel failed: ' + e.message)
    } finally {
      setCancelling(false)
    }
  }

  async function handleActivate() {
    if (!contract) return
    setActivating(true)
    try {
      const { error } = await supabase
        .from('contracts')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', contract.id)
      if (error) throw error
      await loadAll(contract.id)
    } catch (e: any) {
      alert('Activate failed: ' + e.message)
    } finally {
      setActivating(false)
    }
  }

  if (role === 'technician') return null

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0f1923', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#64748b', fontSize: 14 }}>Loading contract…</p>
    </div>
  )

  if (error || !contract) return (
    <div style={{ minHeight: '100vh', background: '#0f1923', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <p style={{ color: '#ef4444', fontSize: 14 }}>{error || 'Contract not found'}</p>
      <button onClick={() => navigate(-1)} style={{ color: '#0d7ea3', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}>← Go back</button>
    </div>
  )

  const displayId  = contract.contract_number || contract.id.slice(0, 8).toUpperCase()
  const canCancel  = role === 'admin' && contract.status === 'active'
  const canActivate = role === 'admin' && contract.status === 'pending'

  return (
    <div style={{ minHeight: '100vh', background: '#0f1923', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{
        background: '#162232', borderBottom: '1px solid #1e3a4f',
        padding: '14px 24px', display: 'flex', alignItems: 'center',
        gap: 16, position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20, padding: 0, lineHeight: 1 }}>
          ←
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: '#e2e8f0' }}>{displayId}</span>
            <Badge label={TYPE_LABELS[contract.type]     ?? contract.type}   color={TYPE_COLORS[contract.type]     ?? '#64748b'} />
            <Badge label={STATUS_LABELS[contract.status] ?? contract.status} color={STATUS_COLORS[contract.status] ?? '#64748b'} />
          </div>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>{contract.customer_name}</p>
        </div>
        {canActivate && (
          <button onClick={handleActivate} disabled={activating} style={{
            background: '#22c55e22', border: '1px solid #22c55e44', color: '#22c55e',
            borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600,
            cursor: activating ? 'not-allowed' : 'pointer', opacity: activating ? 0.6 : 1,
          }}>
            {activating ? 'Activating…' : 'Activate Contract'}
          </button>
        )}
        {canCancel && (
          <button onClick={() => setCancelOpen(true)} style={{
            background: '#ef444422', border: '1px solid #ef444444', color: '#ef4444',
            borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
            Cancel Contract
          </button>
        )}
      </div>

      {/* Body */}
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Summary */}
        <Card>
          <SectionTitle>Contract Summary</SectionTitle>
          <Row label="Contract #"     value={displayId} />
          <Row label="Customer"       value={contract.customer_name} />
          <Row label="Phone"          value={contract.customer_phone} />
          <Row label="Email"          value={contract.customer_email} />
          <Row label="Type"           value={<Badge label={TYPE_LABELS[contract.type] ?? contract.type} color={TYPE_COLORS[contract.type] ?? '#64748b'} />} />
          <Row label="Status"         value={<Badge label={STATUS_LABELS[contract.status] ?? contract.status} color={STATUS_COLORS[contract.status] ?? '#64748b'} />} />
          <Row label="Monthly Amount" value={fmt(contract.monthly_amount)} />
          <Row label="Start Date"     value={fmtDate(contract.start_date)} />
          <Row label="End Date"       value={fmtDate(contract.end_date)} />
          <Row label="Billing Day"    value={contract.billing_day ? `Day ${contract.billing_day} of month` : '—'} />
          <Row label="Last Billed"    value={fmtDate(contract.last_billed_at)} />
          <Row label="Signed"         value={fmtDate(contract.signed_at)} />
          <Row label="Created"        value={fmtDate(contract.created_at)} />
          {contract.notes && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: '#0f1923', borderRadius: 8, fontSize: 13, color: '#94a3b8' }}>
              {contract.notes}
            </div>
          )}
        </Card>

        {/* GAP 15: Buyout Calculator — rental contracts only */}
        <BuyoutCalculatorCard contract={contract} payments={payments} />

        {/* Line Items Snapshot */}
        {contract.line_items_snapshot && (
          <Card>
            <SectionTitle>Line Items (at signing)</SectionTitle>
            {Array.isArray(contract.line_items_snapshot) && contract.line_items_snapshot.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      {['Description', 'Qty', 'Unit Price', 'Total'].map(h => (
                        <th key={h} style={{
                          textAlign: 'left', padding: '6px 10px', color: '#64748b',
                          fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                          textTransform: 'uppercase', borderBottom: '1px solid #1e3a4f', whiteSpace: 'nowrap',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {contract.line_items_snapshot.map((item: any, i: number) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#0f192344' }}>
                        <td style={{ padding: '9px 10px', color: '#e2e8f0' }}>{item.description || item.name || '—'}</td>
                        <td style={{ padding: '9px 10px', color: '#94a3b8' }}>{item.quantity ?? 1}</td>
                        <td style={{ padding: '9px 10px', color: '#94a3b8' }}>{fmt(item.unit_price)}</td>
                        <td style={{ padding: '9px 10px', color: '#e2e8f0', fontWeight: 600 }}>{fmt(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <pre style={{ fontSize: 12, color: '#64748b', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {JSON.stringify(contract.line_items_snapshot, null, 2)}
              </pre>
            )}
          </Card>
        )}

        {/* Terms Snapshot */}
        {contract.terms_snapshot && (
          <Card>
            <SectionTitle>Terms (at signing)</SectionTitle>
            <pre style={{
              fontSize: 12, color: '#94a3b8', margin: 0,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              maxHeight: 240, overflowY: 'auto', lineHeight: 1.6,
            }}>
              {typeof contract.terms_snapshot === 'string'
                ? contract.terms_snapshot
                : JSON.stringify(contract.terms_snapshot, null, 2)}
            </pre>
          </Card>
        )}

        {/* Installed Systems */}
        <Card>
          <SectionTitle>Systems on This Account</SectionTitle>
          {systems.length === 0 ? (
            <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>No installed systems found.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {systems.map(sys => (
                <div key={sys.id} style={{
                  background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8,
                  padding: '12px 14px', display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
                }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{sys.name_snapshot}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                      Installed {fmtDate(sys.install_date)} · {sys.system_type?.replace(/_/g, ' ')}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Badge label={sys.ownership_type === 'rented' ? 'Rental' : 'Purchased'} color={sys.ownership_type === 'rented' ? '#0ea5e9' : '#a855f7'} />
                    <Badge label={sys.is_active ? 'Active' : 'Inactive'} color={sys.is_active ? '#22c55e' : '#94a3b8'} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Signed Agreement */}
        <Card>
          <SectionTitle>Signed Agreement</SectionTitle>
          {agreement ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <p style={{ margin: 0, fontSize: 14, color: '#e2e8f0', fontWeight: 500 }}>Signed {fmtDate(agreement.created_at)}</p>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748b' }}>
                  {agreement.quote_id && agreement.quote_id === contract.quote_id
                    ? 'Linked directly to this contract\'s quote'
                    : 'Matched by account — may be from a related quote'}
                </p>
              </div>
              <button
                onClick={() => navigate(`/agreements/${agreement.id}`)}
                style={{
                  background: '#0d7ea322', border: '1px solid #0d7ea344', color: '#0d7ea3',
                  borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                View Agreement →
              </button>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>No signed agreement on file.</p>
          )}
        </Card>

        {/* Payment History */}
        <Card>
          <SectionTitle>Account Payment History</SectionTitle>
          <p style={{ margin: '-10px 0 14px', fontSize: 11, color: '#475569', fontStyle: 'italic' }}>
            All payments on this account — records are not yet filtered to this contract individually.
          </p>
          {payments.length === 0 ? (
            <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>No payment records found.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {['Date', 'Type', 'Amount', 'Status'].map(h => (
                      <th key={h} style={{
                        textAlign: 'left', padding: '6px 10px', color: '#64748b',
                        fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                        textTransform: 'uppercase', borderBottom: '1px solid #1e3a4f', whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payments.map((tx, i) => (
                    <tr key={tx.id} style={{ background: i % 2 === 0 ? 'transparent' : '#0f192344' }}>
                      <td style={{ padding: '9px 10px', color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDate(tx.attempted_at)}</td>
                      <td style={{ padding: '9px 10px', color: '#e2e8f0', whiteSpace: 'nowrap' }}>{tx.type?.replace(/_/g, ' ')}</td>
                      <td style={{ padding: '9px 10px', color: '#e2e8f0', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(tx.amount)}</td>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                        <Badge label={tx.status} color={TX_COLORS[tx.status] ?? '#64748b'} />
                        {tx.failure_reason && (
                          <span style={{ display: 'block', fontSize: 11, color: '#ef4444', marginTop: 2 }}>{tx.failure_reason}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

      </div>

      {/* Cancel modal */}
      {cancelOpen && (
        <div style={{ position: 'fixed', inset: 0, background: '#00000099', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 14, padding: 28, maxWidth: 420, width: '100%' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, color: '#e2e8f0' }}>Cancel Contract</h3>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: '#64748b' }}>
              This will mark <strong style={{ color: '#e2e8f0' }}>{displayId}</strong> as cancelled.
              Autopay stops on the next billing cycle. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setCancelOpen(false)} style={{
                flex: 1, background: '#1e3a4f', border: '1px solid #1e3a4f', color: '#94a3b8',
                borderRadius: 8, padding: '10px 0', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}>Keep Active</button>
              <button onClick={handleCancel} disabled={cancelling} style={{
                flex: 1, background: '#ef444422', border: '1px solid #ef444466', color: '#ef4444',
                borderRadius: 8, padding: '10px 0', fontSize: 14, fontWeight: 600,
                cursor: cancelling ? 'not-allowed' : 'pointer', opacity: cancelling ? 0.6 : 1,
              }}>{cancelling ? 'Cancelling…' : 'Confirm Cancel'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
