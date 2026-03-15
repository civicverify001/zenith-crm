vimport { useAuth } from './useAuth'

type Resource = string
type Action = string

// Action-level permission matrix
const PERMISSIONS: Record<string, Record<string, string[]>> = {
  admin:      { leads: ['assign_rep', 'create', 'delete', 'edit', 'view'], quotes: ['edit', 'delete', 'view'], customers: ['edit', 'delete', 'view'], dispatch: ['edit', 'view'], installations: ['edit', 'view'], service_plans: ['create', 'edit', 'delete', 'view', 'manage_templates', 'override_price'] },
  frontdesk:  { leads: ['assign_rep', 'create', 'edit', 'view'], quotes: ['view'], customers: ['edit', 'view'], dispatch: ['view'], installations: ['view'], service_plans: ['create', 'view', 'pause'] },
  salesrep:   { leads: ['assign_rep', 'create', 'edit', 'view'], quotes: ['edit', 'view'], customers: ['view'], dispatch: [], installations: [], service_plans: ['create', 'view'] },
  technician: { leads: [], quotes: [], customers: ['view'], dispatch: ['view'], installations: ['edit', 'view'], service_plans: ['view'] },
}

// Page definitions with group, icon, label
export const ALL_PAGES = [
  // Core
  { path: '/dashboard',     group: 'Core',       icon: '🏠', label: 'Dashboard' },
  { path: '/customers',     group: 'Core',       icon: '👥', label: 'Customers' },
  { path: '/follow-ups',    group: 'Core',       icon: '✅', label: 'Follow-Ups' },
  // Sales
  { path: '/leads',         group: 'Sales',      icon: '🎯', label: 'Lead Pipeline' },
  { path: '/quotes',        group: 'Sales',      icon: '📄', label: 'Quotes' },
  { path: '/contracts',     group: 'Sales',      icon: '📝', label: 'Contracts' },
  // Operations
  { path: '/dispatch',      group: 'Operations', icon: '🗺️',  label: 'Dispatch' },
  { path: '/installations', group: 'Operations', icon: '🔧', label: 'Installations' },
  { path: '/service',       group: 'Operations', icon: '⚙️',  label: 'Service' },
  { path: '/inventory',     group: 'Operations', icon: '📦', label: 'Inventory' },
  // Finance
  { path: '/invoices',      group: 'Finance',    icon: '💰', label: 'Invoices' },
  // Analytics
  { path: '/reports',       group: 'Analytics',  icon: '📊', label: 'Reports' },
  // Admin
  { path: '/products',      group: 'Admin',      icon: '🛒', label: 'Products' },
  { path: '/terms',         group: 'Admin',      icon: '📋', label: 'Terms' },
  { path: '/settings',      group: 'Admin',      icon: '⚙️',  label: 'Settings' },
  { path: '/admin/users',   group: 'Admin',      icon: '👤', label: 'Team & Users' },
]

export const ROLE_DEFAULT_PAGES: Record<string, string[]> = {
  admin:      ALL_PAGES.map(p => p.path),
  frontdesk:  ['/dashboard', '/leads', '/customers', '/follow-ups', '/quotes', '/invoices'],
  salesrep:   ['/dashboard', '/leads', '/customers', '/quotes', '/follow-ups'],
  technician: ['/dashboard', '/dispatch', '/installations'],
}

export function usePermissions(roleOverride?: string | null) {
  const { user, profile } = useAuth()

  const role = roleOverride ?? profile?.role ?? (user?.user_metadata?.role as string | undefined) ?? null

  // Custom pages set by admin, or fall back to role defaults
  const customPages: string[] | null = user?.user_metadata?.pages ?? null
  const allowedPages: string[] | null = customPages ?? (role ? (ROLE_DEFAULT_PAGES[role] ?? null) : null)

  // Page-level access check
  function canAccess(path: string): boolean {
    if (role === 'admin') return true
    if (!allowedPages) return false
    return allowedPages.some(p => path.startsWith(p))
  }

  // Action-level access check
  function can(resource: Resource, action: Action): boolean {
    if (!role) return false
    if (role === 'admin') return true
    return PERMISSIONS[role]?.[resource]?.includes(action) ?? false
  }

  return { canAccess, allowedPages, can, role }
}
