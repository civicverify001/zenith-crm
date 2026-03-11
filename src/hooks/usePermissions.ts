// src/hooks/usePermissions.ts
// Reads allowed pages from user metadata.
// If user has a custom 'pages' array set by admin, use it.
// If not set, fall back to role defaults (all pages for that role).

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// All pages in the system grouped by category
export const ALL_PAGES = [
  // Core
  { path: '/dashboard',    label: 'Dashboard',     group: 'Core',       icon: '🏠' },
  // Sales
  { path: '/leads',        label: 'Pipeline',       group: 'Sales',      icon: '🔵' },
  { path: '/quotes',       label: 'Quotes',         group: 'Sales',      icon: '📋' },
  { path: '/invoices',     label: 'Invoices',       group: 'Sales',      icon: '📄' },
  { path: '/follow-ups',   label: 'Follow-Ups',     group: 'Sales',      icon: '❤️' },
  // Operations
  { path: '/customers',    label: 'Customers',      group: 'Operations', icon: '👥' },
  { path: '/dispatch',     label: 'Dispatch',       group: 'Operations', icon: '📌' },
  { path: '/installations',label: 'Installations',  group: 'Operations', icon: '🔧' },
  { path: '/products',     label: 'Products',       group: 'Operations', icon: '⭐' },
  { path: '/services',     label: 'Contracts',      group: 'Operations', icon: '📜' },
  // Finance
  { path: '/accounting',   label: 'Accounting',     group: 'Finance',    icon: '💰' },
  { path: '/inventory',    label: 'Inventory',      group: 'Finance',    icon: '📦' },
  // Analytics
  { path: '/marketing',    label: 'Marketing ROI',  group: 'Analytics',  icon: '📊' },
  { path: '/reports',      label: 'Reports',        group: 'Analytics',  icon: '📈' },
  // Admin
  { path: '/admin/terms',  label: 'Terms & Docs',   group: 'Admin',      icon: '📝' },
  { path: '/admin/users',  label: 'Team & Users',   group: 'Admin',      icon: '👤' },
]

// Default pages per role (used when admin hasn't set custom pages)
export const ROLE_DEFAULT_PAGES: Record<string, string[]> = {
  admin: ALL_PAGES.map(p => p.path), // admin sees everything
  frontdesk: [
    '/dashboard', '/leads', '/follow-ups', '/customers',
    '/invoices', '/dispatch',
  ],
  salesrep: [
    '/dashboard', '/leads', '/quotes', '/follow-ups', '/customers',
  ],
  technician: [
    '/dashboard', '/installations', '/dispatch',
  ],
}

export function usePermissions() {
  const [allowedPages, setAllowedPages] = useState<string[] | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { setLoading(false); return }

      const userRole = user.user_metadata?.role || user.app_metadata?.role || null
      setRole(userRole)

      // If admin has set custom pages, use those
      const customPages: string[] | undefined = user.user_metadata?.pages
      if (customPages && Array.isArray(customPages)) {
        setAllowedPages(customPages)
      } else {
        // Fall back to role defaults
        setAllowedPages(ROLE_DEFAULT_PAGES[userRole || ''] || ['/dashboard'])
      }
      setLoading(false)
    })

    // Re-check on auth state change (after sign-in)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) { setAllowedPages(null); setLoading(false); return }
      const user = session.user
      const userRole = user.user_metadata?.role || user.app_metadata?.role || null
      setRole(userRole)
      const customPages: string[] | undefined = user.user_metadata?.pages
      if (customPages && Array.isArray(customPages)) {
        setAllowedPages(customPages)
      } else {
        setAllowedPages(ROLE_DEFAULT_PAGES[userRole || ''] || ['/dashboard'])
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const canAccess = (path: string) => {
    if (!allowedPages) return false
    // Admin always has full access regardless
    if (role === 'admin') return true
    return allowedPages.includes(path)
  }

  return { allowedPages, role, loading, canAccess }
}
