import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import locales
import commonEn from '../locales/en/common.json';
import authEn from '../locales/en/auth.json';
import dashboardEn from '../locales/en/dashboard.json';
import patientsEn from '../locales/en/patients.json';
import usersEn from '../locales/en/users.json';
import appointmentsEn from '../locales/en/appointments.json';
import appointmentRequestsEn from '../locales/en/appointmentRequests.json';
import contactRequestsEn from '../locales/en/contactRequests.json';
import tasksEn from '../locales/en/tasks.json';
import treatmentCasesEn from '../locales/en/treatmentCases.json';
import paymentsEn from '../locales/en/payments.json';
import validationEn from '../locales/en/validation.json';
import errorsEn from '../locales/en/errors.json';
import messagesEn from '../locales/en/messages.json';
import whatsappEn from '../locales/en/whatsapp.json';
import instagramEn from '../locales/en/instagram.json';
import messageTemplatesEn from '../locales/en/messageTemplates.json';
import servicesEn from '../locales/en/services.json';
import settingsEn from '../locales/en/settings.json';
import insuranceEn from '../locales/en/insurance.json';
import bookingEn from '../locales/en/booking.json';
import branchesEn from '../locales/en/branches.json';
import inventoryEn from '../locales/en/inventory.json';
import noShowsEn from '../locales/en/noShows.json';
import labOrdersEn from '../locales/en/labOrders.json';
import imagingEn from '../locales/en/imaging.json';
import recallEn from '../locales/en/recall.json';
import reportsEn from '../locales/en/reports.json';
import earningsEn from '../locales/en/earnings.json';
import platformEn from '../locales/en/platform.json';
import organizationEn from '../locales/en/organization.json';
import landingEn from '../locales/en/landing.json';
import pricingPageEn from '../locales/en/pricingPage.json';
import legalEn from '../locales/en/legal.json';
import postTreatmentEn from '../locales/en/postTreatment.json';
import smsEn from '../locales/en/sms.json';

import commonTr from '../locales/tr/common.json';
import authTr from '../locales/tr/auth.json';
import dashboardTr from '../locales/tr/dashboard.json';
import patientsTr from '../locales/tr/patients.json';
import usersTr from '../locales/tr/users.json';
import appointmentsTr from '../locales/tr/appointments.json';
import appointmentRequestsTr from '../locales/tr/appointmentRequests.json';
import contactRequestsTr from '../locales/tr/contactRequests.json';
import tasksTr from '../locales/tr/tasks.json';
import treatmentCasesTr from '../locales/tr/treatmentCases.json';
import paymentsTr from '../locales/tr/payments.json';
import validationTr from '../locales/tr/validation.json';
import errorsTr from '../locales/tr/errors.json';
import messagesTr from '../locales/tr/messages.json';
import whatsappTr from '../locales/tr/whatsapp.json';
import instagramTr from '../locales/tr/instagram.json';
import messageTemplatesTr from '../locales/tr/messageTemplates.json';
import servicesTr from '../locales/tr/services.json';
import settingsTr from '../locales/tr/settings.json';
import insuranceTr from '../locales/tr/insurance.json';
import bookingTr from '../locales/tr/booking.json';
import branchesTr from '../locales/tr/branches.json';
import inventoryTr from '../locales/tr/inventory.json';
import noShowsTr from '../locales/tr/noShows.json';
import labOrdersTr from '../locales/tr/labOrders.json';
import imagingTr from '../locales/tr/imaging.json';
import recallTr from '../locales/tr/recall.json';
import reportsTr from '../locales/tr/reports.json';
import earningsTr from '../locales/tr/earnings.json';
import platformTr from '../locales/tr/platform.json';
import organizationTr from '../locales/tr/organization.json';
import landingTr from '../locales/tr/landing.json';
import pricingPageTr from '../locales/tr/pricingPage.json';
import legalTr from '../locales/tr/legal.json';
import postTreatmentTr from '../locales/tr/postTreatment.json';
import smsTr from '../locales/tr/sms.json';

import commonFr from '../locales/fr/common.json';
import authFr from '../locales/fr/auth.json';
import dashboardFr from '../locales/fr/dashboard.json';
import patientsFr from '../locales/fr/patients.json';
import usersFr from '../locales/fr/users.json';
import appointmentsFr from '../locales/fr/appointments.json';
import appointmentRequestsFr from '../locales/fr/appointmentRequests.json';
import contactRequestsFr from '../locales/fr/contactRequests.json';
import tasksFr from '../locales/fr/tasks.json';
import treatmentCasesFr from '../locales/fr/treatmentCases.json';
import paymentsFr from '../locales/fr/payments.json';
import validationFr from '../locales/fr/validation.json';
import errorsFr from '../locales/fr/errors.json';
import messagesFr from '../locales/fr/messages.json';
import whatsappFr from '../locales/fr/whatsapp.json';
import instagramFr from '../locales/fr/instagram.json';
import messageTemplatesFr from '../locales/fr/messageTemplates.json';
import servicesFr from '../locales/fr/services.json';
import settingsFr from '../locales/fr/settings.json';
import insuranceFr from '../locales/fr/insurance.json';
import bookingFr from '../locales/fr/booking.json';
import branchesFr from '../locales/fr/branches.json';
import inventoryFr from '../locales/fr/inventory.json';
import noShowsFr from '../locales/fr/noShows.json';
import labOrdersFr from '../locales/fr/labOrders.json';
import imagingFr from '../locales/fr/imaging.json';
import recallFr from '../locales/fr/recall.json';
import reportsFr from '../locales/fr/reports.json';
import earningsFr from '../locales/fr/earnings.json';
import platformFr from '../locales/fr/platform.json';
import organizationFr from '../locales/fr/organization.json';
import landingFr from '../locales/fr/landing.json';
import pricingPageFr from '../locales/fr/pricingPage.json';
import legalFr from '../locales/fr/legal.json';
import postTreatmentFr from '../locales/fr/postTreatment.json';
import smsFr from '../locales/fr/sms.json';

import commonDe from '../locales/de/common.json';
import authDe from '../locales/de/auth.json';
import dashboardDe from '../locales/de/dashboard.json';
import patientsDe from '../locales/de/patients.json';
import usersDe from '../locales/de/users.json';
import appointmentsDe from '../locales/de/appointments.json';
import appointmentRequestsDe from '../locales/de/appointmentRequests.json';
import contactRequestsDe from '../locales/de/contactRequests.json';
import tasksDe from '../locales/de/tasks.json';
import treatmentCasesDe from '../locales/de/treatmentCases.json';
import paymentsDe from '../locales/de/payments.json';
import validationDe from '../locales/de/validation.json';
import errorsDe from '../locales/de/errors.json';
import messagesDe from '../locales/de/messages.json';
import whatsappDe from '../locales/de/whatsapp.json';
import instagramDe from '../locales/de/instagram.json';
import messageTemplatesDe from '../locales/de/messageTemplates.json';
import servicesDe from '../locales/de/services.json';
import settingsDe from '../locales/de/settings.json';
import insuranceDe from '../locales/de/insurance.json';
import bookingDe from '../locales/de/booking.json';
import branchesDe from '../locales/de/branches.json';
import inventoryDe from '../locales/de/inventory.json';
import noShowsDe from '../locales/de/noShows.json';
import labOrdersDe from '../locales/de/labOrders.json';
import imagingDe from '../locales/de/imaging.json';
import recallDe from '../locales/de/recall.json';
import reportsDe from '../locales/de/reports.json';
import earningsDe from '../locales/de/earnings.json';
import platformDe from '../locales/de/platform.json';
import organizationDe from '../locales/de/organization.json';
import landingDe from '../locales/de/landing.json';
import pricingPageDe from '../locales/de/pricingPage.json';
import legalDe from '../locales/de/legal.json';
import postTreatmentDe from '../locales/de/postTreatment.json';
import smsDe from '../locales/de/sms.json';

const namespaces = [
  'common',
  'auth',
  'dashboard',
  'patients',
  'users',
  'appointments',
  'appointmentRequests',
  'contactRequests',
  'tasks',
  'treatmentCases',
  'payments',
  'messages',
  'whatsapp',
  'instagram',
  'messageTemplates',
  'services',
  'settings',
  'insurance',
  'booking',
  'branches',
  'inventory',
  'noShows',
  'labOrders',
  'imaging',
  'recall',
  'reports',
  'earnings',
  'platform',
  'organization',
  'landing',
  'pricingPage',
  'legal',
  'postTreatment',
  'sms',
  'validation',
  'errors',
];

const resources = {
  en: {
    common: commonEn,
    auth: authEn,
    dashboard: dashboardEn,
    patients: patientsEn,
    users: usersEn,
    appointments: appointmentsEn,
    appointmentRequests: appointmentRequestsEn,
    contactRequests: contactRequestsEn,
    tasks: tasksEn,
    treatmentCases: treatmentCasesEn,
    payments: paymentsEn,
    messages: messagesEn,
    whatsapp: whatsappEn,
    instagram: instagramEn,
    messageTemplates: messageTemplatesEn,
    services: servicesEn,
    settings: settingsEn,
    insurance: insuranceEn,
    booking: bookingEn,
    branches: branchesEn,
    inventory: inventoryEn,
    noShows: noShowsEn,
    labOrders: labOrdersEn,
    imaging: imagingEn,
    recall: recallEn,
    reports: reportsEn,
    earnings: earningsEn,
    platform: platformEn,
    organization: organizationEn,
    landing: landingEn,
    pricingPage: pricingPageEn,
    legal: legalEn,
    postTreatment: postTreatmentEn,
    sms: smsEn,
    validation: validationEn,
    errors: errorsEn,
  },
  tr: {
    common: commonTr,
    auth: authTr,
    dashboard: dashboardTr,
    patients: patientsTr,
    users: usersTr,
    appointments: appointmentsTr,
    appointmentRequests: appointmentRequestsTr,
    contactRequests: contactRequestsTr,
    tasks: tasksTr,
    treatmentCases: treatmentCasesTr,
    payments: paymentsTr,
    messages: messagesTr,
    whatsapp: whatsappTr,
    instagram: instagramTr,
    messageTemplates: messageTemplatesTr,
    services: servicesTr,
    settings: settingsTr,
    insurance: insuranceTr,
    booking: bookingTr,
    branches: branchesTr,
    inventory: inventoryTr,
    noShows: noShowsTr,
    labOrders: labOrdersTr,
    imaging: imagingTr,
    recall: recallTr,
    reports: reportsTr,
    earnings: earningsTr,
    platform: platformTr,
    organization: organizationTr,
    landing: landingTr,
    pricingPage: pricingPageTr,
    legal: legalTr,
    postTreatment: postTreatmentTr,
    sms: smsTr,
    validation: validationTr,
    errors: errorsTr,
  },
  fr: {
    common: commonFr,
    auth: authFr,
    dashboard: dashboardFr,
    patients: patientsFr,
    users: usersFr,
    appointments: appointmentsFr,
    appointmentRequests: appointmentRequestsFr,
    contactRequests: contactRequestsFr,
    tasks: tasksFr,
    treatmentCases: treatmentCasesFr,
    payments: paymentsFr,
    messages: messagesFr,
    whatsapp: whatsappFr,
    instagram: instagramFr,
    messageTemplates: messageTemplatesFr,
    services: servicesFr,
    settings: settingsFr,
    insurance: insuranceFr,
    booking: bookingFr,
    branches: branchesFr,
    inventory: inventoryFr,
    noShows: noShowsFr,
    labOrders: labOrdersFr,
    imaging: imagingFr,
    recall: recallFr,
    reports: reportsFr,
    earnings: earningsFr,
    platform: platformFr,
    organization: organizationFr,
    landing: landingFr,
    pricingPage: pricingPageFr,
    legal: legalFr,
    postTreatment: postTreatmentFr,
    sms: smsFr,
    validation: validationFr,
    errors: errorsFr,
  },
  de: {
    common: commonDe,
    auth: authDe,
    dashboard: dashboardDe,
    patients: patientsDe,
    users: usersDe,
    appointments: appointmentsDe,
    appointmentRequests: appointmentRequestsDe,
    contactRequests: contactRequestsDe,
    tasks: tasksDe,
    treatmentCases: treatmentCasesDe,
    payments: paymentsDe,
    messages: messagesDe,
    whatsapp: whatsappDe,
    instagram: instagramDe,
    messageTemplates: messageTemplatesDe,
    services: servicesDe,
    settings: settingsDe,
    insurance: insuranceDe,
    booking: bookingDe,
    branches: branchesDe,
    inventory: inventoryDe,
    noShows: noShowsDe,
    labOrders: labOrdersDe,
    imaging: imagingDe,
    recall: recallDe,
    reports: reportsDe,
    earnings: earningsDe,
    platform: platformDe,
    organization: organizationDe,
    landing: landingDe,
    pricingPage: pricingPageDe,
    legal: legalDe,
    postTreatment: postTreatmentDe,
    sms: smsDe,
    validation: validationDe,
    errors: errorsDe,
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'tr',
    supportedLngs: ['en', 'fr', 'tr', 'de'],
    ns: namespaces,
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

// Keep <html lang> in sync with the active language (SEO/accessibility).
const syncDocumentLanguage = (lng: string) => {
  document.documentElement.setAttribute('lang', lng);
};
syncDocumentLanguage(i18n.resolvedLanguage || i18n.language || 'tr');
i18n.on('languageChanged', syncDocumentLanguage);

export default i18n;
