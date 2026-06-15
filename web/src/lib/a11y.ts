import type { KeyboardEvent } from 'react';

/**
 * Returns the a11y props needed to make a non-button element keyboard-activatable.
 * Handles Enter and Space exactly like a native button would.
 *
 * Usage:
 *   <tr onClick={toggle} {...expandableRowProps(toggle)} className="file-row">
 */
export function expandableRowProps(onActivate: () => void): {
  onKeyDown: (e: KeyboardEvent) => void;
  tabIndex: number;
  role: string;
} {
  return {
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
    tabIndex: 0,
    role: 'button',
  };
}
