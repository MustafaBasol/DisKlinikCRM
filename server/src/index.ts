import express from 'express';
import cors, { CorsOptions } from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';
import prisma from './db.js';
import { authenticate } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { tenantContextMiddleware } from './middleware/tenantContext.js';
import authRoutes from './routes/auth.js';
import whatsappRoutes from './routes/whatsapp.js';
import usersRoutes from './routes/users.js';
import dashboardRoutes from './routes/dashboard.js';
import patientsRoutes from './routes/patients.js';
import patientIdentityRoutes from './routes/patientIdentity.js';
import patientEmergencyContactsRoutes from './routes/patientEmergencyContacts.js';
import patientContactPointsRoutes from './routes/patientContactPoints.js';
import patientMedicalHistoryRoutes from './routes/patientMedicalHistory.js';
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
import reportExportRoutes from './routes/reportExport.js';
import paymentPlansRoutes from './routes/paymentPlans.js';
import compensationRulesRoutes from './routes/compensationRules.js';
import practitionerEarningsRoutes from './routes/practitionerEarnings.js';
import practitionerPayoutsRoutes from './routes/practitionerPayouts.js';
import inventoryRoutes from './routes/inventory.js';
import inventoryUnitsRoutes from './routes/inventoryUnits.js';
import publicBookingRoutes from './routes/publicBooking.js';
import treatmentPlanProceduresRoutes from './routes/treatmentPlanProcedures.js';
import platformAdminRoutes from './routes/platformAdmin.js';
import platformSecurityIncidentsRoutes from './routes/platformSecurityIncidents.js';
import platformExternalCalendarRoutes from './routes/platformExternalCalendar.js';
import platformMigrationRoutes from './routes/platformMigration.js';
import platformWhatsAppRoutes from './routes/platformWhatsApp.js';
import externalCalendarOutboundSyncStatusRoutes from './routes/externalCalendarOutboundSyncStatus.js';
import clinicRegistrationRoutes from './routes/clinicRegistration.js';
import gdprExportRoutes from './routes/gdprExport.js';
import clinicBulkExportRoutes from './routes/clinicBulkExport.js';
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
import communicationPreferencesRoutes from './routes/communicationPreferences.js';
import laboratoriesRoutes from './routes/laboratories.js';
import labOrdersRoutes from './routes/labOrders.js';
import imagingRoutes from './routes/imaging.js';
import imagingBridgePublicRoutes from './routes/imagingBridgePublic.js';
import externalCalendarWebhookRoutes from './routes/externalCalendarWebhook.js';
import { startBackgroundJobs } from './jobs/startBackgroundJobs.js';
import { closeRedis } from './utils/redis.js';
import { isEncryptionKeyConfigured } from './utils/encryption.js';
import { getSessionCookieDeploymentWarnings } from './utils/sessionCookies.js';
import { getBearerFallbackWarnings } from './utils/authFallback.js';
import { httpLogger, logUnhandledError, logger, safeRoute } from './utils/logger.js';
import { attachRequestIdHeader } from './middleware/requestId.js';
import { resolveApiBackgroundJobsOwnership } from './utils/backgroundJobsOwnership.js';
import { assertProcessRole } from './utils/processRole.js';
import { buildHealthRouter } from './routes/health.js';
import { getRedis } from './utils/redis.js';
import { installFatalErrorHandlers } from './utils/fatalErrorHandlers.js';
import { captureFatalError } from './utils/errorTracking.js';
import { validateImagingS3Config } from './services/imagingRemoteStorage.js';

dotenv.config();

// ── Startup validation ────────────────────────────────────────────────────────
// F3-IMPL-002: fails closed (throws) if NORAMEDI_PROCESS_ROLE is explicitly
// set to something other than "api" — see utils/processRole.ts. Unset is
// fine (pre-existing single-process/dev/test shape, unchanged).
const processRole = assertProcessRole('api');

// F3-OBS-001: an uncaught exception or unhandled rejection previously crashed
// this process with Node's default (unstructured, uncorrelated) handler —
// see utils/fatalErrorHandlers.ts for why this always exits(1) rather than
// trying to keep serving requests.
installFatalErrorHandlers({ processLabel: 'api', logger });

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

// F4-IMAGING-001 Finding C: validate the imaging storage backend selection and
// its IMAGING_S3_* configuration HERE, at boot, not lazily on first use.
// validateImagingS3Config() returns immediately unless an operator has
// explicitly set IMAGING_STORAGE_BACKEND=vps2, so with the flag unset (current
// production default) this is a no-op and startup is unchanged. When the flag
// IS set, a typo'd backend name or a missing bucket/endpoint must stop the
// process here rather than surfacing as a 500 on the first imaging request
// hours later, with imaging silently unavailable in between. Same fail-closed
// shape as the ENCRYPTION_KEY check above: fatal in production, warn otherwise
// so local/dev work is not blocked.
try {
  validateImagingS3Config();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (process.env.NODE_ENV === 'production') {
    console.error(`[FATAL] Imaging storage configuration is invalid: ${message}`);
    process.exit(1);
  }
  console.warn(`[WARN] Imaging storage configuration is invalid: ${message}`);
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
app.use(attachRequestIdHeader);
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

// F3-OBS-001: minimum production health-signal surface (GET /api/livez,
// GET /api/readyz) alongside the /api/health block above, which stays
// byte-for-byte unchanged — see routes/health.ts for why these are
// separate endpoints rather than a change to /api/health itself.
app.use(
  '/api',
  buildHealthRouter({
    processRole: processRole.role,
    checkDatabase: () => prisma.$queryRaw`SELECT 1`,
    checkRedis: getRedis() ? () => getRedis()!.ping() : null,
  }),
);

// Unprotected routes
app.use('/api/auth', authRoutes);
app.use('/api/public/whatsapp', whatsappRoutes);
app.use('/api/public', metaWhatsAppWebhookRoutes);
app.use('/api/public', instagramWebhookRoutes);
app.use('/api/public', publicBookingRoutes);
app.use('/api/public', publicClinicKvkkRoutes);
app.use('/api/public', imagingBridgePublicRoutes); // köprü heartbeat — Bearer köprü token'ı ile, kullanıcı oturumu değil
app.use('/api/public', externalCalendarWebhookRoutes);

// Platform admin routes (kendi JWT'si var, global auth dışında)
app.use('/api/platform', platformAdminRoutes);
// KVKK-CRIT-003 security incident foundation — own authenticatePlatformAdmin
// gate, kept in a separate file/router from platformAdmin.ts's already-large
// route surface.
app.use('/api/platform', platformSecurityIncidentsRoutes);
// External calendar integration (DigiDentiS + future providers) — own
// authenticatePlatformAdmin gate, kept separate for the same reason.
app.use('/api/platform', platformExternalCalendarRoutes);
// F3-DATA-MIG-TODAY-001 — Platform Admin clinic data migration. Own
// authenticatePlatformAdmin + csrfProtection('platform') gate, mounted here
// (BEFORE the global clinic `authenticate` below) so a clinic session can
// never reach it. Entirely separate from the clinic-facing basic patient
// importer at /api/patients/import-*, which is unchanged.
app.use('/api/platform', platformMigrationRoutes);
// F3-WA-META-COEX-002B — the platform's own (NoraMedi-owned) Meta Cloud API
// WhatsApp connection. Own authenticatePlatformAdmin + csrfProtection('platform')
// gate, kept separate for the same reason as the routers above. Entirely
// distinct from organizationWhatsAppRoutes below (tenant-owned WhatsAppConnection) —
// see routes/platformWhatsApp.ts for the tenant-isolation contract.
app.use('/api/platform', platformWhatsAppRoutes);

// Self-service klinik kaydı (public)
app.use('/api/register', clinicRegistrationRoutes);

// Global auth middleware for all /api routes below
app.use('/api', authenticate as express.RequestHandler);
// F3-2 Layer 2: establish the tenant execution context from the just-verified
// req.user. Behaviourally inert on its own — it filters nothing; see
// middleware/tenantContext.ts and tenancy/prismaTenantGuard.ts.
app.use('/api', tenantContextMiddleware as express.RequestHandler);
app.use('/api', csrfProtection('clinic'));

// Protected routes
app.use('/api', patientsImportRoutes);
app.use('/api', usersImportRoutes);
app.use('/api', usersRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', patientsRoutes);
app.use('/api', patientIdentityRoutes);
app.use('/api', patientEmergencyContactsRoutes);
app.use('/api', patientContactPointsRoutes);
app.use('/api', patientMedicalHistoryRoutes);
app.use('/api', servicesRoutes);
app.use('/api', appointmentRequestsRoutes);
app.use('/api', contactRequestsRoutes);
app.use('/api', appointmentsRoutes);
app.use('/api', externalCalendarOutboundSyncStatusRoutes);
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
app.use('/api', reportExportRoutes);
app.use('/api', paymentPlansRoutes);
app.use('/api', compensationRulesRoutes);
app.use('/api', practitionerEarningsRoutes);
app.use('/api', practitionerPayoutsRoutes);
app.use('/api', inventoryRoutes);
app.use('/api', inventoryUnitsRoutes);
app.use('/api', treatmentPlanProceduresRoutes);
app.use('/api', gdprExportRoutes);
app.use('/api', clinicBulkExportRoutes);
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
app.use('/api', communicationPreferencesRoutes);
app.use('/api', laboratoriesRoutes);
app.use('/api', labOrdersRoutes);
app.use('/api', imagingRoutes);

// Global error handler — without this, unhandled errors fall through to
// Express's default handler, which writes the stack trace into the response
// whenever NODE_ENV !== 'production'.
// Logging goes through logUnhandledError (structured, sanitized — see
// utils/logger.ts), never a raw console.error(err): the raw error can carry
// request-derived values (ids, tokens, emails) in err.message or custom
// properties, and this handler is on the same production-reachable HTTP
// path the rest of this file's logging was hardened for.
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  // Body-parser errors (malformed JSON, payload too large) carry a client status.
  const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status >= 500) {
    logUnhandledError(req, status, err);
    // Fire-and-forget: never let error-tracking delivery delay or fail the
    // client response — see utils/errorTracking.ts (no-op unless SENTRY_DSN
    // is set, never throws).
    void captureFatalError(err, { requestId: req.id !== undefined ? String(req.id) : undefined, role: 'api', route: safeRoute(req) });
  }
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : 'Invalid request' });
});

const server = app.listen(port, host, () => {
  console.log(`Server is running on ${host}:${port}`);
  // Cron job'lar ayrı worker sürecine taşınabilir (docs/45 Faz 3 #10):
  // API replikalarında RUN_BACKGROUND_JOBS=false verilir, job'ları yalnızca
  // `npm run start:worker` süreci koşturur. Bayrak ayarlanmazsa tek süreçli
  // kurulumdaki mevcut davranış korunur.
  //
  // The decision itself is always logged (not just the opt-out branch) so an
  // operator can grep production startup logs and positively confirm which
  // mode this process is in — see utils/backgroundJobsOwnership.ts for why
  // the underlying default is intentionally unchanged.
  const jobsOwnership = resolveApiBackgroundJobsOwnership();
  console.log(
    `[jobs] API background-jobs ownership: role=api (declared=${processRole.declared}) ` +
      `ownsJobs=${jobsOwnership.ownsJobs} (${jobsOwnership.reason})`,
  );
  if (jobsOwnership.ownsJobs) {
    startBackgroundJobs();
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
