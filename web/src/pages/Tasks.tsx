import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api, TaskData } from '../lib/api';
import { formatDate } from '../lib/utils';
import { SearchInput } from '../components/SearchInput';

type TaskStatus = TaskData['status'];
type Task = TaskData;

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'var(--warning)',
  in_progress: 'var(--accent)',
  done: 'var(--green)',
  failed: 'var(--red)',
  cancelled: 'var(--text-secondary)',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'Running',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};


function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '10px',
        fontSize: '11px',
        fontWeight: 600,
        color: 'var(--text-on-accent)',
        backgroundColor: STATUS_COLORS[status],
      }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function PriorityDots({ priority }: { priority: number }) {
  if (priority === 0) return <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>-</span>;
  const filled = Math.min(priority, 10);
  return (
    <span title={`Priority: ${priority}/10`} style={{ fontSize: '11px', letterSpacing: '1px' }}>
      {'●'.repeat(Math.min(filled, 5))}
      {'○'.repeat(Math.max(0, 5 - filled))}
    </span>
  );
}

function truncate(s: string | null | undefined, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '...' : s;
}

export function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskStatus | ''>('');
  const [searchQuery, setSearchQuery] = useState('');

  // Detail panel
  const [selected, setSelected] = useState<Task | null>(null);

  // Clean dropdown + confirm modal
  const [cleanMenuOpen, setCleanMenuOpen] = useState(false);
  const [cleanConfirm, setCleanConfirm] = useState<TaskStatus | null>(null);
  const cleanRef = useRef<HTMLDivElement>(null);

  // Always fetch ALL tasks so filter counts are accurate
  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.tasksList();
      const all = res.data ?? [];
      setTasks(all);
      // Refresh selected task if it's still in the list
      setSelected((prev) => {
        if (!prev) return null;
        return all.find((t: Task) => t.id === prev.id) ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Poll only while a task is active (pending/in_progress), like the Dashboard.
  const hasActiveTask = tasks.some((t) => t.status === 'pending' || t.status === 'in_progress');
  useEffect(() => {
    if (!hasActiveTask) return;
    const id = setInterval(loadTasks, 5000);
    return () => clearInterval(id);
  }, [hasActiveTask, loadTasks]);

  // Close clean dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (cleanRef.current && !cleanRef.current.contains(e.target as Node)) {
        setCleanMenuOpen(false);
      }
    }
    if (cleanMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [cleanMenuOpen]);

  const handleClean = async (status: TaskStatus) => {
    setCleanConfirm(null);
    setCleanMenuOpen(false);
    try {
      await api.tasksClean(status);
      setError(null);
      loadTasks();
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const cancelTask = async (id: string) => {
    if (!confirm('Cancel this task?')) return;
    try {
      await api.tasksCancel(id);
      loadTasks();
      if (selected?.id === id) setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const deleteTask = async (id: string) => {
    if (!confirm('Permanently delete this task?')) return;
    try {
      await api.tasksDelete(id);
      loadTasks();
      if (selected?.id === id) setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Counts from ALL tasks, filter for display
  const counts = tasks.reduce(
    (acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const terminalCount = (counts['done'] || 0) + (counts['failed'] || 0) + (counts['cancelled'] || 0);
  const statusFiltered = filter ? tasks.filter((t) => t.status === filter) : tasks;
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const filteredTasks = trimmedQuery
    ? statusFiltered.filter((t) =>
        t.description.toLowerCase().includes(trimmedQuery) ||
        (t.reason ?? '').toLowerCase().includes(trimmedQuery) ||
        t.id.toLowerCase().includes(trimmedQuery)
      )
    : statusFiltered;

  return (
    <div>
      <div className="header">
        <h1>Tasks</h1>
        <p>Scheduled and queued agent tasks</p>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: '14px' }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: '10px', padding: '2px 8px', fontSize: '12px' }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Stats bar */}
      <div className="card" style={{ padding: '10px 14px', marginBottom: '14px', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', overflow: 'visible', position: 'relative', zIndex: 2, borderRadius: 'var(--radius-pill)' }}>
        <span
          onClick={() => setFilter('')}
          style={{
            cursor: 'pointer',
            fontWeight: filter === '' ? 'bold' : 'normal',
            color: filter === '' ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontSize: '13px',
          }}
        >
          All ({tasks.length})
        </span>
        {(['pending', 'in_progress', 'done', 'failed', 'cancelled'] as TaskStatus[]).map((s) => (
          <span
            key={s}
            onClick={() => setFilter(filter === s ? '' : s)}
            style={{
              cursor: 'pointer',
              fontWeight: filter === s ? 'bold' : 'normal',
              color: filter === s ? STATUS_COLORS[s] : 'var(--text-secondary)',
              fontSize: '13px',
            }}
          >
            {STATUS_LABELS[s]} ({counts[s] || 0})
          </span>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search tasks..." />
          {trimmedQuery && (
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              {filteredTasks.length} of {statusFiltered.length} tasks
            </span>
          )}
        </div>

        {/* Clean dropdown */}
        {terminalCount > 0 && (
          <div ref={cleanRef} style={{ position: 'relative' }}>
            <button
              className="btn-ghost btn-sm"
              onClick={() => setCleanMenuOpen(!cleanMenuOpen)}
            >
              Clean
            </button>
            {cleanMenuOpen && (
              <div
                className="custom-select-menu"
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '4px',
                  zIndex: 10,
                  minWidth: '170px',
                  width: 'auto',
                }}
              >
                {(['done', 'failed', 'cancelled'] as TaskStatus[])
                  .filter((s) => (counts[s] || 0) > 0)
                  .map((s) => (
                    <div
                      key={s}
                      className="custom-select-option"
                      onClick={() => { setCleanMenuOpen(false); setCleanConfirm(s); }}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: STATUS_COLORS[s], flexShrink: 0 }} />
                      {STATUS_LABELS[s]} ({counts[s]})
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
        <button
          className="btn-ghost btn-sm"
          onClick={loadTasks}
        >
          Refresh
        </button>
      </div>

      {/* Clean confirmation modal */}
      {cleanConfirm && (
        <div className="modal-overlay" onClick={() => setCleanConfirm(null)}>
          <div className="modal" style={{ maxWidth: '380px' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: '4px' }}>Clean {STATUS_LABELS[cleanConfirm].toLowerCase()} tasks</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
              Permanently delete all {counts[cleanConfirm] || 0}{' '}
              <span style={{ color: STATUS_COLORS[cleanConfirm], fontWeight: 600 }}>
                {STATUS_LABELS[cleanConfirm].toLowerCase()}
              </span>{' '}
              tasks? This cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn-ghost" onClick={() => setCleanConfirm(null)}>Cancel</button>
              <button className="btn-danger btn-sm" onClick={() => handleClean(cleanConfirm)}>
                Delete {counts[cleanConfirm] || 0} tasks
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center' }}>Loading...</div>
        ) : filteredTasks.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            {trimmedQuery
              ? 'No tasks match your search'
              : filter ? `No ${STATUS_LABELS[filter].toLowerCase()} tasks` : 'No tasks yet'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', tableLayout: 'fixed' }}>
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                }}
              >
                <th style={{ textAlign: 'left', padding: '8px 14px' }}>Description</th>
                <th style={{ textAlign: 'center', padding: '8px 10px', width: 80 }}>Status</th>
                <th style={{ textAlign: 'center', padding: '8px 10px', width: 60 }}>Priority</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', width: 120 }}>Scheduled</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', width: 120 }}>Created</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', width: 70 }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((task) => {
                const isExpanded = selected?.id === task.id;
                return (
                  <React.Fragment key={task.id}>
                    <tr
                      onClick={() => setSelected(isExpanded ? null : task)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(isExpanded ? null : task); } }}
                      tabIndex={0}
                      role="button"
                      style={{
                        cursor: 'pointer',
                        borderBottom: isExpanded ? 'none' : '1px solid var(--border)',
                        backgroundColor: isExpanded ? 'var(--glass-micro)' : undefined,
                      }}
                      className="file-row"
                    >
                      <td style={{ padding: '8px 14px' }}>
                        <div>
                          <span style={{ display: 'inline-block', width: '14px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                            {isExpanded ? '\u25BC' : '\u25B6'}
                          </span>
                          {truncate(task.description, 80)}
                        </div>
                        {task.reason && (
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', paddingLeft: '14px' }}>
                            {truncate(task.reason, 60)}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'center', padding: '8px 10px' }}>
                        <StatusBadge status={task.status} />
                      </td>
                      <td style={{ textAlign: 'center', padding: '8px 10px' }}>
                        <PriorityDots priority={task.priority} />
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px 14px', color: 'var(--text-secondary)' }}>
                        {formatDate(task.scheduledFor)}
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px 14px', color: 'var(--text-secondary)' }}>
                        {formatDate(task.createdAt)}
                      </td>
                      <td
                        style={{ textAlign: 'right', padding: '8px 14px', whiteSpace: 'nowrap' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {(task.status === 'pending' || task.status === 'in_progress') && (
                          <button className="icon-button" aria-label="Cancel task" onClick={() => cancelTask(task.id)} title="Cancel">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                          </button>
                        )}
                        <button className="icon-button" aria-label="Delete task" onClick={() => deleteTask(task.id)} title="Delete">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </td>
                    </tr>
                    {isExpanded && selected && (
                      <tr style={{ backgroundColor: 'var(--glass-micro)', borderBottom: '1px solid var(--border)' }}>
                        <td colSpan={6} style={{ padding: '0 14px 14px 14px', overflow: 'hidden' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', fontSize: '13px', padding: '10px 0' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>ID</span>
                            <code style={{ fontSize: '11px', wordBreak: 'break-all' }}>{selected.id}</code>

                            <span style={{ color: 'var(--text-secondary)' }}>Status</span>
                            <span><StatusBadge status={selected.status} /></span>

                            <span style={{ color: 'var(--text-secondary)' }}>Priority</span>
                            <span>{selected.priority}/10</span>

                            <span style={{ color: 'var(--text-secondary)' }}>Description</span>
                            <span>{selected.description}</span>

                            {selected.reason && (
                              <>
                                <span style={{ color: 'var(--text-secondary)' }}>Reason</span>
                                <span>{selected.reason}</span>
                              </>
                            )}

                            <span style={{ color: 'var(--text-secondary)' }}>Created by</span>
                            <span>{selected.createdBy || '\u2014'}</span>

                            <span style={{ color: 'var(--text-secondary)' }}>Created</span>
                            <span>{formatDate(selected.createdAt)}</span>

                            <span style={{ color: 'var(--text-secondary)' }}>Scheduled for</span>
                            <span>{formatDate(selected.scheduledFor)}</span>

                            <span style={{ color: 'var(--text-secondary)' }}>Started</span>
                            <span>{formatDate(selected.startedAt)}</span>

                            <span style={{ color: 'var(--text-secondary)' }}>Completed</span>
                            <span>{formatDate(selected.completedAt)}</span>

                            {selected.dependencies.length > 0 && (
                              <>
                                <span style={{ color: 'var(--text-secondary)' }}>Depends on</span>
                                <span style={{ fontSize: '11px' }}>{selected.dependencies.length} task(s)</span>
                              </>
                            )}

                            {selected.dependents.length > 0 && (
                              <>
                                <span style={{ color: 'var(--text-secondary)' }}>Dependents</span>
                                <span style={{ fontSize: '11px' }}>{selected.dependents.length} task(s)</span>
                              </>
                            )}
                          </div>

                          {selected.payload && (
                            <div style={{ marginTop: '4px' }}>
                              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Payload</div>
                              <pre
                                style={{
                                  padding: '8px',
                                  borderRadius: '4px',
                                  backgroundColor: 'rgba(0,0,0,0.2)',
                                  fontSize: '11px',
                                  overflow: 'auto',
                                  maxHeight: '150px',
                                  margin: 0,
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                }}
                              >
                                {(() => {
                                  try {
                                    return JSON.stringify(JSON.parse(selected.payload!), null, 2);
                                  } catch {
                                    return selected.payload;
                                  }
                                })()}
                              </pre>
                            </div>
                          )}

                          {selected.result && (
                            <div style={{ marginTop: '12px' }}>
                              <div style={{ fontSize: '12px', color: 'var(--green)', marginBottom: '4px' }}>Result</div>
                              <pre
                                style={{
                                  padding: '8px',
                                  borderRadius: '4px',
                                  backgroundColor: 'rgba(0,0,0,0.2)',
                                  fontSize: '11px',
                                  overflow: 'auto',
                                  maxHeight: '200px',
                                  margin: 0,
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                }}
                              >
                                {truncate(selected.result, 2000)}
                              </pre>
                            </div>
                          )}

                          {selected.error && (
                            <div style={{ marginTop: '12px' }}>
                              <div style={{ fontSize: '12px', color: 'var(--red)', marginBottom: '4px' }}>Error</div>
                              <pre
                                style={{
                                  padding: '8px',
                                  borderRadius: '4px',
                                  backgroundColor: 'var(--red-dim)',
                                  fontSize: '11px',
                                  overflow: 'auto',
                                  maxHeight: '150px',
                                  margin: 0,
                                  color: 'var(--red)',
                                }}
                              >
                                {selected.error}
                              </pre>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
