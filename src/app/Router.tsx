import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { AppLayout } from './Layout'
import { LoginPage } from '../modules/auth/LoginPage'
import { LoadingScreen } from '../shared/ui/LoadingScreen'
import ProductCatalog from '../services/ProductCatalog'

// ─── Module pages ────────────────────────────────────────────────
import { DashboardPage } from '../modules/dashboard/DashboardPage'
import { LeadPipelinePage } from '../modules/leads/LeadPipelinePage'
import { DispatchBoardPage } from '../modules/dispatch/DispatchBoardPage'
import { InstallationsListPage } from '../modules/installations/InstallationsListPage'
import { InstallationDetailPage } from '../modules/installations/InstallationDetailPage'
import { CustomersListPage } from '../modules/customers/CustomersListPage'
import { CustomerDetailPage } from '../modules/customers/CustomerDetailPage'

// Placeholder for modules not yet built
const ComingSoon = ({ name }: { name: string }) => (
  <div className="flex items-center justify-center h-full">
    <div className="text-center">
      <div className="text-4xl mb-4">🚧</div>
      <div className="text-xl font-semibold text-slate-300">{name}</div>
      <div className="text-sm text-muted mt-2">Coming in next phase</div>
    </div>
  </div>
)

export function AppRouter() {
  const { session, role, loading } = useAuth()

  if (loading) return <LoadingScreen />
  if (!session) return <LoginPage />

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />

        {/* Pipeline — admin, frontdesk, salesrep */}
        <Route path="/leads" element={<LeadPipelinePage />} />

        {/* Dispatch — admin, frontdesk (technicians redirected to /installations) */}
        <Route path="/dispatch" element={
          role === 'technician' ? <Navigate to="/installations" replace /> : <DispatchBoardPage />
        } />

        {/* Installations — admin, technician */}
        <Route path="/installations" element={<InstallationsListPage />} />
        <Route path="/installations/:jobId" element={<InstallationDetailPage />} />

        {/* Legacy route — redirect /jobs to /installations */}
        <Route path="/jobs" element={<Navigate to="/installations" replace />} />

        {/* Future modules */}
        <Route path="/customers" element={<CustomersListPage />} />
        <Route path="/customers/:customerId" element={<CustomerDetailPage />} />
        <Route path="/follow-ups" element={<ComingSoon name="Follow-Up Center" />} />
        <Route path="/invoices" element={<ComingSoon name="Accounting" />} />
        <Route path="/inventory" element={<ComingSoon name="Inventory" />} />
        <Route path="/services" element={<ComingSoon name="Plans & Rentals" />} />
        <Route path="/products" element={<ProductCatalog />} />
        <Route path="/marketing" element={<ComingSoon name="Marketing ROI" />} />
        <Route path="/reports" element={<ComingSoon name="Reports" />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppLayout>
  )
}
