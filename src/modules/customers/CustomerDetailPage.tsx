import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  useCustomer, useInstalledSystems, useRentalContracts,
  useWarrantyRecords, useMaintenancePlans, useServiceScheduleItems,
} from './useCustomers'
import { LIFECYCLE_LABELS, LIFECYCLE_COLORS } from './customers.types'
import { supabase } from '../../lib/supabase'

import { CustomerOverviewTab } from './tabs/CustomerOverviewTab'
import { InstalledSystemsTab } from './tabs/InstalledSystemsTab'
import { RentalBuyoutTab } from './tabs/RentalBuyoutTab'
import { MaintenanceComplianceTab } from './tabs/MaintenanceComplianceTab'
import { CustomerActivityTab } from './tabs/CustomerActivityTab'
import { CustomerDocumentsTab } from './tabs/CustomerDocumentsTab'
import { BillingTab } from './tabs/BillingTab'
import { CustomerQuotesTab } from './tabs/CustomerQuotesTab'
import { ServicePlansTab } from './tabs/ServicePlansTab'
import { WaterTestsTab } from './tabs/WaterTestsTab'
import ShipmentsTab from './tabs/ShipmentsTab'
import SiteSurveyCapture from '../leads/SiteSurveyCapture'

type CustTab = 'overview' | 'systems' | 'rental' | 'billing' | 'quotes' | 'service_plans' | 'shipments' | 'water_tests' | 'maintenance' | 'activity' | 'documents'

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>()
  const navigate = useNavigate()
  const { data: customer, isLoading, error } = useCustomer(customerId || '')
  const { data: systems } = useInstalledSystems(customerId || '')
  const { data: contracts } = useRentalContracts(customerId || '')
  const { data: warranties } = useWarrantyRecords(customerId || '')
  const { data: plans } = useMaintenancePlans(customerId || '')
  const { data: schedules } = useServiceScheduleItems(customerId || '')

  // ─── Active service plan (from customer_service_plans, not deprecated maintenance_plans) ───
  const [activeServicePlan, setActiveServicePlan] = useState<any>(null)
  const [servicePlanCount, setServicePlanCount] = useState(0)

  useEffect(() => {
    if (!customerId) return
    async function fetchServicePlans() {
      try {
        const { data, error: spErr } = await supabase
          .from('customer_service_plans')
          .select('id, status, price, billing_cycle, plan_id, service_plans(name)')
          .eq('customer_id', customerId!)
          .in('status', ['active', 'pending_payment_method'])
          .order('created_at', { ascending: false })

        if (!spErr && data) {
          setServicePlanCount(data.length)
          // Pick the first active one for the summary card
          const active = data.find((p: any) => p.status === 'active') || data[0] || null
          setActiveServicePlan(active)
        }
      } catch (e) {
        // best effort
      }
    }
    fetchServicePlans()
  }, [customerId])

  const [activeTab, setActiveTab] = useState<CustTab>('overview')
  const [showSMS, setShowSMS] = useState(false)
  const [smsBody, setSmsBody] = useState('')
  const [smsSending, setSmsSending] = useState(false)
  const [smsResult, setSmsResult] = useState<'sent' | 'error' | null>(null)

  if (isLoading) return <div className="flex items-center justify-center h-full"><div className="text-muted text-sm">Loading customer...</div></div>
  if (error || !customer) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-sm mb-2" style={{ color: '#f87171' }}>Customer not found.</div>
          <button onClick={() => navigate('/customers')} className="text-accent text-sm hover:underline">← Back</button>
        </div>
      </div>
    )
  }

  // ─── Computed summaries ───────────────────────────────────
  const activeSystems = (systems || []).filter((s: any) => s.is_active !== false)
  const purchasedCount = activeSystems.filter((s: any) => s.ownership_type === 'purchased').length
  const rentedCount = activeSystems.filter((s: any) => s.ownership_type === 'rented').length

  const warrantyIssues = (warranties || []).filter((w: any) => w.warranty_status === 'warning' || w.warranty_status === 'void')
  const voidWarranties = warrantyIssues.filter((w: any) => w.warranty_status === 'void')
  const warningWarranties = warrantyIssues.filter((w: any) => w.warranty_status === 'warning')

  // Use customer_service_plans for the summary card (not deprecated maintenance_plans)
  const hasActiveServicePlan = !!activeServicePlan
  const activeContract = (contracts || []).find((c: any) => c.status === 'active')
  const hasRentals = (contracts || []).length > 0

  const overdueSchedules = (schedules || []).filter((s: any) => s.status === 'overdue')
  const dueSoonSchedules = (schedules || []).filter((s: any) => s.status === 'due_soon')

  const isAtRisk = customer.lifecycle_status === 'at_risk'
  const hasAlerts = voidWarranties.length > 0 || isAtRisk || overdueSchedules.length > 0

  // ─── Service plan summary for card ────────────────────────
  let planCardValue = 'None'
  let planCardSub = 'No active plan'
  let planCardColor = '#94a3b8'

  if (hasActiveServicePlan) {
    const planName = (activeServicePlan as any)?.service_plans?.name || 'Service Plan'
    const planPrice = activeServicePlan.price ? `$${Number(activeServicePlan.price).toFixed(2)}` : ''
    const cycle = activeServicePlan.billing_cycle === 'yearly' ? '/yr' : activeServicePlan.billing_cycle === 'monthly' ? '/mo' : ''

    if (activeServicePlan.status === 'active') {
      planCardValue = servicePlanCount > 1 ? `${servicePlanCount} Active` : 'Active'
      planCardSub = planPrice ? `${planName} — ${planPrice}${cycle}` : planName
      planCardColor = '#4ade80'
    } else if (activeServicePlan.status === 'pending_payment_method') {
      planCardValue = 'Pending'
      planCardSub = `${planName} — needs card`
      planCardColor = '#fbbf24'
    }
  }

  // ─── Tabs ─────────────────────────────────────────────────
  const TABS: { key: CustTab; label: string; show: boolean }[] = [
    { key: 'overview',       label: 'Overview',        show: true },
    { key: 'systems',        label: 'Systems',          show: true },
    { key: 'rental',         label: 'Rental & Buyout',  show: hasRentals },
    { key: 'billing',        label: 'Billing',          show: true },
    { key: 'quotes',         label: 'Quotes',           show: true },
    { key: 'service_plans',  label: 'Service Plans',    show: true },
    { key: 'shipments',      label: 'Shipments',        show: true },
    { key: 'water_tests',    label: 'Water Tests',      show: true },
    { key: 'maintenance',    label: 'Maintenance',      show: false },
    { key: 'activity',       label: 'Activity',         show: true },
    { key: 'documents',      label: 'Documents',        show: true },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-3 flex-shrink-0">
        <div>
          <button onClick={() => navigate('/customers')}
            className="text-xs text-muted hover:text-accent transition-colors mb-2 flex items-center gap-1">
            ← Back to Customers
          </button>
          <h1 className="text-xl font-bold text-white">{customer.full_name}</h1>
          <div className="text-sm text-muted mt-0.5">{customer.service_address}</div>
          <div className="text-xs text-muted mt-0.5">
            {customer.phone}{customer.email && ` · ${customer.email}`}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => { setShowSMS(true); setSmsResult(null); setSmsBody('') }}
            style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid rgba(6,182,212,0.3)', background: 'rgba(6,182,212,0.1)', color: '#06b6d4', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            💬 Send Text
          </button>
          <div className={`stage-badge border ${LIFECYCLE_COLORS[customer.lifecycle_status as keyof typeof LIFECYCLE_COLORS] || ''}`}>
            {LIFECYCLE_LABELS[customer.lifecycle_status as keyof typeof LIFECYCLE_LABELS] || customer.lifecycle_status}
          </div>
        </div>
      </div>

      {/* ─── Alerts ──────────────────────────────────────── */}
      {hasAlerts && (
        <div className="space-y-2 mb-3 flex-shrink-0">
          {voidWarranties.length > 0 && (
            <div className="rounded-lg px-4 py-2.5 text-sm font-semibold flex items-center gap-2"
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171' }}>
              <span>⚠️</span>
              <span>{voidWarranties.length} warranty {voidWarranties.length === 1 ? 'record' : 'records'} VOID — compliance action required</span>
            </div>
          )}
          {warningWarranties.length > 0 && !voidWarranties.length && (
            <div className="rounded-lg px-4 py-2.5 text-sm font-semibold flex items-center gap-2"
              style={{ backgroundColor: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#fbbf24' }}>
              <span>⚠️</span>
              <span>{warningWarranties.length} warranty {warningWarranties.length === 1 ? 'record is' : 'records are'} at warning status</span>
            </div>
          )}
          {overdueSchedules.length > 0 && (
            <div className="rounded-lg px-4 py-2.5 text-sm font-semibold flex items-center gap-2"
              style={{ backgroundColor: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#fbbf24' }}>
              <span>🔧</span>
              <span>{overdueSchedules.length} overdue service {overdueSchedules.length === 1 ? 'item' : 'items'}</span>
            </div>
          )}
          {isAtRisk && (
            <div className="rounded-lg px-4 py-2.5 text-sm font-semibold flex items-center gap-2"
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171' }}>
              <span>🚨</span>
              <span>Customer flagged as At Risk — review account immediately</span>
            </div>
          )}
        </div>
      )}

      {/* ─── Summary Cards ───────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3 mb-4 flex-shrink-0">
        <SummaryCard
          label="Installed Systems"
          value={String(activeSystems.length)}
          sub={[
            purchasedCount > 0 ? `${purchasedCount} purchased` : '',
            rentedCount > 0 ? `${rentedCount} rented` : '',
          ].filter(Boolean).join(' · ') || 'None'}
          color="#38bdf8"
        />
        <SummaryCard
          label="Warranty"
          value={warrantyIssues.length > 0 ? `${warrantyIssues.length} issue${warrantyIssues.length !== 1 ? 's' : ''}` : '✓ Valid'}
          sub={voidWarranties.length > 0 ? `${voidWarranties.length} void` : warningWarranties.length > 0 ? `${warningWarranties.length} warning` : 'All systems covered'}
          color={voidWarranties.length > 0 ? '#f87171' : warningWarranties.length > 0 ? '#fbbf24' : '#4ade80'}
        />
        <SummaryCard
          label="Service Plan"
          value={planCardValue}
          sub={planCardSub}
          color={planCardColor}
        />
        <SummaryCard
          label="Service Schedule"
          value={overdueSchedules.length > 0 ? `${overdueSchedules.length} overdue` : dueSoonSchedules.length > 0 ? `${dueSoonSchedules.length} due soon` : '✓ Current'}
          sub={`${(schedules || []).length} total items`}
          color={overdueSchedules.length > 0 ? '#f87171' : dueSoonSchedules.length > 0 ? '#fbbf24' : '#4ade80'}
        />
      </div>

      {/* FEATURE FLAG: Site Survey hidden — re-enable when ready */}
      {false && <div className="mb-4 flex-shrink-0">
        <SiteSurveyCapture
          context="customer"
          customerId={customer.id}
          defaultCollapsed={true}
        />
      </div>}

      {/* ─── Tabs ────────────────────────────────────────── */}
      <div className="flex border-b border-border flex-shrink-0 overflow-x-auto">
        {TABS.filter(t => t.show).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wide whitespace-nowrap transition-colors ${
              activeTab === tab.key ? 'text-accent border-b-2 border-accent' : 'text-muted hover:text-slate-300'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Tab Content ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto py-5">
        {activeTab === 'overview'       && <CustomerOverviewTab customer={customer} />}
        {activeTab === 'systems'        && <InstalledSystemsTab customerId={customer.id} />}
        {activeTab === 'rental'         && <RentalBuyoutTab customerId={customer.id} />}
        {activeTab === 'billing'        && <BillingTab customerId={customer.id} customer={customer} />}
        {activeTab === 'quotes'         && (
          <CustomerQuotesTab
            customerId={customer.id}
            customerName={customer.full_name}
            customerAddress={''}
            customerPhone={customer.phone}
          />
        )}
        {activeTab === 'service_plans'  && <ServicePlansTab customerId={customer.id} />}
        {activeTab === 'shipments'      && <ShipmentsTab customerId={customer.id} />}
        {activeTab === 'water_tests'    && <WaterTestsTab customerId={customer.id} />}
        {activeTab === 'maintenance'    && <MaintenanceComplianceTab customerId={customer.id} />}
        {activeTab === 'activity'       && <CustomerActivityTab customerId={customer.id} />}
        {activeTab === 'documents'      && <CustomerDocumentsTab customerId={customer.id} />}
      </div>

      {/* ─── Send SMS Modal ──────────────────────────────── */}
      {showSMS && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
          <div style={{ background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 16, width: '100%', maxWidth: 460, overflow: 'hidden' }}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid #1e3a4f', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 16 }}>Send Text to {customer.full_name}</div>
                <div style={{ color: '#475569', fontSize: 12, marginTop: 2 }}>To: {customer.phone} · From: (463) 300-5100</div>
              </div>
              <button onClick={() => setShowSMS(false)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {[
                  { label: 'Appointment', msg: `Hi ${customer.full_name}, this is Zenith Pure Solutions. Just a reminder about your upcoming appointment. Reply to confirm or call (317) 690-4172.` },
                  { label: 'Follow-Up', msg: `Hi ${customer.full_name}, this is Zenith Pure Solutions. We wanted to check in — how is your water system working? Any questions? Call (317) 690-4172.` },
                  { label: 'Payment', msg: `Hi ${customer.full_name}, this is Zenith Pure Solutions. We noticed a payment is due on your account. Please call (317) 690-4172 or reply for assistance.` },
                ].map(t => (
                  <button key={t.label} onClick={() => setSmsBody(t.msg)}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #1e3a4f', background: '#162232', color: '#94a3b8', cursor: 'pointer' }}>
                    {t.label}
                  </button>
                ))}
              </div>
              <textarea value={smsBody} onChange={e => setSmsBody(e.target.value)} placeholder="Type your message…" rows={4}
                style={{ width: '100%', background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, color: '#e2e8f0', padding: '10px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
              <div style={{ fontSize: 11, color: '#334155', marginTop: 4 }}>{smsBody.length} chars · {Math.ceil(smsBody.length / 160) || 0} segment{Math.ceil(smsBody.length / 160) !== 1 ? 's' : ''}</div>
              {smsResult === 'sent' && <div style={{ marginTop: 10, padding: '8px 14px', borderRadius: 8, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', color: '#4ade80', fontSize: 13 }}>Message sent!</div>}
              {smsResult === 'error' && <div style={{ marginTop: 10, padding: '8px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', fontSize: 13 }}>Failed to send. Check console.</div>}
            </div>
            <div style={{ padding: '14px 24px', borderTop: '1px solid #1e3a4f', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowSMS(false)} style={{ padding: '8px 16px', fontSize: 13, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
              <button disabled={smsSending || !smsBody.trim() || smsResult === 'sent'} onClick={async () => {
                setSmsSending(true); setSmsResult(null)
                try {
                  const res = await fetch('/api/openphone/send-sms', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ to: customer.phone, body: smsBody, entity_type: 'customer', entity_id: customer.id }),
                  })
                  setSmsResult(res.ok ? 'sent' : 'error')
                  if (res.ok) setTimeout(() => setShowSMS(false), 1500)
                } catch { setSmsResult('error') }
                setSmsSending(false)
              }}
                style={{ padding: '9px 22px', borderRadius: 8, border: 'none', background: (!smsBody.trim() || smsResult === 'sent') ? '#334155' : '#06b6d4', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: smsSending ? 0.5 : 1 }}>
                {smsSending ? 'Sending…' : smsResult === 'sent' ? 'Sent!' : 'Send SMS'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="text-xs text-muted uppercase tracking-wide mb-1">{label}</div>
      <div className="text-lg font-bold" style={{ color }}>{value}</div>
      <div className="text-xs text-muted mt-0.5">{sub}</div>
    </div>
  )
}
