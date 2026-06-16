import { useEffect, useState } from 'react';
import {
  getStoredMode,
  resolveMode,
  setMode as applyMode,
  subscribe,
  type ResolvedTheme,
  type ThemeMode,
} from '../lib/theme';

// Thin React wrapper around the canonical theme module in lib/theme.ts.
// Keeps a single source of truth (light / dark / system) so every consumer —
// ThemeToggle (3-way), Shell, Layout — stays in sync. The legacy { theme,
// toggleTheme } shape is preserved for older callers.
export function useTheme() {
  const [mode, setLocalMode] = useState<ThemeMode>(getStoredMode);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveMode(getStoredMode()));

  useEffect(
    () =>
      subscribe(() => {
        const next = getStoredMode();
        setLocalMode(next);
        setResolved(resolveMode(next));
      }),
    []
  );

  const setMode = (m: ThemeMode) => applyMode(m);
  const toggle = () => applyMode(resolved === 'dark' ? 'light' : 'dark');

  return {
    mode,
    resolved,
    setMode,
    toggle,
    // Legacy aliases — keep existing consumers working.
    theme: resolved,
    toggleTheme: toggle,
  };
}
