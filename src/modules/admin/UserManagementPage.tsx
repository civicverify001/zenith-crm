// src/modules/admin/UserManagementPage.tsx
// Admin only — create, ban, delete, change roles, set per-user page access

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { ALL_PAGES, ROLE_DEFAULT_PAGES } from '../../hooks/usePermissions';
import { fetchCalConnections, sendConnectLink, toggleCalSync, disconnectCal } from '../../services/googleCalService';

interface CRMUser {
  id: string;
  email: string;
  role: string;
  role_label: string;
  pages: string[] | null;
  banned: boolean;
  banned_until: string | null;
  created_at: string;
  last_sign_in: string | null;
  confirmed: boolean;
  full_name: string;
}

const ROLES = [
  { value: 'admin',      label: 'Admin',      color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
  { value: 'frontdesk',  label: 'Front Desk', color: '#a78bfa', bg: 'rgba(167,139,250,0.1)' },
  { value: 'salesrep',   label: 'Sales Rep',  color: '#60a5fa', bg: 'rgba(96,165,250,0.1)'  },
  { value: 'technician', label: 'Technician', color: '#4ade80', bg: 'rgba(74,222,128,0.1)'  },
];

// Tab config — matches QuotesPage / InvoicesPage / FollowUpsPage pattern
const FILTER_TABS = [
  { id: 'all',        label: 'All Users',   icon: '👥', color: '#60a5fa' },
  { id: 'admin',      label: 'Admin',       icon: '⚙️', color: '#f87171' },
  { id: 'frontdesk',  label: 'Front Desk',  icon: '📋', color: '#a78bfa' },
  { id: 'salesrep',   label: 'Sales Rep',   icon: '⬡',  color: '#22d3ee' },
  { id: 'technician', label: 'Technician',  icon: '🔧', color: '#4ade80' },
  { id: 'banned',     label: 'Banned',      icon: '🚫', color: '#64748b' },
] as const

type FilterTab = typeof FILTER_TABS[number]['id']

const PAGE_GROUPS = ['Core', 'Sales', 'Operations', 'Finance', 'Analytics', 'Admin'];

const GROUP_COLORS: Record<string, string> = {
  Core:       '#60a5fa',
  Sales:      '#34d399',
  Operations: '#fbbf24',
  Finance:    '#f87171',
  Analytics:  '#a78bfa',
  Admin:      '#fb923c',
};

function getRoleStyle(role: string) {
  return ROLES.find(r => r.value === role) || { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', label: role };
}

async function callAdminAPI(method: string, body?: object) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch('/api/admin/users', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json;
}

const EMPTY_FORM = { email: '', password: '', full_name: '', role: 'salesrep' };

export default function UserManagementPage() {
  const [users, setUsers] = useState<CRMUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [permUser, setPermUser] = useState<CRMUser | null>(null);
  const [permPages, setPermPages] = useState<string[]>([]);
  const [permSaving, setPermSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CRMUser | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [calConnections, setCalConnections] = useState<Record<string, { email: string; is_enabled: boolean; connected_at: string }>>({});
  const [calLoading, setCalLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { users } = await callAdminAPI('GET');
      setUsers(users);
      // Load Google Calendar connections
      const conns = await fetchCalConnections().catch(() => ({}));
      setCalConnections(conns);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Tab counts
  function tabCount(tabId: FilterTab) {
    if (tabId === 'all')    return users.length
    if (tabId === 'banned') return users.filter(u => u.banned).length
    return users.filter(u => u.role === tabId).length
  }

  // Filtered users for active tab
  const filteredUsers = users.filter(u => {
    if (activeTab === 'all')    return true
    if (activeTab === 'banned') return u.banned
    return u.role === activeTab
  })

  function openPermissions(u: CRMUser) {
    setPermPages([...(u.pages || ROLE_DEFAULT_PAGES[u.role] || ['/dashboard'])]);
    setPermUser(u);
  }

  function togglePage(path: string) {
    if (path === '/dashboard') return;
    setPermPages(prev => prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]);
  }

  async function savePermissions() {
    if (!permUser) return;
    setPermSaving(true);
    try {
      await callAdminAPI('PATCH', { user_id: permUser.id, action: 'set_pages', pages: permPages });
      setPermUser(null);
      await load();
    } catch (e: any) { setError(e.message); }
    finally { setPermSaving(false); }
  }

  async function handleCreate() {
    if (!form.email || !form.password || !form.role) { setError('Email, password, and role are required'); return; }
    setSaving(true); setError(null);
    try {
      await callAdminAPI('POST', form);
      setShowCreate(false); setForm(EMPTY_FORM); await load();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleBanToggle(u: CRMUser) {
    setActionLoading(u.id);
    try {
      await callAdminAPI('PATCH', { user_id: u.id, action: u.banned ? 'unban' : 'ban' });
      await load();
    } catch (e: any) { setError(e.message); }
    finally { setActionLoading(null); }
  }

  async function handleRoleChange(u: CRMUser, role: string) {
    setActionLoading(u.id + '_role');
    try {
      await callAdminAPI('PATCH', { user_id: u.id, action: 'set_role', role });
      await load();
    } catch (e: any) { setError(e.message); }
    finally { setActionLoading(null); }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setActionLoading(confirmDelete.id + '_delete');
    try {
      await callAdminAPI('DELETE', { user_id: confirmDelete.id });
      setConfirmDelete(null); await load();
    } catch (e: any) { setError(e.message); }
    finally { setActionLoading(null); }
  }

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Team & Users</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage team access, roles, and page permissions</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setError(null); setForm(EMPTY_FORM); }}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
        >
          + Add User
        </button>
      </div>

      {/* ── Colorful full-width filter tabs ── */}
      <div
        className="grid mb-5"
        style={{ gridTemplateColumns: `repeat(${FILTER_TABS.length}, 1fr)`, gap: 3 }}
      >
        {FILTER_TABS.map(tab => {
          const isActive = activeTab === tab.id
          const count = tabCount(tab.id)
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="relative flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-150 text-left"
              style={{
                background: isActive
                  ? `linear-gradient(135deg, ${tab.color}22, ${tab.color}0a)`
                  : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isActive ? tab.color + '50' : 'rgba(255,255,255,0.06)'}`,
                boxShadow: isActive ? `0 0 18px ${tab.color}18` : 'none',
              }}
            >
              <div>
                <div
                  className="text-xs font-semibold uppercase tracking-wider mb-1"
                  style={{ color: isActive ? tab.color : '#64748b' }}
                >
                  <span className="mr-1.5">{tab.icon}</span>{tab.label}
                </div>
                <div
                  className="text-2xl font-bold"
                  style={{ color: isActive ? tab.color : '#94a3b8' }}
                >
                  {count}
                </div>
              </div>
              {isActive && (
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: tab.color, boxShadow: `0 0 8px ${tab.color}` }}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Users',   value: users.length,                        color: '#60a5fa' },
          { label: 'Active',        value: users.filter(u => !u.banned).length, color: '#4ade80' },
          { label: 'Banned',        value: users.filter(u => u.banned).length,  color: '#f87171' },
          { label: 'Custom Access', value: users.filter(u => u.pages).length,   color: '#fbbf24' },
        ].map(s => (
          <div
            key={s.label}
            className="rounded-xl px-4 py-3"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div className="text-xl font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {error && (
        <div
          className="mb-4 px-4 py-3 rounded-xl text-sm flex items-center justify-between"
          style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171' }}
        >
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-lg ml-4">×</button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-center py-16 text-slate-500">Loading users...</div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full text-sm" style={{ minWidth: 640 }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">User</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Page Access</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Last Sign In</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Google Calendar</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-slate-500">
                      No users in this category
                    </td>
                  </tr>
                ) : filteredUsers.map((u, i) => {
                  const roleStyle = getRoleStyle(u.role);
                  const isActioning = actionLoading?.startsWith(u.id);
                  const effectivePages = u.pages || ROLE_DEFAULT_PAGES[u.role] || [];
                  const isCustom = !!u.pages;
                  return (
                    <tr
                      key={u.id}
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        background: u.banned
                          ? 'rgba(248,113,113,0.03)'
                          : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                        opacity: u.banned ? 0.7 : 1,
                      }}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{u.full_name || u.email}</div>
                        {u.full_name && <div className="text-xs text-slate-500 mt-0.5">{u.email}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={u.role}
                          onChange={e => handleRoleChange(u, e.target.value)}
                          disabled={isActioning}
                          className="rounded-lg px-2 py-1 text-xs font-semibold focus:outline-none disabled:opacity-40"
                          style={{ background: roleStyle.bg, color: roleStyle.color, border: `1px solid ${roleStyle.color}35` }}
                        >
                          {ROLES.map(r => (
                            <option key={r.value} value={r.value} style={{ background: '#0f1923', color: '#e2e8f0' }}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-300">{effectivePages.length} pages</span>
                          <span
                            className="text-xs px-1.5 py-0.5 rounded font-semibold"
                            style={isCustom
                              ? { background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }
                              : { background: 'rgba(148,163,184,0.08)', color: '#64748b' }}
                          >
                            {isCustom ? 'Custom' : 'Default'}
                          </span>
                          <button
                            onClick={() => openPermissions(u)}
                            className="text-xs px-2 py-1 rounded-lg"
                            style={{ background: 'rgba(96,165,250,0.1)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.2)' }}
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-xs font-semibold px-2.5 py-1 rounded-full"
                          style={u.banned
                            ? { background: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }
                            : { background: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)' }}
                        >
                          {u.banned ? 'Banned' : 'Active'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {u.last_sign_in ? new Date(u.last_sign_in).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const conn = calConnections[u.id];
                          const isCalLoading = calLoading === u.id;
                          if (conn) {
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: conn.is_enabled ? '#4ade80' : '#64748b', display: 'inline-block', flexShrink: 0 }} />
                                  <span style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                                    {conn.email || 'Connected'}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button
                                    onClick={async () => { setCalLoading(u.id); try { await toggleCalSync(u.id); await load(); } catch(e: any) { setError(e.message); } finally { setCalLoading(null); } }}
                                    disabled={isCalLoading}
                                    style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
                                      background: conn.is_enabled ? 'rgba(251,191,36,0.1)' : 'rgba(74,222,128,0.1)',
                                      color: conn.is_enabled ? '#fbbf24' : '#4ade80',
                                      border: `1px solid ${conn.is_enabled ? 'rgba(251,191,36,0.3)' : 'rgba(74,222,128,0.3)'}`,
                                      opacity: isCalLoading ? 0.5 : 1 }}
                                  >
                                    {isCalLoading ? '...' : conn.is_enabled ? 'Pause' : 'Resume'}
                                  </button>
                                  <button
                                    onClick={async () => { if (!confirm('Disconnect Google Calendar for ' + (u.full_name || u.email) + '?')) return; setCalLoading(u.id); try { await disconnectCal(u.id); await load(); } catch(e: any) { setError(e.message); } finally { setCalLoading(null); } }}
                                    disabled={isCalLoading}
                                    style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
                                      background: 'rgba(248,113,113,0.08)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)',
                                      opacity: isCalLoading ? 0.5 : 1 }}
                                  >
                                    Disconnect
                                  </button>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <button
                              onClick={() => sendConnectLink(u.id)}
                              style={{ fontSize: 11, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
                                background: 'rgba(96,165,250,0.1)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.25)',
                                whiteSpace: 'nowrap' }}
                            >
                              🔗 Connect
                            </button>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleBanToggle(u)}
                            disabled={isActioning}
                            className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40"
                            style={u.banned
                              ? { background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)' }
                              : { background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}
                          >
                            {isActioning && actionLoading === u.id ? '...' : u.banned ? 'Unban' : 'Ban'}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(u)}
                            disabled={isActioning}
                            className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40"
                            style={{ background: 'rgba(248,113,113,0.08)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── PERMISSIONS MODAL ── */}
      {permUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
        >
          <div
            className="w-full max-w-lg rounded-2xl flex flex-col"
            style={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.1)', maxHeight: '85vh' }}
          >
            <div className="px-6 pt-5 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-white font-bold text-lg">Page Permissions</h3>
                  <p className="text-slate-500 text-sm mt-0.5">
                    {permUser.full_name || permUser.email}
                    {' · '}
                    <span style={{ color: getRoleStyle(permUser.role).color }}>
                      {getRoleStyle(permUser.role).label}
                    </span>
                  </p>
                </div>
                <button onClick={() => setPermUser(null)} className="text-slate-500 hover:text-white text-xl">×</button>
              </div>
              <div className="mt-3">
                <div className="text-xs text-slate-500 mb-2">Load role defaults:</div>
                <div className="flex gap-2 flex-wrap">
                  {ROLES.map(r => (
                    <button
                      key={r.value}
                      onClick={() => setPermPages([...(ROLE_DEFAULT_PAGES[r.value] || ['/dashboard'])])}
                      className="text-xs px-3 py-1.5 rounded-lg"
                      style={{ background: r.bg, color: r.color, border: `1px solid ${r.color}30` }}
                    >
                      {r.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setPermPages(ALL_PAGES.map(p => p.path))}
                    className="text-xs px-3 py-1.5 rounded-lg"
                    style={{ background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    All Pages
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-y-auto px-6 py-4 flex-1 space-y-5">
              {PAGE_GROUPS.map(group => {
                const groupPages = ALL_PAGES.filter(p => p.group === group);
                const groupColor = GROUP_COLORS[group];
                const allChecked = groupPages.every(p => permPages.includes(p.path));
                return (
                  <div key={group}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ background: groupColor }} />
                        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: groupColor }}>{group}</span>
                      </div>
                      <button
                        onClick={() => {
                          const paths = groupPages.map(p => p.path).filter(p => p !== '/dashboard');
                          if (allChecked) setPermPages(prev => prev.filter(p => !paths.includes(p)));
                          else setPermPages(prev => [...prev, ...paths.filter(p => !prev.includes(p))]);
                        }}
                        className="text-xs"
                        style={{ color: allChecked ? '#64748b' : groupColor }}
                      >
                        {allChecked ? 'Deselect all' : 'Select all'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {groupPages.map(page => {
                        const checked = permPages.includes(page.path);
                        const isLocked = page.path === '/dashboard';
                        return (
                          <label
                            key={page.path}
                            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl"
                            style={{
                              background: checked ? `${groupColor}10` : 'rgba(255,255,255,0.03)',
                              border: checked ? `1px solid ${groupColor}30` : '1px solid rgba(255,255,255,0.06)',
                              cursor: isLocked ? 'default' : 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isLocked}
                              onChange={() => togglePage(page.path)}
                              className="w-3.5 h-3.5 rounded"
                              style={{ accentColor: groupColor }}
                            />
                            <span className="text-xs font-medium" style={{ color: checked ? '#e2e8f0' : '#64748b' }}>
                              {page.icon} {page.label}
                            </span>
                            {isLocked && <span className="text-xs text-slate-600 ml-auto">always</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-6 py-4 flex items-center justify-between" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="text-xs text-slate-500">{permPages.length} of {ALL_PAGES.length} pages selected</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPermUser(null)}
                  className="px-4 py-2 rounded-xl text-sm text-slate-400"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={savePermissions}
                  disabled={permSaving}
                  className="px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
                >
                  {permSaving ? 'Saving...' : 'Save Permissions'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CREATE MODAL ── */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="w-full max-w-md rounded-2xl p-6"
            style={{ background: '#0f1923', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <h3 className="text-white font-bold text-lg mb-1">Add New User</h3>
            <p className="text-slate-500 text-sm mb-5">Create a login for a new team member.</p>
            <div className="space-y-4">
              {[
                { label: 'Full Name',     key: 'full_name', type: 'text',     placeholder: 'e.g. Cody Merrill',      required: false },
                { label: 'Email Address', key: 'email',     type: 'email',    placeholder: 'cody@zenithpure.com',    required: true  },
                { label: 'Password',      key: 'password',  type: 'password', placeholder: 'Minimum 6 characters',   required: true  },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs text-slate-500 mb-1.5">
                    {f.label} {f.required && <span style={{ color: '#f87171' }}>*</span>}
                  </label>
                  <input
                    type={f.type}
                    value={(form as any)[f.key]}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">Role <span style={{ color: '#f87171' }}>*</span></label>
                <select
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value} style={{ background: '#0f1923' }}>{r.label}</option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-slate-600">You can customize exact page access after creating the user.</p>
              {error && (
                <div
                  className="px-3 py-2.5 rounded-xl text-sm"
                  style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}
                >
                  {error}
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => { setShowCreate(false); setError(null); }}
                className="flex-1 py-2.5 rounded-xl text-sm text-slate-400"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
              >
                {saving ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRM ── */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6"
            style={{ background: '#0f1923', border: '1px solid rgba(248,113,113,0.2)' }}
          >
            <div className="text-4xl mb-3 text-center">⚠️</div>
            <h3 className="text-white font-bold text-lg text-center mb-2">Delete User?</h3>
            <p style={{ color: '#f87171' }} className="font-semibold text-center mb-4">{confirmDelete.email}</p>
            <p className="text-slate-500 text-xs text-center mb-5">
              This cannot be undone. Consider <strong className="text-slate-400">banning</strong> instead.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2.5 rounded-xl text-sm text-slate-400"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={!!actionLoading}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}
              >
                {actionLoading ? 'Deleting...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
