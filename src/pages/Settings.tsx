import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings as SettingsIcon, Globe, Shield, Activity, UserCog, Users, CalendarClock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import ServiceList from '../components/ServiceList';
import UserList from '../components/UserList';
import DoctorAvailabilityManager from '../components/DoctorAvailabilityManager';

const Settings: React.FC = () => {
  const { t, i18n } = useTranslation(['common', 'settings']);
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'general' | 'users' | 'availability' | 'services'>('general');

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
            {(user?.role === 'admin' || user?.role === 'receptionist') && (
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
            {user?.role === 'admin' && (
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
            {(user?.role === 'admin' || user?.role === 'doctor') && (
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
                    <p className="text-gray-500">Name</p>
                    <p className="font-medium">{user?.firstName} {user?.lastName}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Email</p>
                    <p className="font-medium">{user?.email}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Role</p>
                    <p className="font-medium capitalize">{user?.role}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Clinic</p>
                    <p className="font-medium">{user?.clinic?.name}</p>
                  </div>
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

          {activeTab === 'availability' && (
            <DoctorAvailabilityManager />
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
