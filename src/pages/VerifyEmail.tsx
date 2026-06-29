import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { authService } from '../services/api';
import { CheckCircle2, XCircle, Loader2, Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const VerifyEmail: React.FC = () => {
  const { t } = useTranslation('auth');
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'no-token'>('loading');
  const [errorCode, setErrorCode] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('no-token');
      return;
    }

    authService
      .verifyEmail({ token })
      .then(() => setStatus('success'))
      .catch((err: any) => {
        setErrorCode(err.response?.data?.code ?? '');
        setStatus('error');
      });
  }, [token]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-gray-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center bg-white dark:bg-gray-800 rounded-3xl shadow-xl p-10 border border-gray-100 dark:border-gray-700">
        {status === 'loading' && (
          <>
            <Loader2 size={56} className="text-primary-600 mx-auto mb-4 animate-spin" />
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {t('verifyEmailPage.verifying')}
            </h2>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 size={56} className="text-green-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {t('verifyEmailPage.successTitle')}
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              {t('verifyEmailPage.successMessage')}
            </p>
            <Link
              to="/login"
              className="inline-block bg-primary-600 text-white font-semibold px-6 py-3 rounded-xl hover:bg-primary-700 transition-colors"
            >
              {t('verifyEmailPage.goToLogin')}
            </Link>
          </>
        )}

        {(status === 'error' || status === 'no-token') && (
          <>
            <XCircle size={56} className="text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {t('verifyEmailPage.errorTitle')}
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              {errorCode === 'VERIFY_TOKEN_USED'
                ? t('verifyEmailPage.errorUsed')
                : errorCode === 'VERIFY_TOKEN_EXPIRED'
                  ? t('verifyEmailPage.errorExpired')
                  : t('verifyEmailPage.errorGeneric')}
            </p>
            <div className="flex flex-col gap-3">
              <Link
                to="/resend-verification"
                className="inline-flex items-center justify-center gap-2 bg-primary-600 text-white font-semibold px-6 py-3 rounded-xl hover:bg-primary-700 transition-colors"
              >
                <Mail size={18} />
                {t('verifyEmailPage.resendLink')}
              </Link>
              <Link
                to="/login"
                className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              >
                {t('verifyEmailPage.backToLogin')}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default VerifyEmail;
