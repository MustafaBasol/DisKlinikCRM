import React, { useState } from 'react';
import { X, Save, Loader2, Info, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { messageTemplateService } from '../services/api';

interface MessageTemplateFormProps {
  template?: any;
  onClose: () => void;
  onSuccess: () => void;
}

const PURPOSES = [
  'appointment_reminder',
  'payment_reminder',
  'appointment_confirmation',
  'appointment_cancellation',
  'appointment_reschedule',
  'no_show_recovery',
  'post_treatment_followup',
  'marketing',
  'general_message',
] as const;

const getApiErrorDetail = (error: any): string | null => {
  const data = error?.response?.data;
  if (!data) return error?.message ?? null;
  if (typeof data.error === 'string') return data.error;
  if (typeof data.message === 'string') return data.message;
  if (data.error) return JSON.stringify(data.error);
  return error?.message ?? null;
};

const MessageTemplateForm: React.FC<MessageTemplateFormProps> = ({ template, onClose, onSuccess }) => {
  const { t } = useTranslation(['messageTemplates', 'common']);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: template?.name || '',
    channel: template?.channel || 'sms',
    language: template?.language || 'en',
    subject: template?.subject || '',
    body: template?.body || '',
    isActive: template?.isActive ?? true,
    purpose: template?.purpose || 'general_message',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage(null);
    try {
      if (template) {
        await messageTemplateService.update(template.id, formData);
      } else {
        await messageTemplateService.create(formData);
      }
      onSuccess();
    } catch (error) {
      console.error(error);
      const status = (error as any)?.response?.status;
      const detail = getApiErrorDetail(error);
      const fallbackKey = status === 404 ? 'messageTemplates:notifications.notFound' : 'messageTemplates:notifications.saveFailed';
      const fallback = t(fallbackKey);
      setErrorMessage(detail ? `${fallback} ${t('messageTemplates:notifications.reason', { reason: detail })}` : fallback);
    } finally {
      setLoading(false);
    }
  };

  const variables = [
    'patient_name', 'clinic_name', 'appointment_date', 'appointment_time',
    'practitioner_name', 'treatment_title', 'remaining_balance'
  ];

  const insertVariable = (variable: string) => {
    setFormData(prev => ({
      ...prev,
      body: prev.body + ` {{${variable}}}`
    }));
  };

  return (
    <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden animate-in zoom-in duration-200">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <h2 className="text-lg font-bold text-gray-900">
            {template ? t('messageTemplates:editTemplate') : t('messageTemplates:addTemplate')}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white rounded-xl transition-colors">
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">{t('messageTemplates:fields.name')}</label>
              <input
                type="text"
                required
                className="input-field"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">{t('messageTemplates:fields.channel')}</label>
              <select
                className="input-field"
                value={formData.channel}
                onChange={(e) => setFormData({...formData, channel: e.target.value})}
              >
                <option value="sms">SMS</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
              </select>
              {formData.channel === 'whatsapp' && (
                <p className="mt-1.5 text-[11px] text-blue-600">
                  {t('messageTemplates:whatsappApproval.channelHint')}
                </p>
              )}
            </div>
          </div>

          {/* Purpose select */}
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase mb-1">{t('messageTemplates:purpose.label')}</label>
            <select
              className="input-field"
              value={formData.purpose}
              onChange={(e) => setFormData({...formData, purpose: e.target.value})}
            >
              {PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {t(`messageTemplates:purpose.${p}`)}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-gray-500">
              {t('messageTemplates:purpose.helperText')}
            </p>
            {formData.channel === 'whatsapp' && (
              <p className="mt-1 text-[11px] text-blue-600">
                {t('messageTemplates:purpose.whatsappNote')}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">{t('messageTemplates:fields.language')}</label>
              <select
                className="input-field"
                value={formData.language}
                onChange={(e) => setFormData({...formData, language: e.target.value})}
              >
                <option value="en">English</option>
                <option value="tr">Türkçe</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
              </select>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input
                type="checkbox"
                id="isActive"
                className="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500"
                checked={formData.isActive}
                onChange={(e) => setFormData({...formData, isActive: e.target.checked})}
              />
              <label htmlFor="isActive" className="text-sm font-medium text-gray-700">{t('messageTemplates:fields.isActive')}</label>
            </div>
          </div>

          {formData.channel === 'email' && (
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">{t('messageTemplates:fields.subject')}</label>
              <input
                type="text"
                className="input-field"
                value={formData.subject}
                onChange={(e) => setFormData({...formData, subject: e.target.value})}
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-gray-700 uppercase">{t('messageTemplates:fields.body')}</label>
              <div className="flex items-center gap-1 text-[10px] text-gray-500">
                <Info size={12} />
                {t('messageTemplates:variables.title')}
              </div>
            </div>
            <textarea
              required
              rows={5}
              className="input-field"
              value={formData.body}
              onChange={(e) => setFormData({...formData, body: e.target.value})}
            />
            <div className="mt-2 flex flex-wrap gap-1">
              {variables.map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVariable(v)}
                  className="px-2 py-1 rounded bg-gray-100 text-[10px] font-medium text-gray-600 hover:bg-gray-200 transition-colors"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>

          {errorMessage && (
            <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button type="button" onClick={onClose} disabled={loading} className="btn-secondary">
              {t('common:cancel')}
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
              {t('common:save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MessageTemplateForm;
