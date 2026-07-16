import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Settings as SettingsIcon, Shield, Activity, UserCog, Users, CalendarClock, Link as LinkIcon, Copy, Check, MessageCircle, Instagram, Bell, Clock, Save, MessageSquare, Monitor, Globe2, Coins, RotateCcw, Send, ShieldCheck, ShieldAlert, ScanLine } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useClinic } from '../context/ClinicContext';
import { CLINIC_OPERATING_PREFERENCES_UPDATED_EVENT } from '../context/ClinicPreferencesContext';
import { canManageUsers, canViewInstagramStatus, canViewWhatsAppStatus, normalizeRole, canManageClinicLegalProfile, canManageImagingDevices, canExportClinicBulkData } from '../utils/permissions';
import { clinicOperatingPreferencesService, notificationPreferencesService } from '../services/api';
import ClinicKvkkSection from '../components/settings/ClinicKvkkSection';
import ClinicBulkExportSection from '../components/settings/ClinicBulkExportSection';
import ImagingSettingsPanel from '../components/imaging/ImagingSettingsPanel';
import SmsSettingsSection from '../components/settings/SmsSettingsSection';
import {
  ClinicOperatingPreferences,
  DateFormatPreference,
  DEFAULT_CLINIC_OPERATING_PREFERENCES,
  FirstDayOfWeekPreference,
  REGION_DEFAULTS,
  RegionPreset,
  TimeFormatPreference,
  cloneClinicOperatingPreferences,
  currencyValues,
  dateFormatValues,
  firstDayOfWeekValues,
  formatCurrencyWithPreference,
  formatDateWithPreference,
  formatTimeWithPreference,
  localeValues,
  regionPresetValues,
  timeFormatValues,
  timezoneValues,
} from '../utils/clinicPreferences';
import ServiceList from '../components/ServiceList';
import UserList from '../components/UserList';
import DoctorAvailabilityManager from '../components/DoctorAvailabilityManager';
import RecallSettingsSection from '../components/recall/RecallSettingsSection';
import PostTreatmentMessages from '../components/PostTreatmentMessages';

type TimedWhatsAppPreference = {
  enabled: boolean;
  daysBefore: number;
  sendTime: string;
};

type NotificationPreferences = {
  whatsapp: {
    patientAppointmentReminder: TimedWhatsAppPreference;
    practitionerDailySchedule: TimedWhatsAppPreference;
    taskAssignment: { enabled: boolean };
    paymentReminder: TimedWhatsAppPreference;
  };
  inApp: {
    upcomingAppointments: { enabled: boolean; leadHours: number };
    overdueTasks: { enabled: boolean };
    appointmentRequests: { enabled: boolean };
    lowStock: { enabled: boolean };
  };
};

type SettingsTab = 'general' | 'recall' | 'post-treatment' | 'users' | 'availability' | 'services' | 'integrations' | 'sms' | 'imaging' | 'kvkk' | 'bulkExport';

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  whatsapp: {
    patientAppointmentReminder: { enabled: true, daysBefore: 1, sendTime: '10:00' },
    practitionerDailySchedule: { enabled: false, daysBefore: 1, sendTime: '18:00' },
    taskAssignment: { enabled: false },
    paymentReminder: { enabled: false, daysBefore: 1, sendTime: '10:00' },
  },
  inApp: {
    upcomingAppointments: { enabled: true, leadHours: 2 },
    overdueTasks: { enabled: true },
    appointmentRequests: { enabled: true },
    lowStock: { enabled: true },
  },
};

const reminderDayValues = [0, 1, 2, 3, 7];
const leadHourValues = [1, 2, 4, 8, 24];

function cloneNotificationPreferences(): NotificationPreferences {
  return JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_PREFERENCES)) as NotificationPreferences;
}

function buildOperatingPreview(preferences: ClinicOperatingPreferences) {
  const sampleDate = new Date('2026-06-01T14:30:00Z');

  return {
    date: formatDateWithPreference(sampleDate, preferences),
    time: formatTimeWithPreference(sampleDate, preferences),
    money: formatCurrencyWithPreference(1250.5, preferences),
  };
}

function formatDatePreview(format: DateFormatPreference): string {
  return formatDateWithPreference('2026-06-01T12:00:00Z', {
    ...DEFAULT_CLINIC_OPERATING_PREFERENCES,
    dateFormat: format,
  });
}

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

interface TimedPreferenceRowProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  value: TimedWhatsAppPreference;
  disabled: boolean;
  dayOptions: { value: number; label: string }[];
  timingLabel: string;
  dayLabel: string;
  timeLabel: string;
  onChange: (updates: Partial<TimedWhatsAppPreference>) => void;
}

const TimedPreferenceRow: React.FC<TimedPreferenceRowProps> = ({
  title,
  description,
  icon,
  value,
  disabled,
  dayOptions,
  timingLabel,
  dayLabel,
  timeLabel,
  onChange,
}) => (
  <div className="rounded-lg border border-gray-200 bg-white p-4">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 gap-3">
        <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-600">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <p className="mt-1 text-sm text-gray-500">{description}</p>
        </div>
      </div>
      <ToggleSwitch
        checked={value.enabled}
        disabled={disabled}
        label={title}
        onChange={(checked) => onChange({ enabled: checked })}
      />
    </div>
    <div className="mt-4 grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">{dayLabel}</span>
        <select
          value={value.daysBefore}
          disabled={disabled || !value.enabled}
          onChange={(event) => onChange({ daysBefore: Number(event.target.value) })}
          className="input-field w-full"
        >
          {dayOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">{timeLabel}</span>
        <div className="relative">
          <Clock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="time"
            value={value.sendTime}
            step={300}
            disabled={disabled || !value.enabled}
            onChange={(event) => onChange({ sendTime: event.target.value })}
            className="input-field w-full pl-9"
          />
        </div>
      </label>
    </div>
    <p className="mt-2 text-xs text-gray-500">{timingLabel}</p>
  </div>
);

interface SimplePreferenceRowProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  children?: React.ReactNode;
}

const SimplePreferenceRow: React.FC<SimplePreferenceRowProps> = ({
  title,
  description,
  icon,
  checked,
  disabled,
  onChange,
  children,
}) => (
  <div className="rounded-lg border border-gray-200 bg-white p-4">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 gap-3">
        <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <p className="mt-1 text-sm text-gray-500">{description}</p>
        </div>
      </div>
      <ToggleSwitch checked={checked} disabled={disabled} label={title} onChange={onChange} />
    </div>
    {children && <div className="mt-4 border-t border-gray-100 pt-4">{children}</div>}
  </div>
);

const Settings: React.FC = () => {
  const { t, i18n } = useTranslation(['common', 'settings', 'recall', 'sms', 'imaging']);
  const { user } = useAuth();
  const { availableClinics, selectedClinicId } = useClinic();
  const userCanonicalRole = normalizeRole(user?.role ?? '', user?.canAccessAllClinics ?? false);
  const isDentist = userCanonicalRole === 'DENTIST';
  const canSeeIntegrations = canViewWhatsAppStatus(user) || canViewInstagramStatus(user);
  const canEditNotificationPrefs = canManageUsers(user);
  const canEditOperatingPrefs = canManageUsers(user);
  const canSeeGeneral = !isDentist;
  const canSeeRecall = canSeeGeneral;
  const canSeePostTreatment = canSeeGeneral;
  const canSeeServices = !isDentist && (canManageUsers(user) || userCanonicalRole === 'RECEPTIONIST');
  const canSeeUsers = !isDentist && canManageUsers(user);
  const canSeeIntegrationsTab = !isDentist && canSeeIntegrations;
  const canSeeAvailability = canManageUsers(user) || isDentist;
  const canSeeKvkk = canManageClinicLegalProfile(user);
  // SMS settings/provider management is restricted to admin/manager roles
  const canSeeSms = !isDentist && canManageUsers(user);
  // Görüntüleme cihaz/köprü yönetimi: yalnızca OWNER/ORG_ADMIN/CLINIC_MANAGER
  const canSeeImaging = canManageImagingDevices(user);
  // KVKK-HIGH-004: clinic bulk/structured-data export — yalnızca OWNER/ORG_ADMIN
  const canSeeBulkExport = canExportClinicBulkData(user);
  const firstAllowedTab: SettingsTab = canSeeGeneral
    ? 'general'
    : canSeeAvailability
      ? 'availability'
      : canSeeServices
        ? 'services'
        : canSeeUsers
          ? 'users'
          : canSeeIntegrationsTab
            ? 'integrations'
            : canSeeKvkk
              ? 'kvkk'
              : canSeeBulkExport
                ? 'bulkExport'
                : 'general';
  const [activeTab, setActiveTab] = useState<SettingsTab>(firstAllowedTab);
  const [copied, setCopied] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(() => cloneNotificationPreferences());
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsMessage, setPrefsMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [operatingPrefs, setOperatingPrefs] = useState<ClinicOperatingPreferences>(() => cloneClinicOperatingPreferences());
  const [operatingPrefsLoading, setOperatingPrefsLoading] = useState(false);
  const [operatingPrefsSaving, setOperatingPrefsSaving] = useState(false);
  const [operatingPrefsMessage, setOperatingPrefsMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const selectedClinic =
    selectedClinicId !== 'all'
      ? availableClinics.find((clinic) => clinic.id === selectedClinicId) ?? user?.clinic
      : availableClinics.find((clinic) => clinic.id === user?.defaultClinicId) ??
        availableClinics[0] ??
        user?.clinic;

  const bookingUrl = selectedClinic?.id
    ? `${window.location.origin}/book/${encodeURIComponent(selectedClinic.id)}`
    : '';

  useEffect(() => {
    const activeTabAllowed =
      (activeTab === 'general' && canSeeGeneral) ||
      (activeTab === 'recall' && canSeeRecall) ||
      (activeTab === 'post-treatment' && canSeePostTreatment) ||
      (activeTab === 'services' && canSeeServices) ||
      (activeTab === 'users' && canSeeUsers) ||
      (activeTab === 'integrations' && canSeeIntegrationsTab) ||
      (activeTab === 'availability' && canSeeAvailability) ||
      (activeTab === 'sms' && canSeeSms) ||
      (activeTab === 'imaging' && canSeeImaging) ||
      (activeTab === 'kvkk' && canSeeKvkk) ||
      (activeTab === 'bulkExport' && canSeeBulkExport);

    if (!activeTabAllowed) {
      setActiveTab(firstAllowedTab);
    }
  }, [
    activeTab,
    canSeeAvailability,
    canSeeGeneral,
    canSeeImaging,
    canSeeRecall,
    canSeeIntegrationsTab,
    canSeeKvkk,
    canSeeBulkExport,
    canSeeServices,
    canSeeSms,
    canSeeUsers,
    firstAllowedTab,
  ]);

  useEffect(() => {
    if (!canSeeGeneral || activeTab !== 'general' || !selectedClinic?.id) return;

    let alive = true;
    setPrefsLoading(true);
    setPrefsMessage(null);

    notificationPreferencesService
      .get(selectedClinic.id)
      .then((res) => {
        if (!alive) return;
        setNotificationPrefs(res.data.preferences || cloneNotificationPreferences());
      })
      .catch(() => {
        if (!alive) return;
        setNotificationPrefs(cloneNotificationPreferences());
        setPrefsMessage({ type: 'error', text: t('settings:notificationPreferences.loadError') });
      })
      .finally(() => {
        if (alive) setPrefsLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [activeTab, canSeeGeneral, selectedClinic?.id, t]);

  useEffect(() => {
    if (!canSeeGeneral || activeTab !== 'general' || !selectedClinic?.id) return;

    let alive = true;
    setOperatingPrefsLoading(true);
    setOperatingPrefsMessage(null);

    clinicOperatingPreferencesService
      .get(selectedClinic.id)
      .then((res) => {
        if (!alive) return;
        setOperatingPrefs(res.data.preferences || cloneClinicOperatingPreferences());
      })
      .catch(() => {
        if (!alive) return;
        setOperatingPrefs({
          ...cloneClinicOperatingPreferences(),
          currency: selectedClinic?.currency || user?.clinic?.currency || DEFAULT_CLINIC_OPERATING_PREFERENCES.currency,
          timezone: selectedClinic?.timezone || user?.clinic?.timezone || DEFAULT_CLINIC_OPERATING_PREFERENCES.timezone,
        });
        setOperatingPrefsMessage({ type: 'error', text: t('settings:operatingPreferences.loadError') });
      })
      .finally(() => {
        if (alive) setOperatingPrefsLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [activeTab, canSeeGeneral, selectedClinic?.id, selectedClinic?.currency, selectedClinic?.timezone, user?.clinic?.currency, user?.clinic?.timezone, t]);

  const handleCopy = () => {
    if (!bookingUrl) return;
    navigator.clipboard.writeText(bookingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    i18n.changeLanguage(e.target.value);
  };

  const dayOptions = reminderDayValues.map((value) => ({
    value,
    label: t(`settings:notificationPreferences.days.${value}`),
  }));

  const updateTimedWhatsappPreference = (
    key: keyof Pick<NotificationPreferences['whatsapp'], 'patientAppointmentReminder' | 'practitionerDailySchedule' | 'paymentReminder'>,
    updates: Partial<TimedWhatsAppPreference>,
  ) => {
    setNotificationPrefs((prev) => ({
      ...prev,
      whatsapp: {
        ...prev.whatsapp,
        [key]: {
          ...prev.whatsapp[key],
          ...updates,
        },
      },
    }));
  };

  const updateTaskAssignmentPreference = (enabled: boolean) => {
    setNotificationPrefs((prev) => ({
      ...prev,
      whatsapp: {
        ...prev.whatsapp,
        taskAssignment: { enabled },
      },
    }));
  };

  const updateInAppPreference = <K extends keyof NotificationPreferences['inApp']>(
    key: K,
    updates: Partial<NotificationPreferences['inApp'][K]>,
  ) => {
    setNotificationPrefs((prev) => ({
      ...prev,
      inApp: {
        ...prev.inApp,
        [key]: {
          ...prev.inApp[key],
          ...updates,
        },
      },
    }));
  };

  const handleSaveNotificationPrefs = async () => {
    if (!selectedClinic?.id || !canEditNotificationPrefs) return;

    setPrefsSaving(true);
    setPrefsMessage(null);
    try {
      const res = await notificationPreferencesService.update(notificationPrefs, selectedClinic.id);
      setNotificationPrefs(res.data.preferences || notificationPrefs);
      setPrefsMessage({ type: 'success', text: t('settings:notificationPreferences.saveSuccess') });
    } catch {
      setPrefsMessage({ type: 'error', text: t('settings:notificationPreferences.saveError') });
    } finally {
      setPrefsSaving(false);
    }
  };

  const operatingPreview = buildOperatingPreview(operatingPrefs);

  const updateOperatingPreference = <K extends keyof ClinicOperatingPreferences>(
    key: K,
    value: ClinicOperatingPreferences[K],
  ) => {
    setOperatingPrefs((prev) => ({ ...prev, [key]: value }));
  };

  const applyRegionPreset = (regionPreset: RegionPreset) => {
    setOperatingPrefs({ ...REGION_DEFAULTS[regionPreset] });
  };

  const handleSaveOperatingPrefs = async () => {
    if (!selectedClinic?.id || !canEditOperatingPrefs) return;

    setOperatingPrefsSaving(true);
    setOperatingPrefsMessage(null);
    try {
      const res = await clinicOperatingPreferencesService.update(operatingPrefs, selectedClinic.id);
      const nextPreferences = res.data.preferences || operatingPrefs;
      setOperatingPrefs(nextPreferences);
      window.dispatchEvent(new CustomEvent(CLINIC_OPERATING_PREFERENCES_UPDATED_EVENT, {
        detail: { clinicId: selectedClinic.id, preferences: nextPreferences },
      }));
      setOperatingPrefsMessage({ type: 'success', text: t('settings:operatingPreferences.saveSuccess') });
    } catch {
      setOperatingPrefsMessage({ type: 'error', text: t('settings:operatingPreferences.saveError') });
    } finally {
      setOperatingPrefsSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-2">
        <SettingsIcon size={24} className="text-primary-600" />
        <h1 className="text-2xl font-bold text-gray-900">{t('settings', { defaultValue: 'Settings' })}</h1>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Settings Sidebar */}
        <div className="w-full md:w-64 flex-shrink-0">
          <div className="card p-2 space-y-1">
            {canSeeGeneral && (
              <button
                onClick={() => setActiveTab('general')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors font-medium text-sm ${
                  activeTab === 'general' ? 'bg-primary-50 text-primary-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <UserCog size={18} />
                {t('settings:generalPreferences')}
              </button>
            )}
            {canSeeRecall && (
              <button
                onClick={() => setActiveTab('recall')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors font-medium text-sm ${
                  activeTab === 'recall' ? 'bg-primary-50 text-primary-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <RotateCcw size={18} />
                {t('recall:settings.nav')}
              </button>
            )}
            {canSeePostTreatment && (
              <button
                onClick={() => setActiveTab('post-treatment')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors font-medium text-sm ${
                  activeTab === 'post-treatment' ? 'bg-primary-50 text-primary-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Send size={18} />
                {t('postTreatment:nav')}
              </button>
            )}
            {canSeeServices && (
              <button 
                onClick={() => setActiveTab('services')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors font-medium text-sm ${
                  activeTab === 'services' ? 'bg-primary-50 text-primary-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Activity size={18} />
                {t('settings:services.title')}
              </button>
            )}
            {canSeeUsers && (
              <button
                onClick={() => setActiveTab('users')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors font-medium text-sm ${
                  activeTab === 'users' ? 'bg-primary-50 text-primary-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Users size={18} />
                {t('settings:users.title')}
              </button>
            )}
            {canSeeIntegrationsTab && (
              <button
                onClick={() => setActiveTab('integrations')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors font-medium text-sm ${
                  activeTab === 'integrations' ? 'bg-primary-50 text-primary-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <LinkIcon size={18} />
                {t('settings:integrations.title')}
              </button>
            )}
            {canSeeAvailability && (
              <button
                onClick={() => setActiveTab('availability')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors font-medium text-sm ${
                  activeTab === 'availability' ? 'bg-primary-50 text-primary-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <CalendarClock size={18} />
                {t('settings:availability.title')}
              </button>
            )}
            {canSeeSms && (
              <button
                onClick={() => setActiveTab('sms')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors font-medium text-sm ${
                  activeTab === 'sms' ? 'bg-primary-50 text-primary-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <MessageSquare size={18} />
                {t('sms:nav')}
              </button>
            )}
            {canSeeImaging && (
              <button
                onClick={() => setActiveTab('imaging')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors font-medium text-sm ${
                  activeTab === 'imaging' ? 'bg-primary-50 text-primary-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <ScanLine size={18} />
                {t('imaging:settings.nav')}
              </button>
            )}
            {canSeeKvkk && (
              <button
                onClick={() => setActiveTab('kvkk')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors font-medium text-sm ${
                  activeTab === 'kvkk' ? 'bg-primary-50 text-primary-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <ShieldCheck size={18} />
                {t('settings:kvkk.nav')}
              </button>
            )}
            {canSeeBulkExport && (
              <button
                onClick={() => setActiveTab('bulkExport')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors font-medium text-sm ${
                  activeTab === 'bulkExport' ? 'bg-primary-50 text-primary-600' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <ShieldAlert size={18} />
                {t('clinicBulkExport:nav')}
              </button>
            )}
          </div>
        </div>

        {/* Settings Content */}
        <div className="flex-1">
          {canSeeGeneral && activeTab === 'general' && (
            <div className="space-y-6">
              <div className="card p-6">
                <div className="flex items-center gap-2 mb-4 border-b border-gray-100 pb-4">
                  <Bell size={20} className="text-gray-400" />
                  <div>
                    <h2 className="text-lg font-bold">{t('settings:notificationPreferences.title')}</h2>
                    <p className="mt-1 text-sm text-gray-500">{t('settings:notificationPreferences.subtitle')}</p>
                  </div>
                </div>
                
                <div className="hidden">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings:language')}</label>
                    <select 
                      className="input-field w-full max-w-xs"
                      value={i18n.language}
                      onChange={handleLanguageChange}
                    >
                      <option value="en">English</option>
                      <option value="tr">Türkçe</option>
                      <option value="fr">Français</option>
                      <option value="de">Deutsch</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-2">{t('settings:languageHelp')}</p>
                  </div>
                </div>
                <div className="mt-5">
                  <div className="mb-5 flex flex-col gap-3 border-b border-gray-100 pb-5 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      {selectedClinic?.name && (
                        <p className="text-xs font-medium text-gray-500">
                          {t('settings:notificationPreferences.clinicScope', { clinic: selectedClinic.name })}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveNotificationPrefs}
                      disabled={!canEditNotificationPrefs || prefsSaving || prefsLoading || !selectedClinic?.id}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      {prefsSaving ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      ) : (
                        <Save size={16} />
                      )}
                      {t('settings:notificationPreferences.save')}
                    </button>
                  </div>

                  {!canEditNotificationPrefs && (
                    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      {t('settings:notificationPreferences.readOnly')}
                    </div>
                  )}

                  {prefsMessage && (
                    <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
                      prefsMessage.type === 'success'
                        ? 'border-green-200 bg-green-50 text-green-700'
                        : 'border-red-200 bg-red-50 text-red-700'
                    }`}>
                      {prefsMessage.text}
                    </div>
                  )}

                  {prefsLoading ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                      {t('settings:notificationPreferences.loading')}
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <section>
                        <div className="mb-3 flex items-center gap-2">
                          <MessageSquare size={18} className="text-green-600" />
                          <h3 className="font-bold text-gray-900">{t('settings:notificationPreferences.whatsappSection')}</h3>
                        </div>
                        <div className="space-y-3">
                          <TimedPreferenceRow
                            title={t('settings:notificationPreferences.patientReminder.title')}
                            description={t('settings:notificationPreferences.patientReminder.description')}
                            icon={<MessageCircle size={18} />}
                            value={notificationPrefs.whatsapp.patientAppointmentReminder}
                            disabled={!canEditNotificationPrefs}
                            dayOptions={dayOptions}
                            timingLabel={t('settings:notificationPreferences.patientReminder.timingHelp')}
                            dayLabel={t('settings:notificationPreferences.fields.day')}
                            timeLabel={t('settings:notificationPreferences.fields.time')}
                            onChange={(updates) => updateTimedWhatsappPreference('patientAppointmentReminder', updates)}
                          />

                          <TimedPreferenceRow
                            title={t('settings:notificationPreferences.practitionerSchedule.title')}
                            description={t('settings:notificationPreferences.practitionerSchedule.description')}
                            icon={<CalendarClock size={18} />}
                            value={notificationPrefs.whatsapp.practitionerDailySchedule}
                            disabled={!canEditNotificationPrefs}
                            dayOptions={dayOptions}
                            timingLabel={t('settings:notificationPreferences.practitionerSchedule.timingHelp')}
                            dayLabel={t('settings:notificationPreferences.fields.day')}
                            timeLabel={t('settings:notificationPreferences.fields.time')}
                            onChange={(updates) => updateTimedWhatsappPreference('practitionerDailySchedule', updates)}
                          />

                          <SimplePreferenceRow
                            title={t('settings:notificationPreferences.taskAssignment.title')}
                            description={t('settings:notificationPreferences.taskAssignment.description')}
                            icon={<Users size={18} />}
                            checked={notificationPrefs.whatsapp.taskAssignment.enabled}
                            disabled={!canEditNotificationPrefs}
                            onChange={updateTaskAssignmentPreference}
                          />

                          <TimedPreferenceRow
                            title={t('settings:notificationPreferences.paymentReminder.title')}
                            description={t('settings:notificationPreferences.paymentReminder.description')}
                            icon={<Bell size={18} />}
                            value={notificationPrefs.whatsapp.paymentReminder}
                            disabled={!canEditNotificationPrefs}
                            dayOptions={dayOptions}
                            timingLabel={t('settings:notificationPreferences.paymentReminder.timingHelp')}
                            dayLabel={t('settings:notificationPreferences.fields.day')}
                            timeLabel={t('settings:notificationPreferences.fields.time')}
                            onChange={(updates) => updateTimedWhatsappPreference('paymentReminder', updates)}
                          />
                        </div>
                      </section>

                      <section>
                        <div className="mb-3 flex items-center gap-2">
                          <Monitor size={18} className="text-blue-600" />
                          <h3 className="font-bold text-gray-900">{t('settings:notificationPreferences.inAppSection')}</h3>
                        </div>
                        <div className="space-y-3">
                          <SimplePreferenceRow
                            title={t('settings:notificationPreferences.inApp.upcomingAppointments.title')}
                            description={t('settings:notificationPreferences.inApp.upcomingAppointments.description')}
                            icon={<CalendarClock size={18} />}
                            checked={notificationPrefs.inApp.upcomingAppointments.enabled}
                            disabled={!canEditNotificationPrefs}
                            onChange={(enabled) => updateInAppPreference('upcomingAppointments', { enabled })}
                          >
                            <label className="block max-w-xs">
                              <span className="mb-1 block text-xs font-semibold uppercase text-gray-500">
                                {t('settings:notificationPreferences.fields.leadHours')}
                              </span>
                              <select
                                value={notificationPrefs.inApp.upcomingAppointments.leadHours}
                                disabled={!canEditNotificationPrefs || !notificationPrefs.inApp.upcomingAppointments.enabled}
                                onChange={(event) => updateInAppPreference('upcomingAppointments', { leadHours: Number(event.target.value) })}
                                className="input-field w-full"
                              >
                                {leadHourValues.map((value) => (
                                  <option key={value} value={value}>
                                    {t('settings:notificationPreferences.hoursBefore', { count: value })}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </SimplePreferenceRow>

                          <SimplePreferenceRow
                            title={t('settings:notificationPreferences.inApp.overdueTasks.title')}
                            description={t('settings:notificationPreferences.inApp.overdueTasks.description')}
                            icon={<Bell size={18} />}
                            checked={notificationPrefs.inApp.overdueTasks.enabled}
                            disabled={!canEditNotificationPrefs}
                            onChange={(enabled) => updateInAppPreference('overdueTasks', { enabled })}
                          />

                          <SimplePreferenceRow
                            title={t('settings:notificationPreferences.inApp.appointmentRequests.title')}
                            description={t('settings:notificationPreferences.inApp.appointmentRequests.description')}
                            icon={<MessageCircle size={18} />}
                            checked={notificationPrefs.inApp.appointmentRequests.enabled}
                            disabled={!canEditNotificationPrefs}
                            onChange={(enabled) => updateInAppPreference('appointmentRequests', { enabled })}
                          />

                          <SimplePreferenceRow
                            title={t('settings:notificationPreferences.inApp.lowStock.title')}
                            description={t('settings:notificationPreferences.inApp.lowStock.description')}
                            icon={<Activity size={18} />}
                            checked={notificationPrefs.inApp.lowStock.enabled}
                            disabled={!canEditNotificationPrefs}
                            onChange={(enabled) => updateInAppPreference('lowStock', { enabled })}
                          />
                        </div>
                      </section>
                    </div>
                  )}
                </div>
              </div>

              {canSeeRecall && (
                <div className="card p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                        <RotateCcw size={20} />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-gray-900">{t('recall:settingsSummary.title')}</h2>
                        <p className="mt-1 text-sm text-gray-500">{t('recall:settingsSummary.description')}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('recall')}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
                    >
                      <RotateCcw size={16} />
                      {t('recall:settingsSummary.manage')}
                    </button>
                  </div>
                </div>
              )}

              <div className="card p-6">
                <div className="flex items-center gap-2 mb-4 border-b border-gray-100 pb-4">
                  <Globe2 size={20} className="text-gray-400" />
                  <div>
                    <h2 className="text-lg font-bold">{t('settings:operatingPreferences.title')}</h2>
                    <p className="mt-1 text-sm text-gray-500">{t('settings:operatingPreferences.subtitle')}</p>
                  </div>
                </div>

                <div className="mb-5 flex flex-col gap-3 border-b border-gray-100 pb-5 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    {selectedClinic?.name && (
                      <p className="text-xs font-medium text-gray-500">
                        {t('settings:operatingPreferences.clinicScope', { clinic: selectedClinic.name })}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveOperatingPrefs}
                    disabled={!canEditOperatingPrefs || operatingPrefsSaving || operatingPrefsLoading || !selectedClinic?.id}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {operatingPrefsSaving ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ) : (
                      <Save size={16} />
                    )}
                    {t('settings:operatingPreferences.save')}
                  </button>
                </div>

                {!canEditOperatingPrefs && (
                  <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {t('settings:operatingPreferences.readOnly')}
                  </div>
                )}

                {operatingPrefsMessage && (
                  <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
                    operatingPrefsMessage.type === 'success'
                      ? 'border-green-200 bg-green-50 text-green-700'
                      : 'border-red-200 bg-red-50 text-red-700'
                  }`}>
                    {operatingPrefsMessage.text}
                  </div>
                )}

                {operatingPrefsLoading ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                    {t('settings:operatingPreferences.loading')}
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-gray-700">
                          {t('settings:operatingPreferences.fields.regionPreset')}
                        </span>
                        <select
                          value={operatingPrefs.regionPreset}
                          disabled={!canEditOperatingPrefs}
                          onChange={(event) => applyRegionPreset(event.target.value as RegionPreset)}
                          className="input-field w-full"
                        >
                          {regionPresetValues.map((region) => (
                            <option key={region} value={region}>
                              {t(`settings:operatingPreferences.regions.${region}`)}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">{t('settings:operatingPreferences.help.regionPreset')}</p>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-gray-700">
                          {t('settings:operatingPreferences.fields.currency')}
                        </span>
                        <select
                          value={operatingPrefs.currency}
                          disabled={!canEditOperatingPrefs}
                          onChange={(event) => updateOperatingPreference('currency', event.target.value)}
                          className="input-field w-full"
                        >
                          {currencyValues.map((currency) => (
                            <option key={currency} value={currency}>
                              {t(`settings:operatingPreferences.currencies.${currency}`)}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">{t('settings:operatingPreferences.help.currency')}</p>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-gray-700">
                          {t('settings:operatingPreferences.fields.locale')}
                        </span>
                        <select
                          value={operatingPrefs.locale}
                          disabled={!canEditOperatingPrefs}
                          onChange={(event) => updateOperatingPreference('locale', event.target.value)}
                          className="input-field w-full"
                        >
                          {localeValues.map((locale) => (
                            <option key={locale} value={locale}>
                              {t(`settings:operatingPreferences.locales.${locale}`)}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">{t('settings:operatingPreferences.help.locale')}</p>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-gray-700">
                          {t('settings:operatingPreferences.fields.dateFormat')}
                        </span>
                        <select
                          value={operatingPrefs.dateFormat}
                          disabled={!canEditOperatingPrefs}
                          onChange={(event) => updateOperatingPreference('dateFormat', event.target.value as DateFormatPreference)}
                          className="input-field w-full"
                        >
                          {dateFormatValues.map((dateFormat) => (
                            <option key={dateFormat} value={dateFormat}>
                              {dateFormat} ({formatDatePreview(dateFormat)})
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-gray-700">
                          {t('settings:operatingPreferences.fields.timeFormat')}
                        </span>
                        <select
                          value={operatingPrefs.timeFormat}
                          disabled={!canEditOperatingPrefs}
                          onChange={(event) => updateOperatingPreference('timeFormat', event.target.value as TimeFormatPreference)}
                          className="input-field w-full"
                        >
                          {timeFormatValues.map((timeFormat) => (
                            <option key={timeFormat} value={timeFormat}>
                              {t(`settings:operatingPreferences.timeFormats.${timeFormat}`)}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-gray-700">
                          {t('settings:operatingPreferences.fields.timezone')}
                        </span>
                        <select
                          value={operatingPrefs.timezone}
                          disabled={!canEditOperatingPrefs}
                          onChange={(event) => updateOperatingPreference('timezone', event.target.value)}
                          className="input-field w-full"
                        >
                          {timezoneValues.map((timezone) => (
                            <option key={timezone} value={timezone}>
                              {t(`settings:operatingPreferences.timezones.${timezone}`, { defaultValue: timezone })}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">{t('settings:operatingPreferences.help.timezone')}</p>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-gray-700">
                          {t('settings:operatingPreferences.fields.firstDayOfWeek')}
                        </span>
                        <select
                          value={operatingPrefs.firstDayOfWeek}
                          disabled={!canEditOperatingPrefs}
                          onChange={(event) => updateOperatingPreference('firstDayOfWeek', event.target.value as FirstDayOfWeekPreference)}
                          className="input-field w-full"
                        >
                          {firstDayOfWeekValues.map((day) => (
                            <option key={day} value={day}>
                              {t(`settings:operatingPreferences.weekStarts.${day}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Coins size={18} className="text-primary-600" />
                        <h3 className="font-bold text-gray-900">{t('settings:operatingPreferences.preview.title')}</h3>
                      </div>
                      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                        <div>
                          <p className="text-xs font-semibold uppercase text-gray-500">{t('settings:operatingPreferences.preview.date')}</p>
                          <p className="mt-1 font-medium text-gray-900">{operatingPreview.date}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase text-gray-500">{t('settings:operatingPreferences.preview.time')}</p>
                          <p className="mt-1 font-medium text-gray-900">{operatingPreview.time}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase text-gray-500">{t('settings:operatingPreferences.preview.money')}</p>
                          <p className="mt-1 font-medium text-gray-900">{operatingPreview.money}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="card p-6">
                <div className="flex items-center gap-2 mb-4 border-b border-gray-100 pb-4">
                  <Shield size={20} className="text-gray-400" />
                  <h2 className="text-lg font-bold">{t('settings:accountInfo')}</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">{t('settings:accountFields.name')}</p>
                    <p className="font-medium">{user?.firstName} {user?.lastName}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">{t('settings:accountFields.email')}</p>
                    <p className="font-medium">{user?.email}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">{t('settings:accountFields.role')}</p>
                    <p className="font-medium capitalize">{user?.role}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">{t('settings:accountFields.clinic')}</p>
                    <p className="font-medium">{user?.clinic?.name}</p>
                  </div>
                </div>
              </div>

              {/* Online Booking Link */}
              <div className="card p-6">
                <div className="flex items-center gap-2 mb-4 border-b border-gray-100 pb-4">
                  <LinkIcon size={20} className="text-gray-400" />
                  <h2 className="text-lg font-bold">{t('settings:booking.title')}</h2>
                </div>
                <p className="text-sm text-gray-500 mb-3">
                  {t('settings:booking.description')}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={bookingUrl}
                    className="input-field flex-1 text-sm font-mono bg-gray-50 text-gray-700 select-all"
                    onFocus={e => e.target.select()}
                  />
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50 transition-colors flex-shrink-0"
                  >
                    {copied ? <Check size={15} className="text-green-600" /> : <Copy size={15} />}
                    {copied ? t('settings:booking.copied') : t('settings:booking.copy')}
                  </button>
                  {bookingUrl ? (
                    <a
                      href={bookingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors flex-shrink-0"
                    >
                      {t('settings:booking.open')}
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-200 text-gray-500 text-sm font-medium cursor-not-allowed flex-shrink-0"
                    >
                      {t('settings:booking.open')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {canSeeRecall && activeTab === 'recall' && (
            <RecallSettingsSection
              clinicId={selectedClinic?.id}
              clinicName={selectedClinic?.name}
              canEdit={canEditNotificationPrefs}
            />
          )}

          {canSeePostTreatment && activeTab === 'post-treatment' && (
            <PostTreatmentMessages
              clinicId={selectedClinic?.id}
              canEdit={canEditNotificationPrefs}
            />
          )}

          {canSeeServices && activeTab === 'services' && (
            <ServiceList />
          )}

          {canSeeUsers && activeTab === 'users' && (
            <UserList />
          )}

          {canSeeIntegrationsTab && activeTab === 'integrations' && (
            <div className="card p-6">
              <div className="flex items-center gap-2 mb-4 border-b border-gray-100 pb-4">
                <LinkIcon size={20} className="text-gray-400" />
                <h2 className="text-lg font-bold">{t('settings:integrations.title')}</h2>
              </div>
              <p className="text-sm text-gray-500 mb-5">{t('settings:integrations.subtitle')}</p>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {canViewWhatsAppStatus(user) && (
                  <div className="rounded-xl border border-gray-200 p-5 bg-white">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-green-50 text-green-600 flex items-center justify-center flex-shrink-0">
                        <MessageCircle size={20} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-gray-900">{t('settings:integrations.whatsappTitle')}</h3>
                        <p className="text-sm text-gray-500 mt-1">{t('settings:integrations.whatsappDescription')}</p>
                      </div>
                    </div>
                    <RouterLink
                      to="/organization/whatsapp"
                      className="mt-4 inline-flex items-center justify-center px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors"
                    >
                      {t('settings:integrations.open')}
                    </RouterLink>
                  </div>
                )}

                {canViewInstagramStatus(user) && (
                  <div className="rounded-xl border border-gray-200 p-5 bg-white">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-pink-50 text-pink-600 flex items-center justify-center flex-shrink-0">
                        <Instagram size={20} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-gray-900">{t('settings:integrations.instagramTitle')}</h3>
                        <p className="text-sm text-gray-500 mt-1">{t('settings:integrations.instagramDescription')}</p>
                      </div>
                    </div>
                    <RouterLink
                      to="/organization/instagram"
                      className="mt-4 inline-flex items-center justify-center px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors"
                    >
                      {t('settings:integrations.open')}
                    </RouterLink>
                  </div>
                )}
              </div>
            </div>
          )}

          {canSeeAvailability && activeTab === 'availability' && (
            <DoctorAvailabilityManager />
          )}

          {canSeeSms && activeTab === 'sms' && (
            <SmsSettingsSection clinicId={selectedClinic?.id} />
          )}

          {canSeeImaging && activeTab === 'imaging' && (
            <ImagingSettingsPanel />
          )}
          {canSeeKvkk && activeTab === 'kvkk' && (
            <ClinicKvkkSection
              clinicId={selectedClinic?.id}
              clinicSlug={('slug' in (selectedClinic ?? {})) ? (selectedClinic as any).slug as string : undefined}
              clinicName={selectedClinic?.name}
              canEdit={canManageClinicLegalProfile(user)}
            />
          )}
          {canSeeBulkExport && activeTab === 'bulkExport' && (
            <ClinicBulkExportSection clinicId={selectedClinic?.id} canEdit={canSeeBulkExport} />
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
