import { ArrayInput } from './ArrayInput';
import { InfoTip } from './InfoTip';

interface CommandControlsPanelProps {
  getLocal: (key: string) => string;
  saveConfig: (key: string, value: string) => Promise<void>;
  onArraySave?: (key: string, values: string[]) => Promise<void>;
}

function getArrayValue(raw: string): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw).map(String);
  } catch {
    return [];
  }
}

export function CommandControlsPanel({
  getLocal,
  saveConfig,
  onArraySave,
}: CommandControlsPanelProps) {
  const commandsEnabled = getLocal('telegram.command_access.commands_enabled') === 'true';

  return (
    <>
      <div className="section-title">Command Controls</div>
      <div style={{ display: 'grid', gap: '16px' }}>

        {/* Enable Commands toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label
            style={{ fontSize: '13px', color: 'var(--text)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
            htmlFor="commands-enabled"
          >
            Enable Commands
            <InfoTip text="Globally enable or disable all Telegram command handling" />
          </label>
          <label className="toggle">
            <input
              id="commands-enabled"
              type="checkbox"
              checked={commandsEnabled}
              onChange={(e) => saveConfig('telegram.command_access.commands_enabled', String(e.target.checked))}
            />
            <span className="toggle-track" />
            <span className="toggle-thumb" />
          </label>
        </div>

        {/* Admin Only toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: commandsEnabled ? 1 : 0.4, pointerEvents: commandsEnabled ? 'auto' : 'none' }}>
          <label
            style={{ fontSize: '13px', color: 'var(--text)', cursor: commandsEnabled ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 4 }}
            htmlFor="admin-only-commands"
          >
            Admin Only Commands
            <InfoTip text="Restrict all commands to admin users only" />
          </label>
          <label className="toggle">
            <input
              id="admin-only-commands"
              type="checkbox"
              checked={getLocal('telegram.command_access.admin_only_commands') === 'true'}
              disabled={!commandsEnabled}
              onChange={(e) => saveConfig('telegram.command_access.admin_only_commands', String(e.target.checked))}
            />
            <span className="toggle-track" />
            <span className="toggle-thumb" />
          </label>
        </div>

        {/* Allowed User IDs */}
        {onArraySave && (
          <div style={{ opacity: commandsEnabled ? 1 : 0.4, pointerEvents: commandsEnabled ? 'auto' : 'none' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Allowed User IDs
                  <InfoTip text="Telegram user IDs allowed to run commands. Admins are always allowed. Empty = no extra restriction." />
                </span>
              </label>
              <ArrayInput
                value={getArrayValue(getLocal('telegram.command_access.allowed_user_ids'))}
                onChange={(values) => onArraySave('telegram.command_access.allowed_user_ids', values)}
                validate={(v) => /^\d+$/.test(v) && Number(v) > 0 ? null : 'Must be a positive number'}
                placeholder="Enter user ID..."
                disabled={!commandsEnabled}
              />
            </div>
          </div>
        )}

        {/* Allowed Chat IDs */}
        {onArraySave && (
          <div style={{ opacity: commandsEnabled ? 1 : 0.4, pointerEvents: commandsEnabled ? 'auto' : 'none' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Allowed Chat IDs
                  <InfoTip text="Chat IDs where commands are allowed. Negative IDs for groups/channels. Empty = no extra restriction." />
                </span>
              </label>
              <ArrayInput
                value={getArrayValue(getLocal('telegram.command_access.allowed_chat_ids'))}
                onChange={(values) => onArraySave('telegram.command_access.allowed_chat_ids', values)}
                validate={(v) => /^-?\d+$/.test(v) ? null : 'Must be a valid Telegram ID (can be negative for groups)'}
                placeholder="Enter chat ID..."
                disabled={!commandsEnabled}
              />
            </div>
          </div>
        )}

        {/* Unknown Command Reply toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label
            style={{ fontSize: '13px', color: 'var(--text)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
            htmlFor="unknown-command-reply"
          >
            Reply to Unknown Commands
            <InfoTip text='Send "Use /help for available commands." when an unrecognized command is received' />
          </label>
          <label className="toggle">
            <input
              id="unknown-command-reply"
              type="checkbox"
              checked={getLocal('telegram.command_access.unknown_command_reply') === 'true'}
              onChange={(e) => saveConfig('telegram.command_access.unknown_command_reply', String(e.target.checked))}
            />
            <span className="toggle-track" />
            <span className="toggle-thumb" />
          </label>
        </div>

      </div>
    </>
  );
}
