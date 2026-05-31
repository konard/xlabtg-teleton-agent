import { useState } from 'react';
import { api, ToolInfo, ModuleInfo } from '../lib/api';
import { errMsg } from '../lib/utils';

export function useToolManager(reloadFn: () => Promise<void>) {
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleEnabled = async (toolName: string, currentEnabled: boolean) => {
    setUpdating(toolName);
    try {
      await api.updateToolConfig(toolName, { enabled: !currentEnabled });
      await reloadFn();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setUpdating(null);
    }
  };

  const updateScope = async (toolName: string, newScope: ToolInfo['scope']) => {
    setUpdating(toolName);
    try {
      await api.updateToolConfig(toolName, { scope: newScope });
      await reloadFn();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setUpdating(null);
    }
  };

  const bulkToggle = async (module: ModuleInfo, enabled: boolean) => {
    setUpdating(module.name);
    try {
      for (const tool of module.tools) {
        if (tool.enabled !== enabled) {
          await api.updateToolConfig(tool.name, { enabled });
        }
      }
      await reloadFn();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setUpdating(null);
    }
  };

  const bulkScope = async (module: ModuleInfo, scope: ToolInfo['scope']) => {
    setUpdating(module.name);
    try {
      for (const tool of module.tools) {
        if (tool.scope !== scope) {
          await api.updateToolConfig(tool.name, { scope });
        }
      }
      await reloadFn();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setUpdating(null);
    }
  };

  return { updating, error, setError, toggleEnabled, updateScope, bulkToggle, bulkScope };
}
