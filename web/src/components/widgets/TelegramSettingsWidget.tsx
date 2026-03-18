import { TelegramSettingsPanel } from '../TelegramSettingsPanel';

interface TelegramSettingsWidgetProps {
  getLocal: (key: string) => string;
  getServer: (key: string) => string;
  setLocal: (key: string, value: string) => void;
  saveConfig: (key: string, value: string) => Promise<void>;
  cancelLocal: (key: string) => void;
}

export function TelegramSettingsWidget(props: TelegramSettingsWidgetProps) {
  return <TelegramSettingsPanel {...props} />;
}
