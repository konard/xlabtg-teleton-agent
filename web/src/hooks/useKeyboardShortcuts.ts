import { useEffect, useRef } from 'react';

type ShortcutHandler = (e: KeyboardEvent) => void;

interface Shortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  handler: ShortcutHandler;
}

/**
 * Register keyboard shortcuts. Handlers are called when the matching key
 * combination is pressed anywhere in the document (excluding inputs that are
 * not form-save shortcuts).
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  // Keep a stable ref so the effect doesn't re-run on every render
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      for (const shortcut of shortcutsRef.current) {
        const ctrlOrMeta = shortcut.ctrl
          ? e.ctrlKey || e.metaKey
          : shortcut.meta
            ? e.metaKey
            : true;
        const shift = shortcut.shift ? e.shiftKey : !e.shiftKey || shortcut.shift === undefined;
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();

        if (keyMatch && ctrlOrMeta && shift) {
          e.preventDefault();
          shortcut.handler(e);
          break;
        }
      }
    };

    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, []);
}
