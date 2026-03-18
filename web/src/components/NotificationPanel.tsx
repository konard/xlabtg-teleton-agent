import type { NotificationData, NotificationType } from '../lib/api';

interface Props {
  notifications: NotificationData[];
  loading: boolean;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDelete: (id: string) => void;
}

function typeIcon(type: NotificationType) {
  switch (type) {
    case 'error':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      );
    case 'warning':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      );
    case 'achievement':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="7"/>
          <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
        </svg>
      );
    default:
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
      );
  }
}

function formatTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function NotificationPanel({ notifications, loading, onMarkRead, onMarkAllRead, onDelete }: Props) {
  const hasUnread = notifications.some((n) => !n.read);

  return (
    <div className="notification-panel">
      <div className="notification-panel-header">
        <span className="notification-panel-title">Notifications</span>
        {hasUnread && (
          <button className="btn-ghost notification-mark-all" onClick={onMarkAllRead}>
            Mark all read
          </button>
        )}
      </div>

      <div className="notification-panel-list">
        {loading && (
          <div className="notification-empty">Loading...</div>
        )}
        {!loading && notifications.length === 0 && (
          <div className="notification-empty">No notifications</div>
        )}
        {!loading && notifications.map((n) => (
          <div
            key={n.id}
            className={`notification-item notification-item--${n.type}${n.read ? ' notification-item--read' : ''}`}
            onClick={() => { if (!n.read) onMarkRead(n.id); }}
          >
            <span className={`notification-icon notification-icon--${n.type}`}>
              {typeIcon(n.type)}
            </span>
            <div className="notification-body">
              <div className="notification-title">{n.title}</div>
              <div className="notification-message">{n.message}</div>
              <div className="notification-time">{formatTime(n.createdAt)}</div>
            </div>
            <button
              className="notification-delete btn-ghost"
              onClick={(e) => { e.stopPropagation(); onDelete(n.id); }}
              title="Dismiss"
              aria-label="Dismiss notification"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
