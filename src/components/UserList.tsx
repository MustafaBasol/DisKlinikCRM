import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Edit2, Loader2, Plus, UserCog, XCircle, Building2, FileUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { userService } from '../services/api';
import UserClinicAssignmentModal from './UserClinicAssignmentModal';
import UserImportModal from './UserImportModal';
import { useAuth } from '../context/AuthContext';
import { canAssignUserClinics, canImportUsers } from '../utils/permissions';
import { getErrorMessage } from '../utils/errors';

const roles = ['admin', 'doctor', 'receptionist', 'billing'];

const UserList: React.FC = () => {
  const { t } = useTranslation(['settings', 'common']);
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [assignTarget, setAssignTarget] = useState<{ id: string; name: string; email: string } | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await userService.getAll();
      setUsers(res.data);
    } catch {
      setError(t('settings:users.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const openModal = (user: any = null) => {
    setEditingUser(user);
    setIsModalOpen(true);
  };

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary-500" /></div>;
  }

  if (error) {
    return <div className="text-red-500 p-4 bg-red-50 rounded-lg">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-bold">{t('settings:users.title')}</h2>
          <p className="text-sm text-gray-500">{t('settings:users.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {canImportUsers(currentUser) && (
            <button
              onClick={() => setIsImportOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-green-50 hover:bg-green-100 text-green-700 font-medium rounded-lg border border-green-200 transition-colors text-sm"
            >
              <FileUp size={16} />
              {t('settings:users.importStaffWithExcel')}
            </button>
          )}
          <button onClick={() => openModal()} className="btn-primary">
            <Plus size={18} />
            {t('settings:users.newUser')}
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs uppercase text-gray-500">
                <th className="p-4 font-semibold">{t('settings:users.fields.name')}</th>
                <th className="p-4 font-semibold">{t('settings:users.fields.email')}</th>
                <th className="p-4 font-semibold">{t('settings:users.fields.phone')}</th>
                <th className="p-4 font-semibold">{t('settings:users.fields.role')}</th>
                <th className="p-4 font-semibold">{t('settings:users.fields.status')}</th>
                <th className="p-4 font-semibold text-right">{t('common:actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map((user) => (
                <tr key={user.id} className={`hover:bg-gray-50/50 transition-colors ${!user.isActive ? 'opacity-50' : ''}`}>
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-primary-50 flex items-center justify-center text-primary-700 font-bold">
                        {user.firstName?.[0]}{user.lastName?.[0]}
                      </div>
                      <span className="font-medium text-gray-900">{user.firstName} {user.lastName}</span>
                    </div>
                  </td>
                  <td className="p-4 text-sm text-gray-600">{user.email}</td>
                  <td className="p-4 text-sm text-gray-600">{user.phone || '-'}</td>
                  <td className="p-4 text-sm text-gray-600">{t(`common:roles.${user.role}`)}</td>
                  <td className="p-4">
                    <span className={`badge ${user.isActive ? 'badge-green' : 'badge-gray'}`}>
                      {user.isActive ? t('settings:users.status.active') : t('settings:users.status.inactive')}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-1">
                      {canAssignUserClinics(currentUser) && (
                        <button
                          onClick={() => setAssignTarget({ id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email })}
                          className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors"
                          title={t('settings:clinicAssignments.title')}
                        >
                          <Building2 size={16} />
                        </button>
                      )}
                      <button onClick={() => openModal(user)} className="p-1.5 text-gray-400 hover:text-primary-600 transition-colors" title={t('common:edit')}>
                        <Edit2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500 italic">{t('settings:users.empty')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <UserModal
          user={editingUser}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => {
            setIsModalOpen(false);
            fetchUsers();
          }}
        />
      )}
      {assignTarget && (
        <UserClinicAssignmentModal
          userId={assignTarget.id}
          userName={assignTarget.name}
          userEmail={assignTarget.email}
          onClose={() => setAssignTarget(null)}
          onSaved={() => { setAssignTarget(null); fetchUsers(); }}
        />
      )}
      {isImportOpen && (
        <UserImportModal
          onClose={() => setIsImportOpen(false)}
          onSuccess={() => {
            setIsImportOpen(false);
            fetchUsers();
          }}
        />
      )}
    </div>
  );
};

const UserModal: React.FC<{ user: any, onClose: () => void, onSuccess: () => void }> = ({ user, onClose, onSuccess }) => {
  const { t } = useTranslation(['settings', 'common']);
  const [formData, setFormData] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || '',
    phone: user?.phone || '',
    role: user?.role || 'doctor',
    password: '',
    isActive: user?.isActive ?? true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);

  const validatePassword = (pwd: string) => {
    const errors: string[] = [];
    if (pwd.length < 8) errors.push(t('settings:users.passwordRules.minLength'));
    if (!/[A-Z]/.test(pwd)) errors.push(t('settings:users.passwordRules.uppercase'));
    if (!/[a-z]/.test(pwd)) errors.push(t('settings:users.passwordRules.lowercase'));
    if (!/\d/.test(pwd)) errors.push(t('settings:users.passwordRules.number'));
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd)) errors.push(t('settings:users.passwordRules.special'));
    setPasswordErrors(errors);
  };

  const handlePasswordChange = (pwd: string) => {
    setFormData({ ...formData, password: pwd });
    if (!user || pwd) validatePassword(pwd);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const payload: any = { ...formData };
      if (user && !payload.password) {
        delete payload.password;
      }

      if (user) {
        await userService.update(user.id, payload);
      } else {
        await userService.create(payload);
      }
      onSuccess();
    } catch (err: any) {
      const errorMsg = getErrorMessage(err, t('settings:users.errors.saveFailed'));
      const details = err.response?.data?.details;
      setError(errorMsg);
      if (details && Array.isArray(details) && details.every((d: unknown) => typeof d === 'string')) {
        setPasswordErrors(details);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center text-primary-600">
              <UserCog size={20} />
            </div>
            <h2 className="text-xl font-bold">{user ? t('settings:users.editUser') : t('settings:users.newUser')}</h2>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
            <XCircle size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm flex items-center gap-2"><AlertCircle size={16} />{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings:users.fields.firstName')} *</label>
              <input required className="input-field w-full" value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings:users.fields.lastName')} *</label>
              <input required className="input-field w-full" value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings:users.fields.email')} *</label>
            <input required type="email" className="input-field w-full" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings:users.fields.phone')}</label>
            <input className="input-field w-full" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings:users.fields.role')} *</label>
              <select className="input-field w-full" value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })}>
                {roles.map(role => <option key={role} value={role}>{t(`common:roles.${role}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings:users.fields.password')}{user ? '' : ' *'}</label>
              <input required={!user} type="password" className="input-field w-full" value={formData.password} onChange={e => handlePasswordChange(e.target.value)} placeholder={user ? t('settings:users.passwordHelp') : ''} />
            </div>
          </div>

          {(formData.password || !user) && passwordErrors.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm font-medium text-amber-900 mb-2">{t('settings:users.passwordRequirementsTitle')}</p>
              <ul className="space-y-1">
                {passwordErrors.map(error => (
                  <li key={error} className="text-xs text-amber-800 flex items-center gap-2">
                    <span className="text-amber-600">•</span> {error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className="flex items-center gap-3 pt-2 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" checked={formData.isActive} onChange={e => setFormData({ ...formData, isActive: e.target.checked })} />
            <span className="text-sm font-medium text-gray-700">{t('settings:users.fields.isActive')}</span>
            {formData.isActive ? <CheckCircle2 size={16} className="text-green-500" /> : <XCircle size={16} className="text-gray-400" />}
          </label>

          <div className="flex gap-3 pt-4 mt-6 border-t border-gray-100">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">{t('common:cancel')}</button>
            <button type="submit" disabled={loading || (!user && passwordErrors.length > 0)} className="flex-1 btn-primary">
              {loading ? <Loader2 size={18} className="animate-spin" /> : t('common:save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserList;
