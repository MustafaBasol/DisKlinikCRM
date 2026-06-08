import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BellRing,
  CalendarClock,
  CheckSquare,
  Clock,
  CreditCard,
  MessageSquare,
  Save,
  Stethoscope,
  UserX,
} from 'lucide-react';
import { messageTemplateService, recallService } from '../../services/api';

type RecallActionMode = 'LIST_ONLY' | 'CREATE_TASK' | 'CREATE_MESSAGE_DRAFT' | 'AUTO_SEND_WHATSAPP';
type RecallSendTiming = 'SAME_DAY' | 'NEXT_DAY' | 'MANUAL';

type RecallSettings = {
  isEnabled: boolean;
  defaultActionMode: RecallActionMode;
  checkupEnabled: boolean;
  checkupAfterDays: number;
  checkupSendTiming: RecallSendTiming;
  checkupSendTime: string;
  checkupActionMode: RecallActionMode;
  checkupMessageTemplateId?: string | null;
  treatmentPlanFollowupEnabled: boolean;
  treatmentPlanFollowupAfterDays: number;
  treatmentPlanFollowupRepeatDays: number;
  treatmentPlanFollowupMaxAttempts: number;
  treatmentPlanFollowupActionMode: RecallActionMode;
  treatmentPlanFollowupMessageTemplateId?: string | null;
  incompleteTreatmentEnabled: boolean;
  incompleteTreatmentAfterDays: number;
  incompleteTreatmentActionMode: RecallActionMode;
  incompleteTreatmentMessageTemplateId?: string | null;
  incompleteTreatmentAutoCreateTask: boolean;
  noShowFollowupEnabled: boolean;
  noShowFollowupAfterHours: number;
  noShowFollowupActionMode: RecallActionMode;
  noShowFollowupMessageTemplateId?: string | null;
  noShowFollowupAutoCreateTask: boolean;
  paymentFollowupEnabled: boolean;
  paymentFollowupAfterDays: number;
  paymentFollowupActionMode: RecallActionMode;
  paymentFollowupMessageTemplateId?: string | null;
  respectCommunicationConsent: boolean;
};

type MessageTemplate = {
  id: string;
  name: string;
  language: string;
};

const DEFAULT_RECALL_SETTINGS: RecallSettings = {
  isEnabled: false,
  defaultActionMode: 'LIST_ONLY',
  checkupEnabled: true,
  checkupAfterDays: 180,
  checkupSendTiming: 'MANUAL',
  checkupSendTime: '10:00',
  checkupActionMode: 'LIST_ONLY',
  checkupMessageTemplateId: null,
  treatmentPlanFollowupEnabled: true,
  treatmentPlanFollowupAfterDays: 7,
  treatmentPlanFollowupRepeatDays: 14,
  treatmentPlanFollowupMaxAttempts: 3,
  treatmentPlanFollowupActionMode: 'CREATE_TASK',
  treatmentPlanFollowupMessageTemplateId: null,
  incompleteTreatmentEnabled: true,
  incompleteTreatmentAfterDays: 14,
  incompleteTreatmentActionMode: 'CREATE_TASK',
  incompleteTreatmentMessageTemplateId: null,
  incompleteTreatmentAutoCreateTask: true,
  noShowFollowupEnabled: true,
  noShowFollowupAfterHours: 24,
  noShowFollowupActionMode: 'CREATE_TASK',
  noShowFollowupMessageTemplateId: null,
  noShowFollowupAutoCreateTask: true,
  paymentFollowupEnabled: true,
  paymentFollowupAfterDays: 3,
  paymentFollowupActionMode: 'CREATE_TASK',
  paymentFollowupMessageTemplateId: null,
  respectCommunicationConsent: true,
};

const actionModes: RecallActionMode[] = [
  'LIST_ONLY',
  'CREATE_TASK',
  'CREATE_MESSAGE_DRAFT',
  'AUTO_SEND_WHATSAPP',
];

const sendTimings: RecallSendTiming[] = ['SAME_DAY', 'NEXT_DAY', 'MANUAL'];

interface ToggleSwitchProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ checked, disabled, label, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
      checked ? 'bg-primary-600' : 'bg-gray-300'
    } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
  >
    <span
      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-5' : 'translate-x-1'
      }`}
    />
  </button>
);

interface RuleCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  enabled: boolean;
  disabled: boolean;
  actionMode: RecallActionMode;
  templateId?: string | null;
  templates: MessageTemplate[];
  onEnabledChange: (enabled: boolean) => void;
  onActionModeChange: (mode: RecallActionMode) => void;
  onTemplateChange: (templateId: string | null) => void;
  children: React.ReactNode;
}

const RuleCard: React.FC<RuleCardProps> = ({
  title,
  description,
  icon,
  enabled,
  disabled,
  actionMode,
  templateId,
  templates,
  onEnabledChange,
  onActionModeChange,
  onTemplateChange,
  children,
}) => {
  const { t } = useTranslation('recall');

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
            {icon}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <p className="mt-1 text-sm text-gray-500">{description}</p>
          </div>
        </div>
        <ToggleSwitch checked={enabled} disabled={disabled} label={title} onChange={onEnabledChange} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 md:grid-cols-2 xl:grid-cols-4">
        {children}

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">
            {t('settings.fields.actionMode')}
          </span>
          <select
            value={actionMode}
            disabled={disabled || !enabled}
            onChange={(event) => onActionModeChange(event.target.value as RecallActionMode)}
            className="input-field w-full"
          >
            {actionModes.map((mode) => (
              <option key={mode} value={mode}>
                {t(`settings.actionModes.${mode}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">
            {t('settings.fields.messageTemplate')}
          </span>
          <select
            value={templateId ?? ''}
            disabled={disabled || !enabled}
            onChange={(event) => onTemplateChange(event.target.value || null)}
            className="input-field w-full"
          >
            <option value="">{t('settings.noTemplate')}</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} ({template.language})
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
};

interface RecallSettingsSectionProps {
  clinicId?: string;
  clinicName?: string;
  canEdit: boolean;
}

const RecallSettingsSection: React.FC<RecallSettingsSectionProps> = ({ clinicId, clinicName, canEdit }) => {
  const { t } = useTranslation('recall');
  const [settings, setSettings] = useState<RecallSettings>(DEFAULT_RECALL_SETTINGS);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!clinicId) return;
    let alive = true;
    setLoading(true);
    setMessage(null);

    Promise.all([
      recallService.getSettings(clinicId),
      messageTemplateService.getAll({ clinicId, channel: 'whatsapp', isActive: true }),
    ])
      .then(([settingsRes, templatesRes]) => {
        if (!alive) return;
        setSettings({ ...DEFAULT_RECALL_SETTINGS, ...(settingsRes.data.settings || {}) });
        setTemplates(templatesRes.data || []);
      })
      .catch(() => {
        if (!alive) return;
        setSettings(DEFAULT_RECALL_SETTINGS);
        setTemplates([]);
        setMessage({ type: 'error', text: t('settings.loadError') });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [clinicId, t]);

  const updateSetting = <K extends keyof RecallSettings>(key: K, value: RecallSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!clinicId || !canEdit) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await recallService.updateSettings(settings, clinicId);
      setSettings({ ...DEFAULT_RECALL_SETTINGS, ...(res.data.settings || settings) });
      setMessage({ type: 'success', text: t('settings.saveSuccess') });
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.response?.data?.error || t('settings.saveError') });
    } finally {
      setSaving(false);
    }
  };

  const globalDisabled = !canEdit || !clinicId;
  const paymentNote = useMemo(() => t('settings.paymentGentleLanguage'), [t]);

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-4 border-b border-gray-100 pb-4">
        <BellRing size={20} className="text-gray-400" />
        <div>
          <h2 className="text-lg font-bold">{t('settings.title')}</h2>
          <p className="mt-1 text-sm text-gray-500">{t('settings.subtitle')}</p>
        </div>
      </div>

      <div className="mb-5 flex flex-col gap-3 border-b border-gray-100 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          {clinicName && (
            <p className="text-xs font-medium text-gray-500">
              {t('settings.clinicScope', { clinic: clinicName })}
            </p>
          )}
          <p className="mt-1 text-xs text-gray-500">{t('settings.safeDefault')}</p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={globalDisabled || saving || loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {saving ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <Save size={16} />
          )}
          {t('settings.save')}
        </button>
      </div>

      {!canEdit && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t('settings.readOnly')}
        </div>
      )}

      {message && (
        <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
          message.type === 'success'
            ? 'border-green-200 bg-green-50 text-green-700'
            : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
          {t('settings.loading')}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="flex items-center justify-between gap-3 rounded-lg bg-white p-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{t('settings.fields.enabled')}</p>
                  <p className="text-xs text-gray-500">{t('settings.fields.enabledHelp')}</p>
                </div>
                <ToggleSwitch
                  checked={settings.isEnabled}
                  disabled={globalDisabled}
                  label={t('settings.fields.enabled')}
                  onChange={(enabled) => updateSetting('isEnabled', enabled)}
                />
              </div>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  {t('settings.fields.defaultActionMode')}
                </span>
                <select
                  value={settings.defaultActionMode}
                  disabled={globalDisabled}
                  onChange={(event) => updateSetting('defaultActionMode', event.target.value as RecallActionMode)}
                  className="input-field w-full"
                >
                  {actionModes.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(`settings.actionModes.${mode}`)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center justify-between gap-3 rounded-lg bg-white p-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{t('settings.fields.respectConsent')}</p>
                  <p className="text-xs text-gray-500">{t('settings.fields.respectConsentHelp')}</p>
                </div>
                <ToggleSwitch
                  checked={settings.respectCommunicationConsent}
                  disabled={globalDisabled}
                  label={t('settings.fields.respectConsent')}
                  onChange={(enabled) => updateSetting('respectCommunicationConsent', enabled)}
                />
              </div>
            </div>
          </div>

          <RuleCard
            title={t('settings.rules.checkup.title')}
            description={t('settings.rules.checkup.description')}
            icon={<CalendarClock size={18} />}
            enabled={settings.checkupEnabled}
            disabled={globalDisabled}
            actionMode={settings.checkupActionMode}
            templateId={settings.checkupMessageTemplateId}
            templates={templates}
            onEnabledChange={(enabled) => updateSetting('checkupEnabled', enabled)}
            onActionModeChange={(mode) => updateSetting('checkupActionMode', mode)}
            onTemplateChange={(id) => updateSetting('checkupMessageTemplateId', id)}
          >
            <NumberField
              label={t('settings.fields.afterDays')}
              value={settings.checkupAfterDays}
              disabled={globalDisabled || !settings.checkupEnabled}
              onChange={(value) => updateSetting('checkupAfterDays', value)}
            />
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">
                {t('settings.fields.sendTiming')}
              </span>
              <select
                value={settings.checkupSendTiming}
                disabled={globalDisabled || !settings.checkupEnabled}
                onChange={(event) => updateSetting('checkupSendTiming', event.target.value as RecallSendTiming)}
                className="input-field w-full"
              >
                {sendTimings.map((timing) => (
                  <option key={timing} value={timing}>{t(`settings.sendTimings.${timing}`)}</option>
                ))}
              </select>
            </label>
            <TimeField
              label={t('settings.fields.sendTime')}
              value={settings.checkupSendTime}
              disabled={globalDisabled || !settings.checkupEnabled}
              onChange={(value) => updateSetting('checkupSendTime', value)}
            />
          </RuleCard>

          <RuleCard
            title={t('settings.rules.treatmentPlan.title')}
            description={t('settings.rules.treatmentPlan.description')}
            icon={<MessageSquare size={18} />}
            enabled={settings.treatmentPlanFollowupEnabled}
            disabled={globalDisabled}
            actionMode={settings.treatmentPlanFollowupActionMode}
            templateId={settings.treatmentPlanFollowupMessageTemplateId}
            templates={templates}
            onEnabledChange={(enabled) => updateSetting('treatmentPlanFollowupEnabled', enabled)}
            onActionModeChange={(mode) => updateSetting('treatmentPlanFollowupActionMode', mode)}
            onTemplateChange={(id) => updateSetting('treatmentPlanFollowupMessageTemplateId', id)}
          >
            <NumberField label={t('settings.fields.afterDays')} value={settings.treatmentPlanFollowupAfterDays} disabled={globalDisabled || !settings.treatmentPlanFollowupEnabled} onChange={(value) => updateSetting('treatmentPlanFollowupAfterDays', value)} />
            <NumberField label={t('settings.fields.repeatDays')} value={settings.treatmentPlanFollowupRepeatDays} disabled={globalDisabled || !settings.treatmentPlanFollowupEnabled} onChange={(value) => updateSetting('treatmentPlanFollowupRepeatDays', value)} />
            <NumberField label={t('settings.fields.maxAttempts')} value={settings.treatmentPlanFollowupMaxAttempts} disabled={globalDisabled || !settings.treatmentPlanFollowupEnabled} onChange={(value) => updateSetting('treatmentPlanFollowupMaxAttempts', value)} />
          </RuleCard>

          <RuleCard
            title={t('settings.rules.incompleteTreatment.title')}
            description={t('settings.rules.incompleteTreatment.description')}
            icon={<Stethoscope size={18} />}
            enabled={settings.incompleteTreatmentEnabled}
            disabled={globalDisabled}
            actionMode={settings.incompleteTreatmentActionMode}
            templateId={settings.incompleteTreatmentMessageTemplateId}
            templates={templates}
            onEnabledChange={(enabled) => updateSetting('incompleteTreatmentEnabled', enabled)}
            onActionModeChange={(mode) => updateSetting('incompleteTreatmentActionMode', mode)}
            onTemplateChange={(id) => updateSetting('incompleteTreatmentMessageTemplateId', id)}
          >
            <NumberField label={t('settings.fields.afterDays')} value={settings.incompleteTreatmentAfterDays} disabled={globalDisabled || !settings.incompleteTreatmentEnabled} onChange={(value) => updateSetting('incompleteTreatmentAfterDays', value)} />
            <SwitchField label={t('settings.fields.autoTask')} checked={settings.incompleteTreatmentAutoCreateTask} disabled={globalDisabled || !settings.incompleteTreatmentEnabled} onChange={(value) => updateSetting('incompleteTreatmentAutoCreateTask', value)} />
          </RuleCard>

          <RuleCard
            title={t('settings.rules.noShow.title')}
            description={t('settings.rules.noShow.description')}
            icon={<UserX size={18} />}
            enabled={settings.noShowFollowupEnabled}
            disabled={globalDisabled}
            actionMode={settings.noShowFollowupActionMode}
            templateId={settings.noShowFollowupMessageTemplateId}
            templates={templates}
            onEnabledChange={(enabled) => updateSetting('noShowFollowupEnabled', enabled)}
            onActionModeChange={(mode) => updateSetting('noShowFollowupActionMode', mode)}
            onTemplateChange={(id) => updateSetting('noShowFollowupMessageTemplateId', id)}
          >
            <NumberField label={t('settings.fields.afterHours')} value={settings.noShowFollowupAfterHours} disabled={globalDisabled || !settings.noShowFollowupEnabled} onChange={(value) => updateSetting('noShowFollowupAfterHours', value)} />
            <SwitchField label={t('settings.fields.autoTask')} checked={settings.noShowFollowupAutoCreateTask} disabled={globalDisabled || !settings.noShowFollowupEnabled} onChange={(value) => updateSetting('noShowFollowupAutoCreateTask', value)} />
          </RuleCard>

          <RuleCard
            title={t('settings.rules.payment.title')}
            description={t('settings.rules.payment.description')}
            icon={<CreditCard size={18} />}
            enabled={settings.paymentFollowupEnabled}
            disabled={globalDisabled}
            actionMode={settings.paymentFollowupActionMode}
            templateId={settings.paymentFollowupMessageTemplateId}
            templates={templates}
            onEnabledChange={(enabled) => updateSetting('paymentFollowupEnabled', enabled)}
            onActionModeChange={(mode) => updateSetting('paymentFollowupActionMode', mode)}
            onTemplateChange={(id) => updateSetting('paymentFollowupMessageTemplateId', id)}
          >
            <NumberField label={t('settings.fields.afterDays')} value={settings.paymentFollowupAfterDays} disabled={globalDisabled || !settings.paymentFollowupEnabled} onChange={(value) => updateSetting('paymentFollowupAfterDays', value)} />
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800 xl:col-span-2">
              {paymentNote}
            </div>
          </RuleCard>
        </div>
      )}
    </div>
  );
};

interface NumberFieldProps {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

const NumberField: React.FC<NumberFieldProps> = ({ label, value, disabled, onChange }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">{label}</span>
    <input
      type="number"
      min={1}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
      className="input-field w-full"
    />
  </label>
);

interface TimeFieldProps {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

const TimeField: React.FC<TimeFieldProps> = ({ label, value, disabled, onChange }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">{label}</span>
    <div className="relative">
      <Clock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        type="time"
        value={value}
        step={300}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="input-field w-full pl-9"
      />
    </div>
  </label>
);

interface SwitchFieldProps {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}

const SwitchField: React.FC<SwitchFieldProps> = ({ label, checked, disabled, onChange }) => (
  <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
    <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
      <CheckSquare size={16} className="text-gray-400" />
      {label}
    </div>
    <ToggleSwitch checked={checked} disabled={disabled} label={label} onChange={onChange} />
  </div>
);

export default RecallSettingsSection;
