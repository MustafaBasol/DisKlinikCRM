import React, { useEffect, useState } from 'react';
import { 
  ClipboardList, 
  Plus, 
  Search, 
  Filter, 
  CheckCircle2, 
  Clock, 
  User, 
  MoreVertical, 
  Loader2,
  AlertCircle,
  Calendar,
  XCircle
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { taskService, userService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import TaskForm from '../components/TaskForm';
import { useClinic } from '../context/ClinicContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';

const Tasks: React.FC = () => {
  const { t } = useTranslation(['tasks', 'common']);
  const { user: currentUser } = useAuth();
  const { selectedClinicId } = useClinic();
  const { formatDate } = useClinicPreferences();
  
  const [tasks, setTasks] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  
  // Filters
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('open');
  const [priority, setPriority] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [dueToday, setDueToday] = useState(false);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const response = await taskService.getAll({
        status: status || undefined,
        priority: priority || undefined,
        assignedToId: assignedToId || undefined,
        overdue: overdue || undefined,
        dueToday: dueToday || undefined,
        search: search || undefined
      });
      setTasks(response.data);
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, [status, priority, assignedToId, overdue, dueToday, selectedClinicId]);

  // Debounced search
  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchTasks();
    }, 500);
    return () => clearTimeout(timeout);
  }, [search, selectedClinicId]);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await userService.getAll();
        setUsers(res.data);
      } catch (err) {
        console.error(err);
      }
    };
    fetchUsers();
  }, []);

  const handleComplete = async (id: string) => {
    try {
      await taskService.complete(id);
      fetchTasks();
    } catch (err) {
      console.error('Failed to complete task:', err);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await taskService.cancel(id);
      fetchTasks();
    } catch (err) {
      console.error('Failed to cancel task:', err);
    }
  };

  const getPriorityColor = (p: string) => {
    switch (p) {
      case 'urgent': return 'text-red-600 bg-red-50 border-red-100';
      case 'high': return 'text-orange-600 bg-orange-50 border-orange-100';
      case 'normal': return 'text-blue-600 bg-blue-50 border-blue-100';
      case 'low': return 'text-gray-600 bg-gray-50 border-gray-100';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const isOverdue = (date: string, taskStatus: string) => {
    if (taskStatus === 'completed' || taskStatus === 'cancelled') return false;
    return new Date(date) < new Date(new Date().setHours(0,0,0,0));
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('tasks:title')}</h1>
          <p className="text-gray-500 mt-1">{t('tasks:subtitle')}</p>
        </div>
        <button 
          onClick={() => {
            setEditingTask(null);
            setIsFormOpen(true);
          }} 
          className="btn-primary"
        >
          <Plus size={20} />
          {t('tasks:newTask')}
        </button>
      </div>

      {/* Filter Bar */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text" 
            placeholder={t('common:search')}
            className="input-field pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select className="input-field" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('tasks:filters.allStatus')}</option>
          {['open', 'in_progress', 'completed', 'cancelled'].map(s => (
            <option key={s} value={s}>{t(`tasks:status.${s}`)}</option>
          ))}
        </select>

        <select className="input-field" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">{t('tasks:filters.allPriorities')}</option>
          {['low', 'normal', 'high', 'urgent'].map(p => (
            <option key={p} value={p}>{t(`tasks:priority.${p}`)}</option>
          ))}
        </select>

        <select className="input-field" value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
          <option value="">{t('tasks:filters.allUsers')}</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
          ))}
        </select>

        <div className="flex gap-2">
          <button 
            onClick={() => { setDueToday(!dueToday); setOverdue(false); }}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${dueToday ? 'bg-primary-50 border-primary-200 text-primary-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            {t('tasks:filters.dueToday')}
          </button>
          <button 
            onClick={() => { setOverdue(!overdue); setDueToday(false); }}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${overdue ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            {t('tasks:filters.overdue')}
          </button>
        </div>
      </div>

      {/* Task List */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-primary-600" size={32} />
          </div>
        ) : tasks.length > 0 ? (
          tasks.map((task) => (
            <div 
              key={task.id} 
              className={`card p-4 flex items-center gap-4 transition-all hover:shadow-md group border-l-4 ${
                task.status === 'completed' ? 'opacity-75 border-green-400' : 
                task.status === 'cancelled' ? 'opacity-50 border-gray-300' : 
                isOverdue(task.dueDate, task.status) ? 'border-red-500 bg-red-50/30' : 'border-transparent'
              }`}
            >
              <button 
                onClick={() => handleComplete(task.id)}
                disabled={task.status === 'completed' || task.status === 'cancelled'}
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                  task.status === 'completed' ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-primary-500 text-transparent hover:text-primary-500'
                }`}
              >
                <CheckCircle2 size={16} />
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className={`font-bold truncate ${task.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                    {task.title}
                  </h3>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getPriorityColor(task.priority)}`}>
                    {t(`tasks:priority.${task.priority}`)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-gray-500">
                  {task.patient && (
                    <span className="flex items-center gap-1">
                      <User size={12} className="text-gray-400" />
                      {task.patient.firstName} {task.patient.lastName}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock size={12} className="text-gray-400" />
                    <span className={isOverdue(task.dueDate, task.status) ? 'text-red-600 font-bold' : ''}>
                      {formatDate(task.dueDate)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <ClipboardList size={12} className="text-gray-400" />
                    {task.assignedTo?.firstName}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                {task.status !== 'completed' && task.status !== 'cancelled' && (
                  <>
                    <button 
                      onClick={() => { setEditingTask(task); setIsFormOpen(true); }}
                      className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
                      title={t('tasks:actions.edit')}
                    >
                      <MoreVertical size={18} />
                    </button>
                    <button 
                      onClick={() => handleCancel(task.id)}
                      className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors"
                      title={t('tasks:actions.cancel')}
                    >
                      <XCircle size={18} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="card p-20 text-center text-gray-500 bg-gray-50/50 border-dashed border-2">
            <ClipboardList size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="text-lg font-medium">{t('common:noData')}</p>
            <p className="text-sm">No tasks match your filters.</p>
          </div>
        )}
      </div>

      {isFormOpen && (
        <TaskForm 
          onClose={() => setIsFormOpen(false)} 
          onSuccess={() => {
            setIsFormOpen(false);
            fetchTasks();
          }}
          initialData={editingTask}
        />
      )}
    </div>
  );
};

export default Tasks;
