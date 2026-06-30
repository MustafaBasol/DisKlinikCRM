import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PlatformAuthProvider, usePlatformAuth } from './context/PlatformAuthContext';
import { ClinicProvider } from './context/ClinicContext';
import { ClinicPreferencesProvider } from './context/ClinicPreferencesContext';

import { useTranslation } from 'react-i18next';

const MainLayout = React.lazy(() => import('./layouts/MainLayout'));
const PlatformAdminLayout = React.lazy(() => import('./layouts/PlatformAdminLayout'));
const GlobalSearch = React.lazy(() => import('./components/GlobalSearch'));

const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Patients = React.lazy(() => import('./pages/Patients'));
const PatientDetail = React.lazy(() => import('./pages/PatientDetail'));
const Appointments = React.lazy(() => import('./pages/Appointments'));
const AppointmentRequests = React.lazy(() => import('./pages/AppointmentRequests'));
const AppointmentDetail = React.lazy(() => import('./pages/AppointmentDetail'));
const Tasks = React.lazy(() => import('./pages/Tasks'));
const TreatmentCases = React.lazy(() => import('./pages/TreatmentCases'));
const TreatmentCaseDetail = React.lazy(() => import('./pages/TreatmentCaseDetail'));
const Payments = React.lazy(() => import('./pages/Payments'));
const InsuranceProvisions = React.lazy(() => import('./pages/InsuranceProvisions'));
const InsuranceProvisionDetail = React.lazy(() => import('./pages/InsuranceProvisionDetail'));
const Messages = React.lazy(() => import('./pages/Messages'));
const MessageTemplates = React.lazy(() => import('./pages/MessageTemplates'));
const Settings = React.lazy(() => import('./pages/Settings'));
const Login = React.lazy(() => import('./pages/Login'));
const Register = React.lazy(() => import('./pages/Register'));
const ForgotPassword = React.lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = React.lazy(() => import('./pages/ResetPassword'));
const VerifyEmail = React.lazy(() => import('./pages/VerifyEmail'));
const ResendVerification = React.lazy(() => import('./pages/ResendVerification'));
const PlatformLogin = React.lazy(() => import('./pages/platform/PlatformLogin'));
const PlatformDashboard = React.lazy(() => import('./pages/platform/PlatformDashboard'));
const PlatformOrganizations = React.lazy(() => import('./pages/platform/PlatformOrganizations'));
const PlatformClinics = React.lazy(() => import('./pages/platform/PlatformClinics'));
const PlatformUsers = React.lazy(() => import('./pages/platform/PlatformUsers'));
const PlatformPlans = React.lazy(() => import('./pages/platform/PlatformPlans'));
const PlatformSystem = React.lazy(() => import('./pages/platform/PlatformSystem'));
const PlatformPrivacy = React.lazy(() => import('./pages/platform/PlatformPrivacy'));
const PlatformBackups = React.lazy(() => import('./pages/platform/PlatformBackups'));
const BookingWidget = React.lazy(() => import('./pages/BookingWidget'));
const Reports = React.lazy(() => import('./pages/Reports'));
const PaymentPlans = React.lazy(() => import('./pages/PaymentPlans'));
const PractitionerEarnings = React.lazy(() => import('./pages/PractitionerEarnings'));
const MyEarnings = React.lazy(() => import('./pages/MyEarnings'));
const Inventory = React.lazy(() => import('./pages/Inventory'));
const OrganizationDashboard = React.lazy(() => import('./pages/OrganizationDashboard'));
const Branches = React.lazy(() => import('./pages/Branches'));
const ClinicSchedule = React.lazy(() => import('./pages/ClinicSchedule'));
const WhatsAppConnections = React.lazy(() => import('./pages/WhatsAppConnections'));
const WhatsAppInbox = React.lazy(() => import('./pages/WhatsAppInbox'));
const ContactRequests = React.lazy(() => import('./pages/ContactRequests'));
const InstagramConnections = React.lazy(() => import('./pages/InstagramConnections'));
const InstagramInbox = React.lazy(() => import('./pages/InstagramInbox'));
const FinanceDashboard = React.lazy(() => import('./pages/FinanceDashboard'));
const Operations = React.lazy(() => import('./pages/Operations'));
const Users = React.lazy(() => import('./pages/Users'));
const MetaCallbackPage = React.lazy(() => import('./pages/MetaCallbackPage'));
const NoShows = React.lazy(() => import('./pages/NoShows'));
const RecallDashboard = React.lazy(() => import('./pages/RecallDashboard'));
const LandingPage = React.lazy(() => import('./pages/LandingPage'));
const LegalCenterPage = React.lazy(() => import('./pages/legal/LegalCenterPage'));
const PrivacyNoticePage = React.lazy(() => import('./pages/legal/PrivacyNoticePage'));
const CookiePolicyPage = React.lazy(() => import('./pages/legal/CookiePolicyPage'));
const CommunicationsNoticePage = React.lazy(() => import('./pages/legal/CommunicationsNoticePage'));
const DataSubjectRequestPage = React.lazy(() => import('./pages/legal/DataSubjectRequestPage'));
const ConsentTemplatePage = React.lazy(() => import('./pages/legal/ConsentTemplatePage'));
const ClinicKvkkPublicPage = React.lazy(() => import('./pages/clinic/ClinicKvkkPublicPage'));

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
  </div>
);

const ProtectedRoute = () => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
};

const PlatformRoute = () => {
  const { isAuthenticated, isLoading } = usePlatformAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  return isAuthenticated ? <Outlet /> : <Navigate to="/platform/login" replace />;
};

const ToastContainer = () => {
  const { t } = useTranslation('common');
  const [showToast, setShowToast] = React.useState(false);

  React.useEffect(() => {
    const handleExpired = () => {
      setShowToast(true);
      setTimeout(() => setShowToast(false), 5000);
    };
    window.addEventListener('auth:expired', handleExpired);
    return () => window.removeEventListener('auth:expired', handleExpired);
  }, []);

  if (!showToast) return null;

  return (
    <div className="fixed top-4 right-4 z-50 animate-fade-in-down">
      <div className="bg-red-50 dark:bg-red-900/50 text-red-600 dark:text-red-200 px-4 py-3 rounded-lg shadow-lg border border-red-100 dark:border-red-800 flex items-center gap-3">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        <span className="font-medium">{t('auth.sessionExpired', 'Your session has expired. Please log in again.')}</span>
      </div>
    </div>
  );
};

const ProductApplication: React.FC = () => {
  const [searchOpen, setSearchOpen] = React.useState(false);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <AuthProvider>
      <PlatformAuthProvider>
        <ClinicProvider>
          <ClinicPreferencesProvider>
          <ToastContainer />
          {searchOpen && (
            <React.Suspense fallback={null}>
              <GlobalSearch isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
            </React.Suspense>
          )}
          <React.Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/resend-verification" element={<ResendVerification />} />
            <Route path="/platform/login" element={<PlatformLogin />} />
            <Route path="/book/:clinicId" element={<BookingWidget />} />
            {/* Public Meta OAuth redirect handler — must be outside ProtectedRoute */}
            <Route path="/auth/meta/callback" element={<MetaCallbackPage />} />

            {/* Platform admin area — separate auth */}
            <Route element={<PlatformRoute />}>
              <Route path="/platform" element={<PlatformAdminLayout />}>
                <Route index element={<PlatformDashboard />} />
                <Route path="organizations" element={<PlatformOrganizations />} />
                <Route path="clinics" element={<PlatformClinics />} />
                <Route path="users" element={<PlatformUsers />} />
                <Route path="plans" element={<PlatformPlans />} />
                <Route path="system" element={<PlatformSystem />} />
                <Route path="privacy" element={<PlatformPrivacy />} />
                <Route path="backups" element={<PlatformBackups />} />
              </Route>
            </Route>

            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<MainLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="patients" element={<Patients />} />
              <Route path="patients/:id" element={<PatientDetail />} />
              <Route path="appointments" element={<Appointments />} />
              <Route path="appointment-requests" element={<AppointmentRequests />} />
              <Route path="appointments/:id" element={<AppointmentDetail />} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="treatment-cases" element={<TreatmentCases />} />
              <Route path="treatment-cases/:id" element={<TreatmentCaseDetail />} />
              <Route path="payments" element={<Payments />} />
              <Route path="insurance-provisions" element={<InsuranceProvisions />} />
              <Route path="insurance-provisions/:id" element={<InsuranceProvisionDetail />} />
              <Route path="messages" element={<Messages />} />
              <Route path="templates" element={<MessageTemplates />} />
              <Route path="settings" element={<Settings />} />
              <Route path="reports" element={<Reports />} />
              <Route path="payment-plans" element={<PaymentPlans />} />
              <Route path="practitioner-earnings" element={<PractitionerEarnings />} />
              <Route path="my-earnings" element={<MyEarnings />} />
              <Route path="inventory" element={<Inventory />} />
              <Route path="organization/dashboard" element={<OrganizationDashboard />} />
              <Route path="branches" element={<Branches />} />
              <Route path="branches/:clinicId/schedule" element={<ClinicSchedule />} />
              <Route path="organization/whatsapp" element={<WhatsAppConnections />} />
              <Route path="whatsapp-inbox" element={<WhatsAppInbox />} />
              <Route path="contact-requests" element={<ContactRequests />} />
              <Route path="organization/instagram" element={<InstagramConnections />} />
              <Route path="instagram-inbox" element={<InstagramInbox />} />
              <Route path="finance" element={<FinanceDashboard />} />
              <Route path="operations" element={<Operations />} />
              <Route path="users" element={<Users />} />
              <Route path="no-shows" element={<NoShows />} />
              <Route path="recall" element={<RecallDashboard />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Route>
            </Route>
          </Routes>
          </React.Suspense>
          </ClinicPreferencesProvider>
        </ClinicProvider>
      </PlatformAuthProvider>
    </AuthProvider>
  );
};

const App: React.FC = () => (
  <Router>
    <React.Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/landing" element={<LandingPage />} />
      <Route path="/legal" element={<LegalCenterPage />} />
      <Route path="/legal/privacy" element={<PrivacyNoticePage />} />
      <Route path="/legal/cookies" element={<CookiePolicyPage />} />
      <Route path="/legal/communications" element={<CommunicationsNoticePage />} />
      <Route path="/legal/data-subject-request" element={<DataSubjectRequestPage />} />
      <Route path="/legal/consent" element={<ConsentTemplatePage />} />
      <Route path="/c/:clinicSlug/kvkk" element={<ClinicKvkkPublicPage />} />
      <Route path="*" element={<ProductApplication />} />
    </Routes>
    </React.Suspense>
  </Router>
);

export default App;
