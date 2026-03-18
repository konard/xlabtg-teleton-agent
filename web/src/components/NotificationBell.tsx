import { useState, useEffect, useRef } from 'react';
import { api, type NotificationData } from '../lib/api';
import { NotificationPanel } from './NotificationPanel';

export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Connect to SSE for real-time badge updates
  useEffect(() => {
    const disconnect = api.connectNotifications((count) => {
      setUnreadCount(count);
    });
    return disconnect;
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    try {
      const res = await api.getNotifications();
      if (res.success && res.data) setNotifications(res.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      const res = await api.markNotificationRead(id);
      if (res.success) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read: true } : n))
        );
        if (res.data) setUnreadCount(res.data.count);
      }
    } catch {
      // ignore
    }
  };

  const handleMarkAllRead = async () => {
    try {
      const res = await api.markAllNotificationsRead();
      if (res.success) {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        setUnreadCount(0);
      }
    } catch {
      // ignore
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await api.deleteNotification(id);
      if (res.success) {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        const countRes = await api.getUnreadCount();
        if (countRes.success && countRes.data) setUnreadCount(countRes.data.count);
      }
    } catch {
      // ignore
    }
  };

  return (
    <div ref={containerRef} className="notification-bell-container">
      <button
        className="notification-bell-btn btn-ghost"
        onClick={handleOpen}
        title="Notifications"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unreadCount > 0 && (
          <span className="notification-badge" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <NotificationPanel
          notifications={notifications}
          loading={loading}
          onMarkRead={handleMarkRead}
          onMarkAllRead={handleMarkAllRead}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
