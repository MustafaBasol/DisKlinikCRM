import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Loader2, AlertCircle, CheckCircle, ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { authService } from '../services/api';

const ForgotPassword: React.FC = () => {
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await authService.forgotPassword({ email });
      setSubmitted(true);
    } catch {
      setError(t('forgotPasswordPage.error'));
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
            {t('forgotPasswordPage.title')}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2">
            {t('forgotPasswordPage.subtitle')}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-xl shadow-gray-200/50 dark:shadow-black/50 p-8 border border-gray-100 dark:border-gray-700">
          {submitted ? (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <CheckCircle className="text-green-500" size={48} />
              </div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {t('forgotPasswordPage.successTitle')}
              </h2>
              <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed">
                {t('forgotPasswordPage.successMessage')}
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 text-primary-600 font-semibold hover:text-primary-700 text-sm mt-4"
              >
                <ArrowLeft size={16} />
                {t('forgotPasswordPage.backToLogin')}
              </Link>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm">
                  <AlertCircle size={18} />
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    {t('forgotPasswordPage.emailLabel')}
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all text-gray-900 dark:text-white"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-primary-600 text-white font-bold py-4 rounded-xl hover:bg-primary-700 transition-all shadow-lg shadow-primary-200 flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  {loading ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      {t('forgotPasswordPage.sending')}
                    </>
                  ) : (
                    t('forgotPasswordPage.submitButton')
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

export default ForgotPassword;
