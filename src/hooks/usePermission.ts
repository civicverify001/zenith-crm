import type { UserRole } from '../types/domain.types'

// ─── Permission map ───────────────────────────────────────────────
// Each key is a module. Values map action → roles that can perform it.
const PERMISSIONS: Record<string, Record<string, UserRole[]>> = {
  leads: {
    view:       ['admin', 'frontdesk', 'salesrep'],
    create:     ['admin', 'frontdesk', 'salesrep'],
    qualify:    ['admin', 'frontdesk'],
    assign_rep: ['admin', 'frontdesk'],
    edit_own:   ['admin', 'salesrep'],
    view_all:   ['admin', 'frontdesk'],
  },
  water_tests: {
    create:     ['admin', 'salesrep'],
    view:       ['admin', 'salesrep'],
  },
  quotes: {
    create:     ['admin', 'salesrep'],
    send:       ['admin', 'salesrep'],
    view:       ['admin', 'salesrep'],
  },
  agreements: {
    sign:       ['admin', 'salesrep'],
    view:       ['admin', 'salesrep'],
  },
  jobs: {
    view:       ['admin', 'salesrep', 'technician'],
    assign:     ['admin'],
    update_checklist: ['admin', 'technician'],
    capture_signature: ['admin', 'technician'],
    mark_complete: ['admin', 'technician'],
  },
  dispatch: {
    view:       ['admin', 'technician'],
    manage:     ['admin'],
  },
  customers: {
    view:       ['admin', 'frontdesk', 'salesrep'],
    view_all:   ['admin', 'frontdesk'],
    edit:       ['admin', 'frontdesk', 'salesrep'],
    sell_filters: ['admin', 'frontdesk', 'salesrep'],
  },
  follow_ups: {
    view:       ['admin', 'frontdesk', 'salesrep'],
    manage:     ['admin', 'frontdesk', 'salesrep'],
  },
  invoices: {
    view:       ['admin'],
    manage:     ['admin'],
  },
  inventory: {
    view:       ['admin'],
    manage:     ['admin'],
    create_po:  ['admin'],
  },
  plans_rentals: {
    view:       ['admin', 'frontdesk'],
    manage:     ['admin'],
  },
  marketing: {
    view:       ['admin'],
  },
  reports: {
    view:       ['admin'],
  },
  admin_panel: {
    access:     ['admin'],
  },
}

// ─── Hook ─────────────────────────────────────────────────────────
export function usePermission(role: UserRole | null) {
  /**
   * can('leads', 'create') → boolean
   */
  function can(module: string, action: string): boolean {
    if (!role) return false
    const modulePerms = PERMISSIONS[module]
    if (!modulePerms) return false
    const allowed = modulePerms[action]
    if (!allowed) return false
    return allowed.includes(role)
  }

  /**
   * canAny('leads', ['view', 'create']) → boolean
   * Returns true if user can do ANY of the listed actions
   */
  function canAny(module: string, actions: string[]): boolean {
    return actions.some(action => can(module, action))
  }

  return { can, canAny }
}
