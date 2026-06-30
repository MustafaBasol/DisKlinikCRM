import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowLeft, Info } from 'lucide-react';
import PublicThemeToggle from '../../components/landing/PublicThemeToggle';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface LegalProfile {
  dataControllerTitle?: string;
  address?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  privacyRequestEmail?: string;
  kepEmail?: string;
  website?: string;
  dataProtectionContact?: string;
  privacyNoticeText?: string;
  channelDisclosureText?: string;
  privacyNoticeVersion?: string;
  effectiveDate?: string;
  isPublished?: boolean;
}

interface PageData {
  clinic: { name: string; legalName?: string | null };
  legalProfile: LegalProfile;
}

const ClinicKvkkPublicPage: React.FC = () => {
  const { clinicSlug } = useParams<{ clinicSlug: string }>();
  const { t } = useTranslation('legal');
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!clinicSlug) { setNotFound(true); setLoading(false); return; }
    axios.get(`${API_BASE}/public/clinics/${clinicSlug}/kvkk`)
      .then(res => { setData(res.data); })
      .catch(() => { setNotFound(true); })
      .finally(() => { setLoading(false); });
  }, [clinicSlug]);

  return (
    <div className="landing-page legal-page min-h-screen">
      <header className="border-b border-[var(--landing-border)] bg-[var(--landing-surface)]">
        <div className="landing-container flex min-h-[4.75rem] flex-wrap items-center justify-between gap-4 py-3">
          <Link to="/landing" className="flex flex-col items-start gap-0.5" aria-label="NoraMedi">
            <img src="/assets/brand/noramedi/logo-horizontal-light.svg" alt="NoraMedi" className="h-9 w-auto dark:hidden" />
            <img src="/assets/brand/noramedi/logo-horizontal-dark.svg" alt="NoraMedi" className="h-9 w-auto hidden dark:block" />
          </Link>
          <div className="flex items-center gap-2">
            <PublicThemeToggle label={t('shared.themeToggle')} />
            <Link to="/legal" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-[var(--landing-heading)] transition-colors hover:bg-[var(--landing-surface-muted)]">
              <ArrowLeft size={16} />
              {t('clinicKvkk.backToLegal')}
            </Link>
          </div>
        </div>
      </header>

      <div className="landing-container py-8 sm:py-12 max-w-3xl">
        {loading ? (
          <p className="text-[var(--landing-muted)]">{t('clinicKvkk.loading')}</p>
        ) : notFound || !data ? (
          <div>
            <p className="mt-8 text-xs font-bold uppercase tracking-[0.16em] text-[var(--landing-teal)]">{t('shared.label')}</p>
            <h1 className="mt-3 text-3xl font-bold tracking-[-0.045em]">{t('clinicKvkk.notAvailableTitle')}</h1>
            <p className="mt-5 text-base leading-8 text-[var(--landing-muted)]">{t('clinicKvkk.notAvailableBody')}</p>
          </div>
        ) : (
          <div>
            {/* Notice */}
            <div className="legal-notice" role="note">
              <Info className="mt-0.5 shrink-0 text-[var(--landing-teal)]" size={19} />
              <div>
                <p className="font-semibold text-[var(--landing-heading)]">{t('clinicKvkk.noticeTitle')}</p>
                <p className="mt-1 text-sm leading-7 text-[var(--landing-muted)]">{t('clinicKvkk.noticeBody')}</p>
              </div>
            </div>

            <p className="mt-8 text-xs font-bold uppercase tracking-[0.16em] text-[var(--landing-teal)]">{t('shared.label')}</p>
            <h1 className="mt-3 max-w-3xl text-3xl font-bold tracking-[-0.045em]">{data.clinic.name}</h1>
            {data.clinic.legalName && data.clinic.legalName !== data.clinic.name && (
              <p className="mt-2 text-base text-[var(--landing-muted)]">{data.clinic.legalName}</p>
            )}

            <div className="legal-content mt-10 space-y-8">
              {/* Controller info */}
              <section className="legal-section">
                <h2 className="text-xl font-bold tracking-[-0.025em]">{t('clinicKvkk.controllerTitle')}</h2>
                <div className="legal-body mt-4">
                  <div className="overflow-x-auto rounded-2xl border border-[var(--landing-border)]">
                    <table className="legal-table">
                      <tbody>
                        {data.legalProfile.dataControllerTitle && (
                          <tr><th scope="row">{t('clinicKvkk.fields.dataControllerTitle')}</th><td>{data.legalProfile.dataControllerTitle}</td></tr>
                        )}
                        {data.legalProfile.address && (
                          <tr><th scope="row">{t('clinicKvkk.fields.address')}</th><td>{[data.legalProfile.address, data.legalProfile.city, data.legalProfile.country].filter(Boolean).join(', ')}</td></tr>
                        )}
                        {data.legalProfile.phone && (
                          <tr><th scope="row">{t('clinicKvkk.fields.phone')}</th><td>{data.legalProfile.phone}</td></tr>
                        )}
                        {(data.legalProfile.privacyRequestEmail || data.legalProfile.email) && (
                          <tr><th scope="row">{t('clinicKvkk.fields.privacyRequestEmail')}</th><td><a href={`mailto:${data.legalProfile.privacyRequestEmail || data.legalProfile.email}`} className="underline">{data.legalProfile.privacyRequestEmail || data.legalProfile.email}</a></td></tr>
                        )}
                        {data.legalProfile.kepEmail && (
                          <tr><th scope="row">{t('clinicKvkk.fields.kepEmail')}</th><td>{data.legalProfile.kepEmail}</td></tr>
                        )}
                        {data.legalProfile.website && (
                          <tr><th scope="row">{t('clinicKvkk.fields.website')}</th><td><a href={data.legalProfile.website} target="_blank" rel="noopener noreferrer" className="underline">{data.legalProfile.website}</a></td></tr>
                        )}
                        {data.legalProfile.dataProtectionContact && (
                          <tr><th scope="row">{t('clinicKvkk.fields.dataProtectionContact')}</th><td>{data.legalProfile.dataProtectionContact}</td></tr>
                        )}
                        {data.legalProfile.privacyNoticeVersion && (
                          <tr><th scope="row">{t('clinicKvkk.fields.version')}</th><td>{data.legalProfile.privacyNoticeVersion}</td></tr>
                        )}
                        {data.legalProfile.effectiveDate && (
                          <tr><th scope="row">{t('clinicKvkk.fields.effectiveDate')}</th><td>{new Date(data.legalProfile.effectiveDate).toLocaleDateString('tr-TR')}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              {/* Privacy notice text */}
              {data.legalProfile.privacyNoticeText && (
                <section className="legal-section">
                  <h2 className="text-xl font-bold tracking-[-0.025em]">{t('clinicKvkk.privacyNoticeTitle')}</h2>
                  <div className="legal-body mt-4">
                    <div className="whitespace-pre-line text-sm leading-7">{data.legalProfile.privacyNoticeText}</div>
                  </div>
                </section>
              )}

              {/* Channel disclosure */}
              {data.legalProfile.channelDisclosureText && (
                <section className="legal-section">
                  <h2 className="text-xl font-bold tracking-[-0.025em]">{t('clinicKvkk.channelDisclosureTitle')}</h2>
                  <div className="legal-body mt-4">
                    <div className="whitespace-pre-line text-sm leading-7">{data.legalProfile.channelDisclosureText}</div>
                  </div>
                </section>
              )}

              {/* AI / channel warning */}
              <section className="legal-section">
                <h2 className="text-xl font-bold tracking-[-0.025em]">{t('clinicKvkk.aiWarningTitle')}</h2>
                <div className="legal-body mt-4">
                  <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
                    <p className="text-sm leading-7 text-amber-800">{t('clinicKvkk.aiWarningBody')}</p>
                  </div>
                </div>
              </section>

              {/* Platform note */}
              <section className="legal-section">
                <h2 className="text-xl font-bold tracking-[-0.025em]">{t('clinicKvkk.platformNoteTitle')}</h2>
                <div className="legal-body mt-4">
                  <p>{t('clinicKvkk.platformNoteBody')}</p>
                </div>
              </section>
            </div>
          </div>
        )}
      </div>

      <footer className="mt-8 border-t border-[var(--landing-border)] bg-[var(--landing-surface)]">
        <div className="landing-container flex flex-col justify-between gap-4 py-7 text-sm text-[var(--landing-muted)] sm:flex-row sm:items-center">
          <span>&copy; 2026 NoraMedi</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link className="hover:text-[var(--landing-heading)]" to="/legal/privacy">{t('nav.privacy')}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default ClinicKvkkPublicPage;
