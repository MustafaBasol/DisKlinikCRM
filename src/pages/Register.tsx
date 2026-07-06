import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { Building2, Mail, Lock, User, CheckCircle2, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const getPasswordRuleErrors = (password: string, t: (key: string) => string) => {
  const errors: string[] = [];
  if (password.length < 8) errors.push(t('passwordRequirements.minLength'));
  if (!/[A-Z]/.test(password)) errors.push(t('passwordRequirements.uppercase'));
  if (!/[a-z]/.test(password)) errors.push(t('passwordRequirements.lowercase'));
  if (!/\d/.test(password)) errors.push(t('passwordRequirements.number'));
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) errors.push(t('passwordRequirements.special'));
  return errors;
};

interface FormData {
  clinicName: string;
  slug: string;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  adminPassword: string;
  confirmPassword: string;
}

const Register: React.FC = () => {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [form, setForm] = useState<FormData>({
    clinicName: '',
    slug: '',
    adminFirstName: '',
    adminLastName: '',
    adminEmail: '',
    adminPassword: '',
    confirmPassword: '',
  });
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // clinicName değişince slug otomatik üret
  useEffect(() => {
    if (form.clinicName && !form.slug) {
      const auto = form.clinicName
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      setForm((f) => ({ ...f, slug: auto }));
    }
  }, [form.clinicName]);

  // Slug müsaitlik kontrolü (debounce)
  useEffect(() => {
    if (!form.slug || form.slug.length < 3) {
      setSlugStatus('idle');
      return;
    }
    setSlugStatus('checking');
    const t = setTimeout(async () => {
      try {
        const res = await axios.get(`${API_URL}/register/check-slug/${form.slug}`);
        setSlugStatus(res.data.available ? 'available' : 'taken');
      } catch {
        setSlugStatus('idle');
      }
    }, 500);
    return () => clearTimeout(t);
  }, [form.slug]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    setForm((f) => ({ ...f, slug: val }));
  };

  const passwordErrors = getPasswordRuleErrors(form.adminPassword, t);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (passwordErrors.length > 0) {
      setError(t('register.errors.weakPassword'));
      return;
    }
    if (form.adminPassword !== form.confirmPassword) {
      setError(t('register.errors.passwordMismatch'));
      return;
    }
    if (slugStatus === 'taken') {
      setError(t('register.errors.slugTaken'));
      return;
    }

    setLoading(true);
    try {
      await axios.post(`${API_URL}/register/clinic`, {
        clinicName: form.clinicName,
        slug: form.slug,
        adminFirstName: form.adminFirstName,
        adminLastName: form.adminLastName,
        adminEmail: form.adminEmail,
        adminPassword: form.adminPassword,
        currency: 'TRY',
        timezone: 'Europe/Istanbul',
      });
      setSuccess(true);
    } catch (err: any) {
      const details = err.response?.data?.details;
      if (Array.isArray(details) && details.length > 0) {
        setError(t('register.errors.weakPassword'));
      } else {
        setError(err.response?.data?.error ?? t('register.errors.registerFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center bg-white rounded-3xl shadow-xl p-10">
          <CheckCircle2 size={56} className="text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('register.successTitle')}</h2>
          <p className="text-gray-500">{t('register.successSubtitle')}</p>
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 mt-4">
            {t('register.verifyEmailNotice')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="max-w-lg w-full">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-primary-600 rounded-2xl flex items-center justify-center text-white text-2xl font-bold mx-auto shadow-lg mb-4">
            D
          </div>
          <h1 className="text-3xl font-bold text-gray-900">{t('register.title')}</h1>
          <p className="text-gray-500 mt-1">{t('register.subtitle')}</p>
        </div>

        <div className="bg-white rounded-3xl shadow-xl p-8 border border-gray-100">
          {error && (
            <div className="mb-5 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-600 text-sm">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Klinik Bilgileri */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                {t('register.clinicInfo')}
              </label>
              <div className="space-y-3">
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input
                    name="clinicName"
                    type="text"
                    required
                    placeholder={t('register.clinicNamePlaceholder')}
                    value={form.clinicName}
                    onChange={handleChange}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                  />
                </div>

                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">app.com/</span>
                  <input
                    name="slug"
                    type="text"
                    required
                    placeholder={t('register.slugPlaceholder')}
                    value={form.slug}
                    onChange={handleSlugChange}
                    className="w-full pl-20 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    {slugStatus === 'checking' && <Loader2 size={16} className="animate-spin text-gray-400" />}
                    {slugStatus === 'available' && <CheckCircle2 size={16} className="text-green-500" />}
                    {slugStatus === 'taken' && <XCircle size={16} className="text-red-500" />}
                  </span>
                </div>
                {slugStatus === 'taken' && (
                  <p className="text-xs text-red-500">{t('register.slugTaken')}</p>
                )}
                {slugStatus === 'available' && (
                  <p className="text-xs text-green-600">{t('register.slugAvailable')}</p>
                )}
              </div>
            </div>

            {/* Admin Hesabı */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                {t('register.adminAccount')}
              </label>
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    <input
                      name="adminFirstName"
                      type="text"
                      required
                      placeholder={t('register.firstName')}
                      value={form.adminFirstName}
                      onChange={handleChange}
                      className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                    />
                  </div>
                  <input
                    name="adminLastName"
                    type="text"
                    required
                    placeholder={t('register.lastName')}
                    value={form.adminLastName}
                    onChange={handleChange}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                  />
                </div>

                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input
                    name="adminEmail"
                    type="email"
                    required
                    placeholder={t('register.email')}
                    value={form.adminEmail}
                    onChange={handleChange}
                    className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                  />
                </div>

                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input
                    name="adminPassword"
                    type="password"
                    required
                    placeholder={t('register.passwordPlaceholder')}
                    value={form.adminPassword}
                    onChange={handleChange}
                    className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                  />
                </div>

                {form.adminPassword && passwordErrors.length > 0 && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                    <p className="font-semibold mb-1">{t('passwordRequirements.title')}</p>
                    <ul className="space-y-0.5 pl-2">
                      {passwordErrors.map((rule) => (
                        <li key={rule}>• {rule}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input
                    name="confirmPassword"
                    type="password"
                    required
                    placeholder={t('register.confirmPasswordPlaceholder')}
                    value={form.confirmPassword}
                    onChange={handleChange}
                    className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || slugStatus === 'taken' || slugStatus === 'checking'}
              className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={18} className="animate-spin" />}
              {loading ? t('register.saving') : t('register.submit')}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-5">
            {t('register.alreadyHaveAccount')}{' '}
            <Link to="/login" className="text-primary-600 font-semibold hover:underline">
              {t('register.loginLink')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;
