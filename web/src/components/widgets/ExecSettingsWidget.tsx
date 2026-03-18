import { ExecSettingsPanel } from '../ExecSettingsPanel';

interface ExecSettingsWidgetProps {
  getLocal: (key: string) => string;
  saveConfig: (key: string, value: string) => Promise<void>;
}

export function ExecSettingsWidget(props: ExecSettingsWidgetProps) {
  return <ExecSettingsPanel {...props} />;
}
