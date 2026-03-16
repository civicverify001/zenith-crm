import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  useCustomer, useInstalledSystems, useRentalContracts,
  useWarrantyRecords, useMaintenancePlans, useServiceScheduleItems,
} from './useCustomers'
import { LIFECYCLE_LABELS, LIFECYCLE_COLORS } from './customers.types'

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

  const [activeTab, setActiveTab] = useState<CustTab>('overview')

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

  const activePlan = (plans || []).find((p: any) => p.status === 'active')
  const activeContract = (contracts || []).find((c: any) => c.status === 'active')
  const hasRentals = (contracts || []).length > 0

  const overdueSchedules = (schedules || []).filter((s: any) => s.status === 'overdue')
  const dueSoonSchedules = (schedules || []).filter((s: any) => s.status === 'due_soon')

  const isAtRisk = customer.lifecycle_status === 'at_risk'
  const hasAlerts = voidWarranties.length > 0 || isAtRisk || overdueSchedules.length > 0

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
        <div className={`stage-badge border ${LIFECYCLE_COLORS[customer.lifecycle_status as keyof typeof LIFECYCLE_COLORS] || ''}`}>
          {LIFECYCLE_LABELS[customer.lifecycle_status as keyof typeof LIFECYCLE_LABELS] || customer.lifecycle_status}
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
          label="Maintenance Plan"
          value={activePlan ? 'Active' : 'None'}
          sub={activePlan
            ? ((activePlan as any).included_in_rental ? 'Included in rental' : `$${(activePlan as any).price_snapshot}/yr`)
            : 'No active plan'}
          color={activePlan ? '#4ade80' : '#94a3b8'}
        />
        <SummaryCard
          label="Service Schedule"
          value={overdueSchedules.length > 0 ? `${overdueSchedules.length} overdue` : dueSoonSchedules.length > 0 ? `${dueSoonSchedules.length} due soon` : '✓ Current'}
          sub={`${(schedules || []).length} total items`}
          color={overdueSchedules.length > 0 ? '#f87171' : dueSoonSchedules.length > 0 ? '#fbbf24' : '#4ade80'}
        />
      </div>

      {/* ─── Pre-Install Survey (read-only) ──────────────── */}
      <div className="mb-4 flex-shrink-0">
        <SiteSurveyCapture
          context="customer"
          customerId={customer.id}
          defaultCollapsed={true}
        />
      </div>

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
