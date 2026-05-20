import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { authenticate } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import whatsappRoutes from './routes/whatsapp.js';
import usersRoutes from './routes/users.js';
import dashboardRoutes from './routes/dashboard.js';
import patientsRoutes from './routes/patients.js';
import servicesRoutes from './routes/services.js';
import appointmentRequestsRoutes from './routes/appointmentRequests.js';
import appointmentsRoutes from './routes/appointments.js';
import tasksRoutes from './routes/tasks.js';
import treatmentCasesRoutes from './routes/treatmentCases.js';
import insuranceProvisionsRoutes from './routes/insuranceProvisions.js';
import paymentsRoutes from './routes/payments.js';
import messagesRoutes from './routes/messages.js';
import attachmentsRoutes from './routes/attachments.js';
import notificationsRoutes from './routes/notifications.js';
import dentalChartRoutes from './routes/dentalChart.js';
import reportsRoutes from './routes/reports.js';
import paymentPlansRoutes from './routes/paymentPlans.js';
import compensationRulesRoutes from './routes/compensationRules.js';
import practitionerEarningsRoutes from './routes/practitionerEarnings.js';
import practitionerPayoutsRoutes from './routes/practitionerPayouts.js';
import inventoryRoutes from './routes/inventory.js';
import publicBookingRoutes from './routes/publicBooking.js';
import treatmentPlanProceduresRoutes from './routes/treatmentPlanProcedures.js';
import platformAdminRoutes from './routes/platformAdmin.js';
import clinicRegistrationRoutes from './routes/clinicRegistration.js';
import gdprExportRoutes from './routes/gdprExport.js';
import organizationDashboardRoutes from './routes/organizationDashboard.js';
import { startReminderJobs } from './jobs/reminders.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Unprotected routes
app.use('/api/auth', authRoutes);
app.use('/api/public/whatsapp', whatsappRoutes);
app.use('/api/public', publicBookingRoutes);

// Platform admin routes (kendi JWT'si var, global auth dışında)
app.use('/api/platform', platformAdminRoutes);

// Self-service klinik kaydı (public)
app.use('/api/register', clinicRegistrationRoutes);

// Global auth middleware for all /api routes below
app.use('/api', authenticate as express.RequestHandler);

// Protected routes
app.use('/api', usersRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', patientsRoutes);
app.use('/api', servicesRoutes);
app.use('/api', appointmentRequestsRoutes);
app.use('/api', appointmentsRoutes);
app.use('/api', tasksRoutes);
app.use('/api', treatmentCasesRoutes);
app.use('/api', insuranceProvisionsRoutes);
app.use('/api', paymentsRoutes);
app.use('/api', messagesRoutes);
app.use('/api', attachmentsRoutes);
app.use('/api', notificationsRoutes);
app.use('/api', dentalChartRoutes);
app.use('/api', reportsRoutes);
app.use('/api', paymentPlansRoutes);
app.use('/api', compensationRulesRoutes);
app.use('/api', practitionerEarningsRoutes);
app.use('/api', practitionerPayoutsRoutes);
app.use('/api', inventoryRoutes);
app.use('/api', treatmentPlanProceduresRoutes);
app.use('/api', gdprExportRoutes);
app.use('/api', organizationDashboardRoutes);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  startReminderJobs();
});
