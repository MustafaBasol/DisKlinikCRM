import express from 'express';
import cors, { CorsOptions } from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';
import prisma from './db.js';
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
import clinicLegalProfileRoutes from './routes/clinicLegalProfile.js';
import publicClinicKvkkRoutes from './routes/publicClinicKvkk.js';
import smsRoutes from './routes/sms.js';
import laboratoriesRoutes from './routes/laboratories.js';
import labOrdersRoutes from './routes/labOrders.js';
import imagingRoutes from './routes/imaging.js';
import imagingBridgePublicRoutes from './routes/imagingBridgePublic.js';
import { startBackgroundJobs } from './jobs/startBackgroundJobs.js';
import { closeRedis } from './utils/redis.js';
import { isEncryptionKeyConfigured } from './utils/encryption.js';
import { getSessionCookieDeploymentWarnings } from './utils/sessionCookies.js';
import { getBearerFallbackWarnings } from './utils/authFallback.js';
import { httpLogger } from './utils/logger.js';

dotenv.config();

// ── Startup validation ────────────────────────────────────────────────────────
if (!isEncryptionKeyConfigured()) {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[FATAL] ENCRYPTION_KEY is not set or invalid. ' +
      'WhatsApp/SMS credentials and webhook secrets cannot be encrypted at rest. ' +
      'Set ENCRYPTION_KEY=<openssl rand -hex 32> and restart.',
    );
    process.exit(1);
  }
  console.warn(
    '[WARN] ENCRYPTION_KEY is not set or invalid. ' +
    'Secret writes (WhatsApp tokens, SMS provider configs, webhook secrets) will fail. ' +
    'Set ENCRYPTION_KEY=<openssl rand -hex 32>.',
  );
}

for (const warning of getSessionCookieDeploymentWarnings()) {
  console.warn(`[WARN] ${warning}`);
}

for (const warning of getBearerFallbackWarnings()) {
  console.warn(`[WARN] ${warning}`);
}

const app = express();
const port = parseInt(process.env.PORT || '5000', 10);
const host = process.env.LISTEN_HOST || '0.0.0.0';
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

// Behind a reverse proxy (nginx) req.ip must come from X-Forwarded-For,
// otherwise every IP-keyed rate limit collapses into the proxy's address.
// TRUST_PROXY accepts a hop count, "true"/"false", or an address/subnet list.
const trustProxyEnv = (process.env.TRUST_PROXY ?? '1').trim();
app.set(
  'trust proxy',
  /^\d+$/.test(trustProxyEnv)
    ? parseInt(trustProxyEnv, 10)
    : trustProxyEnv === 'true' ? true : trustProxyEnv === 'false' ? false : trustProxyEnv,
);

// Yapısal request logging (JSON). Body loglanmaz; auth/cookie başlıkları ve
// URL'deki token parametreleri maskelenir — bkz. utils/logger.ts
app.use(httpLogger);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});
app.use(cors(corsOptions));
// Büyük JSON listeleri (randevu/hasta) gzip ile ~5-10x küçülür; nginx gzip
// yapılandırılmışsa çift sıkıştırma olmaz (Content-Encoding varsa atlanır).
app.use(compression());
app.use(express.json({
  limit: process.env.JSON_BODY_LIMIT || '1mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = Buffer.from(buf);
  },
}));

// Health check (load balancer / uptime monitörü için; auth'suz, detay sızdırmaz).
// DB probe'u 3 sn ile sınırlı — havuz doluysa health endpoint'i askıda kalmasın.
app.get('/api/health', async (_req, res) => {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('db timeout')), 3_000)),
    ]);
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'degraded' });
  }
});

// Unprotected routes
app.use('/api/auth', authRoutes);
app.use('/api/public/whatsapp', whatsappRoutes);
app.use('/api/public', metaWhatsAppWebhookRoutes);
app.use('/api/public', instagramWebhookRoutes);
app.use('/api/public', publicBookingRoutes);
app.use('/api/public', publicClinicKvkkRoutes);
app.use('/api/public', imagingBridgePublicRoutes); // köprü heartbeat — Bearer köprü token'ı ile, kullanıcı oturumu değil

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
app.use('/api', clinicLegalProfileRoutes);
app.use('/api', smsRoutes);
app.use('/api', laboratoriesRoutes);
app.use('/api', labOrdersRoutes);
app.use('/api', imagingRoutes);

// Global error handler — without this, unhandled errors fall through to
// Express's default handler, which writes the stack trace into the response
// whenever NODE_ENV !== 'production'.
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  // Body-parser errors (malformed JSON, payload too large) carry a client status.
  const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status >= 500) console.error('[unhandled-error]', err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : 'Invalid request' });
});

const server = app.listen(port, host, () => {
  console.log(`Server is running on ${host}:${port}`);
  // Cron job'lar ayrı worker sürecine taşınabilir (docs/45 Faz 3 #10):
  // API replikalarında RUN_BACKGROUND_JOBS=false verilir, job'ları yalnızca
  // `npm run start:worker` süreci koşturur. Bayrak ayarlanmazsa tek süreçli
  // kurulumdaki mevcut davranış korunur.
  if (process.env.RUN_BACKGROUND_JOBS !== 'false') {
    startBackgroundJobs();
  } else {
    console.log('[jobs] RUN_BACKGROUND_JOBS=false — background jobs delegated to the worker process.');
  }
});

// Graceful shutdown: deploy/restart sırasında uçuştaki istekler tamamlanır,
// yeni bağlantı kabul edilmez, DB havuzu düzgün kapanır. 10 sn içinde
// bitmezse zorla çıkılır (docs/45 Faz 2 #8).
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received, closing server...`);
  server.close(() => {
    Promise.allSettled([prisma.$disconnect(), closeRedis()]).finally(() => {
      console.log('[shutdown] Clean exit.');
      process.exit(0);
    });
  });
  setTimeout(() => {
    console.error('[shutdown] Forced exit after 10s timeout.');
    process.exit(1);
  }, 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
