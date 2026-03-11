// src/pages/admin/UserManagementPage.tsx
// Admin only — create, ban, unban, delete users, change roles

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

interface CRMUser {
  id: string;
  email: string;
  role: string;
  role_label: string;
  banned: boolean;
  banned_until: string | null;
  created_at: string;
  last_sign_in: string | null;
  confirmed: boolean;
}

const ROLES = [
  { value: 'admin',     label: 'Admin',      color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
  { value: 'frontdesk', label: 'Front Desk',  color: '#a78bfa', bg: 'rgba(167,139,250,0.1)' },
  { value: 'salesrep',  label: 'Sales Rep',   color: '#60a5fa', bg: 'rgba(96,165,250,0.1)' },
  { value: 'tech',      label: 'Technician',  color: '#4ade80', bg: 'rgba(74,222,128,0.1)' },
];

function getRoleStyle(role: string) {
  return ROLES.find(r => r.value === role) || { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', label: role };
}

async function callAdminAPI(method: string, body?: object) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch('/api/admin/users', {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
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
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CRMUser | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // user id being actioned

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { users } = await callAdminAPI('GET');
      setUsers(users);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!form.email || !form.password || !form.role) {
      setError('Email, password, and role are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await callAdminAPI('POST', form);
      setShowCreate(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleBanToggle(user: CRMUser) {
    setActionLoading(user.id);
    try {
      await callAdminAPI('PATCH', {
        user_id: user.id,
        action: user.banned ? 'unban' : 'ban',
      });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRoleChange(user: CRMUser, role: string) {
    setActionLoading(user.id + '_role');
    try {
      await callAdminAPI('PATCH', { user_id: user.id, action: 'set_role', role });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setActionLoading(confirmDelete.id + '_delete');
    try {
      await callAdminAPI('DELETE', { user_id: confirmDelete.id });
      setConfirmDelete(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(null);
    }
  }

  const activeUsers = users.filter(u => !u.banned);
  const bannedUsers = users.filter(u => u.banned);

  return (
    <div className="min-h-full">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Team & Users</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage team access, roles, and accounts
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setError(null); setForm(EMPTY_FORM); }}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
        >
          + Add User
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Users', value: users.length,       color: '#60a5fa' },
          { label: 'Active',      value: activeUsers.length, color: '#4ade80' },
          { label: 'Banned',      value: bannedUsers.length, color: '#f87171' },
          { label: 'Roles',       value: new Set(users.map(u => u.role)).size, color: '#a78bfa' },
        ].map(s => (
          <div key={s.label} className="rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="text-xl font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm flex items-center justify-between"
          style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171' }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-lg leading-none ml-4">×</button>
        </div>
      )}

      {/* Users table */}
      {loading ? (
        <div className="text-center py-16 text-slate-500">Loading users...</div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">User</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Role</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Last Sign In</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Joined</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-16 text-slate-500">No users found</td></tr>
              ) : users.map((u, i) => {
                const roleStyle = getRoleStyle(u.role);
                const isActioning = actionLoading === u.id || actionLoading === u.id + '_role' || actionLoading === u.id + '_delete';
                return (
                  <tr
                    key={u.id}
                    className="transition-colors"
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      background: u.banned
                        ? 'rgba(248,113,113,0.03)'
                        : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                      opacity: u.banned ? 0.7 : 1,
                    }}
                  >
                    {/* User */}
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{u.email}</div>
                      {!u.confirmed && (
                        <div className="text-xs mt-0.5" style={{ color: '#fbbf24' }}>⚠ Email not confirmed</div>
                      )}
                    </td>

                    {/* Role — editable dropdown */}
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        onChange={e => handleRoleChange(u, e.target.value)}
                        disabled={isActioning}
                        className="rounded-lg px-2 py-1 text-xs font-semibold focus:outline-none disabled:opacity-40"
                        style={{
                          background: roleStyle.bg,
                          color: roleStyle.color,
                          border: `1px solid ${roleStyle.color}35`,
                        }}
                      >
                        {ROLES.map(r => (
                          <option key={r.value} value={r.value} style={{ background: '#0f1923', color: '#e2e8f0' }}>
                            {r.label}
                          </option>
                        ))}
                        {u.role === 'unassigned' && (
                          <option value="unassigned" style={{ background: '#0f1923', color: '#94a3b8' }}>Unassigned</option>
                        )}
                      </select>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span
                        className="text-xs font-semibold px-2.5 py-1 rounded-full"
                        style={u.banned
                          ? { background: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }
                          : { background: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)' }
                        }
                      >
                        {u.banned ? 'Banned' : 'Active'}
                      </span>
                    </td>

                    {/* Last sign in */}
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {u.last_sign_in ? new Date(u.last_sign_in).toLocaleDateString() : 'Never'}
                    </td>

                    {/* Joined */}
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleBanToggle(u)}
                          disabled={isActioning}
                          className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all disabled:opacity-40"
                          style={u.banned
                            ? { background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)' }
                            : { background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }
                          }
                        >
                          {isActioning && actionLoading === u.id ? '...' : u.banned ? 'Unban' : 'Ban'}
                        </button>
                        <button
                          onClick={() => setConfirmDelete(u)}
                          disabled={isActioning}
                          className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all disabled:opacity-40"
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
      )}

      {/* ── Create User Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-md rounded-2xl p-6"
            style={{ background: '#0f1923', border: '1px solid rgba(255,255,255,0.1)' }}>

            <h3 className="text-white font-bold text-lg mb-1">Add New User</h3>
            <p className="text-slate-500 text-sm mb-5">
              Create a login for a new team member. They can sign in immediately.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">Full Name</label>
                <input
                  value={form.full_name}
                  onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder="e.g. Cody Merrill"
                  className="w-full rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">Email Address <span className="text-red-400">*</span></label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="cody@zenithpure.com"
                  className="w-full rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">Password <span className="text-red-400">*</span></label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Minimum 6 characters"
                  className="w-full rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">Role <span className="text-red-400">*</span></label>
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

              {/* Role description */}
              <div className="rounded-xl p-3 text-xs text-slate-400"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                {form.role === 'admin'     && '⚡ Full access — all modules, settings, billing, team management, vendor data'}
                {form.role === 'frontdesk' && '📋 Leads, follow-ups, customers, plans — no vendor pricing'}
                {form.role === 'salesrep'  && '💼 Pipeline, quotes, follow-ups — no vendor pricing or admin settings'}
                {form.role === 'tech'      && '🔧 Dispatch, installs, mobile view — no vendor pricing or billing'}
              </div>

              {error && (
                <div className="px-3 py-2.5 rounded-xl text-sm"
                  style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}>
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

      {/* ── Confirm Delete Modal ── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-sm rounded-2xl p-6"
            style={{ background: '#0f1923', border: '1px solid rgba(248,113,113,0.2)' }}>
            <div className="text-4xl mb-3 text-center">⚠️</div>
            <h3 className="text-white font-bold text-lg text-center mb-2">Delete User?</h3>
            <p className="text-slate-400 text-sm text-center mb-1">
              You are about to permanently delete:
            </p>
            <p className="text-red-400 font-semibold text-center mb-4">{confirmDelete.email}</p>
            <p className="text-slate-500 text-xs text-center mb-5">
              This cannot be undone. Their account and login will be permanently removed.
              Consider <strong className="text-slate-400">banning</strong> instead if you may need to restore access.
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
