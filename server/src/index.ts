import express from 'express';
import cors, { CorsOptions } from 'cors';
import dotenv from 'dotenv';
import { authenticate } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import authRoutes from './routes/auth.js';
import whatsappRoutes from './routes/whatsapp.js';
import usersRoutes from './routes/users.js';
import dashboardRoutes from './routes/dashboard.js';
import patientsRoutes from './routes/patients.js';
import servicesRoutes from './routes/services.js';
import appointmentRequestsRoutes from './routes/appointmentRequests.js';
import contactRequestsRoutes from './routes/contactRequests.js';
import appointmentsRoutes from './routes/appointments.js';
import tasksRoutes from './routes/tasks.js';
import treatmentCasesRoutes from './routes/treatmentCases.js';
import treatmentPackagesRoutes from './routes/treatmentPackages.js';
import insuranceProvisionsRoutes from './routes/insuranceProvisions.js';
import paymentsRoutes from './routes/payments.js';
import messagesRoutes from './routes/messages.js';
import attachmentsRoutes from './routes/attachments.js';
import notificationsRoutes from './routes/notifications.js';
import settingsRoutes from './routes/settings.js';
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
import organizationBranchesRoutes from './routes/organizationBranches.js';
import organizationWhatsAppRoutes from './routes/organizationWhatsApp.js';
import whatsappInboxRoutes from './routes/whatsappInbox.js';
import organizationInstagramRoutes from './routes/organizationInstagram.js';
import instagramInboxRoutes from './routes/instagramInbox.js';
import financeDashboardRoutes from './routes/financeDashboard.js';
import schedulesRoutes from './routes/schedules.js';
import operationalMonitoringRoutes from './routes/operationalMonitoring.js';
import metaWhatsAppWebhookRoutes from './routes/metaWhatsAppWebhook.js';
import instagramWebhookRoutes from './routes/instagramWebhook.js';
import noShowsRoutes from './routes/noShows.js';
import recallRoutes from './routes/recall.js';
import patientsImportRoutes from './routes/patientsImport.js';
import usersImportRoutes from './routes/usersImport.js';
import postTreatmentRoutes from './routes/postTreatment.js';
import patientPrivacyRoutes from './routes/patientPrivacy.js';
import billingRoutes from './routes/billing.js';
import stripeWebhookRoutes from './routes/stripeWebhook.js';
import { startReminderJobs } from './jobs/reminders.js';
import { startMetaTemplateSyncJob } from './jobs/metaTemplateSyncJob.js';
import { startDataRetentionCleanupJob } from './jobs/dataRetentionCleanupJob.js';
import { isEncryptionKeyConfigured } from './utils/encryption.js';
import { getSessionCookieDeploymentWarnings } from './utils/sessionCookies.js';
import { getBearerFallbackWarnings } from './utils/authFallback.js';

dotenv.config();

// ── Startup validation ────────────────────────────────────────────────────────
if (!isEncryptionKeyConfigured()) {
  console.warn(
    '[WARN] ENCRYPTION_KEY is not set or invalid. ' +
    'WhatsApp API keys will be stored unencrypted. ' +
    'Set ENCRYPTION_KEY=<openssl rand -hex 32> before going to production.',
  );
}

for (const warning of getSessionCookieDeploymentWarnings()) {
  console.warn(`[WARN] ${warning}`);
}

for (const warning of getBearerFallbackWarnings()) {
  console.warn(`[WARN] ${warning}`);
}

const app = express();
const port = process.env.PORT || 5000;
const configuredCorsOrigins = (process.env.CORS_ORIGIN || process.env.CORS_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const allowedCorsOrigins = configuredCorsOrigins.filter(origin => origin !== '*');

if (configuredCorsOrigins.includes('*')) {
  console.warn('[WARN] CORS wildcard origin is not allowed for credentialed session-cookie auth. Configure explicit origins.');
}

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedCorsOrigins.length === 0) {
      return callback(null, process.env.NODE_ENV !== 'production');
    }
    return callback(null, allowedCorsOrigins.includes(origin));
  },
  credentials: true,
};

app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(cors(corsOptions));
app.use(express.json({
  limit: process.env.JSON_BODY_LIMIT || '1mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = Buffer.from(buf);
  },
}));

// Unprotected routes
app.use('/api/auth', authRoutes);
app.use('/api/public/whatsapp', whatsappRoutes);
app.use('/api/public', metaWhatsAppWebhookRoutes);
app.use('/api/public', instagramWebhookRoutes);
app.use('/api/public', publicBookingRoutes);
// Stripe webhook: no user auth, Stripe signature verification is the security layer
app.use('/api', stripeWebhookRoutes);

// Platform admin routes (kendi JWT'si var, global auth dışında)
app.use('/api/platform', platformAdminRoutes);

// Self-service klinik kaydı (public)
app.use('/api/register', clinicRegistrationRoutes);

// Global auth middleware for all /api routes below
app.use('/api', authenticate as express.RequestHandler);
app.use('/api', csrfProtection('clinic'));

// Protected routes
app.use('/api', patientsImportRoutes);
app.use('/api', usersImportRoutes);
app.use('/api', usersRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', patientsRoutes);
app.use('/api', servicesRoutes);
app.use('/api', appointmentRequestsRoutes);
app.use('/api', contactRequestsRoutes);
app.use('/api', appointmentsRoutes);
app.use('/api', tasksRoutes);
app.use('/api', treatmentCasesRoutes);
app.use('/api', treatmentPackagesRoutes);
app.use('/api', insuranceProvisionsRoutes);
app.use('/api', paymentsRoutes);
app.use('/api', messagesRoutes);
app.use('/api', attachmentsRoutes);
app.use('/api', notificationsRoutes);
app.use('/api', settingsRoutes);
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
app.use('/api', organizationBranchesRoutes);
app.use('/api', organizationWhatsAppRoutes);
app.use('/api', whatsappInboxRoutes);
app.use('/api', organizationInstagramRoutes);
app.use('/api', instagramInboxRoutes);
app.use('/api', financeDashboardRoutes);
app.use('/api', schedulesRoutes);
app.use('/api', operationalMonitoringRoutes);
app.use('/api', noShowsRoutes);
app.use('/api', recallRoutes);
app.use('/api', usersImportRoutes);
app.use('/api', postTreatmentRoutes);
app.use('/api', patientPrivacyRoutes);
app.use('/api', billingRoutes);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  startReminderJobs();
  startMetaTemplateSyncJob();
  startDataRetentionCleanupJob();
});
