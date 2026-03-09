import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useCustomer, useRentalContracts } from './useCustomers'
import type { Customer } from './customers.types'
import { LIFECYCLE_LABELS, LIFECYCLE_COLORS } from './customers.types'

import { CustomerOverviewTab } from './tabs/CustomerOverviewTab'
import { InstalledSystemsTab } from './tabs/InstalledSystemsTab'
import { RentalBuyoutTab } from './tabs/RentalBuyoutTab'
import { MaintenanceComplianceTab } from './tabs/MaintenanceComplianceTab'
import { CustomerActivityTab } from './tabs/CustomerActivityTab'

type CustTab = 'overview' | 'systems' | 'rental' | 'maintenance' | 'activity'

export function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>()
  const navigate = useNavigate()
  const { data: customer, isLoading, error } = useCustomer(customerId || '')
  const { data: contracts } = useRentalContracts(customerId || '')
  const [activeTab, setActiveTab] = useState<CustTab>('overview')

  if (isLoading) return <div className="flex items-center justify-center h-full"><div className="text-muted text-sm">Loading customer...</div></div>
  if (error || !customer) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-red text-sm mb-2">Customer not found.</div>
          <button onClick={() => navigate('/customers')} className="text-accent text-sm hover:underline">← Back</button>
        </div>
      </div>
    )
  }

  const hasRentals = (contracts || []).length > 0

  const TABS: { key: CustTab; label: string; show: boolean }[] = [
    { key: 'overview', label: 'Overview', show: true },
    { key: 'systems', label: 'Systems', show: true },
    { key: 'rental', label: 'Rental & Buyout', show: hasRentals },
    { key: 'maintenance', label: 'Maintenance', show: true },
    { key: 'activity', label: 'Activity', show: true },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-shrink-0">
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
        <div className={`stage-badge border ${LIFECYCLE_COLORS[customer.lifecycle_status]}`}>
          {LIFECYCLE_LABELS[customer.lifecycle_status]}
        </div>
      </div>

      {/* Tabs */}
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

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto py-5">
        {activeTab === 'overview' && <CustomerOverviewTab customer={customer} />}
        {activeTab === 'systems' && <InstalledSystemsTab customerId={customer.id} />}
        {activeTab === 'rental' && <RentalBuyoutTab customerId={customer.id} />}
        {activeTab === 'maintenance' && <MaintenanceComplianceTab customerId={customer.id} />}
        {activeTab === 'activity' && <CustomerActivityTab customerId={customer.id} />}
      </div>
    </div>
  )
}
