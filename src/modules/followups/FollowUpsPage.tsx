import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import {
  getOpenFollowUps,
  getCompletedFollowUps,
  createFollowUp,
  completeFollowUp,
  reopenFollowUp,
  deleteFollowUp,
  TASK_TYPE_LABELS,
  TASK_TYPE_ICONS,
  type FollowUpTask,
  type FollowUpTaskType,
  type CreateFollowUpParams,
} from '../../services/followUpService';

// ============================================================
// HELPERS
// ============================================================

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + 'T00:00:00');
  return Math.floor((due.getTime() - today.getTime()) / 86400000);
}

function formatDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(d: string): string {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

type FilterView = 'all' | 'overdue' | 'today' | 'upcoming' | 'completed';

// ============================================================
// TAB CONFIG — matches QuotesPage pill style exactly
// ============================================================

const STATUS_FILTERS: {
  key: FilterView;
  label: string;
  icon: string;
  color: string;
  bg: string;
  border: string;
}[] = [
  { key: 'all',       label: 'All Open',  icon: '◈', color: '#e2e8f0', bg: 'rgba(226,232,240,0.1)',  border: 'rgba(226,232,240,0.2)' },
  { key: 'overdue',   label: 'Overdue',   icon: '🔴', color: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.25)' },
  { key: 'today',     label: 'Today',     icon: '◉', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.25)' },
  { key: 'upcoming',  label: 'Upcoming',  icon: '▷', color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)' },
  { key: 'completed', label: 'Completed', icon: '✓', color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  border: 'rgba(74,222,128,0.25)' },
];

// ============================================================
// COMPONENT
// ============================================================

export function FollowUpsPage() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [tasks, setTasks] = useState<FollowUpTask[]>([]);
  const [completedTasks, setCompletedTasks] = useState<FollowUpTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterView>('all');
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [entityNames, setEntityNames] = useState<Record<string, string>>({});

  // Load tasks
  async function loadTasks() {
    setLoading(true);
    try {
      const [open, completed] = await Promise.all([
        getOpenFollowUps(),
        getCompletedFollowUps(20),
      ]);
      setTasks(open);
      setCompletedTasks(completed);

      const leadIds = [...new Set([...open, ...completed].map(t => t.lead_id).filter(Boolean))] as string[];
      const customerIds = [...new Set([...open, ...completed].map(t => t.customer_id).filter(Boolean))] as string[];

      const names: Record<string, string> = {};
      if (leadIds.length > 0) {
        const { data: leads } = await supabase.from('leads').select('id, full_name').in('id', leadIds);
        (leads || []).forEach((l: any) => { names[`lead:${l.id}`] = l.full_name; });
      }
      if (customerIds.length > 0) {
        const { data: customers } = await supabase.from('customers').select('id, full_name').in('id', customerIds);
        (customers || []).forEach((c: any) => { names[`customer:${c.id}`] = c.full_name; });
      }
      setEntityNames(names);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTasks(); }, []);

  // ─── Filter logic ────────────────────────────────────────
  const today_str = new Date().toISOString().split('T')[0];
  const overdueTasks = tasks.filter(t => t.due_date < today_str);
  const todayTasks = tasks.filter(t => t.due_date === today_str);
  const upcomingTasks = tasks.filter(t => t.due_date > today_str);

  const countFor = (key: FilterView) =>
    key === 'all' ? tasks.length :
    key === 'overdue' ? overdueTasks.length :
    key === 'today' ? todayTasks.length :
    key === 'upcoming' ? upcomingTasks.length :
    completedTasks.length;

  const baseFilteredTasks = filter === 'all' ? tasks
    : filter === 'overdue' ? overdueTasks
    : filter === 'today' ? todayTasks
    : filter === 'upcoming' ? upcomingTasks
    : completedTasks;

  const displayTasks = useMemo(() => {
    if (!search.trim()) return baseFilteredTasks;
    const q = search.toLowerCase();
    return baseFilteredTasks.filter(t => {
      const name = getEntityNameFn(t);
      return t.title.toLowerCase().includes(q) ||
        (t.notes && t.notes.toLowerCase().includes(q)) ||
        (name && name.toLowerCase().includes(q));
    });
  }, [baseFilteredTasks, search, entityNames]);

  function getEntityNameFn(task: FollowUpTask): string | null {
    if (task.lead_id) return entityNames[`lead:${task.lead_id}`] || null;
    if (task.customer_id) return entityNames[`customer:${task.customer_id}`] || null;
    return null;
  }

  function getEntityType(task: FollowUpTask): 'lead' | 'customer' | null {
    if (task.lead_id) return 'lead';
    if (task.customer_id) return 'customer';
    return null;
  }

  function navigateToEntity(task: FollowUpTask) {
    if (task.lead_id) navigate('/leads');
    else if (task.customer_id) navigate(`/customers/${task.customer_id}`);
  }

  // ─── Actions ─────────────────────────────────────────────
  async function handleComplete(taskId: string) {
    try { await completeFollowUp(taskId); await loadTasks(); }
    catch (err: any) { setError(err.message); }
  }

  async function handleReopen(taskId: string) {
    try { await reopenFollowUp(taskId); await loadTasks(); }
    catch (err: any) { setError(err.message); }
  }

  async function handleDelete(taskId: string) {
    if (!confirm('Delete this follow-up?')) return;
    try { await deleteFollowUp(taskId); await loadTasks(); }
    catch (err: any) { setError(err.message); }
  }

  async function handleCreate(params: CreateFollowUpParams) {
    try { await createFollowUp(params); setShowCreateModal(false); await loadTasks(); }
    catch (err: any) { setError(err.message); }
  }

  // ─── Render ──────────────────────────────────────────────
  return (
    <div style={{ background: '#0f1923', minHeight: '100vh', color: '#e2e8f0', display: 'flex', flexDirection: 'column' }}>

      {/* ── Top bar: title + search + new button ── */}
      <div style={{
        background: '#162232',
        borderBottom: '1px solid #1e3a4f',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 20, color: '#e2e8f0', lineHeight: 1.2 }}>Follow-Ups</div>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
            {overdueTasks.length > 0
              ? <><span style={{ color: '#f87171' }}>{overdueTasks.length} overdue</span> · {todayTasks.length} today · {upcomingTasks.length} upcoming</>
              : <>All caught up · {todayTasks.length} today · {upcomingTasks.length} upcoming</>
            }
          </div>
        </div>
        {/* Search hidden on mobile — shown below top bar instead */}
        {!isMobile && (
          <input
            placeholder="Search title or name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8,
              color: '#e2e8f0', padding: '9px 14px', fontSize: 13, outline: 'none',
              width: 220, flexShrink: 0,
            }}
          />
        )}
        <button
          onClick={() => setShowCreateModal(true)}
          style={{
            padding: '10px 22px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#0d7ea3', color: '#fff', fontWeight: 700, fontSize: 14,
            flexShrink: 0, whiteSpace: 'nowrap',
          }}
        >
          + New Follow-Up
        </button>
      </div>

      {/* ── Mobile search row ── */}
      {isMobile && (
        <div style={{ padding: '10px 16px', background: '#0f1923', borderBottom: '1px solid #1e3a4f' }}>
          <input
            placeholder="Search title or name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8,
              color: '#e2e8f0', padding: '10px 14px', fontSize: 14, outline: 'none',
              width: '100%', boxSizing: 'border-box',
            }}
          />
        </div>
      )}

      {/* ── Colorful filter tabs ── */}
      {isMobile ? (
        /* Mobile: icon-only, scrollable */
        <div style={{
          background: '#0c1a26',
          borderBottom: '1px solid #1e3a4f',
          padding: '10px 16px',
          display: 'flex',
          gap: 6,
          flexShrink: 0,
          overflowX: 'auto',
        }}>
          {STATUS_FILTERS.map(f => {
            const count = countFor(f.key);
            const isActive = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: `1px solid ${isActive ? f.color + '60' : f.border}`,
                  background: isActive ? f.bg : 'rgba(255,255,255,0.02)',
                  color: isActive ? f.color : '#475569',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  boxShadow: isActive ? `0 0 14px ${f.color}20` : 'none',
                }}
              >
                <span>{f.icon}</span>
                {count > 0 && (
                  <span style={{
                    background: isActive ? f.color + '30' : 'rgba(255,255,255,0.06)',
                    color: isActive ? f.color : '#64748b',
                    borderRadius: 20, padding: '1px 6px', fontSize: 11, fontWeight: 700,
                  }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        /* Desktop: full-width equal tabs — ORIGINAL layout preserved exactly */
        <div style={{
          background: '#0c1a26',
          borderBottom: '1px solid #1e3a4f',
          padding: '12px 24px',
          display: 'flex',
          gap: 8,
          flexShrink: 0,
        }}>
          {STATUS_FILTERS.map(f => {
            const count = countFor(f.key);
            const isActive = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 7,
                  padding: '11px 8px',
                  borderRadius: 10,
                  border: `1px solid ${isActive ? f.color + '60' : f.border}`,
                  background: isActive ? f.bg : 'rgba(255,255,255,0.02)',
                  color: isActive ? f.color : '#475569',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: isActive ? 700 : 500,
                  transition: 'all 0.12s',
                  boxShadow: isActive ? `0 0 14px ${f.color}20` : 'none',
                }}
                onMouseEnter={e => {
                  if (!isActive) {
                    e.currentTarget.style.background = f.bg;
                    e.currentTarget.style.color = f.color;
                    e.currentTarget.style.borderColor = f.border;
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = '#475569';
                    e.currentTarget.style.borderColor = f.border;
                  }
                }}
              >
                <span style={{ fontSize: 14 }}>{f.icon}</span>
                <span>{f.label}</span>
                {count > 0 && (
                  <span style={{
                    background: isActive ? f.color + '30' : 'rgba(255,255,255,0.06)',
                    color: isActive ? f.color : '#64748b',
                    borderRadius: 20,
                    padding: '1px 7px',
                    fontSize: 11,
                    fontWeight: 700,
                    minWidth: 20,
                    textAlign: 'center' as const,
                  }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Stats strip ── */}
      <div style={{
        display: 'flex',
        gap: 12,
        padding: isMobile ? '12px 16px' : '14px 24px',
        borderBottom: '1px solid #1e3a4f',
        background: '#0f1923',
        flexShrink: 0,
        overflowX: 'auto',
      }}>
        {[
          { label: 'Open',      val: String(tasks.length),          color: '#94a3b8' },
          { label: 'Overdue',   val: String(overdueTasks.length),   color: '#f87171' },
          { label: 'Due Today', val: String(todayTasks.length),     color: '#fbbf24' },
          { label: 'Completed', val: String(completedTasks.length), color: '#4ade80' },
        ].map(s => (
          <div key={s.label} style={{
            background: '#162232', border: '1px solid #1e3a4f', borderRadius: 10,
            padding: isMobile ? '8px 14px' : '10px 18px', flexShrink: 0, minWidth: isMobile ? 85 : 110,
          }}>
            <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>{s.label}</div>
            <div style={{ color: s.color, fontWeight: 800, fontSize: isMobile ? 18 : 20, marginTop: 3 }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div style={{
          margin: '12px 24px 0', padding: '10px 14px', borderRadius: 8,
          background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
          color: '#f87171', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      )}

      {/* ── Task list ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '12px 12px' : '16px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>Loading follow-ups…</div>
        ) : displayTasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>{filter === 'completed' ? '✅' : '📋'}</div>
            <div style={{ color: '#64748b', fontSize: 15 }}>
              {search ? 'No matching follow-ups' :
               filter === 'overdue' ? 'No overdue tasks — nice!' :
               filter === 'today' ? 'Nothing due today' :
               filter === 'upcoming' ? 'No upcoming tasks' :
               filter === 'completed' ? 'No completed tasks yet' :
               'No open follow-ups'}
            </div>
            {filter === 'all' && !search && (
              <button onClick={() => setShowCreateModal(true)} style={{
                marginTop: 16, padding: '10px 24px', borderRadius: 8, border: 'none',
                cursor: 'pointer', background: '#0d7ea3', color: '#fff', fontWeight: 700,
              }}>
                Create First Follow-Up
              </button>
            )}
          </div>
        ) : isMobile ? (
          /* ── MOBILE: card list ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {displayTasks.map(task => {
              const days = daysUntil(task.due_date);
              const isOverdue = days < 0 && !task.completed_at;
              const isToday = days === 0 && !task.completed_at;
              const isCompleted = !!task.completed_at;
              const entityName = getEntityNameFn(task);
              const entityType = getEntityType(task);

              const dueText = isCompleted ? formatDate(task.due_date) :
                isOverdue ? `${Math.abs(days)}d overdue` :
                isToday ? 'Due today' :
                days === 1 ? 'Tomorrow' :
                `In ${days}d`;

              const dueColor = isCompleted ? '#475569' :
                isOverdue ? '#f87171' : isToday ? '#fbbf24' :
                days <= 3 ? '#fb923c' : '#94a3b8';

              const typeBg =
                task.task_type === 'call_back' ? '#60a5fa' :
                task.task_type === 'google_review' ? '#fbbf24' :
                task.task_type === 'service_due' ? '#22d3ee' :
                task.task_type === 're_engage' ? '#a78bfa' : '#94a3b8';

              return (
                <div key={task.id} style={{
                  background: '#162232', border: '1px solid #1e3a4f', borderRadius: 12,
                  padding: '14px 16px', opacity: isCompleted ? 0.55 : 1,
                }}>
                  {/* Row 1: checkbox + title + due badge */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ paddingTop: 2, flexShrink: 0 }}>
                      {!isCompleted ? (
                        <button onClick={() => handleComplete(task.id)}
                          style={{ width: 22, height: 22, borderRadius: 5, border: '2px solid #475569', background: 'transparent', cursor: 'pointer' }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = '#4ade80'; e.currentTarget.style.background = 'rgba(74,222,128,0.15)'; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = '#475569'; e.currentTarget.style.background = 'transparent'; }}
                        />
                      ) : (
                        <button onClick={() => handleReopen(task.id)}
                          style={{ width: 22, height: 22, borderRadius: 5, border: 'none', background: '#16a34a', cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          ✓
                        </button>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: isCompleted ? '#64748b' : '#e2e8f0', textDecoration: isCompleted ? 'line-through' : 'none', flex: 1, minWidth: 0 }}>
                          {TASK_TYPE_ICONS[task.task_type]} {task.title}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: dueColor, flexShrink: 0 }}>{dueText}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: typeBg, background: typeBg + '22', padding: '2px 7px', borderRadius: 6 }}>
                          {TASK_TYPE_LABELS[task.task_type]}
                        </span>
                        {!isCompleted && <span style={{ fontSize: 11, color: '#475569' }}>{formatDate(task.due_date)}</span>}
                      </div>
                    </div>
                  </div>
                  {/* Entity link */}
                  {entityName && (
                    <button onClick={() => navigateToEntity(task)}
                      style={{ fontSize: 13, marginTop: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: entityType === 'lead' ? '#38bdf8' : '#4ade80', display: 'block' }}>
                      {entityType === 'lead' ? '⬡' : '👤'} {entityName}
                    </button>
                  )}
                  {/* Notes */}
                  {task.notes && (
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>{task.notes}</div>
                  )}
                  {/* Completed timestamp */}
                  {isCompleted && task.completed_at && (
                    <div style={{ fontSize: 11, color: '#475569', marginTop: 6 }}>
                      Completed {formatDateTime(task.completed_at)}
                    </div>
                  )}
                  {/* Delete */}
                  {role === 'admin' && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #1e3a4f' }}>
                      <button onClick={() => handleDelete(task.id)}
                        style={{ background: 'none', border: '1px solid #3f1a1a', borderRadius: 6, cursor: 'pointer', color: '#ef4444', fontSize: 12, fontWeight: 600, padding: '6px 12px' }}>
                        🗑 Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* ── DESKTOP: original row layout preserved exactly ── */
          <div style={{ background: '#162232', border: '1px solid #1e3a4f', borderRadius: 12, overflow: 'hidden' }}>
            {displayTasks.map((task, idx) => {
              const days = daysUntil(task.due_date);
              const isOverdue = days < 0 && !task.completed_at;
              const isToday = days === 0 && !task.completed_at;
              const isCompleted = !!task.completed_at;
              const entityName = getEntityNameFn(task);
              const entityType = getEntityType(task);

              const dueText = isCompleted ? formatDate(task.due_date) :
                isOverdue ? `${Math.abs(days)}d overdue` :
                isToday ? 'Due today' :
                days === 1 ? 'Tomorrow' :
                `In ${days}d`;

              const dueColor = isCompleted ? '#475569' :
                isOverdue ? '#f87171' :
                isToday ? '#fbbf24' :
                days <= 3 ? '#fb923c' :
                '#94a3b8';

              const typeBg =
                task.task_type === 'call_back' ? '#60a5fa' :
                task.task_type === 'google_review' ? '#fbbf24' :
                task.task_type === 'service_due' ? '#22d3ee' :
                task.task_type === 're_engage' ? '#a78bfa' :
                '#94a3b8';

              return (
                <div
                  key={task.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 14px',
                    borderBottom: idx < displayTasks.length - 1 ? '1px solid #1a2a3a' : 'none',
                    opacity: isCompleted ? 0.5 : 1,
                    transition: 'background 0.1s',
                    cursor: 'default',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#1a2e42'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {/* Checkbox */}
                  {!isCompleted ? (
                    <button
                      onClick={() => handleComplete(task.id)}
                      title="Mark complete"
                      style={{
                        width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                        border: '2px solid #475569', background: 'transparent', cursor: 'pointer',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#4ade80'; e.currentTarget.style.background = 'rgba(74,222,128,0.15)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#475569'; e.currentTarget.style.background = 'transparent'; }}
                    />
                  ) : (
                    <button
                      onClick={() => handleReopen(task.id)}
                      title="Reopen"
                      style={{
                        width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                        border: 'none', background: '#16a34a', cursor: 'pointer',
                        color: '#fff', fontSize: 11, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      ✓
                    </button>
                  )}

                  {/* Icon */}
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{TASK_TYPE_ICONS[task.task_type]}</span>

                  {/* Title + entity */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 13, fontWeight: 600,
                        color: isCompleted ? '#64748b' : '#e2e8f0',
                        textDecoration: isCompleted ? 'line-through' : 'none',
                      }}>
                        {task.title}
                      </span>
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: typeBg,
                        background: typeBg + '22', padding: '3px 8px', borderRadius: 6,
                      }}>
                        {TASK_TYPE_LABELS[task.task_type]}
                      </span>
                    </div>
                    {entityName && (
                      <button
                        onClick={() => navigateToEntity(task)}
                        style={{
                          fontSize: 12, marginTop: 2, background: 'none', border: 'none',
                          cursor: 'pointer', padding: 0,
                          color: entityType === 'lead' ? '#38bdf8' : '#4ade80',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
                        onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
                      >
                        {entityType === 'lead' ? '⬡' : '👤'} {entityName}
                      </button>
                    )}
                    {task.notes && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: 400 }}>
                        {task.notes}
                      </div>
                    )}
                    {isCompleted && task.completed_at && (
                      <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                        Completed {formatDateTime(task.completed_at)}
                      </div>
                    )}
                  </div>

                  {/* Due date */}
                  <div style={{ textAlign: 'right' as const, flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: dueColor }}>{dueText}</div>
                    {!isCompleted && <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{formatDate(task.due_date)}</div>}
                  </div>

                  {/* Delete */}
                  {role === 'admin' && (
                    <button
                      onClick={() => handleDelete(task.id)}
                      title="Delete"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#475569', fontSize: 14, padding: '4px 8px', lineHeight: 1,
                        borderRadius: 6,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#3f1a1a'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#475569'; e.currentTarget.style.background = 'none'; }}
                    >
                      🗑
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateFollowUpModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreate}
          userId={user?.id || null}
        />
      )}
    </div>
  );
}

// ============================================================
// CREATE MODAL
// ============================================================

function CreateFollowUpModal({ onClose, onCreate, userId }: {
  onClose: () => void;
  onCreate: (params: CreateFollowUpParams) => void;
  userId: string | null;
}) {
  const [taskType, setTaskType] = useState<FollowUpTaskType>('call_back');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState(new Date().toISOString().split('T')[0]);
  const [entityType, setEntityType] = useState<'none' | 'lead' | 'customer'>('none');
  const [entitySearch, setEntitySearch] = useState('');
  const [entityResults, setEntityResults] = useState<any[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  function handleTypeChange(type: FollowUpTaskType) {
    setTaskType(type);
    if (!title || Object.values(TASK_TYPE_LABELS).some(l => title.startsWith(l))) {
      setTitle(`${TASK_TYPE_LABELS[type]} follow-up`);
    }
  }

  async function searchEntities(query: string) {
    if (query.length < 2) { setEntityResults([]); return; }
    setSearching(true);
    try {
      if (entityType === 'lead') {
        const { data } = await supabase.from('leads').select('id, full_name, phone, stage')
          .or(`full_name.ilike.%${query}%,phone.ilike.%${query}%`)
          .not('stage', 'in', '(won,lost,dnd)')
          .limit(5);
        setEntityResults(data || []);
      } else if (entityType === 'customer') {
        const { data } = await supabase.from('customers').select('id, full_name, phone, lifecycle_status')
          .or(`full_name.ilike.%${query}%,phone.ilike.%${query}%`)
          .limit(5);
        setEntityResults(data || []);
      }
    } catch { setEntityResults([]); }
    finally { setSearching(false); }
  }

  function handleSubmit() {
    if (!title.trim() || !dueDate) return;
    setSaving(true);
    onCreate({
      task_type: taskType,
      title: title.trim(),
      notes: notes.trim() || null,
      due_date: dueDate,
      lead_id: entityType === 'lead' && selectedEntity ? selectedEntity.id : null,
      customer_id: entityType === 'customer' && selectedEntity ? selectedEntity.id : null,
      assigned_to: userId,
    });
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: '#0f1923', border: '1px solid #1e3a4f',
    color: '#e2e8f0', fontSize: 14, borderRadius: 8, padding: '10px 14px',
    outline: 'none', boxSizing: 'border-box' as const,
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50,
    }}>
      <div style={{
        background: '#162232', border: '1px solid #1e3a4f', borderRadius: 12,
        width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px', borderBottom: '1px solid #1e3a4f',
          position: 'sticky', top: 0, background: '#162232', zIndex: 1,
        }}>
          <div>
            <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 18 }}>New Follow-Up</div>
            <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>Create a task</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Task type */}
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 6 }}>Type</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(Object.keys(TASK_TYPE_LABELS) as FollowUpTaskType[]).map(type => (
                <button
                  key={type}
                  onClick={() => handleTypeChange(type)}
                  style={{
                    fontSize: 12, padding: '6px 12px', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
                    border: taskType === type ? '1px solid #0d7ea3' : '1px solid #1e3a4f',
                    background: taskType === type ? 'rgba(13,126,163,0.15)' : 'transparent',
                    color: taskType === type ? '#22d3ee' : '#64748b',
                    transition: 'all 0.15s',
                  }}
                >
                  {TASK_TYPE_ICONS[type]} {TASK_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 6 }}>
              Title <span style={{ color: '#f87171' }}>*</span>
            </label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Call back about softener quote" style={inputStyle} />
          </div>

          {/* Due date */}
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 6 }}>
              Due Date <span style={{ color: '#f87171' }}>*</span>
            </label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={inputStyle} />
          </div>

          {/* Link to entity */}
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 6 }}>Link to</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {(['none', 'lead', 'customer'] as const).map(et => (
                <button
                  key={et}
                  onClick={() => { setEntityType(et); setSelectedEntity(null); setEntitySearch(''); setEntityResults([]); }}
                  style={{
                    fontSize: 12, padding: '6px 12px', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
                    border: entityType === et ? '1px solid #1e3a4f' : '1px solid #1e3a4f',
                    background: entityType === et ? 'rgba(255,255,255,0.06)' : 'transparent',
                    color: entityType === et ? '#e2e8f0' : '#64748b',
                  }}
                >
                  {et === 'none' ? 'No link' : et === 'lead' ? '⬡ Lead' : '👤 Customer'}
                </button>
              ))}
            </div>

            {entityType !== 'none' && !selectedEntity && (
              <div style={{ position: 'relative' }}>
                <input type="text" value={entitySearch}
                  onChange={e => { setEntitySearch(e.target.value); searchEntities(e.target.value); }}
                  placeholder={`Search ${entityType}s by name or phone…`}
                  style={inputStyle} />
                {entityResults.length > 0 && (
                  <div style={{
                    position: 'absolute', zIndex: 10, width: '100%', marginTop: 4,
                    background: '#162232', border: '1px solid #1e3a4f', borderRadius: 8, overflow: 'hidden',
                  }}>
                    {entityResults.map((entity: any) => (
                      <button key={entity.id}
                        onClick={() => { setSelectedEntity(entity); setEntityResults([]); }}
                        style={{
                          display: 'flex', flexDirection: 'column', width: '100%', padding: '12px 14px',
                          background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                          borderBottom: '1px solid #1a2a3a',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#1e3a5f')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                      >
                        <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 14 }}>{entity.full_name}</span>
                        <span style={{ color: '#64748b', fontSize: 12 }}>{entity.phone} · {entity.stage || entity.lifecycle_status}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedEntity && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8, padding: '10px 14px',
              }}>
                <span style={{ fontSize: 14 }}>{entityType === 'lead' ? '⬡' : '👤'}</span>
                <span style={{ fontSize: 14, color: '#e2e8f0', flex: 1 }}>{selectedEntity.full_name}</span>
                <button onClick={() => setSelectedEntity(null)} style={{
                  background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14,
                }}>×</button>
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 6 }}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Additional details…" rows={2}
              style={{ ...inputStyle, resize: 'none' as const }} />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12,
          padding: '16px 24px', borderTop: '1px solid #1e3a4f',
          position: 'sticky', bottom: 0, background: '#162232',
        }}>
          <button onClick={onClose} style={{
            padding: '8px 16px', fontSize: 13, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer',
          }}>Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || !dueDate || saving}
            style={{
              padding: '10px 22px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: (!title.trim() || !dueDate || saving) ? '#0d7ea350' : '#0d7ea3',
              color: '#fff', fontWeight: 700, fontSize: 14,
              opacity: (!title.trim() || !dueDate || saving) ? 0.5 : 1,
            }}
          >
            {saving ? 'Creating…' : 'Create Follow-Up'}
          </button>
        </div>
      </div>
    </div>
  );
}
