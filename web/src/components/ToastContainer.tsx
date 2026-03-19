import { useEffect, useState } from 'react';
import { toast as toastStore, Toast } from '../lib/toast-store';

const ICONS: Record<Toast['type'], string> = {
  success: '✓',
  error: '✕',
  warn: '⚠',
  info: 'ℹ',
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  return (
    <div
      className={`toast toast-${toast.type}`}
      role="alert"
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
    >
      <span className="toast-icon" aria-hidden="true">{ICONS[toast.type]}</span>
      <span className="toast-message">{toast.message}</span>
      <button
        className="toast-close"
        onClick={() => onRemove(toast.id)}
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>(() => toastStore.getToasts());

  useEffect(() => {
    return toastStore.subscribe(() => {
      setToasts([...toastStore.getToasts()]);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-label="Notifications">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onRemove={(id) => toastStore.remove(id)} />
      ))}
    </div>
  );
}
