import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { usePermission } from '../hooks/usePermission'
import { supabase } from '../lib/supabase'
import type { UserRole } from '../types/domain.types'

// ─── Nav items config ─────────────────────────────────────────────
const NAV_ITEMS = [
  { path: '/dashboard',      label: 'Dashboard',        icon: '◉',  roles: ['admin','frontdesk','salesrep','technician'] as UserRole[] },
  { path: '/leads',          label: 'Pipeline',          icon: '⬡',  roles: ['admin','frontdesk','salesrep'] as UserRole[] },
  { path: '/dispatch',       label: 'Dispatch',          icon: '📅', roles: ['admin','frontdesk'] as UserRole[] },
  { path: '/installations',  label: 'Installations',     icon: '🔧', roles: ['admin','technician'] as UserRole[] },
  { path: '/customers',      label: 'Customers',         icon: '👥', roles: ['admin','frontdesk','salesrep'] as UserRole[] },
  { path: '/follow-ups',     label: 'Follow-Ups',        icon: '📞', roles: ['admin','frontdesk','salesrep'] as UserRole[] },
  { path: '/invoices',       label: 'Accounting',        icon: '💰', roles: ['admin'] as UserRole[] },
  { path: '/inventory',      label: 'Inventory',         icon: '📦', roles: ['admin'] as UserRole[] },
  { path: '/services',       label: 'Plans & Rentals',   icon: '🔄', roles: ['admin','frontdesk'] as UserRole[] },
  { path: '/products',      label: 'Products',          icon: '🏷️', roles: ['admin'] as UserRole[] },
  { path: '/marketing',      label: 'Marketing ROI',     icon: '📊', roles: ['admin'] as UserRole[] },
  { path: '/reports',        label: 'Reports',           icon: '📈', roles: ['admin'] as UserRole[] },
]

const ROLE_LABELS: Record<UserRole, string> = {
  admin:       'Admin',
  frontdesk:   'Front Desk',
  salesrep:    'Sales Rep',
  technician:  'Technician',
}

const ROLE_COLORS: Record<UserRole, string> = {
  admin:       'bg-accent/20 text-accent',
  frontdesk:   'bg-purple/20 text-purple',
  salesrep:    'bg-green/20 text-green',
  technician:  'bg-orange/20 text-orange',
}

function Avatar({ name, size = 8 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  const colors = ['bg-accent', 'bg-green', 'bg-purple', 'bg-orange', 'bg-teal', 'bg-cyan']
  const color = colors[name.charCodeAt(0) % colors.length]
  return (
    <div className={`${color} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`}
         style={{ width: size * 4, height: size * 4, fontSize: size * 1.6 }}>
      {initials}
    </div>
  )
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, role } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const visibleNav = NAV_ITEMS.filter(item =>
    role && item.roles.includes(role)
  )

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div className="flex h-screen bg-navy overflow-hidden">

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className={`flex flex-col bg-surface border-r border-border transition-all duration-200 ${sidebarOpen ? 'w-56' : 'w-16'} flex-shrink-0`}>

        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-border">
          <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white font-black text-sm">Z</span>
          </div>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <div className="text-white font-bold text-sm leading-tight">Zenith Pure</div>
              <div className="text-muted text-xs">Solutions CRM</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto">
          {visibleNav.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-accent/15 text-accent font-semibold'
                    : 'text-muted hover:text-slate-200 hover:bg-white/5'
                }`
              }
            >
              <span className="text-base flex-shrink-0">{item.icon}</span>
              {sidebarOpen && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User info */}
        {profile && (
          <div className="p-3 border-t border-border">
            <div className="flex items-center gap-2">
              <Avatar name={profile.full_name} size={8} />
              {sidebarOpen && (
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-200 truncate">{profile.full_name}</div>
                  <div className={`text-xs px-1.5 py-0.5 rounded font-medium mt-0.5 inline-block ${role ? ROLE_COLORS[role] : ''}`}>
                    {role ? ROLE_LABELS[role] : ''}
                  </div>
                </div>
              )}
            </div>
            {sidebarOpen && (
              <button
                onClick={handleSignOut}
                className="mt-3 w-full text-xs text-muted hover:text-red transition-colors text-left"
              >
                Sign out
              </button>
            )}
          </div>
        )}

        {/* Collapse toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-3 border-t border-border text-muted hover:text-slate-200 transition-colors text-xs"
        >
          {sidebarOpen ? '◀ Collapse' : '▶'}
        </button>
      </aside>

      {/* ── Main content ─────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Topbar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface flex-shrink-0">
          <div className="text-sm text-muted">
            Zenith Pure Solutions — Indianapolis, IN
          </div>
          <div className="flex items-center gap-4">
            <div className="w-2 h-2 rounded-full bg-green animate-pulse" title="Connected" />
            <span className="text-xs text-muted">Live</span>
          </div>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-auto p-6">
          {children}
        </div>
      </main>
    </div>
  )
}
