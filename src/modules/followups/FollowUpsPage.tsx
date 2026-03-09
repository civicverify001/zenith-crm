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

  // ─── Filter logic ────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];

  const overdueTasks = tasks.filter(t => t.due_date < today);
  const todayTasks = tasks.filter(t => t.due_date === today);
  const upcomingTasks = tasks.filter(t => t.due_date > today);

  const displayTasks = filter === 'all' ? tasks
    : filter === 'overdue' ? overdueTasks
    : filter === 'today' ? todayTasks
    : filter === 'upcoming' ? upcomingTasks
    : completedTasks;

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
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Follow-Ups</h1>
          <p className="text-sm text-muted mt-1">
            {overdueTasks.length > 0 ? (
              <span style={{ color: '#f87171' }}>{overdueTasks.length} overdue</span>
            ) : 'All caught up'} · {todayTasks.length} today · {upcomingTasks.length} upcoming
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + New Follow-Up
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-white">×</button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2">
        {([
          { key: 'all', label: `All Open (${tasks.length})` },
          { key: 'overdue', label: `Overdue (${overdueTasks.length})`, urgent: overdueTasks.length > 0 },
          { key: 'today', label: `Today (${todayTasks.length})` },
          { key: 'upcoming', label: `Upcoming (${upcomingTasks.length})` },
          { key: 'completed', label: `Completed (${completedTasks.length})` },
        ] as { key: FilterView; label: string; urgent?: boolean }[]).map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
              filter === f.key
                ? f.urgent ? 'bg-red-900/50 text-red-400 ring-1 ring-red-700' : 'bg-gray-700 text-white'
                : f.urgent ? 'text-red-400 hover:bg-red-900/30' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Task list */}
      {displayTasks.length === 0 ? (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-8 text-center">
          <div className="text-3xl mb-2">{filter === 'completed' ? '✅' : '📋'}</div>
          <div className="text-sm text-gray-400">
            {filter === 'overdue' ? 'No overdue tasks — nice!' :
             filter === 'today' ? 'Nothing due today' :
             filter === 'upcoming' ? 'No upcoming tasks' :
             filter === 'completed' ? 'No completed tasks yet' :
             'No open follow-ups. Create one to get started.'}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {displayTasks.map(task => {
            const days = daysUntil(task.due_date);
            const isOverdue = days < 0 && !task.completed_at;
            const isToday = days === 0 && !task.completed_at;
            const isCompleted = !!task.completed_at;
            const entityName = getEntityName(task);
            const entityType = getEntityType(task);

            return (
              <div
                key={task.id}
                className={`bg-gray-800/50 border rounded-xl p-4 transition-colors ${
                  isOverdue ? 'border-red-700/40' :
                  isToday ? 'border-yellow-700/40' :
                  isCompleted ? 'border-gray-700/50 opacity-60' :
                  'border-gray-700'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Left: Task info */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {/* Complete checkbox */}
                    {!isCompleted ? (
                      <button
                        onClick={() => handleComplete(task.id)}
                        className="mt-0.5 w-5 h-5 rounded border-2 border-gray-600 hover:border-green-500 hover:bg-green-900/30 flex-shrink-0 transition-colors"
                        title="Mark complete"
                      />
                    ) : (
                      <button
                        onClick={() => handleReopen(task.id)}
                        className="mt-0.5 w-5 h-5 rounded bg-green-600 flex items-center justify-center flex-shrink-0 text-white text-xs"
                        title="Reopen"
                      >
                        ✓
                      </button>
                    )}

                    <div className="flex-1 min-w-0">
                      {/* Title row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm">{TASK_TYPE_ICONS[task.task_type]}</span>
                        <span className={`text-sm font-medium ${isCompleted ? 'text-gray-500 line-through' : 'text-white'}`}>
                          {task.title}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          task.task_type === 'call_back' ? 'bg-blue-900/50 text-blue-400' :
                          task.task_type === 'google_review' ? 'bg-yellow-900/50 text-yellow-400' :
                          task.task_type === 'service_due' ? 'bg-cyan-900/50 text-cyan-400' :
                          task.task_type === 're_engage' ? 'bg-purple-900/50 text-purple-400' :
                          'bg-gray-700 text-gray-400'
                        }`}>
                          {TASK_TYPE_LABELS[task.task_type]}
                        </span>
                      </div>

                      {/* Entity link */}
                      {entityName && (
                        <button
                          onClick={() => navigateToEntity(task)}
                          className="text-xs mt-1 hover:underline"
                          style={{ color: entityType === 'lead' ? '#38bdf8' : '#4ade80' }}
                        >
                          {entityType === 'lead' ? '⬡' : '👤'} {entityName}
                        </button>
                      )}

                      {/* Notes */}
                      {task.notes && (
                        <p className="text-xs text-gray-500 mt-1 truncate max-w-md">{task.notes}</p>
                      )}

                      {/* Completed info */}
                      {isCompleted && task.completed_at && (
                        <div className="text-xs text-gray-600 mt-1">
                          Completed {formatDateTime(task.completed_at)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: Due date + actions */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {/* Due date */}
                    <div className="text-right">
                      <div className={`text-xs font-medium ${
                        isCompleted ? 'text-gray-600' :
                        isOverdue ? 'text-red-400' :
                        isToday ? 'text-yellow-400' :
                        days <= 3 ? 'text-orange-400' :
                        'text-gray-400'
                      }`}>
                        {isCompleted ? formatDate(task.due_date) :
                         isOverdue ? `${Math.abs(days)}d overdue` :
                         isToday ? 'Due today' :
                         days === 1 ? 'Tomorrow' :
                         `In ${days}d`}
                      </div>
                      <div className="text-[10px] text-gray-600">{formatDate(task.due_date)}</div>
                    </div>

                    {/* Delete */}
                    {role === 'admin' && (
                      <button
                        onClick={() => handleDelete(task.id)}
                        className="text-gray-600 hover:text-red-400 text-sm transition-colors"
                        title="Delete"
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

  // Auto-fill title based on task type
  function handleTypeChange(type: FollowUpTaskType) {
    setTaskType(type);
    if (!title || Object.values(TASK_TYPE_LABELS).some(l => title.startsWith(l))) {
      setTitle(`${TASK_TYPE_LABELS[type]} follow-up`);
    }
  }

  // Entity search
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <h2 className="text-lg font-bold text-white">New Follow-Up</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">×</button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Task type */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Type</label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(TASK_TYPE_LABELS) as FollowUpTaskType[]).map(type => (
                <button
                  key={type}
                  onClick={() => handleTypeChange(type)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                    taskType === type
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  {TASK_TYPE_ICONS[type]} {TASK_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Title <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Call back about softener quote"
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Due date */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Due Date <span className="text-red-400">*</span></label>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Link to entity */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Link to</label>
            <div className="flex gap-2 mb-2">
              {(['none', 'lead', 'customer'] as const).map(et => (
                <button
                  key={et}
                  onClick={() => { setEntityType(et); setSelectedEntity(null); setEntitySearch(''); setEntityResults([]); }}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    entityType === et
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {et === 'none' ? 'No link' : et === 'lead' ? '⬡ Lead' : '👤 Customer'}
                </button>
              ))}
            </div>

            {entityType !== 'none' && !selectedEntity && (
              <div className="relative">
                <input
                  type="text"
                  value={entitySearch}
                  onChange={e => { setEntitySearch(e.target.value); searchEntities(e.target.value); }}
                  placeholder={`Search ${entityType}s by name or phone...`}
                  className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {entityResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden shadow-xl">
                    {entityResults.map((entity: any) => (
                      <button
                        key={entity.id}
                        onClick={() => { setSelectedEntity(entity); setEntityResults([]); }}
                        className="w-full px-3 py-2 text-left hover:bg-gray-700 transition-colors"
                      >
                        <div className="text-sm text-white">{entity.full_name}</div>
                        <div className="text-xs text-gray-500">{entity.phone} · {entity.stage || entity.lifecycle_status}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedEntity && (
              <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
                <span className="text-sm">{entityType === 'lead' ? '⬡' : '👤'}</span>
                <span className="text-sm text-white flex-1">{selectedEntity.full_name}</span>
                <button onClick={() => setSelectedEntity(null)} className="text-gray-500 hover:text-white text-xs">×</button>
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Additional details..."
              rows={2}
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || !dueDate || saving}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saving ? 'Creating...' : 'Create Follow-Up'}
          </button>
        </div>
      </div>
    </div>
  );
}
