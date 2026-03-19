import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { usePermissions } from '../hooks/usePermissions'
import { AppLayout } from './Layout'
import { LoginPage } from '../modules/auth/LoginPage'
import { LoadingScreen } from '../shared/ui/LoadingScreen'
import ProductCatalog from '../modules/products/ProductCatalogPage'
import { FollowUpsPage } from '../modules/followups/FollowUpsPage'
import { QuoteReviewPage } from '../modules/public/QuoteReviewPage'
import AdminSettingsPage from '../modules/admin/AdminSettingsPage'
import PublicTermsPage from '../modules/public/PublicTermsPage'
import InventoryPage from '../modules/inventory/InventoryPage'
import UserManagementPage from '../modules/admin/UserManagementPage'
import { MySchedulePage } from '../modules/schedule/MySchedulePage'
import { ConnectCalendarPage } from '../modules/schedule/ConnectCalendarPage'
import ShippingPage from '../modules/shipping/ShippingPage'
import { FulfillmentPage } from '../modules/fulfillment/FulfillmentPage'
import CommunicationsPage from '../modules/communications/CommunicationsPage'

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
import { ReportsPage } from '../modules/reports/ReportsPage'
import { ContractsPage } from '../modules/contracts/ContractsPage'
import ContractDetailPage from '../modules/contracts/ContractDetailPage'
import { InvoicesPage } from '../modules/invoices/InvoicesPage'

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
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 text-3xl"
          style={{ backgroundColor: `${phaseColor}15`, border: `1px solid ${phaseColor}30` }}
        >
          {icon}
        </div>
        <div
          className="inline-block text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider mb-3"
          style={{ backgroundColor: `${phaseColor}15`, color: phaseColor, border: `1px solid ${phaseColor}30` }}
        >
          {phase}
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">{name}</h2>
        <p className="text-sm text-slate-400 mb-6 leading-relaxed">{description}</p>
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

  return (
    <Routes>
      {/* Public routes — no auth required */}
      <Route path="/q/:token" element={<QuoteReviewPage />} />
      <Route path="/terms" element={<PublicTermsPage />} />

      {/* Everything else requires auth */}
      <Route path="/*" element={
        !session ? <LoginPage /> : <AuthenticatedRoutes role={role} />
      } />
    </Routes>
  )
}

// ─── Authenticated Routes (inside AppLayout) ─────────────────────
function AuthenticatedRoutes({ role }: { role: string | null }) {
  const { canAccess } = usePermissions()
  const cs = COMING_SOON_PAGES

  // Helper — wraps a page element with a permission check
  // Admin always bypasses the check
  function guard(path: string, element: React.ReactElement) {
    if (role === 'admin') return element
    return canAccess(path) ? element : <Navigate to="/dashboard" replace />
  }

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />

        {/* Schedule — all roles */}
        <Route path="/schedule" element={<MySchedulePage />} />
        <Route path="/connect-calendar" element={<ConnectCalendarPage />} />

        {/* Pipeline */}
        <Route path="/leads" element={guard('/leads', <LeadPipelinePage />)} />

        {/* Dispatch */}
        <Route path="/dispatch" element={
          role === 'technician'
            ? <Navigate to="/installations" replace />
            : guard('/dispatch', <DispatchBoardPage />)
        } />

        {/* Installations */}
        <Route path="/installations" element={guard('/installations', <InstallationsListPage />)} />
        <Route path="/installations/:jobId" element={guard('/installations', <InstallationDetailPage />)} />
        <Route path="/jobs" element={<Navigate to="/installations" replace />} />

        {/* Customers */}
        <Route path="/customers" element={guard('/customers', <CustomersListPage />)} />
        <Route path="/customers/:customerId" element={guard('/customers', <CustomerDetailPage />)} />

        {/* Follow-Ups */}
        <Route path="/follow-ups" element={guard('/follow-ups', <FollowUpsPage />)} />

        {/* Products */}
        <Route path="/products" element={guard('/products', <ProductCatalog />)} />

        {/* Quotes */}
        <Route path="/quotes" element={guard('/quotes', <QuotesPage />)} />

        {/* Invoices */}
        <Route path="/invoices" element={guard('/invoices', <InvoicesPage />)} />

        {/* Contracts */}
        <Route path="/services" element={guard('/services', <ContractsPage />)} />
        <Route path="/contracts/:id" element={guard('/services', <ContractDetailPage />)} />

        {/* Shipping */}
        <Route path="/shipping" element={guard('/shipping', <ShippingPage />)} />

        {/* Fulfillment Queue */}
        <Route path="/fulfillment" element={guard('/fulfillment', <FulfillmentPage />)} />
        {/* Communications / SMS */}
        <Route path="/communications" element={guard('/communications', <CommunicationsPage />)} />

        {/* Accounting */}
        <Route path="/accounting" element={guard('/accounting', <AccountingPage />)} />

        {/* Inventory */}
        <Route path="/inventory" element={guard('/inventory', <InventoryPage />)} />

        {/* Analytics — coming soon */}
        <Route path="/marketing" element={guard('/marketing', <ComingSoon {...cs.marketing} />)} />
        <Route path="/reports"  element={guard('/reports',  <ReportsPage />)} />

        {/* Admin only */}
        <Route path="/admin/terms" element={
          role === 'admin' ? <AdminSettingsPage /> : <Navigate to="/dashboard" replace />
        } />
        <Route path="/admin/users" element={
          role === 'admin' ? <UserManagementPage /> : <Navigate to="/dashboard" replace />
        } />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppLayout>
  )
}
