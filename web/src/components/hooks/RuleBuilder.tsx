/**
 * Visual Rule Builder — block-based rule editor for Hooks page.
 * Supports Trigger, Condition, and Action blocks assembled into rules.
 * Rules can be drag-and-drop reordered for priority.
 */

import { useState, useCallback } from 'react';
import type {
  StructuredRule,
  RuleBlock,
  TriggerBlock,
  ConditionBlock,
  ActionBlock,
  RuleType,
  ChatType,
  UserRole,
} from '../../lib/api';

// ── Block color palette ──────────────────────────────────────────────────────

const BLOCK_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  trigger: { bg: 'rgba(10, 132, 255, 0.12)', border: 'rgba(10, 132, 255, 0.4)', label: 'TRIGGER' },
  condition: { bg: 'rgba(255, 204, 0, 0.12)', border: 'rgba(255, 204, 0, 0.4)', label: 'CONDITION' },
  action: { bg: 'rgba(48, 209, 88, 0.12)', border: 'rgba(48, 209, 88, 0.4)', label: 'ACTION' },
};

const RULE_TYPE_LABELS: Record<RuleType, string> = {
  block: 'Block message',
  inject: 'Inject context',
  transform: 'Transform message',
  notify: 'Notify admin',
};

const RULE_TYPE_PLACEHOLDERS: Record<RuleType, string> = {
  block: 'Reply sent when blocked (optional)...',
  inject: 'Context to inject into the LLM prompt...',
  transform: 'Replacement text for the message...',
  notify: 'Notification message to admin...',
};

// ── Block display components ─────────────────────────────────────────────────

function BlockBadge({ type }: { type: string }) {
  const c = BLOCK_COLORS[type] ?? BLOCK_COLORS.trigger;
  return (
    <span style={{
      fontSize: '10px',
      fontWeight: 700,
      letterSpacing: '0.06em',
      padding: '2px 6px',
      borderRadius: '4px',
      background: c.bg,
      color: type === 'trigger' ? 'var(--accent)' : type === 'condition' ? '#FFCC00' : 'var(--green)',
      border: `1px solid ${c.border}`,
    }}>
      {c.label}
    </span>
  );
}

interface BlockCardProps {
  block: RuleBlock;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}

function BlockCard({ block, onEdit, onDelete, onMoveUp, onMoveDown, isFirst, isLast }: BlockCardProps) {
  const c = BLOCK_COLORS[block.type];
  return (
    <div style={{
      border: `1px solid ${c.border}`,
      borderRadius: '8px',
      background: c.bg,
      padding: '8px 10px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    }}>
      {/* Move up/down arrows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          style={{ background: 'none', border: 'none', cursor: isFirst ? 'default' : 'pointer', padding: '0 2px', color: 'var(--text-secondary)', opacity: isFirst ? 0.2 : 0.6, fontSize: '10px', lineHeight: 1 }}
        >▲</button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          style={{ background: 'none', border: 'none', cursor: isLast ? 'default' : 'pointer', padding: '0 2px', color: 'var(--text-secondary)', opacity: isLast ? 0.2 : 0.6, fontSize: '10px', lineHeight: 1 }}
        >▼</button>
      </div>

      <BlockBadge type={block.type} />

      <div style={{ flex: 1, fontSize: '13px' }}>
        {block.type === 'trigger' && (
          <span>When message contains <strong>"{(block as TriggerBlock).keyword}"</strong></span>
        )}
        {block.type === 'condition' && (
          <span>
            AND user is <strong>{(block as ConditionBlock).userRole}</strong>
            {' '}AND chat is <strong>{(block as ConditionBlock).chatType}</strong>
          </span>
        )}
        {block.type === 'action' && (
          <span>
            <strong>{RULE_TYPE_LABELS[(block as ActionBlock).ruleType]}</strong>
            {(block as ActionBlock).value && (
              <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                {' — '}{(block as ActionBlock).value.slice(0, 60)}{(block as ActionBlock).value.length > 60 ? '…' : ''}
              </span>
            )}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '4px' }}>
        <button className="btn-ghost btn-sm" onClick={onEdit} style={{ fontSize: '11px' }}>Edit</button>
        <button
          onClick={onDelete}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--red)', opacity: 0.5, fontSize: '13px', transition: 'opacity 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; }}
        >&#x2715;</button>
      </div>
    </div>
  );
}

// ── Block editor forms ───────────────────────────────────────────────────────

interface BlockEditorProps {
  block: RuleBlock;
  onChange: (block: RuleBlock) => void;
  onClose: () => void;
}

function BlockEditor({ block, onChange, onClose }: BlockEditorProps) {
  const [local, setLocal] = useState<RuleBlock>({ ...block });

  const save = () => {
    if (local.type === 'trigger' && !(local as TriggerBlock).keyword.trim()) return;
    onChange(local);
    onClose();
  };

  return (
    <div style={{ padding: '10px', background: 'var(--surface)', borderRadius: '8px', marginTop: '6px', border: '1px solid var(--separator)' }}>
      {local.type === 'trigger' && (
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Keyword</label>
          <input
            type="text"
            value={(local as TriggerBlock).keyword}
            onChange={(e) => setLocal({ ...local, keyword: e.target.value } as TriggerBlock)}
            placeholder="Keyword to match (min 2 chars)"
            maxLength={100}
            style={{ width: '100%' }}
          />
        </div>
      )}

      {local.type === 'condition' && (
        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>User role</label>
            <select
              value={(local as ConditionBlock).userRole}
              onChange={(e) => setLocal({ ...local, userRole: e.target.value as UserRole } as ConditionBlock)}
              style={{ width: '100%' }}
            >
              <option value="any">Any user</option>
              <option value="admin">Admin only</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Chat type</label>
            <select
              value={(local as ConditionBlock).chatType}
              onChange={(e) => setLocal({ ...local, chatType: e.target.value as ChatType } as ConditionBlock)}
              style={{ width: '100%' }}
            >
              <option value="any">Any chat</option>
              <option value="dm">Direct message</option>
              <option value="group">Group chat</option>
            </select>
          </div>
        </div>
      )}

      {local.type === 'action' && (
        <div>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Action type</label>
            <select
              value={(local as ActionBlock).ruleType}
              onChange={(e) => setLocal({ ...local, ruleType: e.target.value as RuleType } as ActionBlock)}
              style={{ width: '100%' }}
            >
              <option value="inject">Inject context</option>
              <option value="block">Block message</option>
              <option value="transform">Transform message</option>
              <option value="notify">Notify admin</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Value</label>
            <textarea
              value={(local as ActionBlock).value}
              onChange={(e) => setLocal({ ...local, value: e.target.value } as ActionBlock)}
              placeholder={RULE_TYPE_PLACEHOLDERS[(local as ActionBlock).ruleType]}
              maxLength={2000}
              rows={3}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
        <button className="btn-sm" onClick={save}>Apply</button>
        <button className="btn-ghost btn-sm" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ── Add block palette ────────────────────────────────────────────────────────

interface BlockPaletteProps {
  onAdd: (block: RuleBlock) => void;
}

function BlockPalette({ onAdd }: BlockPaletteProps) {
  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      <button
        className="btn-ghost btn-sm"
        onClick={() => onAdd({ type: 'trigger', keyword: '' })}
        style={{ fontSize: '12px', border: '1px solid rgba(10, 132, 255, 0.4)', color: 'var(--accent)' }}
      >
        + Trigger
      </button>
      <button
        className="btn-ghost btn-sm"
        onClick={() => onAdd({ type: 'condition', userRole: 'any', chatType: 'any' })}
        style={{ fontSize: '12px', border: '1px solid rgba(255, 204, 0, 0.4)', color: '#FFCC00' }}
      >
        + Condition
      </button>
      <button
        className="btn-ghost btn-sm"
        onClick={() => onAdd({ type: 'action', ruleType: 'inject', value: '' })}
        style={{ fontSize: '12px', border: '1px solid rgba(48, 209, 88, 0.4)', color: 'var(--green)' }}
      >
        + Action
      </button>
    </div>
  );
}

// ── Rule card ────────────────────────────────────────────────────────────────

interface RuleCardProps {
  rule: StructuredRule;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (rule: StructuredRule) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  matchedBlockIndices?: Set<number>;
}

function RuleCard({ rule, isFirst, isLast, onUpdate, onDelete, onMoveUp, onMoveDown, matchedBlockIndices }: RuleCardProps) {
  const [editingBlockIdx, setEditingBlockIdx] = useState<number | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(rule.name);

  const updateBlock = (idx: number, block: RuleBlock) => {
    const next = [...rule.blocks];
    next[idx] = block;
    onUpdate({ ...rule, blocks: next });
  };

  const deleteBlock = (idx: number) => {
    const next = rule.blocks.filter((_, i) => i !== idx);
    onUpdate({ ...rule, blocks: next });
  };

  const moveBlock = (idx: number, dir: -1 | 1) => {
    const next = [...rule.blocks];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onUpdate({ ...rule, blocks: next });
  };

  const addBlock = (block: RuleBlock) => {
    const next = [...rule.blocks, block];
    onUpdate({ ...rule, blocks: next });
    // Auto-open editor for the new block
    setEditingBlockIdx(next.length - 1);
  };

  const saveName = () => {
    onUpdate({ ...rule, name: nameInput.trim() || 'Untitled Rule' });
    setEditingName(false);
  };

  const isMatched = matchedBlockIndices !== undefined && matchedBlockIndices.size > 0;

  return (
    <div
      className="card"
      style={{
        marginBottom: '10px',
        border: isMatched ? '1px solid var(--green)' : '1px solid var(--separator)',
        transition: 'border-color 0.2s',
      }}
    >
      {/* Rule header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        {/* Priority arrows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            style={{ background: 'none', border: 'none', cursor: isFirst ? 'default' : 'pointer', padding: '1px 3px', color: 'var(--text-secondary)', opacity: isFirst ? 0.2 : 0.6, fontSize: '11px', lineHeight: 1 }}
            title="Higher priority"
          >▲</button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            style={{ background: 'none', border: 'none', cursor: isLast ? 'default' : 'pointer', padding: '1px 3px', color: 'var(--text-secondary)', opacity: isLast ? 0.2 : 0.6, fontSize: '11px', lineHeight: 1 }}
            title="Lower priority"
          >▼</button>
        </div>

        {/* Rule name */}
        {editingName ? (
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
            maxLength={100}
            style={{ flex: 1, fontWeight: 600, fontSize: '14px' }}
            autoFocus
          />
        ) : (
          <span
            style={{ flex: 1, fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}
            onClick={() => { setNameInput(rule.name); setEditingName(true); }}
            title="Click to rename"
          >
            {rule.name}
            {isMatched && <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--green)', fontWeight: 400 }}>● match</span>}
          </span>
        )}

        {/* Toggle */}
        <label className="toggle">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={() => onUpdate({ ...rule, enabled: !rule.enabled })}
          />
          <span className="toggle-track" />
          <span className="toggle-thumb" />
        </label>

        {/* Delete */}
        <button
          onClick={onDelete}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--red)', opacity: 0.5, fontSize: '14px', transition: 'opacity 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; }}
        >&#x2715;</button>
      </div>

      {/* Blocks */}
      {rule.blocks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
          {rule.blocks.map((block, idx) => (
            <div
              key={idx}
              style={{
                outline: matchedBlockIndices?.has(idx) ? '2px solid var(--green)' : 'none',
                borderRadius: '8px',
                transition: 'outline 0.2s',
              }}
            >
              {editingBlockIdx === idx ? (
                <BlockEditor
                  block={block}
                  onChange={(b) => { updateBlock(idx, b); setEditingBlockIdx(null); }}
                  onClose={() => setEditingBlockIdx(null)}
                />
              ) : (
                <BlockCard
                  block={block}
                  index={idx}
                  onEdit={() => setEditingBlockIdx(idx)}
                  onDelete={() => deleteBlock(idx)}
                  onMoveUp={() => moveBlock(idx, -1)}
                  onMoveDown={() => moveBlock(idx, 1)}
                  isFirst={idx === 0}
                  isLast={idx === rule.blocks.length - 1}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {rule.blocks.length === 0 && (
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
          Add blocks below to build your rule. A rule needs at least one Trigger and one Action.
        </p>
      )}

      {/* Add block palette */}
      <BlockPalette onAdd={addBlock} />
    </div>
  );
}

// ── Rule testing panel ───────────────────────────────────────────────────────

interface TestResult {
  ruleId: string;
  ruleName: string;
  matchedBlockIndices: Set<number>;
  actions: Array<{ ruleType: RuleType; value: string }>;
}

function evaluateRulesLocally(rules: StructuredRule[], testInput: string): TestResult[] {
  if (!testInput.trim()) return [];
  const results: TestResult[] = [];

  const normalize = (t: string) => t.toLowerCase().normalize('NFKC').replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');
  const tokenize = (t: string) =>
    normalize(t)
      .split(/[\s,.!?;:'"()\[\]{}<>/\\|@#$%^&*+=~`]+/)
      .filter(Boolean);

  const msgTokens = tokenize(testInput);

  const matchKeyword = (keyword: string): boolean => {
    const kwTokens = tokenize(keyword);
    if (kwTokens.length === 0) return false;
    if (kwTokens.length === 1) return msgTokens.includes(kwTokens[0]);
    for (let i = 0; i <= msgTokens.length - kwTokens.length; i++) {
      if (kwTokens.every((t, j) => msgTokens[i + j] === t)) return true;
    }
    return false;
  };

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const matchedIndices = new Set<number>();
    const actions: Array<{ ruleType: RuleType; value: string }> = [];
    let triggered = false;
    let conditionsMet = true;

    for (let i = 0; i < rule.blocks.length; i++) {
      const block = rule.blocks[i];
      if (block.type === 'trigger') {
        if ((block as TriggerBlock).keyword && matchKeyword((block as TriggerBlock).keyword)) {
          triggered = true;
          matchedIndices.add(i);
        }
      } else if (block.type === 'condition') {
        // Conditions always pass in the test panel (we don't know actual user/chat context)
        matchedIndices.add(i);
      } else if (block.type === 'action') {
        actions.push({ ruleType: (block as ActionBlock).ruleType, value: (block as ActionBlock).value });
      }
    }

    if (triggered && conditionsMet && actions.length > 0) {
      // Mark all action blocks as matched
      rule.blocks.forEach((b, i) => { if (b.type === 'action') matchedIndices.add(i); });
      results.push({ ruleId: rule.id, ruleName: rule.name, matchedBlockIndices: matchedIndices, actions });
    }
  }

  return results;
}

interface TestPanelProps {
  rules: StructuredRule[];
  onTestResults: (results: Map<string, Set<number>>) => void;
}

function TestPanel({ rules, onTestResults }: TestPanelProps) {
  const [input, setInput] = useState('');
  const [results, setResults] = useState<TestResult[]>([]);
  const [hasRun, setHasRun] = useState(false);

  const runTest = useCallback(() => {
    const r = evaluateRulesLocally(rules, input);
    setResults(r);
    setHasRun(true);
    const map = new Map<string, Set<number>>();
    r.forEach((res) => map.set(res.ruleId, res.matchedBlockIndices));
    onTestResults(map);
  }, [rules, input, onTestResults]);

  const clear = () => {
    setInput('');
    setResults([]);
    setHasRun(false);
    onTestResults(new Map());
  };

  return (
    <div className="card" style={{ marginBottom: '16px', border: '1px solid var(--separator)' }}>
      <h2 style={{ fontSize: '16px', margin: '0 0 8px' }}>Rule Testing</h2>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
        Enter a test message to see which rules and blocks would activate. Results are evaluated locally in the browser.
      </p>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <input
          type="text"
          placeholder="Type a test message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') runTest(); }}
          style={{ flex: 1 }}
        />
        <button className="btn-sm" onClick={runTest} disabled={!input.trim()}>Test</button>
        {hasRun && <button className="btn-ghost btn-sm" onClick={clear}>Clear</button>}
      </div>
      {hasRun && (
        <div>
          {results.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>No rules matched this message.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {results.map((r) => (
                <div
                  key={r.ruleId}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: 'var(--green-dim)',
                    border: '1px solid rgba(48, 209, 88, 0.3)',
                    fontSize: '13px',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--green)' }}>
                    ✓ {r.ruleName}
                  </div>
                  {r.actions.map((a, i) => (
                    <div key={i} style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      → {RULE_TYPE_LABELS[a.ruleType]}{a.value ? `: "${a.value.slice(0, 80)}${a.value.length > 80 ? '…' : ''}"` : ''}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main RuleBuilder component ───────────────────────────────────────────────

interface RuleBuilderProps {
  rules: StructuredRule[];
  saving: boolean;
  onCreateRule: (rule: Omit<StructuredRule, 'id' | 'order'>) => void;
  onUpdateRule: (rule: StructuredRule) => void;
  onDeleteRule: (id: string) => void;
  onReorderRules: (ids: string[]) => void;
}

export function RuleBuilder({ rules, saving, onCreateRule, onUpdateRule, onDeleteRule, onReorderRules }: RuleBuilderProps) {
  const [testMatchMap, setTestMatchMap] = useState<Map<string, Set<number>>>(new Map());

  const sortedRules = [...rules].sort((a, b) => a.order - b.order);

  const moveRule = (idx: number, dir: -1 | 1) => {
    const next = [...sortedRules];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onReorderRules(next.map((r) => r.id));
  };

  const addNewRule = () => {
    onCreateRule({
      name: `Rule ${rules.length + 1}`,
      enabled: true,
      blocks: [],
    });
  };

  return (
    <div>
      <TestPanel rules={sortedRules} onTestResults={setTestMatchMap} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {rules.length}/100 rules · Higher rules have higher priority
          </span>
        </div>
        <button className="btn-sm" onClick={addNewRule} disabled={saving || rules.length >= 100}>
          {saving ? 'Saving...' : '+ New Rule'}
        </button>
      </div>

      {sortedRules.length === 0 && (
        <div style={{
          padding: '32px',
          textAlign: 'center',
          border: '1px dashed var(--separator)',
          borderRadius: '12px',
          color: 'var(--text-secondary)',
          fontSize: '13px',
        }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>⚡</div>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>No rules yet</div>
          <div style={{ fontSize: '12px', marginBottom: '12px' }}>
            Create a rule and add Trigger → Condition → Action blocks to define behavior
          </div>
          <button className="btn-sm" onClick={addNewRule}>Create first rule</button>
        </div>
      )}

      {sortedRules.map((rule, idx) => (
        <RuleCard
          key={rule.id}
          rule={rule}
          isFirst={idx === 0}
          isLast={idx === sortedRules.length - 1}
          onUpdate={onUpdateRule}
          onDelete={() => onDeleteRule(rule.id)}
          onMoveUp={() => moveRule(idx, -1)}
          onMoveDown={() => moveRule(idx, 1)}
          matchedBlockIndices={testMatchMap.get(rule.id)}
        />
      ))}
    </div>
  );
}
