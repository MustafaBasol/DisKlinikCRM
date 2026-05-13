import React, { useEffect, useState } from 'react';
import { 
  MessageSquare, 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  Loader2,
  Globe,
  Smartphone,
  Mail,
  CheckCircle2,
  XCircle,
  Database
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { messageTemplateService } from '../services/api';
import MessageTemplateForm from '../components/MessageTemplateForm';

const MessageTemplates: React.FC = () => {
  const { t } = useTranslation(['messageTemplates', 'common']);
  
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [seeding, setSeeding] = useState(false);

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

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('messageTemplates:fields.name')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('messageTemplates:fields.channel')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('messageTemplates:fields.language')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('messageTemplates:fields.isActive')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">{t('common:actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center">
                    <Loader2 className="animate-spin text-primary-600 mx-auto" size={32} />
                  </td>
                </tr>
              ) : templates.length > 0 ? (
                templates.map((template) => (
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
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => {
                            setEditingTemplate(template);
                            setIsFormOpen(true);
                          }}
                          className="p-2 text-gray-400 hover:bg-white hover:text-blue-600 rounded-lg transition-all shadow-sm"
                        >
                          <Edit2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-gray-400">
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
    </div>
  );
};

export default MessageTemplates;
