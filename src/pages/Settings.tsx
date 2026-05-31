import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Settings as SettingsIcon, Globe, Shield, Activity, UserCog, Users, CalendarClock, Link as LinkIcon, Copy, Check, MessageCircle, Instagram } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useClinic } from '../context/ClinicContext';
import { canManageUsers, canViewInstagramStatus, canViewWhatsAppStatus, normalizeRole } from '../utils/permissions';
import ServiceList from '../components/ServiceList';
import UserList from '../components/UserList';
import DoctorAvailabilityManager from '../components/DoctorAvailabilityManager';

const Settings: React.FC = () => {
  const { t, i18n } = useTranslation(['common', 'settings']);
  const { user } = useAuth();
  const { availableClinics, selectedClinicId } = useClinic();
  const [activeTab, setActiveTab] = useState<'general' | 'users' | 'availability' | 'services' | 'integrations'>('general');
  const [copied, setCopied] = useState(false);

  const userCanonicalRole = normalizeRole(user?.role ?? '', user?.canAccessAllClinics ?? false);
  const canSeeIntegrations = canViewWhatsAppStatus(user) || canViewInstagramStatus(user);

  const selectedClinic =
    selectedClinicId !== 'all'
      ? availableClinics.find((clinic) => clinic.id === selectedClinicId) ?? user?.clinic
      : availableClinics.find((clinic) => clinic.id === user?.defaultClinicId) ??
        availableClinics[0] ??
        user?.clinic;

  const bookingUrl = selectedClinic?.id
    ? `${window.location.origin}/book/${encodeURIComponent(selectedClinic.id)}`
    : '';

  const handleCopy = () => {
    if (!bookingUrl) return;
    navigator.clipboard.writeText(bookingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    i18n.changeLanguage(e.target.value);
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
            <button 
              onClick={() => setActiveTab('general')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors font-medium text-sm ${
                activeTab === 'general' ? 'bg-primary-50 text-primary-600' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <UserCog size={18} />
              {t('settings:generalPreferences')}
            </button>
            {(canManageUsers(user) || userCanonicalRole === 'RECEPTIONIST') && (
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
            {canManageUsers(user) && (
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
            {canSeeIntegrations && (
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
            {(canManageUsers(user) || userCanonicalRole === 'DENTIST') && (
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
          </div>
        </div>

        {/* Settings Content */}
        <div className="flex-1">
          {activeTab === 'general' && (
            <div className="space-y-6">
              <div className="card p-6">
                <div className="flex items-center gap-2 mb-4 border-b border-gray-100 pb-4">
                  <Globe size={20} className="text-gray-400" />
                  <h2 className="text-lg font-bold">{t('settings:preferences')}</h2>
                </div>
                
                <div className="space-y-4">
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
              </div>

              <div className="card p-6">
                <div className="flex items-center gap-2 mb-4 border-b border-gray-100 pb-4">
                  <Shield size={20} className="text-gray-400" />
                  <h2 className="text-lg font-bold">{t('settings:accountInfo')}</h2>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
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

          {activeTab === 'services' && (
            <ServiceList />
          )}

          {activeTab === 'users' && (
            <UserList />
          )}

          {activeTab === 'integrations' && (
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

          {activeTab === 'availability' && (
            <DoctorAvailabilityManager />
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
