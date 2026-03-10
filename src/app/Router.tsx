import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { AppLayout } from './Layout'
import { LoginPage } from '../modules/auth/LoginPage'
import { LoadingScreen } from '../shared/ui/LoadingScreen'
import ProductCatalog from '../services/ProductCatalog'
import { FollowUpsPage } from '../modules/followups/FollowUpsPage'

// ─── Module pages ────────────────────────────────────────────────
import { DashboardPage } from '../modules/dashboard/DashboardPage'
import { LeadPipelinePage } from '../modules/leads/LeadPipelinePage'
import { DispatchBoardPage } from '../modules/dispatch/DispatchBoardPage'
import { InstallationsListPage } from '../modules/installations/InstallationsListPage'
import { InstallationDetailPage } from '../modules/installations/InstallationDetailPage'
import { CustomersListPage } from '../modules/customers/CustomersListPage'
import { CustomerDetailPage } from '../modules/customers/CustomerDetailPage'
import { QuotesPage } from '../modules/quotes/QuotesPage'
import { AccountingPage } from '../modules/accounting/AccountingPage'

// ─── Phase-aware ComingSoon placeholder ─────────────────────────
interface ComingSoonProps {
  name: string
  icon: string
  phase: string
  phaseColor: string
  description: string
  features: string[]
  dependsOn?: string
}

function ComingSoon({ name, icon, phase, phaseColor, description, features, dependsOn }: ComingSoonProps) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="max-w-md w-full mx-auto text-center px-6">

        {/* Icon */}
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 text-3xl"
          style={{ backgroundColor: `${phaseColor}15`, border: `1px solid ${phaseColor}30` }}
        >
          {icon}
        </div>

        {/* Phase badge */}
        <div
          className="inline-block text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider mb-3"
          style={{ backgroundColor: `${phaseColor}15`, color: phaseColor, border: `1px solid ${phaseColor}30` }}
        >
          {phase}
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold text-white mb-2">{name}</h2>
        <p className="text-sm text-slate-400 mb-6 leading-relaxed">{description}</p>

        {/* Features list */}
        <div
          className="rounded-xl p-4 text-left mb-5 space-y-2"
          style={{ backgroundColor: 'rgba(148,163,184,0.05)', border: '1px solid rgba(148,163,184,0.12)' }}
        >
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">What's included</div>
          {features.map((f, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <span className="text-xs mt-0.5 flex-shrink-0" style={{ color: phaseColor }}>◆</span>
              <span className="text-sm text-slate-400">{f}</span>
            </div>
          ))}
        </div>

        {/* Depends on */}
        {dependsOn && (
          <div
            className="text-xs rounded-lg px-3 py-2 text-slate-500"
            style={{ backgroundColor: 'rgba(148,163,184,0.05)', border: '1px solid rgba(148,163,184,0.1)' }}
          >
            🔗 Requires <span className="text-slate-400 font-medium">{dependsOn}</span> to be complete first
          </div>
        )}

      </div>
    </div>
  )
}

// ─── Per-module configs ──────────────────────────────────────────
const COMING_SOON_PAGES = {
  accounting: {
    name: 'Accounting',
    icon: '💰',
    phase: 'Phase 1 — Billing & Payments',
    phaseColor: '#facc15',
    description: 'Revenue summaries, receivables aging, Stripe reconciliation, and export to QuickBooks or Xero. Reads from billing — never initiates charges.',
    features: [
      'Payment transaction log with Stripe reconciliation',
      'Outstanding receivables & aging buckets',
      'Monthly recurring revenue (MRR) dashboard',
      'Failed payment tracking & retry management',
      'CSV / QBO export for QuickBooks or Xero',
    ],
    dependsOn: 'Billing & Stripe integration (Phase 1)',
  },
  inventory: {
    name: 'Inventory',
    icon: '📦',
    phase: 'Future Phase',
    phaseColor: '#2dd4bf',
    description: 'Track stock levels for filters, parts, and equipment. Know what\'s on hand, what\'s low, and what needs to be ordered before jobs are scheduled.',
    features: [
      'Stock levels per product SKU',
      'Low stock alerts and reorder triggers',
      'Parts consumed per installation job',
      'Supplier order tracking',
      'Integration with Product Catalog',
    ],
    dependsOn: 'Product Catalog (live) + Shipping module (Phase 3)',
  },
  services: {
    name: 'Plans & Rentals',
    icon: '🔄',
    phase: 'Phase 2 — Contracts & Documents',
    phaseColor: '#818cf8',
    description: 'Manage all active rental contracts, maintenance plans, and service agreements in one place. See renewals, billing status, and plan compliance at a glance.',
    features: [
      'All active rental contracts with status & billing',
      'Maintenance plan enrollment and renewal tracking',
      'Contract renewals due in the next 30/60/90 days',
      'Buyout pipeline — customers close to ownership',
      'Plan compliance by customer and system type',
    ],
    dependsOn: 'Contracts & Terms engine (Phase 2)',
  },
  marketing: {
    name: 'Marketing ROI',
    icon: '📊',
    phase: 'Phase 5 — Marketing & Audiences',
    phaseColor: '#fb7185',
    description: 'Track which channels generate the best customers. See revenue by lead source, cost per acquisition, and lifetime value by campaign — once billing data flows.',
    features: [
      'Leads by source: Google Ads, Facebook, referral, door knock',
      'Conversion rate per source (lead → customer)',
      'Revenue attributed per lead source',
      'Campaign spend vs revenue (Phase 5)',
      'Full ROI per channel: spend ÷ revenue generated',
    ],
    dependsOn: 'Source tracking (live) + Billing revenue data (Phase 1)',
  },
  reports: {
    name: 'Reports',
    icon: '📈',
    phase: 'Phase 5 — Reports & Analytics',
    phaseColor: '#38bdf8',
    description: 'Operational and financial reporting across all modules. KPIs, trends, team performance, and customer lifecycle metrics — all read-only aggregation, no data entry.',
    features: [
      'Pipeline conversion funnel & close rates',
      'Installation volume and technician performance',
      'Customer lifecycle: active, at risk, churned',
      'Revenue trends: MRR, churn rate, ARPU',
      'Service compliance and overdue schedule rates',
    ],
    dependsOn: 'All core modules live + billing data flowing',
  },
}

// ─── Router ──────────────────────────────────────────────────────
export function AppRouter() {
  const { session, role, loading } = useAuth()

  if (loading) return <LoadingScreen />
  if (!session) return <LoginPage />

  const cs = COMING_SOON_PAGES

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />

        {/* Pipeline */}
        <Route path="/leads" element={<LeadPipelinePage />} />

        {/* Dispatch */}
        <Route path="/dispatch" element={
          role === 'technician' ? <Navigate to="/installations" replace /> : <DispatchBoardPage />
        } />

        {/* Installations */}
        <Route path="/installations" element={<InstallationsListPage />} />
        <Route path="/installations/:jobId" element={<InstallationDetailPage />} />
        <Route path="/jobs" element={<Navigate to="/installations" replace />} />

        {/* Customers */}
        <Route path="/customers" element={<CustomersListPage />} />
        <Route path="/customers/:customerId" element={<CustomerDetailPage />} />

        {/* Follow-Ups */}
        <Route path="/follow-ups" element={<FollowUpsPage />} />

        {/* Products */}
        <Route path="/products" element={<ProductCatalog />} />

        {/* Quotes */}
        <Route path="/quotes" element={<QuotesPage />} />

        {/* Coming Soon — Phase-aware placeholders */}
        <Route path="/accounting" element={<AccountingPage />} />
        <Route path="/invoices"   element={<ComingSoon {...cs.accounting} />} />
        <Route path="/inventory"  element={<ComingSoon {...cs.inventory} />} />
        <Route path="/services"   element={<ComingSoon {...cs.services} />} />
        <Route path="/marketing"  element={<ComingSoon {...cs.marketing} />} />
        <Route path="/reports"    element={<ComingSoon {...cs.reports} />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppLayout>
  )
}
