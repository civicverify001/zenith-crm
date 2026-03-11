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

type FilterView = 'all' | 'overdue' | 'today' | 'upcoming' | 'completed';

// ============================================================
// TAB CONFIG — colorful full-width tabs
// ============================================================

const TAB_CONFIG: {
  key: FilterView;
  label: string;
  icon: string;
  color: string;
  bg: string;
  glow: string;
  border: string;
  hoverBg: string;
}[] = [
  {
    key: 'all',
    label: 'All Open',
    icon: '📋',
    color: '#38bdf8',
    bg: 'rgba(56,189,248,0.10)',
    glow: '0 0 20px rgba(56,189,248,0.15)',
    border: 'rgba(56,189,248,0.3)',
    hoverBg: 'rgba(56,189,248,0.06)',
  },
  {
    key: 'overdue',
    label: 'Overdue',
    icon: '🔴',
    color: '#f87171',
    bg: 'rgba(248,113,113,0.10)',
    glow: '0 0 20px rgba(248,113,113,0.15)',
    border: 'rgba(248,113,113,0.3)',
    hoverBg: 'rgba(248,113,113,0.06)',
  },
  {
    key: 'today',
    label: 'Today',
    icon: '🟡',
    color: '#fbbf24',
    bg: 'rgba(251,191,36,0.10)',
    glow: '0 0 20px rgba(251,191,36,0.15)',
    border: 'rgba(251,191,36,0.3)',
    hoverBg: 'rgba(251,191,36,0.06)',
  },
  {
    key: 'upcoming',
    label: 'Upcoming',
    icon: '📅',
    color: '#a78bfa',
    bg: 'rgba(167,139,250,0.10)',
    glow: '0 0 20px rgba(167,139,250,0.15)',
    border: 'rgba(167,139,250,0.3)',
    hoverBg: 'rgba(167,139,250,0.06)',
  },
  {
    key: 'completed',
    label: 'Completed',
    icon: '✅',
    color: '#4ade80',
    bg: 'rgba(74,222,128,0.10)',
    glow: '0 0 20px rgba(74,222,128,0.15)',
    border: 'rgba(74,222,128,0.3)',
    hoverBg: 'rgba(74,222,128,0.06)',
  },
];

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
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [entityNames, setEntityNames] = useState<Record<string, string>>({});
  const [hoveredTab, setHoveredTab] = useState<FilterView | null>(null);

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

  const counts: Record<FilterView, number> = {
    all: tasks.length,
    overdue: overdueTasks.length,
    today: todayTasks.length,
    upcoming: upcomingTasks.length,
    completed: completedTasks.length,
  };

  const baseFilteredTasks = filter === 'all' ? tasks
    : filter === 'overdue' ? overdueTasks
    : filter === 'today' ? todayTasks
    : filter === 'upcoming' ? upcomingTasks
    : completedTasks;

  // Search filter
  const displayTasks = useMemo(() => {
    if (!searchQuery.trim()) return baseFilteredTasks;
    const q = searchQuery.toLowerCase();
    return baseFilteredTasks.filter(t => {
      const entityName = getEntityNameFn(t);
      return (
        t.title.toLowerCase().includes(q) ||
        (t.notes && t.notes.toLowerCase().includes(q)) ||
        (entityName && entityName.toLowerCase().includes(q))
      );
    });
  }, [baseFilteredTasks, searchQuery, entityNames]);

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

  // ─── Render ──────────────────────────────────────────────
  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div style={{ color: '#64748b', fontSize: 14 }}>Loading follow-ups...</div>
    </div>;
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>

      {/* ── Header row: title + search + button ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap', marginBottom: 20,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 24, margin: 0 }}>Follow-Ups</h1>
          <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
            {overdueTasks.length > 0 ? (
              <span style={{ color: '#f87171', fontWeight: 600 }}>{overdueTasks.length} overdue</span>
            ) : <span style={{ color: '#4ade80' }}>All caught up</span>} · {todayTasks.length} today · {upcomingTasks.length} upcoming
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14, pointerEvents: 'none' }}>🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search follow-ups..."
              style={{
                background: 'rgba(30,58,79,0.5)', border: '1px solid #1e3a4f', borderRadius: 8,
                color: '#e2e8f0', fontSize: 13, padding: '8px 12px 8px 32px', width: 200,
                outline: 'none',
              }}
            />
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            style={{
              padding: '9px 18px', backgroundColor: '#2563eb', color: '#fff',
              fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none',
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            + New Follow-Up
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 16, borderRadius: 8,
          background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
          color: '#f87171', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      )}

      {/* ── Colorful Full-Width Tabs ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${TAB_CONFIG.length}, 1fr)`,
        gap: 0,
        marginBottom: 16,
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid #1e3a4f',
      }}>
        {TAB_CONFIG.map((tab, idx) => {
          const active = filter === tab.key;
          const hovered = hoveredTab === tab.key;
          const count = counts[tab.key];

          return (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              onMouseEnter={() => setHoveredTab(tab.key)}
              onMouseLeave={() => setHoveredTab(null)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 4, padding: '14px 8px', cursor: 'pointer',
                background: active ? tab.bg : hovered ? tab.hoverBg : 'rgba(15,25,35,0.6)',
                borderRight: idx < TAB_CONFIG.length - 1 ? '1px solid #1e3a4f' : 'none',
                border: 'none',
                borderBottom: active ? `2px solid ${tab.color}` : '2px solid transparent',
                boxShadow: active ? tab.glow : 'none',
                transition: 'all 0.2s ease',
                position: 'relative',
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>{tab.icon}</span>
              <span style={{
                fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
                color: active ? tab.color : hovered ? tab.color : '#64748b',
                transition: 'color 0.2s',
              }}>
                {tab.label}
              </span>
              <span style={{
                fontSize: 18, fontWeight: 700, lineHeight: 1,
                color: active ? tab.color : '#94a3b8',
                transition: 'color 0.2s',
              }}>
                {count}
              </span>

              {/* Pulse dot on overdue if count > 0 */}
              {tab.key === 'overdue' && count > 0 && (
                <span style={{
                  position: 'absolute', top: 8, right: 8,
                  width: 8, height: 8, borderRadius: '50%',
                  backgroundColor: '#f87171',
                  boxShadow: '0 0 8px rgba(248,113,113,0.6)',
                  animation: 'followup-pulse 2s infinite',
                }} />
              )}
            </button>
          );
        })}
      </div>

      <style>{`
        @keyframes followup-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* ── Stats strip ── */}
      <div style={{
        display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap',
      }}>
        {overdueTasks.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 8,
            background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
          }}>
            <span style={{ color: '#f87171', fontSize: 12, fontWeight: 600 }}>⚠ {overdueTasks.length} overdue</span>
            <span style={{ color: '#64748b', fontSize: 11 }}>
              — oldest {overdueTasks.length > 0 ? `${Math.abs(daysUntil(overdueTasks.sort((a, b) => a.due_date.localeCompare(b.due_date))[0]?.due_date || today_str))}d ago` : ''}
            </span>
          </div>
        )}
        {todayTasks.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 8,
            background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)',
          }}>
            <span style={{ color: '#fbbf24', fontSize: 12, fontWeight: 600 }}>{todayTasks.length} due today</span>
          </div>
        )}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 14px', borderRadius: 8,
          background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)',
        }}>
          <span style={{ color: '#4ade80', fontSize: 12, fontWeight: 600 }}>{completedTasks.length} completed</span>
        </div>
      </div>

      {/* ── Task list ── */}
      {displayTasks.length === 0 ? (
        <div style={{
          background: 'rgba(30,58,79,0.3)', border: '1px solid #1e3a4f', borderRadius: 12,
          padding: '48px 24px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>{filter === 'completed' ? '✅' : '📋'}</div>
          <div style={{ color: '#64748b', fontSize: 14 }}>
            {searchQuery ? 'No matching follow-ups' :
             filter === 'overdue' ? 'No overdue tasks — nice!' :
             filter === 'today' ? 'Nothing due today' :
             filter === 'upcoming' ? 'No upcoming tasks' :
             filter === 'completed' ? 'No completed tasks yet' :
             'No open follow-ups. Create one to get started.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {displayTasks.map(task => {
            const days = daysUntil(task.due_date);
            const isOverdue = days < 0 && !task.completed_at;
            const isToday = days === 0 && !task.completed_at;
            const isCompleted = !!task.completed_at;
            const entityName = getEntityNameFn(task);
            const entityType = getEntityType(task);

            return (
              <div
                key={task.id}
                style={{
                  background: 'rgba(30,58,79,0.3)',
                  border: `1px solid ${
                    isOverdue ? 'rgba(248,113,113,0.3)' :
                    isToday ? 'rgba(251,191,36,0.3)' :
                    isCompleted ? 'rgba(100,116,139,0.2)' :
                    '#1e3a4f'
                  }`,
                  borderRadius: 12,
                  padding: '14px 16px',
                  opacity: isCompleted ? 0.6 : 1,
                  transition: 'border-color 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  {/* Left: checkbox + info */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1, minWidth: 0 }}>
                    {/* Checkbox */}
                    {!isCompleted ? (
                      <button
                        onClick={() => handleComplete(task.id)}
                        title="Mark complete"
                        style={{
                          marginTop: 2, width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                          border: '2px solid #475569', background: 'transparent', cursor: 'pointer',
                          transition: 'border-color 0.15s, background 0.15s',
                        }}
                        onMouseEnter={e => { const el = e.currentTarget; el.style.borderColor = '#4ade80'; el.style.background = 'rgba(74,222,128,0.15)'; }}
                        onMouseLeave={e => { const el = e.currentTarget; el.style.borderColor = '#475569'; el.style.background = 'transparent'; }}
                      />
                    ) : (
                      <button
                        onClick={() => handleReopen(task.id)}
                        title="Reopen"
                        style={{
                          marginTop: 2, width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                          border: 'none', background: '#16a34a', cursor: 'pointer',
                          color: '#fff', fontSize: 11, fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
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
                          fontSize: 10, padding: '2px 8px', borderRadius: 6, fontWeight: 600,
                          background:
                            task.task_type === 'call_back' ? 'rgba(59,130,246,0.15)' :
                            task.task_type === 'google_review' ? 'rgba(251,191,36,0.15)' :
                            task.task_type === 'service_due' ? 'rgba(6,182,212,0.15)' :
                            task.task_type === 're_engage' ? 'rgba(167,139,250,0.15)' :
                            'rgba(100,116,139,0.2)',
                          color:
                            task.task_type === 'call_back' ? '#60a5fa' :
                            task.task_type === 'google_review' ? '#fbbf24' :
                            task.task_type === 'service_due' ? '#22d3ee' :
                            task.task_type === 're_engage' ? '#a78bfa' :
                            '#94a3b8',
                          border: `1px solid ${
                            task.task_type === 'call_back' ? 'rgba(59,130,246,0.25)' :
                            task.task_type === 'google_review' ? 'rgba(251,191,36,0.25)' :
                            task.task_type === 'service_due' ? 'rgba(6,182,212,0.25)' :
                            task.task_type === 're_engage' ? 'rgba(167,139,250,0.25)' :
                            'rgba(100,116,139,0.3)'
                          }`,
                        }}>
                          {TASK_TYPE_LABELS[task.task_type]}
                        </span>
                      </div>

                      {/* Entity link */}
                      {entityName && (
                        <button
                          onClick={() => navigateToEntity(task)}
                          style={{
                            fontSize: 12, marginTop: 4, background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                            color: entityType === 'lead' ? '#38bdf8' : '#4ade80',
                            textDecoration: 'none',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
                          onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
                        >
                          {entityType === 'lead' ? '⬡' : '👤'} {entityName}
                        </button>
                      )}

                      {/* Notes */}
                      {task.notes && (
                        <p style={{ fontSize: 12, color: '#64748b', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400, margin: '4px 0 0' }}>
                          {task.notes}
                        </p>
                      )}

                      {/* Completed info */}
                      {isCompleted && task.completed_at && (
                        <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                          Completed {formatDateTime(task.completed_at)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: due date + actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{
                        fontSize: 12, fontWeight: 600,
                        color: isCompleted ? '#475569' :
                          isOverdue ? '#f87171' :
                          isToday ? '#fbbf24' :
                          days <= 3 ? '#fb923c' :
                          '#94a3b8',
                      }}>
                        {isCompleted ? formatDate(task.due_date) :
                         isOverdue ? `${Math.abs(days)}d overdue` :
                         isToday ? 'Due today' :
                         days === 1 ? 'Tomorrow' :
                         `In ${days}d`}
                      </div>
                      {!isCompleted && (
                        <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{formatDate(task.due_date)}</div>
                      )}
                    </div>

                    {/* Delete */}
                    {role === 'admin' && (
                      <button
                        onClick={() => handleDelete(task.id)}
                        title="Delete"
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: '#475569', fontSize: 16, padding: 4,
                          transition: 'color 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#475569'; }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
    width: '100%', background: 'rgba(30,58,79,0.5)', border: '1px solid #1e3a4f',
    color: '#e2e8f0', fontSize: 13, borderRadius: 8, padding: '8px 12px', outline: 'none',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50,
    }}>
      <div style={{
        background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 16,
        width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 20px', borderBottom: '1px solid #1e3a4f',
        }}>
          <h2 style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 18, margin: 0 }}>New Follow-Up</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Task type */}
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 600 }}>TYPE</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(Object.keys(TASK_TYPE_LABELS) as FollowUpTaskType[]).map(type => (
                <button
                  key={type}
                  onClick={() => handleTypeChange(type)}
                  style={{
                    fontSize: 12, padding: '6px 12px', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
                    border: taskType === type ? '1px solid rgba(37,99,235,0.4)' : '1px solid #1e3a4f',
                    background: taskType === type ? 'rgba(37,99,235,0.15)' : 'rgba(30,58,79,0.3)',
                    color: taskType === type ? '#60a5fa' : '#94a3b8',
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
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 600 }}>
              TITLE <span style={{ color: '#f87171' }}>*</span>
            </label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Call back about softener quote" style={inputStyle} />
          </div>

          {/* Due date */}
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 600 }}>
              DUE DATE <span style={{ color: '#f87171' }}>*</span>
            </label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={inputStyle} />
          </div>

          {/* Link to entity */}
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 600 }}>LINK TO</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {(['none', 'lead', 'customer'] as const).map(et => (
                <button
                  key={et}
                  onClick={() => { setEntityType(et); setSelectedEntity(null); setEntitySearch(''); setEntityResults([]); }}
                  style={{
                    fontSize: 12, padding: '6px 12px', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
                    border: entityType === et ? '1px solid rgba(100,116,139,0.4)' : '1px solid #1e3a4f',
                    background: entityType === et ? 'rgba(100,116,139,0.15)' : 'transparent',
                    color: entityType === et ? '#e2e8f0' : '#64748b',
                    transition: 'all 0.15s',
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
                  style={inputStyle}
                />
                {entityResults.length > 0 && (
                  <div style={{
                    position: 'absolute', zIndex: 10, width: '100%', marginTop: 4,
                    background: '#0f1923', border: '1px solid #1e3a4f', borderRadius: 8,
                    overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  }}>
                    {entityResults.map((entity: any) => (
                      <button
                        key={entity.id}
                        onClick={() => { setSelectedEntity(entity); setEntityResults([]); }}
                        style={{
                          width: '100%', padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                          background: 'transparent', border: 'none', borderBottom: '1px solid #1e3a4f',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(30,58,79,0.5)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <div style={{ fontSize: 13, color: '#e2e8f0' }}>{entity.full_name}</div>
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
                background: 'rgba(30,58,79,0.5)', border: '1px solid #1e3a4f', borderRadius: 8,
                padding: '8px 12px',
              }}>
                <span style={{ fontSize: 14 }}>{entityType === 'lead' ? '⬡' : '👤'}</span>
                <span style={{ fontSize: 13, color: '#e2e8f0', flex: 1 }}>{selectedEntity.full_name}</span>
                <button onClick={() => setSelectedEntity(null)} style={{
                  background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14,
                }}>×</button>
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 600 }}>NOTES</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Additional details..."
              rows={2}
              style={{ ...inputStyle, resize: 'none' as const }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12,
          padding: '16px 20px', borderTop: '1px solid #1e3a4f',
        }}>
          <button onClick={onClose} style={{
            padding: '8px 16px', fontSize: 13, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer',
          }}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || !dueDate || saving}
            style={{
              padding: '9px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
              background: (!title.trim() || !dueDate || saving) ? 'rgba(37,99,235,0.3)' : '#2563eb',
              color: '#fff', border: 'none',
              opacity: (!title.trim() || !dueDate || saving) ? 0.5 : 1,
            }}
          >
            {saving ? 'Creating...' : 'Create Follow-Up'}
          </button>
        </div>
      </div>
    </div>
  );
}
