import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { usePermissions } from '../hooks/usePermissions'
import { supabase } from '../lib/supabase'
import type { UserRole } from '../types/domain.types'

// ─── Nav items config ─────────────────────────────────────────────
const NAV_ITEMS = [
  { path: '/dashboard',     label: 'Dashboard',      icon: '◉',  hex: '#60a5fa', soon: false, roles: ['admin','frontdesk','salesrep','technician'] as UserRole[] },
  { path: '/schedule',      label: 'My Schedule',    icon: '🗓️', hex: '#34d399', soon: false, roles: ['admin','frontdesk','salesrep','technician'] as UserRole[] },
  { path: '/leads',         label: 'Pipeline',        icon: '⬡',  hex: '#22d3ee', soon: false, roles: ['admin','frontdesk','salesrep'] as UserRole[] },
  { path: '/quotes',        label: 'Quotes',          icon: '📋', hex: '#22d3ee', soon: false, roles: ['admin','frontdesk','salesrep'] as UserRole[] },
  { path: '/invoices',      label: 'Invoices',        icon: '🧾', hex: '#34d399', soon: false, roles: ['admin','frontdesk'] as UserRole[] },
  { path: '/follow-ups',    label: 'Follow-Ups',      icon: '📞', hex: '#f472b6', soon: false, roles: ['admin','frontdesk','salesrep'] as UserRole[] },
  { path: '/dispatch',      label: 'Dispatch',        icon: '📅', hex: '#a78bfa', soon: false, roles: ['admin','frontdesk'] as UserRole[] },
  { path: '/installations', label: 'Installations',   icon: '🔧', hex: '#fb923c', soon: false, roles: ['admin','technician'] as UserRole[] },
  { path: '/customers',     label: 'Customers',       icon: '👥', hex: '#4ade80', soon: false, roles: ['admin','frontdesk','salesrep'] as UserRole[] },
  { path: '/products',      label: 'Products',        icon: '🏷️', hex: '#fbbf24', soon: false, roles: ['admin'] as UserRole[] },
  { path: '/services',      label: 'Contracts',       icon: '📝', hex: '#818cf8', soon: false, roles: ['admin','frontdesk'] as UserRole[] },
  { path: '/admin/terms',   label: 'Admin Settings',  icon: '⚙️', hex: '#8b5cf6', soon: false, roles: ['admin'] as UserRole[] },
  { path: '/accounting',    label: 'Accounting',      icon: '💰', hex: '#facc15', soon: false, roles: ['admin'] as UserRole[] },
  { path: '/inventory',     label: 'Inventory',       icon: '📦', hex: '#2dd4bf', soon: false, roles: ['admin'] as UserRole[] },
  { path: '/admin/users',   label: 'Team & Users',    icon: '👤', hex: '#f87171', soon: false, roles: ['admin'] as UserRole[] },
  { path: '/marketing',     label: 'Marketing ROI',   icon: '📊', hex: '#fb7185', soon: true,  roles: ['admin'] as UserRole[] },
  { path: '/reports',       label: 'Reports',         icon: '📈', hex: '#38bdf8', soon: false,  roles: ['admin'] as UserRole[] },
]

const ROLE_LABELS: Record<UserRole, string> = {
  admin:      'Admin',
  frontdesk:  'Front Desk',
  salesrep:   'Sales Rep',
  technician: 'Technician',
}

const ROLE_HEX: Record<UserRole, string> = {
  admin:      '#60a5fa',
  frontdesk:  '#a78bfa',
  salesrep:   '#4ade80',
  technician: '#fb923c',
}

function Avatar({ name, size = 8 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  const colors = ['#3b82f6','#22c55e','#8b5cf6','#f97316','#14b8a6','#06b6d4']
  const color = colors[name.charCodeAt(0) % colors.length]
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
      style={{ width: size * 4, height: size * 4, fontSize: size * 1.6, backgroundColor: color }}
    >
      {initials}
    </div>
  )
}

// ─── Sidebar inner content (shared between desktop + mobile drawer) ──
function SidebarContent({
  visibleNav, profile, role, sidebarOpen, onClose, onSignOut,
}: {
  visibleNav: typeof NAV_ITEMS
  profile: any
  role: UserRole | null
  sidebarOpen: boolean
  onClose: () => void
  onSignOut: () => void
}) {
  const liveItems = visibleNav.filter(i => !i.soon)
  const soonItems = visibleNav.filter(i => i.soon)

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-border">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: '#3b82f6', boxShadow: '0 0 14px #3b82f650' }}
        >
          <span className="text-white font-black text-sm">Z</span>
        </div>
        {sidebarOpen && (
          <div className="overflow-hidden">
            <div className="text-white font-bold text-sm leading-tight">Zenith Pure</div>
            <div className="text-slate-500 text-xs">Solutions CRM</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {liveItems.map(item => (
          <NavLink key={item.path} to={item.path} className="block" onClick={onClose}>
            {({ isActive }) => (
              <div
                className="flex items-center gap-3 px-3 py-2.5 mx-2 mb-0.5 rounded-lg text-sm transition-all"
                style={isActive
                  ? { backgroundColor: `${item.hex}1a`, color: item.hex, fontWeight: 600 }
                  : { color: '#94a3b8' }
                }
                onMouseEnter={e => {
                  if (!isActive) {
                    const el = e.currentTarget as HTMLDivElement
                    el.style.backgroundColor = 'rgba(255,255,255,0.05)'
                    el.style.color = '#e2e8f0'
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    const el = e.currentTarget as HTMLDivElement
                    el.style.backgroundColor = 'transparent'
                    el.style.color = '#94a3b8'
                  }
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: isActive ? item.hex : 'transparent' }}
                />
                <span className="text-base flex-shrink-0 leading-none">{item.icon}</span>
                {sidebarOpen && <span className="truncate">{item.label}</span>}
              </div>
            )}
          </NavLink>
        ))}

        {soonItems.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 mt-2">
            <div className="flex-1 h-px bg-border" />
            {sidebarOpen && (
              <span className="text-slate-600 text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
                Coming Soon
              </span>
            )}
            <div className="flex-1 h-px bg-border" />
          </div>
        )}

        {soonItems.map(item => (
          <div
            key={item.path}
            className="flex items-center gap-3 px-3 py-2.5 mx-2 mb-0.5 rounded-lg text-sm select-none"
            style={{ opacity: 0.38, cursor: 'not-allowed', color: '#94a3b8' }}
          >
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" />
            <span className="text-base flex-shrink-0 leading-none">{item.icon}</span>
            {sidebarOpen && (
              <>
                <span className="truncate">{item.label}</span>
                <span
                  className="ml-auto font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                  style={{ fontSize: '9px', letterSpacing: '0.05em', backgroundColor: '#1e293b', color: '#64748b' }}
                >
                  SOON
                </span>
              </>
            )}
          </div>
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
                {role && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded font-semibold mt-0.5 inline-block"
                    style={{ backgroundColor: `${ROLE_HEX[role]}20`, color: ROLE_HEX[role] }}
                  >
                    {ROLE_LABELS[role]}
                  </span>
                )}
              </div>
            )}
          </div>
          {sidebarOpen && (
            <button
              onClick={onSignOut}
              className="mt-3 w-full text-xs text-left"
              style={{ color: '#64748b' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
              onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}
            >
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main layout ──────────────────────────────────────────────────
export function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, role } = useAuth()
  const { canAccess, allowedPages } = usePermissions()
  const navigate = useNavigate()

  // Desktop: sidebar collapsed/expanded
  const [sidebarOpen, setSidebarOpen] = useState(true)
  // Mobile: drawer open/closed (always starts closed)
  const [mobileOpen, setMobileOpen] = useState(false)

  const visibleNav = NAV_ITEMS.filter(item => {
    if (!role) return false
    if (role === 'admin') return item.roles.includes(role)
    if (allowedPages) return canAccess(item.path)
    return item.roles.includes(role)
  })

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div className="flex h-screen bg-navy overflow-hidden">

      {/* ── Mobile overlay backdrop ──────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile drawer ────────────────────────────────── */}
      <div
        className="fixed inset-y-0 left-0 z-50 w-64 bg-surface border-r border-border md:hidden transition-transform duration-250"
        style={{ transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)' }}
      >
        {/* Close button */}
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white"
          style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
        >
          ✕
        </button>
        <SidebarContent
          visibleNav={visibleNav}
          profile={profile}
          role={role}
          sidebarOpen={true}
          onClose={() => setMobileOpen(false)}
          onSignOut={handleSignOut}
        />
      </div>

      {/* ── Desktop sidebar ──────────────────────────────── */}
      <aside
        className={`hidden md:flex flex-col bg-surface border-r border-border transition-all duration-200 flex-shrink-0 ${sidebarOpen ? 'w-56' : 'w-16'}`}
      >
        <SidebarContent
          visibleNav={visibleNav}
          profile={profile}
          role={role}
          sidebarOpen={sidebarOpen}
          onClose={() => {}}
          onSignOut={handleSignOut}
        />
        {/* Desktop collapse toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-3 border-t border-border text-xs"
          style={{ color: '#64748b' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#cbd5e1')}
          onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}
        >
          {sidebarOpen ? '◀ Collapse' : '▶'}
        </button>
      </aside>

      {/* ── Main content ─────────────────────────────────── */}
      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface flex-shrink-0">
          <div className="flex items-center gap-3">
            {/* Hamburger — mobile only */}
            <button
              className="md:hidden flex flex-col gap-1.5 p-1"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <span className="block w-5 h-0.5 rounded" style={{ backgroundColor: '#94a3b8' }} />
              <span className="block w-5 h-0.5 rounded" style={{ backgroundColor: '#94a3b8' }} />
              <span className="block w-5 h-0.5 rounded" style={{ backgroundColor: '#94a3b8' }} />
            </button>
            <div className="text-sm text-slate-500">Zenith Pure Solutions — Indianapolis, IN</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: '#4ade80' }} />
            <span className="text-xs text-slate-500">Live</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col min-h-0 p-4 md:p-6">
          {children}
        </div>
      </main>
    </div>
  )
}
