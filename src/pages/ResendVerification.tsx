import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../services/api';
import { Mail, Loader2, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const ResendVerification: React.FC = () => {
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authService.resendVerification({ email });
    } catch {
      // Always show generic success — no user enumeration
    } finally {
      setLoading(false);
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] dark:bg-gray-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center bg-white dark:bg-gray-800 rounded-3xl shadow-xl p-10 border border-gray-100 dark:border-gray-700">
          <CheckCircle2 size={56} className="text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            {t('resendVerificationPage.successTitle')}
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            {t('resendVerificationPage.successMessage')}
          </p>
          <Link
            to="/login"
            className="text-sm text-primary-600 font-semibold hover:underline"
          >
            {t('resendVerificationPage.backToLogin')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-gray-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <img
              src="/assets/brand/noramedi/logo-horizontal-light.svg"
              alt="NoraMedi CRM"
              className="h-12 w-auto dark:hidden"
            />
            <img
              src="/assets/brand/noramedi/logo-horizontal-dark.svg"
              alt="NoraMedi CRM"
              className="h-12 w-auto hidden dark:block"
            />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t('resendVerificationPage.title')}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2">
            {t('resendVerificationPage.subtitle')}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-xl p-8 border border-gray-100 dark:border-gray-700">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                {t('resendVerificationPage.emailLabel')}
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
              className="w-full bg-primary-600 text-white font-bold py-3 rounded-xl hover:bg-primary-700 transition-all flex items-center justify-center gap-2 disabled:opacity-70"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : t('resendVerificationPage.submitButton')}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-5">
            <Link to="/login" className="text-primary-600 font-semibold hover:underline">
              {t('resendVerificationPage.backToLogin')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default ResendVerification;
