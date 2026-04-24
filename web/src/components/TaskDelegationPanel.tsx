import { useState } from 'react';
import type {
  AgentOverview,
  TaskData,
  TaskDelegationTreeData,
  TaskSubtaskNodeData,
  TaskSubtaskStatus,
} from '../lib/api';

const SUBTASK_STATUS_COLORS: Record<TaskSubtaskStatus, string> = {
  pending: '#f0ad4e',
  delegated: '#7d8cff',
  in_progress: '#5bc0de',
  done: '#5cb85c',
  failed: '#d9534f',
  cancelled: '#777',
};

const SUBTASK_STATUS_LABELS: Record<TaskSubtaskStatus, string> = {
  pending: 'Pending',
  delegated: 'Delegated',
  in_progress: 'Running',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function SubtaskStatusBadge({ status }: { status: TaskSubtaskStatus }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '10px',
        fontSize: '11px',
        fontWeight: 600,
        color: '#fff',
        backgroundColor: SUBTASK_STATUS_COLORS[status],
        whiteSpace: 'nowrap',
      }}
    >
      {SUBTASK_STATUS_LABELS[status]}
    </span>
  );
}

function AgentBadge({ agentId, agents }: { agentId?: string; agents: AgentOverview[] }) {
  const agent = agents.find((item) => item.id === agentId);
  return (
    <span
      title={agent?.description || agentId || 'Unassigned'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        maxWidth: '180px',
        padding: '2px 8px',
        borderRadius: '10px',
        border: '1px solid var(--separator)',
        color: agentId ? 'var(--text)' : 'var(--text-secondary)',
        fontSize: '11px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {agent?.name || agentId || 'Unassigned'}
    </span>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncate(s: string | null | undefined, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '...' : s;
}

function SubtaskNode({
  node,
  agents,
  collapsed,
  onToggle,
  onAssign,
  onRetry,
}: {
  node: TaskSubtaskNodeData;
  agents: AgentOverview[];
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onAssign: (subtaskId: string, agentId: string) => void;
  onRetry: (subtaskId: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const agentId = e.dataTransfer.getData('text/plain');
        if (agentId) onAssign(node.id, agentId);
      }}
      style={{
        marginLeft: node.depth > 1 ? '18px' : 0,
        padding: '8px 0 8px 12px',
        borderLeft: node.depth > 1 ? '1px solid var(--separator)' : 'none',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: '10px',
          alignItems: 'start',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', minWidth: 0 }}>
            <button
              className="icon-button"
              onClick={() => hasChildren && onToggle(node.id)}
              disabled={!hasChildren}
              title={hasChildren ? 'Toggle subtasks' : undefined}
              style={{ opacity: hasChildren ? 1 : 0.25, width: '20px', height: '20px' }}
            >
              {hasChildren ? (isCollapsed ? '\u25B6' : '\u25BC') : '\u2022'}
            </button>
            <span style={{ fontSize: '13px', wordBreak: 'break-word' }}>{node.description}</span>
          </div>
          {(node.requiredSkills.length > 0 ||
            node.requiredTools.length > 0 ||
            node.dependencies.length > 0) && (
            <div
              style={{
                display: 'flex',
                gap: '6px',
                flexWrap: 'wrap',
                paddingLeft: '28px',
                marginTop: '5px',
                color: 'var(--text-secondary)',
                fontSize: '11px',
              }}
            >
              {node.requiredSkills.map((skill) => (
                <span key={skill}>#{skill}</span>
              ))}
              {node.requiredTools.map((tool) => (
                <code key={tool} style={{ fontSize: '11px' }}>
                  {tool}
                </code>
              ))}
              {node.dependencies.length > 0 && <span>{node.dependencies.length} dependency</span>}
            </div>
          )}
          {node.error && (
            <div
              style={{
                paddingLeft: '28px',
                marginTop: '5px',
                color: '#d9534f',
                fontSize: '11px',
              }}
            >
              {truncate(node.error, 180)}
            </div>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
          }}
        >
          <SubtaskStatusBadge status={node.status} />
          <AgentBadge agentId={node.agentId} agents={agents} />
          <select
            value={node.agentId || ''}
            onChange={(e) => e.target.value && onAssign(node.id, e.target.value)}
            style={{
              maxWidth: '150px',
              fontSize: '12px',
              background: 'transparent',
              color: 'var(--text)',
              border: '1px solid var(--separator)',
              borderRadius: '6px',
              padding: '3px 6px',
            }}
          >
            <option value="">Assign</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          {node.status === 'failed' && (
            <button className="btn-ghost btn-sm" onClick={() => onRetry(node.id)}>
              Retry
            </button>
          )}
        </div>
      </div>
      {hasChildren && !isCollapsed && (
        <div>
          {node.children.map((child) => (
            <SubtaskNode
              key={child.id}
              node={child}
              agents={agents}
              collapsed={collapsed}
              onToggle={onToggle}
              onAssign={onAssign}
              onRetry={onRetry}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskDelegationPanel({
  task,
  tree,
  agents,
  loading,
  manualDescription,
  manualAgentId,
  onManualDescription,
  onManualAgent,
  onDecompose,
  onCreateManual,
  onDelegateRoot,
  onAssign,
  onRetry,
}: {
  task: TaskData;
  tree: TaskDelegationTreeData | null;
  agents: AgentOverview[];
  loading: boolean;
  manualDescription: string;
  manualAgentId: string;
  onManualDescription: (value: string) => void;
  onManualAgent: (value: string) => void;
  onDecompose: () => void;
  onCreateManual: () => void;
  onDelegateRoot: () => void;
  onAssign: (subtaskId: string, agentId: string) => void;
  onRetry: (subtaskId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const hasTree = Boolean(tree && tree.subtasks.length > 0);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div style={{ marginTop: '14px', borderTop: '1px solid var(--separator)', paddingTop: '12px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
          marginBottom: '10px',
        }}
      >
        <strong style={{ fontSize: '13px' }}>Delegation</strong>
        <button className="btn-ghost btn-sm" onClick={onDecompose} disabled={loading}>
          Decompose
        </button>
        <select
          value={manualAgentId}
          onChange={(e) => onManualAgent(e.target.value)}
          style={{
            fontSize: '12px',
            background: 'transparent',
            color: 'var(--text)',
            border: '1px solid var(--separator)',
            borderRadius: '6px',
            padding: '4px 6px',
          }}
        >
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <button
          className="btn-ghost btn-sm"
          onClick={onDelegateRoot}
          disabled={loading || agents.length === 0}
        >
          Delegate Task
        </button>
      </div>

      {agents.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
          {agents.map((agent) => (
            <span
              key={agent.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', agent.id)}
              title={agent.description}
              style={{
                cursor: 'grab',
                border: '1px solid var(--separator)',
                borderRadius: '10px',
                padding: '3px 8px',
                fontSize: '11px',
                color: 'var(--text-secondary)',
              }}
            >
              {agent.name}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={manualDescription}
          onChange={(e) => onManualDescription(e.target.value)}
          placeholder="Manual subtask"
          style={{
            flex: '1 1 260px',
            minWidth: 0,
            padding: '6px 8px',
            fontSize: '13px',
            border: '1px solid var(--separator)',
            borderRadius: '6px',
            backgroundColor: 'transparent',
            color: 'var(--text)',
          }}
        />
        <button
          className="btn-ghost btn-sm"
          onClick={onCreateManual}
          disabled={!manualDescription.trim() || loading}
        >
          Add
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
          Loading delegation...
        </div>
      ) : hasTree && tree ? (
        <>
          <div
            style={{
              border: '1px solid var(--separator)',
              borderRadius: '6px',
              padding: '2px 10px',
            }}
          >
            {tree.roots.map((node) => (
              <SubtaskNode
                key={node.id}
                node={node}
                agents={agents}
                collapsed={collapsed}
                onToggle={toggle}
                onAssign={onAssign}
                onRetry={onRetry}
              />
            ))}
          </div>
          {tree.timeline.length > 0 && (
            <div style={{ marginTop: '10px' }}>
              <div
                style={{ color: 'var(--text-secondary)', fontSize: '12px', marginBottom: '4px' }}
              >
                Timeline
              </div>
              <div style={{ display: 'grid', gap: '4px', fontSize: '12px' }}>
                {tree.timeline.slice(-8).map((event) => (
                  <div
                    key={event.id}
                    style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '8px' }}
                  >
                    <span style={{ color: 'var(--text-secondary)' }}>{formatDate(event.at)}</span>
                    <span>{event.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
          No delegated subtasks for {truncate(task.description, 80)}
        </div>
      )}
    </div>
  );
}
