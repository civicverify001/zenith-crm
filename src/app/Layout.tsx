import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import type { UserRole } from '../types/domain.types'

// ─── Nav items config ─────────────────────────────────────────────
// color: Tailwind color name used for active state
// soon: shows dimmed + "Soon" badge instead of live link
const NAV_ITEMS = [
  { path: '/dashboard',     label: 'Dashboard',      icon: '◉',  color: 'blue',   soon: false, roles: ['admin','frontdesk','salesrep','technician'] as UserRole[] },
  { path: '/leads',         label: 'Pipeline',        icon: '⬡',  color: 'cyan',   soon: false, roles: ['admin','frontdesk','salesrep'] as UserRole[] },
  { path: '/dispatch',      label: 'Dispatch',        icon: '📅', color: 'violet', soon: false, roles: ['admin','frontdesk'] as UserRole[] },
  { path: '/installations', label: 'Installations',   icon: '🔧', color: 'orange', soon: false, roles: ['admin','technician'] as UserRole[] },
  { path: '/customers',     label: 'Customers',       icon: '👥', color: 'green',  soon: false, roles: ['admin','frontdesk','salesrep'] as UserRole[] },
  { path: '/follow-ups',    label: 'Follow-Ups',      icon: '📞', color: 'pink',   soon: false, roles: ['admin','frontdesk','salesrep'] as UserRole[] },
  { path: '/products',      label: 'Products',        icon: '🏷️', color: 'amber',  soon: false, roles: ['admin'] as UserRole[] },
  { path: '/invoices',      label: 'Accounting',      icon: '💰', color: 'yellow', soon: true,  roles: ['admin'] as UserRole[] },
  { path: '/inventory',     label: 'Inventory',       icon: '📦', color: 'teal',   soon: true,  roles: ['admin'] as UserRole[] },
  { path: '/services',      label: 'Plans & Rentals', icon: '🔄', color: 'indigo', soon: true,  roles: ['admin','frontdesk'] as UserRole[] },
  { path: '/marketing',     label: 'Marketing ROI',   icon: '📊', color: 'rose',   soon: true,  roles: ['admin'] as UserRole[] },
  { path: '/reports',       label: 'Reports',         icon: '📈', color: 'sky',    soon: true,  roles: ['admin'] as UserRole[] },
]

// Active color map — bg + text per color name
const ACTIVE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  blue:   { bg: 'bg-blue-500/15',   text: 'text-blue-400',   dot: 'bg-blue-400'   },
  cyan:   { bg: 'bg-cyan-500/15',   text: 'text-cyan-400',   dot: 'bg-cyan-400'   },
  violet: { bg: 'bg-violet-500/15', text: 'text-violet-400', dot: 'bg-violet-400' },
  orange: { bg: 'bg-orange-500/15', text: 'text-orange-400', dot: 'bg-orange-400' },
  green:  { bg: 'bg-green-500/15',  text: 'text-green-400',  dot: 'bg-green-400'  },
  pink:   { bg: 'bg-pink-500/15',   text: 'text-pink-400',   dot: 'bg-pink-400'   },
  amber:  { bg: 'bg-amber-500/15',  text: 'text-amber-400',  dot: 'bg-amber-400'  },
  yellow: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', dot: 'bg-yellow-400' },
  teal:   { bg: 'bg-teal-500/15',   text: 'text-teal-400',   dot: 'bg-teal-400'   },
  indigo: { bg: 'bg-indigo-500/15', text: 'text-indigo-400', dot: 'bg-indigo-400' },
  rose:   { bg: 'bg-rose-500/15',   text: 'text-rose-400',   dot: 'bg-rose-400'   },
  sky:    { bg: 'bg-sky-500/15',    text: 'text-sky-400',    dot: 'bg-sky-400'    },
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin:      'Admin',
  frontdesk:  'Front Desk',
  salesrep:   'Sales Rep',
  technician: 'Technician',
}

const ROLE_COLORS: Record<UserRole, string> = {
  admin:      'bg-blue-500/20 text-blue-400',
  frontdesk:  'bg-violet-500/20 text-violet-400',
  salesrep:   'bg-green-500/20 text-green-400',
  technician: 'bg-orange-500/20 text-orange-400',
}

function Avatar({ name, size = 8 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  const colors = ['bg-blue-500', 'bg-green-500', 'bg-violet-500', 'bg-orange-500', 'bg-teal-500', 'bg-cyan-500']
  const color = colors[name.charCodeAt(0) % colors.length]
  return (
    <div
      className={`${color} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`}
      style={{ width: size * 4, height: size * 4, fontSize: size * 1.6 }}
    >
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

  // Split into live and coming-soon for a visual divider
  const liveItems = visibleNav.filter(i => !i.soon)
  const soonItems = visibleNav.filter(i => i.soon)

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div className="flex h-screen bg-navy overflow-hidden">

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside
        className={`flex flex-col bg-surface border-r border-border transition-all duration-200 ${
          sidebarOpen ? 'w-56' : 'w-16'
        } flex-shrink-0`}
      >

        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-border">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/30">
            <span className="text-white font-black text-sm">Z</span>
          </div>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <div className="text-white font-bold text-sm leading-tight">Zenith Pure</div>
              <div className="text-slate-500 text-xs">Solutions CRM</div>
            </div>
          )}
        </div>

        {/* Nav — Live items */}
        <nav className="flex-1 py-3 overflow-y-auto space-y-0.5">
          {liveItems.map(item => {
            const ac = ACTIVE_COLORS[item.color] ?? ACTIVE_COLORS.blue
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `group flex items-center gap-3 px-3 py-2.5 mx-2 rounded-lg text-sm transition-all ${
                    isActive
                      ? `${ac.bg} ${ac.text} font-semibold`
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {/* Color dot on active */}
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-all ${
                        isActive ? `${ac.dot} shadow-sm` : 'bg-transparent'
                      }`}
                    />
                    <span className="text-base flex-shrink-0 leading-none">{item.icon}</span>
                    {sidebarOpen && <span className="truncate">{item.label}</span>}
                  </>
                )}
              </NavLink>
            )
          })}

          {/* Divider before coming-soon */}
          {soonItems.length > 0 && sidebarOpen && (
            <div className="flex items-center gap-2 px-5 py-2 mt-1">
              <div className="flex-1 h-px bg-border" />
              <span className="text-slate-600 text-xs font-medium uppercase tracking-wider">Coming Soon</span>
              <div className="flex-1 h-px bg-border" />
            </div>
          )}
          {soonItems.length > 0 && !sidebarOpen && (
            <div className="mx-4 my-1 h-px bg-border" />
          )}

          {/* Coming-soon items */}
          {soonItems.map(item => (
            <div
              key={item.path}
              className="flex items-center gap-3 px-3 py-2.5 mx-2 rounded-lg text-sm opacity-40 cursor-not-allowed select-none"
              title={`${item.label} — Coming Soon`}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-transparent" />
              <span className="text-base flex-shrink-0 leading-none">{item.icon}</span>
              {sidebarOpen && (
                <>
                  <span className="truncate text-slate-500">{item.label}</span>
                  <span className="ml-auto text-[9px] font-semibold bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded-full tracking-wide flex-shrink-0">
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
                  <div
                    className={`text-xs px-1.5 py-0.5 rounded font-medium mt-0.5 inline-block ${
                      role ? ROLE_COLORS[role] : ''
                    }`}
                  >
                    {role ? ROLE_LABELS[role] : ''}
                  </div>
                </div>
              )}
            </div>
            {sidebarOpen && (
              <button
                onClick={handleSignOut}
                className="mt-3 w-full text-xs text-slate-500 hover:text-red-400 transition-colors text-left"
              >
                Sign out
              </button>
            )}
          </div>
        )}

        {/* Collapse toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-3 border-t border-border text-slate-500 hover:text-slate-300 transition-colors text-xs"
        >
          {sidebarOpen ? '◀ Collapse' : '▶'}
        </button>
      </aside>

      {/* ── Main content ─────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Topbar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface flex-shrink-0">
          <div className="text-sm text-slate-500">
            Zenith Pure Solutions — Indianapolis, IN
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" title="Connected" />
            <span className="text-xs text-slate-500">Live</span>
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
