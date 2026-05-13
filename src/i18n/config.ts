import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import locales
import commonEn from '../locales/en/common.json';
import authEn from '../locales/en/auth.json';
import dashboardEn from '../locales/en/dashboard.json';
import patientsEn from '../locales/en/patients.json';
import appointmentsEn from '../locales/en/appointments.json';
import appointmentRequestsEn from '../locales/en/appointmentRequests.json';
import tasksEn from '../locales/en/tasks.json';
import treatmentCasesEn from '../locales/en/treatmentCases.json';
import paymentsEn from '../locales/en/payments.json';
import validationEn from '../locales/en/validation.json';
import errorsEn from '../locales/en/errors.json';
import messagesEn from '../locales/en/messages.json';
import messageTemplatesEn from '../locales/en/messageTemplates.json';
import servicesEn from '../locales/en/services.json';
import settingsEn from '../locales/en/settings.json';
import insuranceEn from '../locales/en/insurance.json';

import commonTr from '../locales/tr/common.json';
import authTr from '../locales/tr/auth.json';
import dashboardTr from '../locales/tr/dashboard.json';
import patientsTr from '../locales/tr/patients.json';
import appointmentsTr from '../locales/tr/appointments.json';
import appointmentRequestsTr from '../locales/tr/appointmentRequests.json';
import tasksTr from '../locales/tr/tasks.json';
import treatmentCasesTr from '../locales/tr/treatmentCases.json';
import paymentsTr from '../locales/tr/payments.json';
import messagesTr from '../locales/tr/messages.json';
import messageTemplatesTr from '../locales/tr/messageTemplates.json';
import servicesTr from '../locales/tr/services.json';
import settingsTr from '../locales/tr/settings.json';
import insuranceTr from '../locales/tr/insurance.json';

import commonFr from '../locales/fr/common.json';
import authFr from '../locales/fr/auth.json';
import dashboardFr from '../locales/fr/dashboard.json';
import patientsFr from '../locales/fr/patients.json';
import paymentsFr from '../locales/fr/payments.json';
import insuranceFr from '../locales/fr/insurance.json';

import commonDe from '../locales/de/common.json';
import authDe from '../locales/de/auth.json';
import dashboardDe from '../locales/de/dashboard.json';
import patientsDe from '../locales/de/patients.json';
import paymentsDe from '../locales/de/payments.json';

const resources = {
  en: {
    common: commonEn,
    auth: authEn,
    dashboard: dashboardEn,
    patients: patientsEn,
    appointments: appointmentsEn,
    appointmentRequests: appointmentRequestsEn,
    tasks: tasksEn,
    treatmentCases: treatmentCasesEn,
    payments: paymentsEn,
    messages: messagesEn,
    messageTemplates: messageTemplatesEn,
    services: servicesEn,
    settings: settingsEn,
    insurance: insuranceEn,
    validation: validationEn,
    errors: errorsEn,
  },
  tr: {
    common: commonTr,
    auth: authTr,
    dashboard: dashboardTr,
    patients: patientsTr,
    appointments: appointmentsTr,
    appointmentRequests: appointmentRequestsTr,
    tasks: tasksTr,
    treatmentCases: treatmentCasesTr,
    payments: paymentsTr,
    messages: messagesTr,
    messageTemplates: messageTemplatesTr,
    services: servicesTr,
    settings: settingsTr,
    insurance: insuranceTr,
    validation: validationEn,
    errors: errorsEn,
  },
  fr: {
    common: commonFr,
    auth: authFr,
    dashboard: dashboardFr,
    patients: patientsFr,
    appointments: appointmentsEn,
    appointmentRequests: appointmentRequestsEn,
    payments: paymentsFr,
    services: servicesEn,
    settings: settingsEn,
    insurance: insuranceFr,
    validation: validationEn,
    errors: errorsEn,
  },
  de: {
    common: commonDe,
    auth: authDe,
    dashboard: dashboardDe,
    patients: patientsDe,
    appointments: appointmentsEn,
    appointmentRequests: appointmentRequestsEn,
    payments: paymentsDe,
    services: servicesEn,
    settings: settingsEn,
    insurance: insuranceEn,
    validation: validationEn,
    errors: errorsEn,
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'tr',
    supportedLngs: ['en', 'fr', 'tr', 'de'],
    debug: false,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage'],
      caches: ['localStorage'],
    },
    defaultNS: 'common',
  });

export default i18n;
