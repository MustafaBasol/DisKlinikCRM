import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Calendar, CheckSquare, CalendarPlus, AlertTriangle, X, CheckCheck, Circle, CheckCircle2 } from 'lucide-react';
import api from '../services/api';

interface NotificationItem {
  id: string;
  type: 'upcoming_appointment' | 'overdue_task' | 'appointment_request' | 'low_stock';
  title: string;
  subtitle?: string;
  link: string;
  isRead: boolean;
  createdAt: string;
}

const TYPE_CONFIG = {
  upcoming_appointment: { icon: <Calendar size={15} />, color: 'text-primary-600 bg-primary-50' },
  overdue_task:         { icon: <CheckSquare size={15} />, color: 'text-red-600 bg-red-50' },
  appointment_request:  { icon: <CalendarPlus size={15} />, color: 'text-amber-600 bg-amber-50' },
  low_stock:            { icon: <AlertTriangle size={15} />, color: 'text-orange-600 bg-orange-50' },
};

const NotificationBell: React.FC = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await api.get('/notifications');
      const fetched: NotificationItem[] = res.data.items || [];
      setItems(fetched);
      setUnreadCount(fetched.filter(n => !n.isRead).length);
    } catch {
      // silently fail
    }
  }, []);

  // Initial fetch + poll every 60s
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleItemClick = (item: NotificationItem) => {
    setOpen(false);
    navigate(item.link);
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      await api.post('/notifications/mark-all-read');
      setItems(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch { /* ignore */ } finally {
      setMarkingAll(false);
    }
  };

  const handleToggleRead = async (e: React.MouseEvent, item: NotificationItem) => {
    e.stopPropagation();
    try {
      const res = await api.patch(`/notifications/${item.id}/toggle-read`);
      const updated: NotificationItem = res.data;
      setItems(prev => prev.map(n => n.id === item.id ? { ...n, isRead: updated.isRead } : n));
      setUnreadCount(prev => updated.isRead ? Math.max(0, prev - 1) : prev + 1);
    } catch { /* ignore */ }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-gray-500 dark:text-gray-400 relative"
        aria-label="Bildirimler"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white dark:border-gray-900 leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Bildirimler
              {unreadCount > 0 && (
                <span className="ml-2 text-[10px] font-bold text-white bg-red-500 rounded-full px-1.5 py-0.5">{unreadCount}</span>
              )}
            </span>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  disabled={markingAll}
                  title="Tümünü okundu işaretle"
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 hover:text-green-600 transition-colors"
                >
                  <CheckCheck size={15} />
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                <X size={14} className="text-gray-400" />
              </button>
            </div>
          </div>

          {/* Items */}
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-gray-400 dark:text-gray-500">
                <Bell size={28} className="mb-2 opacity-30" />
                <p className="text-sm">Bildirim yok</p>
              </div>
            ) : (
              items.map((item) => {
                const cfg = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.overdue_task;
                return (
                  <div
                    key={item.id}
                    className={`group flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors border-b border-gray-50 dark:border-gray-700/50 last:border-0 cursor-pointer ${!item.isRead ? 'bg-blue-50/40 dark:bg-blue-900/10' : ''}`}
                    onClick={() => handleItemClick(item)}
                  >
                    <span className={`mt-0.5 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${cfg.color}`}>
                      {cfg.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${!item.isRead ? 'font-semibold text-gray-900 dark:text-gray-100' : 'font-medium text-gray-700 dark:text-gray-300'}`}>
                        {item.title}
                      </p>
                      {item.subtitle && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{item.subtitle}</p>
                      )}
                    </div>
                    <button
                      onClick={(e) => handleToggleRead(e, item)}
                      title={item.isRead ? 'Okunmadı olarak işaretle' : 'Okundu olarak işaretle'}
                      className="flex-shrink-0 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                      {item.isRead
                        ? <Circle size={13} className="text-gray-400" />
                        : <CheckCircle2 size={13} className="text-blue-500" />}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
