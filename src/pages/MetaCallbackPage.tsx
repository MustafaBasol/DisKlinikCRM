/**
 * MetaCallbackPage.tsx — OAuth redirect target for Meta Embedded Signup
 *
 * This page is served at the VITE_META_REDIRECT_URI path (e.g. /auth/meta/callback).
 * Meta redirects here after the user completes (or cancels) the Embedded Signup flow.
 *
 * It:
 * 1. Reads the OAuth `code`, `state`, and `error` from the URL query string.
 * 2. Posts a `meta_signup_callback` message to window.opener (the parent WhatsApp
 *    Connections page that opened this popup).
 * 3. Attempts to close itself. If running in same-tab fallback mode, shows a
 *    "You can close this tab" message.
 * 4. Never exposes app secrets. No API calls are made from this page.
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

type CallbackState = 'processing' | 'success' | 'error' | 'no_opener';

const ALLOWED_ORIGINS = [window.location.origin];

export default function MetaCallbackPage() {
  const [state, setState] = useState<CallbackState>('processing');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code') ?? undefined;
    const stateParam = params.get('state') ?? undefined;
    const error = params.get('error');
    const errorDescription = params.get('error_description');

    // Build the postMessage payload — no secrets, only what Meta returned
    const payload = {
      type: 'meta_signup_callback' as const,
      code,
      state: stateParam,
      error: error ?? undefined,
      errorDescription: errorDescription ?? undefined,
    };

    if (error) {
      setErrorMsg(errorDescription ?? error);
      setState('error');
    } else if (!code) {
      setErrorMsg('Meta yanıtı eksik: authorization code alınamadı.');
      setState('error');
    }

    // Try to send to opener
    const opener = window.opener as Window | null;
    if (opener && !opener.closed) {
      // Only post to the same origin for security
      try {
        opener.postMessage(payload, ALLOWED_ORIGINS[0]);
      } catch {
        // Opener may be cross-origin in some popup setups — ignore
      }
      if (!error && code) {
        setState('success');
      }
      // Close popup after a brief delay so user can see the status
      setTimeout(() => {
        try {
          window.close();
        } catch {
          // Some browsers block window.close() on user-opened pages
        }
      }, 1500);
    } else {
      // No opener — likely same-tab fallback or direct navigation
      // In this case, we cannot postMessage. Show instruction to user.
      setState('no_opener');
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
        {state === 'processing' && (
          <>
            <Loader2 className="mx-auto mb-4 text-blue-500 animate-spin" size={40} />
            <p className="text-gray-700 dark:text-gray-300 font-medium">
              Meta bağlantısı tamamlanıyor…
            </p>
          </>
        )}
        {state === 'success' && (
          <>
            <CheckCircle2 className="mx-auto mb-4 text-green-500" size={40} />
            <p className="text-gray-700 dark:text-gray-300 font-medium">
              Meta hesabınız başarıyla bağlandı.
            </p>
            <p className="mt-2 text-sm text-gray-400">Bu sekme kapanacak…</p>
          </>
        )}
        {state === 'error' && (
          <>
            <XCircle className="mx-auto mb-4 text-red-500" size={40} />
            <p className="text-gray-700 dark:text-gray-300 font-medium">
              Meta bağlantısı başarısız oldu.
            </p>
            {errorMsg && (
              <p className="mt-2 text-sm text-red-500 dark:text-red-400 break-words">{errorMsg}</p>
            )}
            <p className="mt-4 text-sm text-gray-400">Bu sekmeyi/pencereyi kapatabilirsiniz.</p>
          </>
        )}
        {state === 'no_opener' && (
          <>
            <CheckCircle2 className="mx-auto mb-4 text-blue-500" size={40} />
            <p className="text-gray-700 dark:text-gray-300 font-medium">
              Meta yetkilendirmesi alındı.
            </p>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              WhatsApp Bağlantıları sayfasına geri dönün ve tekrar deneyin.
            </p>
            <a
              href="/organization/whatsapp"
              className="mt-4 inline-block text-blue-600 dark:text-blue-400 text-sm underline"
            >
              WhatsApp Bağlantıları
            </a>
          </>
        )}
      </div>
    </div>
  );
}
