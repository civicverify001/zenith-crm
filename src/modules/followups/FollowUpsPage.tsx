import { useState, useEffect } from 'react';
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

type FilterView = 'all' | 'overdue' | 'today' | 'upcoming' | 'completed';

// ── Tab color config (matches Quotes/Invoices pattern) ──
const TAB_CONFIG: Record<FilterView, { label: string; icon: string; color: string; bg: string; glow: string; border: string }> = {
  all:       { label: 'All Open',  icon: '📋', color: '#38bdf8', bg: 'rgba(56,189,248,0.10)',  glow: '0 0 20px rgba(56,189,248,0.25)',  border: 'rgba(56,189,248,0.30)' },
  overdue:   { label: 'Overdue',   icon: '🔴', color: '#f87171', bg: 'rgba(248,113,113,0.10)', glow: '0 0 20px rgba(248,113,113,0.25)', border: 'rgba(248,113,113,0.30)' },
  today:     { label: 'Today',     icon: '🟡', color: '#fbbf24', bg: 'rgba(251,191,36,0.10)',  glow: '0 0 20px rgba(251,191,36,0.25)',  border: 'rgba(251,191,36,0.30)' },
  upcoming:  { label: 'Upcoming',  icon: '🔵', color: '#818cf8', bg: 'rgba(129,140,248,0.10)', glow: '0 0 20px rgba(129,140,248,0.25)', border: 'rgba(129,140,248,0.30)' },
  completed: { label: 'Completed', icon: '✅', color: '#4ade80', bg: 'rgba(74,222,128,0.10)',  glow: '0 0 20px rgba(74,222,128,0.25)',  border: 'rgba(74,222,128,0.30)' },
};

// ============================================================
// COMPONENT
// ============================================================

export function FollowUpsPage() {
  const { user, role } = useAuth();
  const navigate = useNavigate();

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

      // Fetch entity names for display
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

  // ─── Filter + search logic ───────────────────────────────
  const today = new Date().toISOString().split('T')[0];

  const overdueTasks = tasks.filter(t => t.due_date < today);
  const todayTasks = tasks.filter(t => t.due_date === today);
  const upcomingTasks = tasks.filter(t => t.due_date > today);

  const counts: Record<FilterView, number> = {
    all: tasks.length,
    overdue: overdueTasks.length,
    today: todayTasks.length,
    upcoming: upcomingTasks.length,
    completed: completedTasks.length,
  };

  const baseTasks = filter === 'all' ? tasks
    : filter === 'overdue' ? overdueTasks
    : filter === 'today' ? todayTasks
    : filter === 'upcoming' ? upcomingTasks
    : completedTasks;

  const displayTasks = search.trim()
    ? baseTasks.filter(t => {
        const q = search.toLowerCase();
        const eName = getEntityName(t)?.toLowerCase() || '';
        return t.title.toLowerCase().includes(q) || eName.includes(q) || (t.notes || '').toLowerCase().includes(q);
      })
    : baseTasks;

  // ─── Actions ─────────────────────────────────────────────
  async function handleComplete(taskId: string) {
    try {
      await completeFollowUp(taskId);
      await loadTasks();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleReopen(taskId: string) {
    try {
      await reopenFollowUp(taskId);
      await loadTasks();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDelete(taskId: string) {
    if (!confirm('Delete this follow-up?')) return;
    try {
      await deleteFollowUp(taskId);
      await loadTasks();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleCreate(params: CreateFollowUpParams) {
    try {
      await createFollowUp(params);
      setShowCreateModal(false);
      await loadTasks();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function getEntityName(task: FollowUpTask): string | null {
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

  // ─── Render ──────────────────────────────────────────────
  if (loading) {
    return <div className="flex items-center justify-center h-full"><div className="text-muted text-sm">Loading follow-ups...</div></div>;
  }

  return (
    <div className="space-y-0 w-full">

      {/* ── Header bar: title + search + button ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 24px 16px', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <h1 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 22, margin: 0 }}>Follow-Ups</h1>
          <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
            {overdueTasks.length > 0 ? (
              <span style={{ color: '#f87171', fontWeight: 600 }}>{overdueTasks.length} overdue</span>
            ) : (
              <span style={{ color: '#4ade80' }}>All caught up</span>
            )}
            {' · '}{todayTasks.length} today · {upcomingTasks.length} upcoming
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search tasks..."
              style={{
                backgroundColor: 'rgba(30,58,79,0.5)', border: '1px solid #1e3a4f',
                color: '#e2e8f0', fontSize: 13, borderRadius: 8,
                padding: '8px 12px 8px 32px', width: 200, outline: 'none',
              }}
            />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 13 }}>🔍</span>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            style={{
              padding: '8px 18px', backgroundColor: '#2563eb', color: '#fff',
              fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none',
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            + New Follow-Up
          </button>
        </div>
      </div>

      {/* ── Colorful tabs ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 0, padding: '0 24px',
      }}>
        {(Object.keys(TAB_CONFIG) as FilterView[]).map(key => {
          const cfg = TAB_CONFIG[key];
          const active = filter === key;
          const count = counts[key];
          const hasUrgent = key === 'overdue' && count > 0;

          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 4, padding: '14px 8px', cursor: 'pointer',
                border: active ? `1px solid ${cfg.border}` : '1px solid transparent',
                borderBottom: active ? `2px solid ${cfg.color}` : '2px solid transparent',
                borderRadius: '10px 10px 0 0',
                background: active ? cfg.bg : 'transparent',
                boxShadow: active ? cfg.glow : 'none',
                transition: 'all 0.2s ease',
                position: 'relative',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 15 }}>{cfg.icon}</span>
                <span style={{
                  fontSize: 12, fontWeight: 600, letterSpacing: '0.02em',
                  color: active ? cfg.color : '#64748b',
                  transition: 'color 0.2s',
                }}>
                  {cfg.label}
                </span>
              </div>

              {/* Count badge */}
              <span style={{
                fontSize: 18, fontWeight: 700,
                color: active ? cfg.color : '#475569',
                lineHeight: 1,
                transition: 'color 0.2s',
              }}>
                {count}
              </span>

              {/* Urgent pulse for overdue when not active */}
              {hasUrgent && !active && (
                <span style={{
                  position: 'absolute', top: 8, right: 12,
                  width: 7, height: 7, borderRadius: '50%',
                  backgroundColor: '#f87171',
                  animation: 'pulse-dot 2s infinite',
                }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: '#1e3a4f', margin: '0 24px' }} />

      {/* ── Stats strip ── */}
      <div style={{
        display: 'flex', gap: 24, padding: '12px 24px',
        borderBottom: '1px solid rgba(30,58,79,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#f87171' }} />
          <span style={{ color: '#94a3b8', fontSize: 12 }}>Overdue</span>
          <span style={{ color: overdueTasks.length > 0 ? '#f87171' : '#475569', fontSize: 13, fontWeight: 700 }}>
            {overdueTasks.length}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#fbbf24' }} />
          <span style={{ color: '#94a3b8', fontSize: 12 }}>Due Today</span>
          <span style={{ color: todayTasks.length > 0 ? '#fbbf24' : '#475569', fontSize: 13, fontWeight: 700 }}>
            {todayTasks.length}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#4ade80' }} />
          <span style={{ color: '#94a3b8', fontSize: 12 }}>Completed This Week</span>
          <span style={{ color: '#475569', fontSize: 13, fontWeight: 700 }}>
            {completedTasks.filter(t => {
              if (!t.completed_at) return false;
              const d = new Date(t.completed_at);
              const now = new Date();
              const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
              return d >= weekAgo;
            }).length}
          </span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          margin: '8px 24px', padding: '10px 14px', borderRadius: 8,
          background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
          color: '#fca5a5', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      )}

      {/* ── Task list ── */}
      <div style={{ padding: '16px 24px 32px' }}>
        {displayTasks.length === 0 ? (
          <div style={{
            background: 'rgba(30,58,79,0.25)', border: '1px solid #1e3a4f',
            borderRadius: 12, padding: '48px 24px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>{filter === 'completed' ? '✅' : filter === 'overdue' ? '🎉' : '📋'}</div>
            <div style={{ color: '#64748b', fontSize: 14 }}>
              {search.trim() ? 'No tasks match your search.' :
               filter === 'overdue' ? 'No overdue tasks — nice!' :
               filter === 'today' ? 'Nothing due today.' :
               filter === 'upcoming' ? 'No upcoming tasks.' :
               filter === 'completed' ? 'No completed tasks yet.' :
               'No open follow-ups. Create one to get started.'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {displayTasks.map(task => {
              const days = daysUntil(task.due_date);
              const isOverdue = days < 0 && !task.completed_at;
              const isToday = days === 0 && !task.completed_at;
              const isCompleted = !!task.completed_at;
              const entityName = getEntityName(task);
              const entityType = getEntityType(task);

              const borderColor = isOverdue ? 'rgba(248,113,113,0.3)' :
                isToday ? 'rgba(251,191,36,0.3)' :
                isCompleted ? 'rgba(71,85,105,0.3)' : '#1e3a4f';

              return (
                <div
                  key={task.id}
                  style={{
                    background: 'rgba(30,58,79,0.2)', border: `1px solid ${borderColor}`,
                    borderRadius: 10, padding: '12px 16px',
                    opacity: isCompleted ? 0.55 : 1,
                    transition: 'all 0.15s',
                    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
                  }}
                >
                  {/* Left: checkbox + task info */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
                    {/* Checkbox */}
                    {!isCompleted ? (
                      <button
                        onClick={() => handleComplete(task.id)}
                        style={{
                          marginTop: 2, width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                          border: '2px solid #475569', background: 'transparent', cursor: 'pointer',
                          transition: 'border-color 0.15s',
                        }}
                        onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = '#4ade80'; (e.target as HTMLElement).style.background = 'rgba(74,222,128,0.1)'; }}
                        onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = '#475569'; (e.target as HTMLElement).style.background = 'transparent'; }}
                        title="Mark complete"
                      />
                    ) : (
                      <button
                        onClick={() => handleReopen(task.id)}
                        style={{
                          marginTop: 2, width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                          border: 'none', background: '#22c55e', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontSize: 12, fontWeight: 700,
                        }}
                        title="Reopen"
                      >
                        ✓
                      </button>
                    )}

                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Title row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14 }}>{TASK_TYPE_ICONS[task.task_type]}</span>
                        <span style={{
                          fontSize: 14, fontWeight: 600,
                          color: isCompleted ? '#64748b' : '#e2e8f0',
                          textDecoration: isCompleted ? 'line-through' : 'none',
                        }}>
                          {task.title}
                        </span>
                        <span style={{
                          fontSize: 10, padding: '2px 7px', borderRadius: 5, fontWeight: 600,
                          letterSpacing: '0.02em',
                          ...(task.task_type === 'call_back' ? { background: 'rgba(59,130,246,0.15)', color: '#60a5fa' } :
                              task.task_type === 'google_review' ? { background: 'rgba(251,191,36,0.15)', color: '#fbbf24' } :
                              task.task_type === 'service_due' ? { background: 'rgba(6,182,212,0.15)', color: '#22d3ee' } :
                              task.task_type === 're_engage' ? { background: 'rgba(168,85,247,0.15)', color: '#c084fc' } :
                              { background: 'rgba(100,116,139,0.2)', color: '#94a3b8' }),
                        }}>
                          {TASK_TYPE_LABELS[task.task_type]}
                        </span>
                      </div>

                      {/* Entity link */}
                      {entityName && (
                        <button
                          onClick={() => navigateToEntity(task)}
                          style={{
                            fontSize: 12, marginTop: 4, background: 'none', border: 'none',
                            cursor: 'pointer', padding: 0,
                            color: entityType === 'lead' ? '#38bdf8' : '#4ade80',
                          }}
                          onMouseEnter={e => { (e.target as HTMLElement).style.textDecoration = 'underline'; }}
                          onMouseLeave={e => { (e.target as HTMLElement).style.textDecoration = 'none'; }}
                        >
                          {entityType === 'lead' ? '⬡' : '👤'} {entityName}
                        </button>
                      )}

                      {/* Notes */}
                      {task.notes && (
                        <p style={{
                          fontSize: 12, color: '#64748b', marginTop: 4,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400,
                        }}>{task.notes}</p>
                      )}

                      {/* Completed info */}
                      {isCompleted && task.completed_at && (
                        <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                          Completed {formatDateTime(task.completed_at)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: due date + delete */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{
                        fontSize: 12, fontWeight: 600,
                        color: isCompleted ? '#475569' :
                          isOverdue ? '#f87171' :
                          isToday ? '#fbbf24' :
                          days <= 3 ? '#fb923c' : '#94a3b8',
                      }}>
                        {isCompleted ? formatDate(task.due_date) :
                         isOverdue ? `${Math.abs(days)}d overdue` :
                         isToday ? 'Due today' :
                         days === 1 ? 'Tomorrow' :
                         `In ${days}d`}
                      </div>
                      <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>{formatDate(task.due_date)}</div>
                    </div>

                    {role === 'admin' && (
                      <button
                        onClick={() => handleDelete(task.id)}
                        style={{
                          color: '#475569', background: 'none', border: 'none',
                          cursor: 'pointer', fontSize: 16, lineHeight: 1,
                          transition: 'color 0.15s',
                        }}
                        onMouseEnter={e => { (e.target as HTMLElement).style.color = '#f87171'; }}
                        onMouseLeave={e => { (e.target as HTMLElement).style.color = '#475569'; }}
                        title="Delete"
                      >
                        ×
                      </button>
                    )}
                  </div>
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

      {/* Pulse animation for overdue dot */}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.4); }
        }
      `}</style>
    </div>
  );
}

// ============================================================
// CREATE MODAL (unchanged logic, matching dark theme)
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

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50,
    }}>
      <div style={{
        backgroundColor: '#111827', border: '1px solid #1e3a4f',
        borderRadius: 12, width: '100%', maxWidth: 440,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 20px', borderBottom: '1px solid #1e3a4f',
        }}>
          <h2 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 17, margin: 0 }}>New Follow-Up</h2>
          <button onClick={onClose} style={{ color: '#64748b', fontSize: 20, background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Task type */}
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Type</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(Object.keys(TASK_TYPE_LABELS) as FollowUpTaskType[]).map(type => (
                <button
                  key={type}
                  onClick={() => handleTypeChange(type)}
                  style={{
                    fontSize: 12, padding: '6px 10px', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
                    border: 'none', transition: 'all 0.15s',
                    ...(taskType === type
                      ? { backgroundColor: '#2563eb', color: '#fff' }
                      : { backgroundColor: 'rgba(30,58,79,0.5)', color: '#94a3b8' }),
                  }}
                >
                  {TASK_TYPE_ICONS[type]} {TASK_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Title <span style={{ color: '#f87171' }}>*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Call back about softener quote"
              style={{
                width: '100%', backgroundColor: 'rgba(30,58,79,0.5)', border: '1px solid #1e3a4f',
                color: '#e2e8f0', fontSize: 13, borderRadius: 8, padding: '9px 12px', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Due date */}
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Due Date <span style={{ color: '#f87171' }}>*</span>
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              style={{
                width: '100%', backgroundColor: 'rgba(30,58,79,0.5)', border: '1px solid #1e3a4f',
                color: '#e2e8f0', fontSize: 13, borderRadius: 8, padding: '9px 12px', outline: 'none',
                boxSizing: 'border-box', colorScheme: 'dark',
              }}
            />
          </div>

          {/* Link to entity */}
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Link to</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {(['none', 'lead', 'customer'] as const).map(et => (
                <button
                  key={et}
                  onClick={() => { setEntityType(et); setSelectedEntity(null); setEntitySearch(''); setEntityResults([]); }}
                  style={{
                    fontSize: 12, padding: '6px 12px', borderRadius: 8, fontWeight: 600,
                    cursor: 'pointer', border: 'none', transition: 'all 0.15s',
                    ...(entityType === et
                      ? { backgroundColor: 'rgba(100,116,139,0.3)', color: '#e2e8f0' }
                      : { backgroundColor: 'transparent', color: '#64748b' }),
                  }}
                >
                  {et === 'none' ? 'No link' : et === 'lead' ? '⬡ Lead' : '👤 Customer'}
                </button>
              ))}
            </div>

            {entityType !== 'none' && !selectedEntity && (
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={entitySearch}
                  onChange={e => { setEntitySearch(e.target.value); searchEntities(e.target.value); }}
                  placeholder={`Search ${entityType}s by name or phone...`}
                  style={{
                    width: '100%', backgroundColor: 'rgba(30,58,79,0.5)', border: '1px solid #1e3a4f',
                    color: '#e2e8f0', fontSize: 13, borderRadius: 8, padding: '9px 12px', outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                {entityResults.length > 0 && (
                  <div style={{
                    position: 'absolute', zIndex: 10, width: '100%', marginTop: 4,
                    backgroundColor: '#1e293b', border: '1px solid #1e3a4f', borderRadius: 8,
                    overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  }}>
                    {entityResults.map((entity: any) => (
                      <button
                        key={entity.id}
                        onClick={() => { setSelectedEntity(entity); setEntityResults([]); }}
                        style={{
                          width: '100%', padding: '10px 12px', textAlign: 'left',
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          borderBottom: '1px solid rgba(30,58,79,0.5)',
                        }}
                        onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(56,189,248,0.08)'; }}
                        onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent'; }}
                      >
                        <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>{entity.full_name}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{entity.phone} · {entity.stage || entity.lifecycle_status}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedEntity && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                backgroundColor: 'rgba(30,58,79,0.5)', border: '1px solid #1e3a4f',
                borderRadius: 8, padding: '9px 12px',
              }}>
                <span style={{ fontSize: 13 }}>{entityType === 'lead' ? '⬡' : '👤'}</span>
                <span style={{ fontSize: 13, color: '#e2e8f0', flex: 1 }}>{selectedEntity.full_name}</span>
                <button onClick={() => setSelectedEntity(null)} style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>×</button>
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Additional details..."
              rows={2}
              style={{
                width: '100%', backgroundColor: 'rgba(30,58,79,0.5)', border: '1px solid #1e3a4f',
                color: '#e2e8f0', fontSize: 13, borderRadius: 8, padding: '9px 12px', outline: 'none',
                resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
          padding: '16px 20px', borderTop: '1px solid #1e3a4f',
        }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 16px', fontSize: 13, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || !dueDate || saving}
            style={{
              padding: '8px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8,
              border: 'none', cursor: (!title.trim() || !dueDate || saving) ? 'not-allowed' : 'pointer',
              backgroundColor: (!title.trim() || !dueDate || saving) ? '#1e3a5f' : '#2563eb',
              color: (!title.trim() || !dueDate || saving) ? '#64748b' : '#fff',
              transition: 'all 0.15s',
            }}
          >
            {saving ? 'Creating...' : 'Create Follow-Up'}
          </button>
        </div>
      </div>
    </div>
  );
}
