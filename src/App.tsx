import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import MainLayout from './layouts/MainLayout';
import GlobalSearch from './components/GlobalSearch';
import Dashboard from './pages/Dashboard';
import Patients from './pages/Patients';
import PatientDetail from './pages/PatientDetail';
import Appointments from './pages/Appointments';
import AppointmentRequests from './pages/AppointmentRequests';
import AppointmentDetail from './pages/AppointmentDetail';
import Tasks from './pages/Tasks';
import TreatmentCases from './pages/TreatmentCases';
import TreatmentCaseDetail from './pages/TreatmentCaseDetail';
import Payments from './pages/Payments';
import InsuranceProvisions from './pages/InsuranceProvisions';
import InsuranceProvisionDetail from './pages/InsuranceProvisionDetail';
import Messages from './pages/Messages';
import MessageTemplates from './pages/MessageTemplates';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Register from './pages/Register';
import PlatformAdmin from './pages/PlatformAdmin';
import BookingWidget from './pages/BookingWidget';
import Reports from './pages/Reports';
import PaymentPlans from './pages/PaymentPlans';
import PractitionerEarnings from './pages/PractitionerEarnings';
import MyEarnings from './pages/MyEarnings';
import Inventory from './pages/Inventory';
import OrganizationDashboard from './pages/OrganizationDashboard';
import Branches from './pages/Branches';
import ClinicSchedule from './pages/ClinicSchedule';
import WhatsAppConnections from './pages/WhatsAppConnections';
import WhatsAppInbox from './pages/WhatsAppInbox';
import FinanceDashboard from './pages/FinanceDashboard';
import Operations from './pages/Operations';

import { useTranslation } from 'react-i18next';

const ProtectedRoute = () => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
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

const App: React.FC = () => {
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
      <Router>
        <ToastContainer />
        <GlobalSearch isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/platform" element={<PlatformAdmin />} />
          <Route path="/book/:clinicId" element={<BookingWidget />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<MainLayout />}>
              <Route index element={<Dashboard />} />
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
              <Route path="finance" element={<FinanceDashboard />} />
              <Route path="operations" element={<Operations />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  );
};

export default App;
