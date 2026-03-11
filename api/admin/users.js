// api/admin/users.js
// Server-side user management — create, ban, delete, set role, set page permissions

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ROLE_LABELS = {
  admin:      'Admin',
  frontdesk:  'Front Desk',
  salesrep:   'Sales Rep',
  technician: 'Technician',
};

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const callerRole = user.user_metadata?.role || user.app_metadata?.role;
  if (callerRole !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // ── GET — list all users ──────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) return res.status(500).json({ error: error.message });

    const users = data.users.map(u => ({
      id:           u.id,
      email:        u.email,
      role:         u.user_metadata?.role || u.app_metadata?.role || 'unassigned',
      role_label:   ROLE_LABELS[u.user_metadata?.role] || 'Unassigned',
      pages:        u.user_metadata?.pages || null,
      banned:       u.banned_until ? new Date(u.banned_until) > new Date() : false,
      banned_until: u.banned_until || null,
      created_at:   u.created_at,
      last_sign_in: u.last_sign_in_at,
      confirmed:    !!u.confirmed_at,
      full_name:    u.user_metadata?.full_name || '',
    }));

    return res.status(200).json({ users });
  }

  // ── POST — create new user ────────────────────────────────────
  if (req.method === 'POST') {
    const { email, password, role, full_name, pages } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'email, password, and role are required' });
    }
    if (!ROLE_LABELS[role]) return res.status(400).json({ error: 'Invalid role' });

    const metadata = { role, full_name: full_name || '' };
    if (pages && Array.isArray(pages)) metadata.pages = pages;

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    });

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ user: data.user });
  }

  // ── PATCH — update user ───────────────────────────────────────
  if (req.method === 'PATCH') {
    const { user_id, action, role, pages } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    if (user_id === user.id) {
      return res.status(400).json({ error: 'You cannot modify your own account' });
    }

    if (action === 'set_role') {
      if (!ROLE_LABELS[role]) return res.status(400).json({ error: 'Invalid role' });
      const { data: targetUser } = await supabaseAdmin.auth.admin.getUserById(user_id);
      const currentMeta = targetUser?.user?.user_metadata || {};
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
        user_metadata: { ...currentMeta, role },
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'set_pages') {
      if (!Array.isArray(pages)) return res.status(400).json({ error: 'pages must be an array' });
      const { data: targetUser } = await supabaseAdmin.auth.admin.getUserById(user_id);
      const currentMeta = targetUser?.user?.user_metadata || {};
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
        user_metadata: {
          ...currentMeta,
          pages: pages.length > 0 ? pages : null,
        },
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'ban') {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, { ban_duration: '87600h' });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'unban') {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, { ban_duration: 'none' });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid action' });
  }

  // ── DELETE ────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    if (user_id === user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    const { error } = await supabaseAdmin.auth.admin.deleteUser(user_id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
