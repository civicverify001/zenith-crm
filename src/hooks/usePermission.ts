// usePermission — action-level permissions based on role
// Separate from usePermissions (page-level access control)

type Resource = 'leads' | 'quotes' | 'customers' | 'dispatch' | 'installations' | string
type Action = 'assign_rep' | 'delete' | 'edit' | 'view' | string

const PERMISSIONS: Record<string, Record<string, string[]>> = {
  admin:      { leads: ['assign_rep', 'delete', 'edit', 'view'], quotes: ['edit', 'delete', 'view'], customers: ['edit', 'delete', 'view'], dispatch: ['edit', 'view'], installations: ['edit', 'view'] },
  frontdesk:  { leads: ['assign_rep', 'edit', 'view'], quotes: ['view'], customers: ['edit', 'view'], dispatch: ['view'], installations: ['view'] },
  salesrep:   { leads: ['assign_rep', 'edit', 'view'], quotes: ['edit', 'view'], customers: ['view'], dispatch: [], installations: [] },
  technician: { leads: [], quotes: [], customers: ['view'], dispatch: ['view'], installations: ['edit', 'view'] },
}

export function usePermission(role: string | null) {
  function can(resource: Resource, action: Action): boolean {
    if (!role) return false
    if (role === 'admin') return true
    return PERMISSIONS[role]?.[resource]?.includes(action) ?? false
  }
  return { can }
}
