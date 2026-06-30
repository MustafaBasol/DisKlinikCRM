import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle, ExternalLink, FileText, Globe, Save } from 'lucide-react';
import { clinicLegalProfileService } from '../../services/api';

interface LegalProfile {
  dataControllerTitle?: string | null;
  taxNumber?: string | null;
  mersisNumber?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  privacyRequestEmail?: string | null;
  kepEmail?: string | null;
  website?: string | null;
  dataProtectionContact?: string | null;
  privacyNoticeText?: string | null;
  channelDisclosureText?: string | null;
  channelConsentText?: string | null;
  privacyNoticeVersion?: string | null;
  effectiveDate?: string | null;
  isPublished?: boolean;
}

interface ClinicKvkkSectionProps {
  clinicId?: string;
  clinicSlug?: string;
  clinicName?: string;
  canEdit: boolean;
}

const EMPTY: LegalProfile = {
  dataControllerTitle: '',
  taxNumber: '',
  mersisNumber: '',
  address: '',
  city: '',
  country: 'TR',
  phone: '',
  email: '',
  privacyRequestEmail: '',
  kepEmail: '',
  website: '',
  dataProtectionContact: '',
  privacyNoticeText: '',
  channelDisclosureText: '',
  channelConsentText: '',
  privacyNoticeVersion: '',
  effectiveDate: '',
  isPublished: false,
};

const DEFAULT_PRIVACY_TEXT_TR = `Bu aydınlatma metni, kliniğimiz tarafından hizmetlerimizden yararlanan hastalarımıza ve iletişime geçen kişilere sunulmaktadır.

**Veri Sorumlusu**
Klinik adı ve iletişim bilgileri yukarıda yer almaktadır.

**İşlenen Kişisel Veriler**
Kimlik bilgileri, iletişim bilgileri, sağlık verileri (anamnez, tanı, tedavi bilgileri), randevu ve tedavi geçmişi, muhasebe ve ödeme bilgileri.

**İşleme Amaçları ve Hukuki Sebepler**
- Sağlık hizmetinin sunulması ve takibi (KVKK m. 6/3 — açık rıza veya kanunlarda öngörülen hallerde)
- Randevu yönetimi ve hatırlatma
- Yasal yükümlülüklerin yerine getirilmesi
- Sigorta ve fatura işlemleri

**Veri Aktarımı**
Kişisel verileriniz; hukuki yükümlülükler çerçevesinde yetkili kamu kurumları ile ve açık rızanız dahilinde tıbbi laboratuvar, tedarikçi ve teknik hizmet sağlayıcılarla paylaşılabilir. Klinik yönetim yazılımı olarak NoraMedi platformu, veri işleme hizmeti sunmaktadır.

**Saklama Süresi**
Sağlık kayıtları ilgili mevzuat uyarınca saklanmaktadır. Diğer veriler, işleme amacının sona ermesinin ardından uygulanabilir yasal süre kadar tutulur.

**İlgili Kişi Hakları**
KVKK m. 11 kapsamında; verilerinize erişme, düzeltme, silme veya anonim hale getirilmesini talep etme, işlemeye itiraz etme ve kısıtlama haklarına sahipsiniz.

**Başvuru Yöntemi**
Haklarınızı kullanmak için yukarıda belirtilen e-posta adresine yazılı olarak başvurabilirsiniz.`;

const ClinicKvkkSection: React.FC<ClinicKvkkSectionProps> = ({ clinicId, clinicSlug, clinicName, canEdit }) => {
  const { t } = useTranslation('settings');
  const [profile, setProfile] = useState<LegalProfile>({ ...EMPTY });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    try {
      const res = await clinicLegalProfileService.get(clinicId);
      setProfile(res.data.profile ?? { ...EMPTY });
    } catch {
      setProfile({ ...EMPTY });
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => { load(); }, [load]);

  const handleChange = (field: keyof LegalProfile, value: string) => {
    setProfile(prev => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
    }
  };

  const handleSaveDraft = async () => {
    if (!clinicId || !canEdit) return;
    setSaving(true);
    setMessage(null);
    setFieldErrors({});
    try {
      const res = await clinicLegalProfileService.save(clinicId, profile as Record<string, unknown>);
      setProfile(res.data.profile ?? profile);
      setMessage({ type: 'success', text: t('kvkk.savedDraft') });
    } catch {
      setMessage({ type: 'error', text: t('kvkk.saveError') });
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!clinicId || !canEdit) return;
    setPublishing(true);
    setMessage(null);
    setFieldErrors({});
    try {
      // Send form data with publish so updates are saved atomically before validation.
      const res = await clinicLegalProfileService.publish(clinicId, profile as Record<string, unknown>);
      setProfile(res.data.profile ?? profile);
      setMessage({ type: 'success', text: t('kvkk.publishedSuccess') });
    } catch (err: any) {
      const fe = err?.response?.data?.fieldErrors;
      if (fe) {
        setFieldErrors(fe);
        setMessage({ type: 'error', text: t('kvkk.publishValidationError') });
      } else {
        setMessage({ type: 'error', text: t('kvkk.publishError') });
      }
    } finally {
      setPublishing(false);
    }
  };

  const handleLoadDefault = () => {
    setProfile(prev => ({ ...prev, privacyNoticeText: DEFAULT_PRIVACY_TEXT_TR }));
  };

  const publicUrl = clinicSlug ? `/c/${clinicSlug}/kvkk` : null;

  if (loading) {
    return (
      <div className="card p-6">
        <p className="text-sm text-gray-500">{t('kvkk.loading')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4 mb-4 border-b border-gray-100 pb-4">
          <div className="flex items-center gap-2">
            <FileText size={20} className="text-gray-400" />
            <div>
              <h2 className="text-lg font-bold">{t('kvkk.title')}</h2>
              {clinicName && <p className="text-xs text-gray-500 mt-0.5">{clinicName}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {profile.isPublished ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                <CheckCircle size={12} />
                {t('kvkk.statusPublished')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-700">
                {t('kvkk.statusDraft')}
              </span>
            )}
          </div>
        </div>

        {/* Channel warning */}
        <div className="mb-4 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">{t('kvkk.channelWarning')}</p>
        </div>

        {/* Action buttons */}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {!profile.isPublished && (
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={saving || publishing}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {saving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" /> : <Save size={15} />}
                {t('kvkk.saveDraft')}
              </button>
            )}
            <button
              type="button"
              onClick={handlePublish}
              disabled={saving || publishing}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {publishing ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Globe size={15} />}
              {profile.isPublished ? t('kvkk.updatePublished') : t('kvkk.publish')}
            </button>
            {publicUrl && profile.isPublished && (
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <ExternalLink size={15} />
                {t('kvkk.viewPublic')}
              </a>
            )}
          </div>
        )}
        {profile.isPublished && canEdit && (
          <p className="mt-3 text-xs text-gray-500">{t('kvkk.publishedEditNote')}</p>
        )}

        {/* Status message */}
        {message && (
          <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}>
            {message.text}
          </div>
        )}
      </div>

      {/* Identity fields */}
      <div className="card p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900 border-b border-gray-100 pb-3">{t('kvkk.sectionIdentity')}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('kvkk.fields.dataControllerTitle')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className={`input-field w-full ${fieldErrors.dataControllerTitle ? 'border-red-400' : ''}`}
              value={profile.dataControllerTitle ?? ''}
              onChange={e => handleChange('dataControllerTitle', e.target.value)}
              disabled={!canEdit}
            />
            {fieldErrors.dataControllerTitle && <p className="mt-1 text-xs text-red-600">{t('kvkk.fieldRequired')}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('kvkk.fields.phone')}</label>
            <input type="text" className="input-field w-full" value={profile.phone ?? ''} onChange={e => handleChange('phone', e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('kvkk.fields.email')}</label>
            <input type="email" className="input-field w-full" value={profile.email ?? ''} onChange={e => handleChange('email', e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('kvkk.fields.privacyRequestEmail')} <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              className={`input-field w-full ${fieldErrors.privacyRequestEmail ? 'border-red-400' : ''}`}
              value={profile.privacyRequestEmail ?? ''}
              onChange={e => handleChange('privacyRequestEmail', e.target.value)}
              disabled={!canEdit}
            />
            {fieldErrors.privacyRequestEmail && <p className="mt-1 text-xs text-red-600">{t('kvkk.fieldRequired')}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('kvkk.fields.kepEmail')}</label>
            <input type="text" className="input-field w-full" value={profile.kepEmail ?? ''} onChange={e => handleChange('kepEmail', e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('kvkk.fields.website')}</label>
            <input type="text" className="input-field w-full" value={profile.website ?? ''} onChange={e => handleChange('website', e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('kvkk.fields.taxNumber')}</label>
            <input type="text" className="input-field w-full" value={profile.taxNumber ?? ''} onChange={e => handleChange('taxNumber', e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('kvkk.fields.mersisNumber')}</label>
            <input type="text" className="input-field w-full" value={profile.mersisNumber ?? ''} onChange={e => handleChange('mersisNumber', e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('kvkk.fields.dataProtectionContact')}</label>
            <input type="text" className="input-field w-full" value={profile.dataProtectionContact ?? ''} onChange={e => handleChange('dataProtectionContact', e.target.value)} disabled={!canEdit} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('kvkk.fields.address')} <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={3}
            className={`input-field w-full ${fieldErrors.address ? 'border-red-400' : ''}`}
            value={profile.address ?? ''}
            onChange={e => handleChange('address', e.target.value)}
            disabled={!canEdit}
          />
          {fieldErrors.address && <p className="mt-1 text-xs text-red-600">{t('kvkk.fieldRequired')}</p>}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('kvkk.fields.city')}</label>
            <input type="text" className="input-field w-full" value={profile.city ?? ''} onChange={e => handleChange('city', e.target.value)} disabled={!canEdit} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('kvkk.fields.country')}</label>
            <input type="text" className="input-field w-full" value={profile.country ?? 'TR'} onChange={e => handleChange('country', e.target.value)} disabled={!canEdit} />
          </div>
        </div>
      </div>

      {/* Notice fields */}
      <div className="card p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900 border-b border-gray-100 pb-3">{t('kvkk.sectionNotice')}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('kvkk.fields.privacyNoticeVersion')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className={`input-field w-full ${fieldErrors.privacyNoticeVersion ? 'border-red-400' : ''}`}
              placeholder="1.0"
              value={profile.privacyNoticeVersion ?? ''}
              onChange={e => handleChange('privacyNoticeVersion', e.target.value)}
              disabled={!canEdit}
            />
            {fieldErrors.privacyNoticeVersion && <p className="mt-1 text-xs text-red-600">{t('kvkk.fieldRequired')}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('kvkk.fields.effectiveDate')} <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              className={`input-field w-full ${fieldErrors.effectiveDate ? 'border-red-400' : ''}`}
              value={profile.effectiveDate ? profile.effectiveDate.split('T')[0] : ''}
              onChange={e => handleChange('effectiveDate', e.target.value)}
              disabled={!canEdit}
            />
            {fieldErrors.effectiveDate && <p className="mt-1 text-xs text-red-600">{t('kvkk.fieldRequired')}</p>}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700">
              {t('kvkk.fields.privacyNoticeText')} <span className="text-red-500">*</span>
            </label>
            {canEdit && !profile.privacyNoticeText && (
              <button type="button" onClick={handleLoadDefault} className="text-xs text-primary-600 hover:underline">
                {t('kvkk.loadDefaultTr')}
              </button>
            )}
          </div>
          <textarea
            rows={14}
            className={`input-field w-full font-mono text-xs ${fieldErrors.privacyNoticeText ? 'border-red-400' : ''}`}
            value={profile.privacyNoticeText ?? ''}
            onChange={e => handleChange('privacyNoticeText', e.target.value)}
            disabled={!canEdit}
          />
          {fieldErrors.privacyNoticeText && <p className="mt-1 text-xs text-red-600">{t('kvkk.fieldRequired')}</p>}
          <p className="mt-1 text-xs text-gray-500">{t('kvkk.privacyNoticeTextHelp')}</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('kvkk.fields.channelDisclosureText')}</label>
          <textarea rows={6} className="input-field w-full font-mono text-xs" value={profile.channelDisclosureText ?? ''} onChange={e => handleChange('channelDisclosureText', e.target.value)} disabled={!canEdit} />
          <p className="mt-1 text-xs text-gray-500">{t('kvkk.channelDisclosureHelp')}</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('kvkk.fields.channelConsentText')}</label>
          <textarea rows={4} className="input-field w-full font-mono text-xs" value={profile.channelConsentText ?? ''} onChange={e => handleChange('channelConsentText', e.target.value)} disabled={!canEdit} />
          <p className="mt-1 text-xs text-gray-500">{t('kvkk.channelConsentHelp')}</p>
        </div>
      </div>
    </div>
  );
};

export default ClinicKvkkSection;
