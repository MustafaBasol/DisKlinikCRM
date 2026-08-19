/**
 * Inbox.tsx — UX-001: unified navigational shell for messaging channels.
 *
 * NOTE (scope): This is a foundation, not a merged inbox. WhatsApp and
 * Instagram each keep their own fully-working page (own state, own service
 * calls, own header) — this component only adds a channel tab bar above
 * whichever one is active. There is no backend contract for a true merged
 * feed yet, so "All" is a visible but disabled/coming-soon tab, never a
 * real view. Do not extend this file to fetch or merge messages itself.
 */
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { canViewWhatsAppInbox, canViewInstagramInbox } from '../utils/permissions';
import WhatsAppInbox from './WhatsAppInbox';
import InstagramInbox from './InstagramInbox';

type InboxChannel = 'whatsapp' | 'instagram';

const CHANNEL_ORDER: InboxChannel[] = ['whatsapp', 'instagram'];

export default function Inbox() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { channel } = useParams<{ channel?: string }>();
  const { t } = useTranslation(['inbox', 'common']);

  const canWhatsApp = canViewWhatsAppInbox(user);
  const canInstagram = canViewInstagramInbox(user);

  const permittedChannels = CHANNEL_ORDER.filter((c) =>
    c === 'whatsapp' ? canWhatsApp : canInstagram,
  );

  const isValidChannel = channel === 'whatsapp' || channel === 'instagram';
  const isPermittedChannel =
    isValidChannel && ((channel === 'whatsapp' && canWhatsApp) || (channel === 'instagram' && canInstagram));

  const fallbackPath = permittedChannels.length > 0 ? `/inbox/${permittedChannels[0]}` : '/dashboard';
  const needsRedirect = !isPermittedChannel;

  useEffect(() => {
    if (needsRedirect) {
      navigate(fallbackPath, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsRedirect, fallbackPath]);

  if (needsRedirect) {
    return null;
  }

  const activeChannel = channel as InboxChannel;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 border-b border-gray-200 bg-white px-4 pt-3" role="tablist" aria-label={t('inbox:title')}>
        <button
          type="button"
          role="tab"
          aria-selected="false"
          disabled
          title={t('inbox:allComingSoon')}
          aria-disabled="true"
          className="px-3 py-2 text-sm font-medium text-gray-400 border-b-2 border-transparent cursor-not-allowed select-none"
        >
          {t('inbox:tabs.all')}
        </button>
        {canWhatsApp && (
          <button
            type="button"
            role="tab"
            aria-selected={activeChannel === 'whatsapp'}
            onClick={() => navigate('/inbox/whatsapp')}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeChannel === 'whatsapp'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {t('inbox:tabs.whatsapp')}
          </button>
        )}
        {canInstagram && (
          <button
            type="button"
            role="tab"
            aria-selected={activeChannel === 'instagram'}
            onClick={() => navigate('/inbox/instagram')}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeChannel === 'instagram'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {t('inbox:tabs.instagram')}
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {activeChannel === 'whatsapp' && <WhatsAppInbox />}
        {activeChannel === 'instagram' && <InstagramInbox />}
      </div>
    </div>
  );
}
