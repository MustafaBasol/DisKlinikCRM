import React, { useEffect, useState } from 'react';
import {
  MessageSquare,
  Plus,
  Edit2,
  Loader2,
  Globe,
  Smartphone,
  Mail,
  CheckCircle2,
  XCircle,
  Database,
  Send,
  RefreshCw,
  AlertTriangle,
  Info,
  Clock,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { messageTemplateService } from '../services/api';
import MessageTemplateForm from '../components/MessageTemplateForm';

type MetaStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paused' | 'disabled' | 'unknown' | null | undefined;

const MetaApprovalBadge: React.FC<{ status: MetaStatus; submitted: boolean }> = ({ status, submitted }) => {
  if (!submitted || !status || status === 'draft') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-50 text-gray-500 border border-gray-100 uppercase">
        <Clock size={9} />
        Gönderilmedi
      </span>
    );
  }
  switch (status) {
    case 'approved':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-100 uppercase">
          <CheckCircle2 size={9} />
          Kullanıma Hazır
        </span>
      );
    case 'submitted':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-600 border border-blue-100 uppercase">
          <Clock size={9} />
          Onay Bekleniyor
        </span>
      );
    case 'rejected':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600 border border-red-100 uppercase">
          <XCircle size={9} />
          Reddedildi
        </span>
      );
    case 'paused':
    case 'disabled':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-100 uppercase">
          <AlertTriangle size={9} />
          Dikkat Gerekiyor
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-50 text-gray-500 border border-gray-100 uppercase">
          <Clock size={9} />
          Bilinmiyor
        </span>
      );
  }
};

const MessageTemplates: React.FC = () => {
  const { t } = useTranslation(['messageTemplates', 'common']);

  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [seeding, setSeeding] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rejectionModal, setRejectionModal] = useState<{ name: string; reason: string } | null>(null);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const response = await messageTemplateService.getAll();
      setTemplates(response.data);
    } catch (error) {
      console.error('Failed to fetch templates:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleSeed = async () => {
    if (!window.confirm(t('messageTemplates:seed.confirm', { defaultValue: 'Seed default templates?' }))) return;
    setSeeding(true);
    try {
      await messageTemplateService.seed();
      fetchTemplates();
    } catch (error) {
      console.error(error);
    } finally {
      setSeeding(false);
    }
  };

  const handleMetaSubmit = async (template: any) => {
    setActionLoading(`submit-${template.id}`);
    try {
      await messageTemplateService.metaSubmit(template.id, {
        metaTemplateLanguage: template.language === 'tr' ? 'tr' : template.language === 'fr' ? 'fr' : 'en',
        metaTemplateCategory: 'utility',
      });
      fetchTemplates();
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'WhatsApp onayına gönderilemedi.';
      alert(msg);
    } finally {
      setActionLoading(null);
    }
  };

  const handleMetaSync = async (template: any) => {
    setActionLoading(`sync-${template.id}`);
    try {
      await messageTemplateService.metaSync(template.id);
      fetchTemplates();
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'Onay durumu alınamadı.';
      alert(msg);
    } finally {
      setActionLoading(null);
    }
  };

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'sms': return <Smartphone size={16} />;
      case 'whatsapp': return <MessageSquare size={16} />;
      case 'email': return <Mail size={16} />;
      default: return <MessageSquare size={16} />;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('messageTemplates:title')}</h1>
          <p className="text-gray-500 mt-1">{t('messageTemplates:subtitle')}</p>
        </div>
        <div className="flex gap-3">
          {templates.length === 0 && (
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="btn-secondary"
            >
              {seeding ? <Loader2 size={20} className="animate-spin" /> : <Database size={20} />}
              {t('messageTemplates:seed.button')}
            </button>
          )}
          <button
            onClick={() => {
              setEditingTemplate(null);
              setIsFormOpen(true);
            }}
            className="btn-primary"
          >
            <Plus size={20} />
            {t('messageTemplates:addTemplate')}
          </button>
        </div>
      </div>

      {/* WhatsApp approval info card */}
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 flex gap-3">
        <Info size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800 space-y-1">
          <p className="font-semibold">{t('messageTemplates:whatsappApproval.infoTitle')}</p>
          <p>{t('messageTemplates:whatsappApproval.infoBody')}</p>
          <p className="text-blue-600">{t('messageTemplates:whatsappApproval.infoHint')}</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('messageTemplates:fields.name')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('messageTemplates:fields.channel')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('messageTemplates:purpose.label')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('messageTemplates:fields.language')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('messageTemplates:fields.isActive')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('messageTemplates:whatsappApproval.columnHeader')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">{t('common:actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center">
                    <Loader2 className="animate-spin text-primary-600 mx-auto" size={32} />
                  </td>
                </tr>
              ) : templates.length > 0 ? (
                templates.map((template) => {
                  const isWhatsApp = template.channel === 'whatsapp';
                  const metaStatus: MetaStatus = template.metaTemplateStatus;
                  const submitted = !!template.metaTemplateName;
                  const isSubmitting = actionLoading === `submit-${template.id}`;
                  const isSyncing = actionLoading === `sync-${template.id}`;

                  return (
                    <tr key={template.id} className="hover:bg-gray-50/50 transition-colors group">
                      <td className="p-4">
                        <p className="text-sm font-bold text-gray-900">{template.name}</p>
                        <p className="text-xs text-gray-500 truncate max-w-xs">{template.body}</p>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2 text-xs font-medium text-gray-600">
                          <span className="p-1.5 rounded-lg bg-gray-100 text-gray-500">
                            {getChannelIcon(template.channel)}
                          </span>
                          {t(`messageTemplates:channels.${template.channel}`)}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                          {t(`messageTemplates:purpose.${template.purpose ?? 'general_message'}`, { defaultValue: template.purpose ?? 'general_message' })}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className="flex items-center gap-2 text-xs text-gray-600">
                          <Globe size={14} className="text-gray-400" />
                          {template.language.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-4">
                        {template.isActive ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-100 uppercase">
                            <CheckCircle2 size={10} />
                            {t('common:active')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-50 text-gray-500 border border-gray-100 uppercase">
                            <XCircle size={10} />
                            {t('common:inactive')}
                          </span>
                        )}
                      </td>
                      <td className="p-4">
                        {isWhatsApp ? (
                          <MetaApprovalBadge status={metaStatus} submitted={submitted} />
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* WhatsApp approval actions */}
                          {isWhatsApp && metaStatus !== 'approved' && (
                            <button
                              onClick={() => handleMetaSubmit(template)}
                              disabled={isSubmitting || isSyncing}
                              title={t('messageTemplates:whatsappApproval.submitAction')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-green-50 text-green-700 border border-green-100 hover:bg-green-100 transition-colors disabled:opacity-50"
                            >
                              {isSubmitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                              {t('messageTemplates:whatsappApproval.submitAction')}
                            </button>
                          )}
                          {isWhatsApp && submitted && (
                            <button
                              onClick={() => handleMetaSync(template)}
                              disabled={isSubmitting || isSyncing}
                              title={t('messageTemplates:whatsappApproval.syncAction')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 transition-colors disabled:opacity-50"
                            >
                              {isSyncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                              {t('messageTemplates:whatsappApproval.syncAction')}
                            </button>
                          )}
                          {isWhatsApp && metaStatus === 'rejected' && template.metaTemplateRejectionReason && (
                            <button
                              onClick={() => setRejectionModal({ name: template.name, reason: template.metaTemplateRejectionReason })}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 transition-colors"
                            >
                              <AlertTriangle size={12} />
                              {t('messageTemplates:whatsappApproval.rejectionAction')}
                            </button>
                          )}
                          {/* Edit */}
                          <button
                            onClick={() => {
                              setEditingTemplate(template);
                              setIsFormOpen(true);
                            }}
                            className="p-2 text-gray-400 hover:bg-white hover:text-blue-600 rounded-lg transition-all shadow-sm opacity-0 group-hover:opacity-100"
                          >
                            <Edit2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-gray-400">
                    <MessageSquare size={48} className="mx-auto mb-3 opacity-20" />
                    <p>{t('common:noData')}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isFormOpen && (
        <MessageTemplateForm
          template={editingTemplate}
          onClose={() => setIsFormOpen(false)}
          onSuccess={() => {
            setIsFormOpen(false);
            fetchTemplates();
          }}
        />
      )}

      {/* Rejection reason modal */}
      {rejectionModal && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-full bg-red-100">
                <XCircle size={20} className="text-red-600" />
              </span>
              <div>
                <p className="text-sm font-bold text-gray-900">{rejectionModal.name}</p>
                <p className="text-xs text-red-600 font-semibold">{t('messageTemplates:whatsappApproval.rejectedTitle')}</p>
              </div>
            </div>
            <p className="text-sm text-gray-700">{t('messageTemplates:whatsappApproval.rejectedMessage')}</p>
            {rejectionModal.reason && (
              <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-xs text-red-800 font-mono break-words">
                {rejectionModal.reason}
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={() => setRejectionModal(null)} className="btn-secondary text-sm">
                {t('common:close', { defaultValue: 'Kapat' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MessageTemplates;
