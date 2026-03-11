import { useAuth } from './useAuth'

type Resource = string
type Action = string

// Action-level permission matrix
const PERMISSIONS: Record<string, Record<string, string[]>> = {
  admin:      { leads: ['assign_rep', 'create', 'delete', 'edit', 'view'], quotes: ['edit', 'delete', 'view'], customers: ['edit', 'delete', 'view'], dispatch: ['edit', 'view'], installations: ['edit', 'view'] },
  frontdesk:  { leads: ['assign_rep', 'create', 'edit', 'view'], quotes: ['view'], customers: ['edit', 'view'], dispatch: ['view'], installations: ['view'] },
  salesrep:   { leads: ['assign_rep', 'create', 'edit', 'view'], quotes: ['edit', 'view'], customers: ['view'], dispatch: [], installations: [] },
  technician: { leads: [], quotes: [], customers: ['view'], dispatch: ['view'], installations: ['edit', 'view'] },
}

// Page-level defaults per role
export const ALL_PAGES = [
  '/dashboard', '/leads', '/customers', '/quotes', '/invoices',
  '/dispatch', '/installations', '/follow-ups', '/products',
  '/contracts', '/terms', '/service', '/reports', '/inventory',
  '/admin/users', '/settings',
]

export const ROLE_DEFAULT_PAGES: Record<string, string[]> = {
  admin:      ALL_PAGES,
  frontdesk:  ['/dashboard', '/leads', '/customers', '/follow-ups', '/quotes', '/invoices'],
  salesrep:   ['/dashboard', '/leads', '/customers', '/quotes', '/follow-ups'],
  technician: ['/dashboard', '/dispatch', '/installations'],
}

export function usePermissions(roleOverride?: string | null) {
  const { user, profile } = useAuth()

  const role = roleOverride ?? profile?.role ?? (user?.user_metadata?.role as string | undefined) ?? null

  // Page-level: custom pages from user metadata, or role defaults
  const customPages: string[] | null = user?.user_metadata?.pages ?? null
  const allowedPages: string[] | null = customPages ?? (role ? (ROLE_DEFAULT_PAGES[role] ?? null) : null)

  function canAccess(path: string): boolean {
    if (role === 'admin') return true
    if (!allowedPages) return false
    return allowedPages.some(p => path.startsWith(p))
  }

  // Action-level (same as usePermission)
  function can(resource: Resource, action: Action): boolean {
    if (!role) return false
    if (role === 'admin') return true
    return PERMISSIONS[role]?.[resource]?.includes(action) ?? false
  }

  return { canAccess, allowedPages, can, role }
}
