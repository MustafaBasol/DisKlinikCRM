import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Calendar, CheckSquare, CalendarPlus, X } from 'lucide-react';
import api from '../services/api';

interface NotificationItem {
  id: string;
  type: 'upcoming_appointment' | 'overdue_task' | 'appointment_request';
  title: string;
  subtitle?: string;
  link: string;
  createdAt: string;
}

const TYPE_CONFIG = {
  upcoming_appointment: { icon: <Calendar size={15} />, color: 'text-primary-600 bg-primary-50' },
  overdue_task:         { icon: <CheckSquare size={15} />, color: 'text-red-600 bg-red-50' },
  appointment_request:  { icon: <CalendarPlus size={15} />, color: 'text-amber-600 bg-amber-50' },
};

const NotificationBell: React.FC = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await api.get('/notifications');
      setItems(res.data.items || []);
      setTotal(res.data.total || 0);
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

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-gray-500 dark:text-gray-400 relative"
        aria-label="Bildirimler"
      >
        <Bell size={20} />
        {total > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white dark:border-gray-900" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Bildirimler {total > 0 && <span className="ml-1 text-xs font-bold text-white bg-red-500 rounded-full px-1.5 py-0.5">{total}</span>}
            </span>
            <button onClick={() => setOpen(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
              <X size={14} className="text-gray-400" />
            </button>
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
                const cfg = TYPE_CONFIG[item.type];
                return (
                  <button
                    key={item.id}
                    onClick={() => handleItemClick(item)}
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left border-b border-gray-50 dark:border-gray-700/50 last:border-0"
                  >
                    <span className={`mt-0.5 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${cfg.color}`}>
                      {cfg.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{item.title}</p>
                      {item.subtitle && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{item.subtitle}</p>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          {total > 0 && (
            <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 text-center">
              <button
                onClick={() => { setOpen(false); fetchNotifications(); }}
                className="text-xs text-primary-600 hover:underline"
              >
                Yenile
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
