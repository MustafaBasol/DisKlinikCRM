import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Lock, Loader2, AlertCircle, CheckCircle, ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { authService } from '../services/api';

const getPasswordRuleErrors = (password: string, t: (key: string) => string) => {
  const errors: string[] = [];
  if (password.length < 8) errors.push(t('passwordRequirements.minLength'));
  if (!/[A-Z]/.test(password)) errors.push(t('passwordRequirements.uppercase'));
  if (!/[a-z]/.test(password)) errors.push(t('passwordRequirements.lowercase'));
  if (!/\d/.test(password)) errors.push(t('passwordRequirements.number'));
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) errors.push(t('passwordRequirements.special'));
  return errors;
};

const ResetPassword: React.FC = () => {
  const { t } = useTranslation('auth');
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const passwordErrors = getPasswordRuleErrors(newPassword, t);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (passwordErrors.length > 0) {
      setError(t('resetPasswordPage.errorWeakPassword'));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t('resetPasswordPage.errorMismatch'));
      return;
    }

    if (!token) {
      setError(t('resetPasswordPage.errorInvalidToken'));
      return;
    }

    setLoading(true);
    try {
      await authService.resetPassword({ token, newPassword });
      setSuccess(true);
    } catch (err: any) {
      const code = err?.response?.data?.code;
      if (code === 'RESET_TOKEN_INVALID' || code === 'RESET_TOKEN_EXPIRED' || code === 'RESET_TOKEN_USED') {
        setError(t('resetPasswordPage.errorInvalidToken'));
      } else if (code === 'PASSWORD_WEAK') {
        setError(t('resetPasswordPage.errorWeakPassword'));
      } else if (code === 'RESET_FIELDS_REQUIRED') {
        setError(t('resetPasswordPage.errorFieldsRequired'));
      } else {
        setError(t('resetPasswordPage.errorGeneric'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-gray-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-10">
          <div className="flex justify-center mb-6">
            <img
              src="/assets/brand/noramedi/logo-horizontal-light@2x.png"
              alt="NoraMedi CRM"
              className="h-12 w-auto dark:hidden"
            />
            <img
              src="/assets/brand/noramedi/logo-horizontal-dark@2x.png"
              alt="NoraMedi CRM"
              className="h-12 w-auto hidden dark:block"
            />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            {t('resetPasswordPage.title')}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2">
            {t('resetPasswordPage.subtitle')}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-xl shadow-gray-200/50 dark:shadow-black/50 p-8 border border-gray-100 dark:border-gray-700">
          {success ? (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <CheckCircle className="text-green-500" size={48} />
              </div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {t('resetPasswordPage.successTitle')}
              </h2>
              <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed">
                {t('resetPasswordPage.successMessage')}
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 text-primary-600 font-semibold hover:text-primary-700 text-sm mt-4"
              >
                <ArrowLeft size={16} />
                {t('resetPasswordPage.goToLogin')}
              </Link>
            </div>
          ) : (
            <>
              {!token && (
                <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm">
                  <AlertCircle size={18} />
                  {t('resetPasswordPage.errorInvalidToken')}
                </div>
              )}

              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm">
                  <AlertCircle size={18} />
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    {t('resetPasswordPage.newPasswordLabel')}
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                      type="password"
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all text-gray-900 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    {t('resetPasswordPage.confirmPasswordLabel')}
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all text-gray-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                  <p className="font-semibold">{t('passwordRequirements.title')}</p>
                  <ul className="space-y-1 pl-2">
                    {[
                      t('passwordRequirements.minLength'),
                      t('passwordRequirements.uppercase'),
                      t('passwordRequirements.lowercase'),
                      t('passwordRequirements.number'),
                      t('passwordRequirements.special'),
                    ].map((rule) => {
                      const failed = newPassword.length > 0 && passwordErrors.includes(rule);
                      return (
                        <li key={rule} className={failed ? 'text-red-500 dark:text-red-400 font-medium' : undefined}>
                          • {rule}
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <button
                  type="submit"
                  disabled={loading || !token}
                  className="w-full bg-primary-600 text-white font-bold py-4 rounded-xl hover:bg-primary-700 transition-all shadow-lg shadow-primary-200 flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  {loading ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      {t('resetPasswordPage.saving')}
                    </>
                  ) : (
                    t('resetPasswordPage.submitButton')
                  )}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-sm"
                >
                  <ArrowLeft size={16} />
                  {t('forgotPasswordPage.backToLogin')}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
