export type ToastType = 'success' | 'error' | 'warn' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number; // ms, 0 = no auto-dismiss
}

type Listener = () => void;

const AUTO_DISMISS: Record<ToastType, number> = {
  success: 3000,
  info: 3000,
  warn: 5000,
  error: 0, // stays until dismissed
};

class ToastStore {
  private toasts: Toast[] = [];
  private listeners = new Set<Listener>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  private notify() {
    for (const fn of this.listeners) fn();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getToasts(): Toast[] {
    return this.toasts;
  }

  add(type: ToastType, message: string, duration?: number): string {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ms = duration !== undefined ? duration : AUTO_DISMISS[type];
    const toast: Toast = { id, type, message, duration: ms };
    this.toasts = [...this.toasts, toast];
    this.notify();

    if (ms > 0) {
      const timer = setTimeout(() => this.remove(id), ms);
      this.timers.set(id, timer);
    }

    return id;
  }

  remove(id: string): void {
    if (this.timers.has(id)) {
      clearTimeout(this.timers.get(id)!);
      this.timers.delete(id);
    }
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.notify();
  }

  success(message: string, duration?: number) {
    return this.add('success', message, duration);
  }

  error(message: string, duration?: number) {
    return this.add('error', message, duration);
  }

  warn(message: string, duration?: number) {
    return this.add('warn', message, duration);
  }

  info(message: string, duration?: number) {
    return this.add('info', message, duration);
  }
}

export const toast = new ToastStore();
