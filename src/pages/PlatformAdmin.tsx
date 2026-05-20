import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Building2, Users, UserPlus, Activity, TrendingUp,
  CheckCircle2, XCircle, Clock, Ban, AlertCircle, Loader2,
  ChevronRight, BarChart3, Package,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '/api';

interface Clinic {
  id: string;
  name: string;
  slug: string;
  status: string;
  email?: string;
  createdAt: string;
  trialEndsAt?: string;
  plan?: { displayName: string };
  _count: { users: number; patients: number; appointments: number };
}

interface Stats {
  totals: { clinics: number; users: number; patients: number; appointments: number };
  clinicsByStatus: Record<string, number>;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  active:    { label: 'Aktif',       color: 'text-green-600 bg-green-50',  icon: <CheckCircle2 size={14} /> },
  trial:     { label: 'Deneme',      color: 'text-blue-600 bg-blue-50',    icon: <Clock size={14} /> },
  suspended: { label: 'Askıya Alındı', color: 'text-amber-600 bg-amber-50', icon: <AlertCircle size={14} /> },
  cancelled: { label: 'İptal',       color: 'text-red-600 bg-red-50',      icon: <Ban size={14} /> },
};

const PlatformAdmin: React.FC = () => {
  const navigate = useNavigate();
  const [token] = useState(() => localStorage.getItem('platform_token'));
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [stats, setStats] = useState<Stats | null>(null);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

  const fetchData = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [statsRes, clinicsRes] = await Promise.all([
        axios.get(`${API_URL}/platform/stats`, { headers: authHeader }),
        axios.get(`${API_URL}/platform/clinics`, { headers: authHeader, params: statusFilter ? { status: statusFilter } : {} }),
      ]);
      setStats(statsRes.data);
      setClinics(clinicsRes.data);
    } catch (err: any) {
      if (err.response?.status === 401) {
        localStorage.removeItem('platform_token');
        navigate('/platform/login');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchData();
  }, [token, statusFilter]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const res = await axios.post(`${API_URL}/platform/auth/login`, {
        email: loginEmail,
        password: loginPassword,
      });
      localStorage.setItem('platform_token', res.data.token);
      window.location.reload();
    } catch (err: any) {
      setLoginError(err.response?.data?.error ?? 'Giriş başarısız');
    } finally {
      setLoginLoading(false);
    }
  };

  const updateStatus = async (clinicId: string, status: string) => {
    try {
      await axios.patch(`${API_URL}/platform/clinics/${clinicId}/status`, { status }, { headers: authHeader });
      fetchData();
    } catch {
      alert('Durum güncellenemedi');
    }
  };

  // Login formu
  if (!token) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="max-w-sm w-full">
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-violet-600 rounded-2xl flex items-center justify-center text-white font-bold text-xl mx-auto mb-4">
              P
            </div>
            <h1 className="text-2xl font-bold text-white">Platform Admin</h1>
          </div>
          <div className="bg-gray-800 rounded-2xl p-7 border border-gray-700">
            {loginError && (
              <div className="mb-4 p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-400 text-sm flex gap-2">
                <AlertCircle size={16} className="mt-0.5" /> {loginError}
              </div>
            )}
            <form onSubmit={handleLogin} className="space-y-4">
              <input
                type="email" required placeholder="E-posta" value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-xl px-4 py-2.5 text-white placeholder-gray-400 text-sm focus:ring-2 focus:ring-violet-500 outline-none"
              />
              <input
                type="password" required placeholder="Şifre" value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-xl px-4 py-2.5 text-white placeholder-gray-400 text-sm focus:ring-2 focus:ring-violet-500 outline-none"
              />
              <button
                type="submit" disabled={loginLoading}
                className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2"
              >
                {loginLoading && <Loader2 size={16} className="animate-spin" />} Giriş Yap
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center font-bold text-sm">P</div>
          <span className="font-semibold text-gray-200">Platform Admin</span>
        </div>
        <button
          onClick={() => { localStorage.removeItem('platform_token'); window.location.reload(); }}
          className="text-sm text-gray-400 hover:text-white"
        >
          Çıkış
        </button>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Toplam Klinik', value: stats.totals.clinics, icon: <Building2 size={18} />, color: 'bg-violet-600' },
              { label: 'Toplam Kullanıcı', value: stats.totals.users, icon: <Users size={18} />, color: 'bg-blue-600' },
              { label: 'Toplam Hasta', value: stats.totals.patients, icon: <UserPlus size={18} />, color: 'bg-teal-600' },
              { label: 'Toplam Randevu', value: stats.totals.appointments, icon: <BarChart3 size={18} />, color: 'bg-amber-600' },
            ].map((s) => (
              <div key={s.label} className="bg-gray-800 rounded-2xl p-5 border border-gray-700">
                <div className={`w-9 h-9 ${s.color} rounded-lg flex items-center justify-center mb-3`}>{s.icon}</div>
                <div className="text-2xl font-bold">{s.value.toLocaleString('tr-TR')}</div>
                <div className="text-xs text-gray-400 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Status badges */}
        {stats && (
          <div className="flex gap-2 flex-wrap">
            {Object.entries(stats.clinicsByStatus).map(([status, count]) => {
              const cfg = STATUS_CONFIG[status];
              return (
                <span key={status} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${cfg?.color ?? 'bg-gray-700 text-gray-300'}`}>
                  {cfg?.icon} {cfg?.label ?? status}: {count}
                </span>
              );
            })}
          </div>
        )}

        {/* Klinik Listesi */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Klinikler</h2>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-300"
            >
              <option value="">Tümü</option>
              <option value="active">Aktif</option>
              <option value="trial">Deneme</option>
              <option value="suspended">Askıya Alındı</option>
              <option value="cancelled">İptal</option>
            </select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="animate-spin text-gray-400" size={28} /></div>
          ) : (
            <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase">
                    <th className="text-left px-5 py-3">Klinik</th>
                    <th className="text-left px-5 py-3">Durum</th>
                    <th className="text-left px-5 py-3 hidden md:table-cell">Plan</th>
                    <th className="text-right px-5 py-3 hidden md:table-cell">Kullanıcı / Hasta</th>
                    <th className="text-right px-5 py-3">İşlemler</th>
                  </tr>
                </thead>
                <tbody>
                  {clinics.map((clinic) => {
                    const cfg = STATUS_CONFIG[clinic.status];
                    return (
                      <tr key={clinic.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
                        <td className="px-5 py-4">
                          <div className="font-medium text-white">{clinic.name}</div>
                          <div className="text-xs text-gray-400">/{clinic.slug}</div>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${cfg?.color ?? 'bg-gray-700 text-gray-300'}`}>
                            {cfg?.icon} {cfg?.label ?? clinic.status}
                          </span>
                        </td>
                        <td className="px-5 py-4 hidden md:table-cell text-gray-400">
                          {clinic.plan?.displayName ?? '—'}
                        </td>
                        <td className="px-5 py-4 hidden md:table-cell text-right text-gray-400">
                          {clinic._count.users} / {clinic._count.patients}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {clinic.status === 'active' && (
                              <button
                                onClick={() => updateStatus(clinic.id, 'suspended')}
                                className="text-xs text-amber-400 hover:text-amber-300 border border-amber-700 rounded-lg px-2.5 py-1 hover:bg-amber-900/20"
                              >
                                Askıya Al
                              </button>
                            )}
                            {(clinic.status === 'suspended' || clinic.status === 'trial') && (
                              <button
                                onClick={() => updateStatus(clinic.id, 'active')}
                                className="text-xs text-green-400 hover:text-green-300 border border-green-700 rounded-lg px-2.5 py-1 hover:bg-green-900/20"
                              >
                                Aktifleştir
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {clinics.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-10 text-gray-500">Klinik bulunamadı</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlatformAdmin;
