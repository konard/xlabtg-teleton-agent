import { AgentSettingsPanel } from '../AgentSettingsPanel';
import { ProviderMeta } from '../../hooks/useConfigState';

interface AgentSettingsWidgetProps {
  getLocal: (key: string) => string;
  getServer: (key: string) => string;
  setLocal: (key: string, value: string) => void;
  saveConfig: (key: string, value: string) => Promise<void>;
  cancelLocal: (key: string) => void;
  modelOptions: Array<{ value: string; name: string }>;
  pendingProvider: string | null;
  pendingMeta: ProviderMeta | null;
  pendingApiKey: string;
  setPendingApiKey: (v: string) => void;
  pendingValidating: boolean;
  pendingError: string | null;
  setPendingError: (v: string | null) => void;
  handleProviderChange: (provider: string) => Promise<void>;
  handleProviderConfirm: () => Promise<void>;
  handleProviderCancel: () => void;
}

export function AgentSettingsWidget(props: AgentSettingsWidgetProps) {
  return <AgentSettingsPanel compact {...props} />;
}
