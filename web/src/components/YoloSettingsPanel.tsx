import { useState } from 'react';
import { InfoTip } from './InfoTip';
import { ArrayInput } from './ArrayInput';
import { Select } from './Select';

// Preset command groups users can add with one click
const PRESET_GROUPS: { label: string; commands: string[] }[] = [
  {
    label: 'Git',
    commands: ['git status', 'git diff', 'git log', 'git branch', 'git show'],
  },
  {
    label: 'npm',
    commands: ['npm run', 'npm install', 'npm test', 'npm build'],
  },
  {
    label: 'Files',
    commands: ['ls', 'cat', 'find', 'grep', 'head', 'tail'],
  },
  {
    label: 'System',
    commands: ['ps', 'df', 'du', 'free', 'uname', 'whoami', 'uptime'],
  },
];

interface YoloSettingsPanelProps {
  getLocal: (key: string) => string;
  saveConfig: (key: string, value: string) => Promise<void>;
  onArraySave: (key: string, values: string[]) => Promise<void>;
}

export function YoloSettingsPanel({ getLocal, saveConfig, onArraySave }: YoloSettingsPanelProps) {
  const mode = getLocal('capabilities.exec.mode') || 'off';
  const scope = getLocal('capabilities.exec.scope') || 'admin-only';

  // Parse the allowlist from the config value — it may be a JSON array string or comma-separated
  const rawAllowlist = getLocal('capabilities.exec.command_allowlist');
  let parsedAllowlist: string[] = [];
  try {
    const parsed = JSON.parse(rawAllowlist);
    if (Array.isArray(parsed)) parsedAllowlist = parsed;
  } catch {
    if (rawAllowlist) {
      parsedAllowlist = rawAllowlist.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }

  const [saving, setSaving] = useState(false);

  const handleModeChange = async (newMode: string) => {
    setSaving(true);
    try {
      await saveConfig('capabilities.exec.mode', newMode);
    } finally {
      setSaving(false);
    }
  };

  const handleScopeChange = async (newScope: string) => {
    await saveConfig('capabilities.exec.scope', newScope);
  };

  const addPresetGroup = async (commands: string[]) => {
    const merged = Array.from(new Set([...parsedAllowlist, ...commands]));
    await onArraySave('capabilities.exec.command_allowlist', merged);
  };

  const clearAllowlist = async () => {
    await onArraySave('capabilities.exec.command_allowlist', []);
  };

  const enableFullAccess = async () => {
    setSaving(true);
    try {
      await saveConfig('capabilities.exec.mode', 'yolo');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ── Security warning banner ─────────────────────────────────────── */}
      <div
        style={{
          background: 'var(--red-bg, rgba(239,68,68,0.08))',
          border: '1px solid var(--red-border, rgba(239,68,68,0.3))',
          borderRadius: 8,
          padding: '14px 16px',
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ fontSize: 20, lineHeight: 1 }}>⚠️</span>
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>
          <strong>Security Warning</strong>
          <p style={{ margin: '6px 0 0' }}>
            Exec tools let the agent run shell commands on your server. In <strong>YOLO</strong> mode the
            agent has unrestricted system access — it can read files, install software, exfiltrate data,
            or damage the system. Only enable if you fully trust all users who can trigger exec tools and
            understand the risks. Use <strong>Allowlist</strong> mode to restrict to specific safe commands.
          </p>
        </div>
      </div>

      {/* ── Mode selector ───────────────────────────────────────────────── */}
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
          Exec Mode
          <InfoTip text="Controls what shell commands the agent is allowed to run. Requires agent restart to take effect." />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(
            [
              {
                value: 'off',
                label: 'Off',
                description: 'Exec tools are completely disabled. The agent cannot run any shell commands.',
                color: 'var(--text-secondary)',
              },
              {
                value: 'allowlist',
                label: 'Allowlist',
                description:
                  'Only commands matching the prefixes listed below are permitted. All others are rejected.',
                color: 'var(--accent, #6366f1)',
              },
              {
                value: 'yolo',
                label: 'YOLO — Full Access',
                description:
                  'Unrestricted shell access. The agent can execute any command with the privileges of the Node process.',
                color: 'var(--red, #ef4444)',
              },
            ] as const
          ).map((opt) => {
            const isSelected = mode === opt.value;
            return (
              <label
                key={opt.value}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '12px 14px',
                  border: `1px solid ${isSelected ? opt.color : 'var(--border, var(--glass-border))'}`,
                  borderRadius: 8,
                  cursor: saving ? 'wait' : 'pointer',
                  background: isSelected ? `${opt.color}0d` : 'transparent',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                <input
                  type="radio"
                  name="exec-mode"
                  value={opt.value}
                  checked={isSelected}
                  disabled={saving}
                  onChange={() => handleModeChange(opt.value)}
                  style={{ marginTop: 2, accentColor: opt.color }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: opt.color }}>{opt.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {opt.description}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* ── Scope ───────────────────────────────────────────────────────── */}
      {mode !== 'off' && (
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
            Who Can Use Exec
            <InfoTip text="Restricts which Telegram users are allowed to trigger exec tools." />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Select
              value={scope}
              options={['admin-only', 'allowlist', 'all']}
              labels={['Admin Only (recommended)', 'User Allowlist', 'Everyone']}
              onChange={handleScopeChange}
              style={{ minWidth: 220 }}
            />
            {scope === 'all' && (
              <span style={{ fontSize: 12, color: 'var(--red, #ef4444)', fontWeight: 500 }}>
                ⚠️ Anyone can run commands
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Command allowlist (shown when mode = allowlist) ─────────────── */}
      {mode === 'allowlist' && (
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
            Allowed Command Prefixes
            <InfoTip text='Enter command prefixes the agent is allowed to run. A prefix like "git" allows "git status" but not "gitconfig". Matching is whitespace-boundary-aware.' />
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
            Add prefixes one at a time. A command is permitted if it exactly matches a prefix or starts
            with a prefix followed by a space (e.g. <code>git</code> allows <code>git status</code> but
            not <code>gitconfig</code>).
          </p>

          {/* Preset quick-add buttons */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Quick-add preset groups:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PRESET_GROUPS.map((group) => (
                <button
                  key={group.label}
                  type="button"
                  onClick={() => addPresetGroup(group.commands)}
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    borderRadius: 6,
                    border: '1px solid var(--glass-border)',
                    background: 'var(--surface)',
                    cursor: 'pointer',
                    color: 'var(--text)',
                  }}
                >
                  + {group.label}
                </button>
              ))}
              <button
                type="button"
                onClick={enableFullAccess}
                disabled={saving}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: '1px solid var(--red-border, rgba(239,68,68,0.3))',
                  background: 'var(--red-bg, rgba(239,68,68,0.08))',
                  cursor: saving ? 'wait' : 'pointer',
                  color: 'var(--red, #ef4444)',
                  fontWeight: 500,
                }}
              >
                Allow Everything (switch to YOLO)
              </button>
            </div>
          </div>

          <ArrayInput
            value={parsedAllowlist}
            onChange={(values) => onArraySave('capabilities.exec.command_allowlist', values)}
            placeholder="e.g. git status"
          />

          {parsedAllowlist.length > 0 && (
            <button
              type="button"
              onClick={clearAllowlist}
              style={{
                marginTop: 10,
                padding: '3px 10px',
                fontSize: 12,
                borderRadius: 6,
                border: '1px solid var(--glass-border)',
                background: 'transparent',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
              }}
            >
              Clear all
            </button>
          )}

          {parsedAllowlist.length === 0 && (
            <div
              style={{
                marginTop: 10,
                padding: '10px 14px',
                background: 'var(--yellow-bg, rgba(245,158,11,0.08))',
                border: '1px solid var(--yellow-border, rgba(245,158,11,0.3))',
                borderRadius: 6,
                fontSize: 12,
                color: 'var(--text)',
              }}
            >
              No commands configured — all exec requests will be rejected.
            </div>
          )}
        </div>
      )}

      {/* ── Status summary ──────────────────────────────────────────────── */}
      <div
        style={{
          padding: '10px 14px',
          borderRadius: 6,
          background: 'var(--surface)',
          border: '1px solid var(--glass-border)',
          fontSize: 12,
          color: 'var(--text-secondary)',
        }}
      >
        {mode === 'off' && 'Exec tools are disabled. The agent cannot run any shell commands.'}
        {mode === 'allowlist' &&
          `Allowlist mode active — ${parsedAllowlist.length} command prefix${parsedAllowlist.length !== 1 ? 'es' : ''} permitted. Scope: ${scope}.`}
        {mode === 'yolo' &&
          `⚠️ Full access (YOLO) enabled. Scope: ${scope}. All shell commands are permitted.`}
        <span style={{ marginLeft: 8, color: 'var(--text-tertiary)' }}>
          (Restart required to apply changes)
        </span>
      </div>
    </div>
  );
}
