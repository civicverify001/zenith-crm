import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { usePermissions } from '../hooks/usePermissions'
import { supabase } from '../lib/supabase'
import type { UserRole } from '../types/domain.types'

// ─── Nav items with groups ────────────────────────────────────────
interface NavItem {
  path: string
  label: string
  icon: string
  hex: string
  group: string
  soon: boolean
  roles: UserRole[]
}

const NAV_ITEMS: NavItem[] = [
  // Core
  { path: '/dashboard',     label: 'Dashboard',    icon: '◉',  hex: '#60a5fa', group: 'Core',       soon: false, roles: ['admin','frontdesk','salesrep','technician'] },
  { path: '/schedule',      label: 'My Schedule',  icon: '🗓️', hex: '#34d399', group: 'Core',       soon: false, roles: ['admin','frontdesk','salesrep','technician'] },
  { path: '/customers',     label: 'Customers',    icon: '👥', hex: '#4ade80', group: 'Core',       soon: false, roles: ['admin','frontdesk','salesrep'] },
  { path: '/follow-ups',    label: 'Follow-Ups',   icon: '📞', hex: '#f472b6', group: 'Core',       soon: false, roles: ['admin','frontdesk','salesrep'] },
  // Sales
  { path: '/leads',         label: 'Pipeline',     icon: '⬡',  hex: '#22d3ee', group: 'Sales',      soon: false, roles: ['admin','frontdesk','salesrep'] },
  { path: '/quotes',        label: 'Quotes',       icon: '📋', hex: '#38bdf8', group: 'Sales',      soon: false, roles: ['admin','frontdesk','salesrep'] },
  { path: '/services',      label: 'Contracts',    icon: '📝', hex: '#818cf8', group: 'Sales',      soon: false, roles: ['admin','frontdesk'] },
  { path: '/invoices',      label: 'Invoices',     icon: '🧾', hex: '#34d399', group: 'Sales',      soon: false, roles: ['admin','frontdesk'] },
  { path: '/invoice/new',   label: 'Quick Invoice', icon: '⚡', hex: '#fbbf24', group: 'Sales',      soon: false, roles: ['admin','frontdesk'] },
  // Operations
  { path: '/dispatch',      label: 'Dispatch',     icon: '📅', hex: '#a78bfa', group: 'Ops',        soon: false, roles: ['admin','frontdesk'] },
  { path: '/installations', label: 'Installs',     icon: '🔧', hex: '#fb923c', group: 'Ops',        soon: false, roles: ['admin','technician'] },
  { path: '/shipping',      label: 'Shipping',     icon: '🚚', hex: '#06b6d4', group: 'Ops',        soon: false, roles: ['admin','frontdesk'] },
  { path: '/fulfillment',   label: 'Fulfillment',  icon: '🔔', hex: '#fbbf24', group: 'Ops',        soon: false, roles: ['admin','frontdesk','technician'] },
  { path: '/inventory',     label: 'Inventory',    icon: '📦', hex: '#2dd4bf', group: 'Ops',        soon: false, roles: ['admin'] },
  { path: '/communications', label: 'Messages',    icon: '💬', hex: '#06b6d4', group: 'Ops',        soon: false, roles: ['admin','frontdesk','salesrep'] },
  // Finance & Reports
  { path: '/accounting',    label: 'Accounting',   icon: '💰', hex: '#facc15', group: 'Finance',    soon: false, roles: ['admin'] },
  { path: '/reports',       label: 'Reports',      icon: '📈', hex: '#38bdf8', group: 'Finance',    soon: false, roles: ['admin'] },
  // Admin
  { path: '/products',      label: 'Products',     icon: '🏷️', hex: '#fbbf24', group: 'Admin',      soon: false, roles: ['admin'] },
  { path: '/admin/terms',   label: 'Settings',     icon: '⚙️', hex: '#8b5cf6', group: 'Admin',      soon: false, roles: ['admin'] },
  { path: '/admin/users',   label: 'Team',         icon: '👤', hex: '#f87171', group: 'Admin',      soon: false, roles: ['admin'] },
  { path: '/marketing',     label: 'Marketing',    icon: '📊', hex: '#fb7185', group: 'Soon',       soon: true,  roles: ['admin'] },
]

const GROUP_ORDER = ['Core', 'Sales', 'Ops', 'Finance', 'Admin', 'Soon']

const GROUP_LABELS: Record<string, string> = {
  'Core': 'CORE', 'Sales': 'SALES', 'Ops': 'OPERATIONS', 'Finance': 'FINANCE', 'Admin': 'ADMIN', 'Soon': 'COMING SOON',
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin', frontdesk: 'Front Desk', salesrep: 'Sales Rep', technician: 'Technician',
}

const ROLE_HEX: Record<UserRole, string> = {
  admin: '#60a5fa', frontdesk: '#a78bfa', salesrep: '#4ade80', technician: '#fb923c',
}

function Avatar({ name, size = 8 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  const colors = ['#3b82f6','#22c55e','#8b5cf6','#f97316','#14b8a6','#06b6d4']
  const color = colors[name.charCodeAt(0) % colors.length]
  return (
    <div
      style={{
        width: size * 4, height: size * 4, fontSize: size * 1.6,
        borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 700, flexShrink: 0, backgroundColor: color,
      }}
    >
      {initials}
    </div>
  )
}

// ─── Sidebar inner content ────────────────────────────────────────
function SidebarContent({
  visibleNav, profile, role, sidebarOpen, onClose, onSignOut,
}: {
  visibleNav: NavItem[]
  profile: any
  role: UserRole | null
  sidebarOpen: boolean
  onClose: () => void
  onSignOut: () => void
}) {
  const grouped: Record<string, NavItem[]> = {}
  for (const item of visibleNav) {
    if (!grouped[item.group]) grouped[item.group] = []
    grouped[item.group].push(item)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0b1420' }}>
      {/* Logo */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '16px 14px 14px',
        borderBottom: '1px solid #162232',
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', flexShrink: 0,
          boxShadow: '0 0 20px rgba(59,130,246,0.35)',
        }}>
          <span style={{ color: '#fff', fontWeight: 900, fontSize: 17 }}>Z</span>
        </div>
        {sidebarOpen && (
          <div>
            <div style={{ color: '#f1f5f9', fontWeight: 800, fontSize: 15, lineHeight: 1.2 }}>Zenith Pure</div>
            <div style={{ color: '#475569', fontSize: 11, marginTop: 2, fontWeight: 500 }}>Solutions CRM</div>
          </div>
        )}
      </div>

      {/* Nav groups */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '6px 0 10px' }}>
        {GROUP_ORDER.filter(g => grouped[g]?.length).map((groupKey, gi) => (
          <div key={groupKey} style={{ marginBottom: 2 }}>
            {/* Group divider label */}
            {sidebarOpen ? (
              <div style={{
                padding: gi === 0 ? '8px 16px 6px' : '14px 16px 6px',
                fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
                color: '#64748b',
              }}>
                {GROUP_LABELS[groupKey] || groupKey}
              </div>
            ) : (
              gi > 0 && <div style={{ height: 1, background: '#162232', margin: '8px 8px' }} />
            )}

            {/* Items */}
            {grouped[groupKey].map(item => {
              if (item.soon) {
                return (
                  <div key={item.path} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: sidebarOpen ? '7px 10px' : '7px 0', margin: sidebarOpen ? '2px 6px' : '2px 4px',
                    borderRadius: 10, opacity: 0.35, cursor: 'not-allowed',
                    justifyContent: sidebarOpen ? 'flex-start' : 'center',
                  }}>
                    <div style={{
                      width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: '#0d1a26', fontSize: 16,
                    }}>
                      {item.icon}
                    </div>
                    {sidebarOpen && (
                      <>
                        <span style={{ fontSize: 13, color: '#475569', flex: 1 }}>{item.label}</span>
                        <span style={{
                          fontSize: 8, fontWeight: 800, letterSpacing: '0.08em',
                          padding: '2px 6px', borderRadius: 8,
                          background: '#0d1a26', color: '#475569',
                        }}>SOON</span>
                      </>
                    )}
                  </div>
                )
              }

              return (
                <NavLink key={item.path} to={item.path} style={{ textDecoration: 'none', display: 'block' }} onClick={onClose}>
                  {({ isActive }) => (
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, position: 'relative',
                        padding: sidebarOpen ? '8px 10px' : '8px 0',
                        margin: sidebarOpen ? '2px 6px' : '2px 4px',
                        borderRadius: 10, cursor: 'pointer',
                        justifyContent: sidebarOpen ? 'flex-start' : 'center',
                        background: isActive ? `${item.hex}15` : 'transparent',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={e => {
                        if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                      }}
                      onMouseLeave={e => {
                        if (!isActive) e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      {/* Active left bar */}
                      {isActive && sidebarOpen && (
                        <div style={{
                          position: 'absolute', left: 0, top: 8, bottom: 8, width: 3,
                          borderRadius: '0 3px 3px 0', background: item.hex,
                          boxShadow: `0 0 10px ${item.hex}60`,
                        }} />
                      )}

                      {/* Icon box */}
                      <div style={{
                        width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 16,
                        background: isActive ? `${item.hex}25` : `${item.hex}10`,
                        border: `1px solid ${isActive ? `${item.hex}40` : `${item.hex}12`}`,
                        boxShadow: isActive ? `0 0 14px ${item.hex}20` : 'none',
                        transition: 'all 0.15s ease',
                      }}>
                        {item.icon}
                      </div>

                      {/* Label */}
                      {sidebarOpen && (
                        <span style={{
                          fontSize: 13.5, fontWeight: isActive ? 700 : 500,
                          color: isActive ? item.hex : '#94a3b8',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          transition: 'color 0.15s ease',
                        }}>
                          {item.label}
                        </span>
                      )}
                    </div>
                  )}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>

      {/* User card */}
      {profile && (
        <div style={{ padding: '10px 10px 12px', borderTop: '1px solid #162232' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', borderRadius: 10,
            background: '#0d1a26', border: '1px solid #162232',
          }}>
            <Avatar name={profile.full_name} size={8} />
            {sidebarOpen && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: '#e2e8f0',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {profile.full_name}
                </div>
                {role && (
                  <span style={{
                    display: 'inline-block', marginTop: 3,
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                    background: `${ROLE_HEX[role]}15`, color: ROLE_HEX[role],
                    border: `1px solid ${ROLE_HEX[role]}25`,
                    letterSpacing: '0.04em',
                  }}>
                    {ROLE_LABELS[role]}
                  </span>
                )}
              </div>
            )}
          </div>
          {sidebarOpen && (
            <button
              onClick={onSignOut}
              style={{
                display: 'block', marginTop: 8, marginLeft: 10, fontSize: 10, color: '#1e3a4f',
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
              onMouseLeave={e => (e.currentTarget.style.color = '#1e3a4f')}
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

  const [sidebarOpen, setSidebarOpen] = useState(true)
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
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0f1923' }}>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.6)' }}
          className="md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <div
        className="md:hidden"
        style={{
          position: 'fixed', insetBlock: 0, left: 0, zIndex: 50, width: 240,
          borderRight: '1px solid #162232',
          transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s ease',
        }}
      >
        <button
          onClick={() => setMobileOpen(false)}
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 10,
            width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 7, background: 'rgba(255,255,255,0.05)', border: 'none',
            color: '#475569', fontSize: 13, cursor: 'pointer',
          }}
        >
          ✕
        </button>
        <SidebarContent
          visibleNav={visibleNav} profile={profile} role={role}
          sidebarOpen={true} onClose={() => setMobileOpen(false)} onSignOut={handleSignOut}
        />
      </div>

      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex"
        style={{
          flexDirection: 'column', flexShrink: 0,
          width: sidebarOpen ? 230 : 60,
          borderRight: '1px solid #162232',
          transition: 'width 0.2s ease',
        }}
      >
        <SidebarContent
          visibleNav={visibleNav} profile={profile} role={role}
          sidebarOpen={sidebarOpen} onClose={() => {}} onSignOut={handleSignOut}
        />
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{
            padding: 8, borderTop: '1px solid #162232', background: '#0b1420',
            border: 'none', borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: '#162232',
            color: '#1e3a4f', fontSize: 11, cursor: 'pointer', textAlign: 'center',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#64748b')}
          onMouseLeave={e => (e.currentTarget.style.color = '#1e3a4f')}
        >
          {sidebarOpen ? '◀ Collapse' : '▶'}
        </button>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 20px', borderBottom: '1px solid #162232',
          background: '#0b1420', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 4, background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <span style={{ display: 'block', width: 18, height: 2, borderRadius: 1, background: '#475569' }} />
              <span style={{ display: 'block', width: 18, height: 2, borderRadius: 1, background: '#475569' }} />
              <span style={{ display: 'block', width: 18, height: 2, borderRadius: 1, background: '#475569' }} />
            </button>
            <span style={{ fontSize: 12, color: '#1e3a4f', fontWeight: 500 }}>Zenith Pure Solutions — Indianapolis, IN</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 8px rgba(74,222,128,0.5)' }} />
            <span style={{ fontSize: 10, color: '#334155', fontWeight: 600 }}>Live</span>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0, padding: '16px 20px' }}>
          {children}
        </div>
      </main>
    </div>
  )
}
