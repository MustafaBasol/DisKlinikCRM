import React, { useEffect, useState } from 'react';
import { X, Loader2, MessageSquare, Smartphone, Mail, CheckCircle2, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { messageTemplateService, messageService } from '../services/api';

interface PrepareMessageModalProps {
  patientId: string;
  clinicId?: string;
  appointmentId?: string;
  treatmentCaseId?: string;
  paymentId?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const PrepareMessageModal: React.FC<PrepareMessageModalProps> = ({ 
  patientId, clinicId, appointmentId, treatmentCaseId, paymentId, onClose, onSuccess 
}) => {
  const { t, i18n } = useTranslation(['messages', 'messageTemplates', 'common']);
  
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [customBody, setCustomBody] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const res = await messageTemplateService.getAll({ 
          clinicId,
          isActive: true 
        });
        const currentLanguage = i18n.language.split('-')[0];
        setTemplates([...res.data].sort((a, b) => {
          if (a.language === currentLanguage && b.language !== currentLanguage) return -1;
          if (a.language !== currentLanguage && b.language === currentLanguage) return 1;
          return String(a.name).localeCompare(String(b.name));
        }));
      } catch (err) {
        console.error(err);
        setErrorMessage(t('messages:prepareModal.loadFailed'));
      } finally {
        setLoading(false);
      }
    };
    fetchTemplates();
  }, [clinicId, i18n.language, t]);

  const handlePreview = async (templateId: string) => {
    setSelectedTemplateId(templateId);
    setErrorMessage(null);
    if (!templateId) {
      setPreview(null);
      return;
    }
    
    setPreparing(true);
    try {
      const res = await messageService.prepare({
        templateId,
        patientId,
        clinicId,
        appointmentId,
        treatmentCaseId,
        paymentId
      });
      setPreview(res.data);
      setCustomBody(res.data.body);
    } catch (err) {
      console.error(err);
      const detail = (err as any)?.response?.data?.error ?? (err as any)?.response?.data?.message;
      setErrorMessage(detail ? `${t('messages:prepareModal.prepareFailed')} ${detail}` : t('messages:prepareModal.prepareFailed'));
    } finally {
      setPreparing(false);
    }
  };

  const handleSave = async () => {
    if (!preview) return;
    setPreparing(true);
    try {
      // In this case, we've already "prepared" it in the backend via handlePreview (which saves it as 'prepared')
      // If the user modified the text, we might want to update it.
      // But for MVP, if they click save, we just close and notify success.
      // Actually, my backend prepare endpoint ALREADY creates the record.
      // So handlePreview already saved a "prepared" message.
      onSuccess?.();
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden animate-in zoom-in duration-200">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <MessageSquare size={20} className="text-primary-600" />
            {t('messages:prepareModal.title')}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white rounded-xl transition-colors">
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase mb-1">{t('messages:prepareModal.selectTemplate')}</label>
            <select 
              className="input-field"
              value={selectedTemplateId}
              onChange={(e) => handlePreview(e.target.value)}
              disabled={loading}
            >
              <option value="">{t('common:select')}</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.channel.toUpperCase()} · {String(t.language).toUpperCase()})</option>
              ))}
            </select>
          </div>

          {!loading && templates.length === 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{t('messages:prepareModal.noTemplates')}</span>
            </div>
          )}

          {errorMessage && (
            <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {preparing ? (
            <div className="py-12 text-center">
              <Loader2 className="animate-spin text-primary-600 mx-auto" size={32} />
            </div>
          ) : preview ? (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{t('messages:prepareModal.preview')}</span>
                  <div className="flex items-center gap-2">
                    {preview.channel === 'sms' && <Smartphone size={14} className="text-gray-400" />}
                    {preview.channel === 'whatsapp' && <MessageSquare size={14} className="text-green-500" />}
                    {preview.channel === 'email' && <Mail size={14} className="text-blue-500" />}
                    <span className="text-xs font-medium text-gray-600 capitalize">{preview.channel}</span>
                  </div>
                </div>
                {preview.subject && (
                  <p className="text-sm font-bold text-gray-900 mb-2 border-b border-gray-200 pb-2">{preview.subject}</p>
                )}
                <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {preview.body}
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs text-gray-500 italic">
                <p>Recipient: <span className="font-medium text-gray-700">{preview.recipient}</span></p>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-gray-400 italic">
              {t('messages:prepareModal.selectTemplatePrompt', { defaultValue: 'Please select a template to see preview' })}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button type="button" onClick={onClose} className="btn-secondary">
              {t('common:cancel')}
            </button>
            <button 
              type="button" 
              onClick={handleSave} 
              disabled={!preview || preparing} 
              className="btn-primary"
            >
              {preparing ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle2 size={20} />}
              {t('messages:prepareModal.send')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrepareMessageModal;
