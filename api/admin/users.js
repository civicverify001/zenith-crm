// api/admin/users.js
// Server-side user management — uses service role key, never exposed to client
// Handles: GET (list), POST (create), PATCH (ban/unban), DELETE (delete)

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY, // service role — server only
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ROLE_LABELS = {
  admin:     'Admin',
  frontdesk: 'Front Desk',
  salesrep:  'Sales Rep',
  tech:      'Technician',
};

export default async function handler(req, res) {
  // Verify caller is admin via their JWT
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const callerRole = user.user_metadata?.role || user.app_metadata?.role;
  if (callerRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // ── GET — list all users ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) return res.status(500).json({ error: error.message });

    const users = data.users.map(u => ({
      id:         u.id,
      email:      u.email,
      role:       u.user_metadata?.role || u.app_metadata?.role || 'unassigned',
      role_label: ROLE_LABELS[u.user_metadata?.role] || 'Unassigned',
      banned:     u.banned_until ? new Date(u.banned_until) > new Date() : false,
      banned_until: u.banned_until || null,
      created_at: u.created_at,
      last_sign_in: u.last_sign_in_at,
      confirmed:  !!u.confirmed_at,
    }));

    return res.status(200).json({ users });
  }

  // ── POST — create new user ────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { email, password, role, full_name } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'email, password, and role are required' });
    }
    if (!ROLE_LABELS[role]) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${Object.keys(ROLE_LABELS).join(', ')}` });
    }

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // auto-confirm so they can log in immediately
      user_metadata: {
        role,
        full_name: full_name || '',
      },
    });

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ user: data.user });
  }

  // ── PATCH — ban or unban user ─────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { user_id, action, role } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    // Prevent admin from banning themselves
    if (user_id === user.id) {
      return res.status(400).json({ error: 'You cannot modify your own account' });
    }

    // Update role
    if (action === 'set_role') {
      if (!ROLE_LABELS[role]) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
        user_metadata: { role },
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    // Ban user
    if (action === 'ban') {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
        ban_duration: '87600h', // 10 years = effectively permanent
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    // Unban user
    if (action === 'unban') {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
        ban_duration: 'none',
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid action' });
  }

  // ── DELETE — permanently delete user ─────────────────────────────────────
  if (req.method === 'DELETE') {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    // Prevent admin from deleting themselves
    if (user_id === user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(user_id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
