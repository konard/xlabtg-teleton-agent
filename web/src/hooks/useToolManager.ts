import { useState } from 'react';
import { api, ToolInfo, ModuleInfo } from '../lib/api';
import { errMsg } from '../lib/utils';

export function useToolManager(reloadFn: () => Promise<void>) {
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Shared envelope: mark `key` updating, run the mutation, reload, surface errors.
  const runUpdate = async (key: string, body: () => Promise<unknown>) => {
    setUpdating(key);
    try {
      await body();
      await reloadFn();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setUpdating(null);
    }
  };

  const toggleEnabled = (toolName: string, currentEnabled: boolean) =>
    runUpdate(toolName, () => api.updateToolConfig(toolName, { enabled: !currentEnabled }));

  const updateScope = (toolName: string, newScope: ToolInfo['scope']) =>
    runUpdate(toolName, () => api.updateToolConfig(toolName, { scope: newScope }));

  const bulkToggle = (module: ModuleInfo, enabled: boolean) =>
    runUpdate(module.name, async () => {
      for (const tool of module.tools) {
        if (tool.enabled !== enabled) {
          await api.updateToolConfig(tool.name, { enabled });
        }
      }
    });

  const bulkScope = (module: ModuleInfo, scope: ToolInfo['scope']) =>
    runUpdate(module.name, async () => {
      for (const tool of module.tools) {
        if (tool.scope !== scope) {
          await api.updateToolConfig(tool.name, { scope });
        }
      }
    });

  return { updating, error, setError, toggleEnabled, updateScope, bulkToggle, bulkScope };
}
