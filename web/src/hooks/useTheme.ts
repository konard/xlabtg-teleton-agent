import { useState, useEffect, useCallback } from 'react';

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'teleton-theme';

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage not available
  }
  return 'dark';
}

function applyTheme(theme: Theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

// Module-level state so all hook instances stay in sync
let currentTheme: Theme = getInitialTheme();
const listeners = new Set<() => void>();

function setGlobalTheme(theme: Theme) {
  currentTheme = theme;
  applyTheme(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage not available
  }
  listeners.forEach((fn) => fn());
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    const notify = () => setTheme(currentTheme);
    listeners.add(notify);
    return () => { listeners.delete(notify); };
  }, []);

  const toggleTheme = useCallback(() => {
    setGlobalTheme(currentTheme === 'dark' ? 'light' : 'dark');
  }, []);

  return { theme, toggleTheme };
}
