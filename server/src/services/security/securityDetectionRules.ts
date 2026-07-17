/**
 * securityDetectionRules.ts — KVKK-CRIT-003 mandatory detection rules.
 *
 * Thin, route/service-facing wrappers around securitySignalService.ts
 * (raw evidence + windowed counting) and securityIncidentService.ts
 * (deduplicated aggregate). Every exported function here:
 *  - NEVER throws — a detection-rule failure must never break the primary
 *    request (login, clinic access, export) or change an allow/deny
 *    decision that was already made independently of this call;
 *  - is thresholded/aggregated — a single ordinary mistake never creates an
 *    incident by itself (except the two export-integrity signals, which are
 *    rare infra-level failures where even one occurrence is worth surfacing);
 *  - never receives a raw IP, raw email, raw token, or storage path — only
 *    already-hashed/bounded values (see securitySignalService.ts).
 *
 * Rule 1: auth brute-force            → evaluateAuthLoginFailureSignal
 * Rule 2: cross-tenant access         → evaluateCrossTenantDenialSignal
 * Rule 3: clinic export anomaly       → evaluateExportStepUpLockoutSignal,
 *                                        evaluateExportTokenReplaySignal,
 *                                        evaluateExportGenerationIntegritySignal,
 *                                        evaluateExportCleanupFailureSignal,
 *                                        evaluateExportRequestBurstSignal
 */

import {
  recordSecuritySignal,
  countSignalsInWindow,
  hashAccountIdentifier,
  hashResourceId,
  type SecuritySignalSeverity,
} from './securitySignalService.js';
import { upsertIncidentFromSignal } from './securityIncidentService.js';
import prisma from '../../db.js';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function safely(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error('[security-detection] rule evaluation failed:', err instanceof Error ? err.message : String(err));
  }
}

// ── Rule 1: Authentication brute-force suspicion ─────────────────────────

const AUTH_FAILURE_THRESHOLD = () => envInt('SECURITY_ALERT_AUTH_FAILURE_THRESHOLD', 10);
const AUTH_FAILURE_WINDOW_MINUTES = () => envInt('SECURITY_ALERT_AUTH_FAILURE_WINDOW_MINUTES', 15);
const AUTH_FAILURE_CRITICAL_THRESHOLD = () => envInt('SECURITY_ALERT_AUTH_FAILURE_CRITICAL_THRESHOLD', 30);

export interface AuthLoginFailureParams {
  /** Raw account identifier (email) — normalized + HMAC-hashed inside, never stored raw. */
  accountIdentifier: string;
  context: 'clinic' | 'platform';
  organizationId?: string | null;
  clinicId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Rule 1 — repeated failed login attempts for the same normalized account
 * identifier. Threshold/window are env-configurable. Never reveals to the
 * caller whether the account exists — this function is purely an
 * observability side-channel called from the SAME generic-failure branch
 * every login rejection already takes, so its presence changes nothing
 * about the response. Successful login never erases the evidence already
 * recorded here (nothing here is ever deleted on success).
 */
export function evaluateAuthLoginFailureSignal(params: AuthLoginFailureParams): void {
  void safely(async () => {
    const accountHash = hashAccountIdentifier(params.accountIdentifier);
    if (!accountHash) return;
    const ruleKey = 'auth.brute_force.v1';

    await recordSecuritySignal({
      signalType: 'auth_login_failed',
      category: 'auth_brute_force',
      severity: 'low',
      ruleKey,
      dedupeDimension: accountHash,
      organizationId: params.organizationId ?? null,
      clinicId: params.clinicId ?? null,
      ipAddress: params.ip ?? null,
      userAgent: params.userAgent ?? null,
      resourceType: 'account',
      resourceId: accountHash,
      safeMetadata: { context: params.context },
    });

    const windowMs = AUTH_FAILURE_WINDOW_MINUTES() * 60 * 1000;
    const count = await countSignalsInWindow({ ruleKey, dedupeDimension: accountHash, windowMs });
    const threshold = AUTH_FAILURE_THRESHOLD();
    if (count < threshold) return;

    const severity: SecuritySignalSeverity = count >= AUTH_FAILURE_CRITICAL_THRESHOLD() ? 'critical' : 'high';

    await upsertIncidentFromSignal({
      sourceRule: ruleKey,
      sourceType: 'auth_login',
      category: 'auth_brute_force',
      severity: count >= threshold * 2 ? severity : 'medium',
      organizationId: params.organizationId ?? null,
      clinicId: params.clinicId ?? null,
      affectedResourceType: 'account',
      affectedResourceId: accountHash,
      title: `Repeated failed login attempts (${params.context})`,
      summary:
        `${count} failed login attempts for the same account within ${AUTH_FAILURE_WINDOW_MINUTES()} minutes. ` +
        'Account identifier is HMAC-hashed; no plaintext email is stored.',
      metadata: { context: params.context, occurrenceCountAtDetection: count, windowMinutes: AUTH_FAILURE_WINDOW_MINUTES() },
    });
  });
}

// ── Rule 2: Cross-tenant access suspicion ────────────────────────────────

const CROSS_TENANT_THRESHOLD = () => envInt('SECURITY_ALERT_CROSS_TENANT_THRESHOLD', 3);
const CROSS_TENANT_WINDOW_MINUTES = () => envInt('SECURITY_ALERT_CROSS_TENANT_WINDOW_MINUTES', 15);

export interface CrossTenantDenialParams {
  actorUserId: string;
  actorOrganizationId: string;
  actorClinicId?: string | null;
  attemptedResourceType: string; // e.g. "clinic"
  attemptedResourceId: string; // raw — hashed inside, never stored raw
  method: string;
  routeTemplate: string;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Rule 2 — instruments the single shared clinic/organization scope-
 * rejection helper (validateAndGetClinicIdScope / buildClinicScopeWhere),
 * not individual routes. A single accidental denial only ever produces raw
 * evidence (SecuritySignalEvent) — no incident — until the threshold is
 * crossed within the window. Once crossed, probing across MULTIPLE distinct
 * target resources escalates to high (a single repeatedly-mistyped clinicId
 * stays medium).
 */
export function evaluateCrossTenantDenialSignal(params: CrossTenantDenialParams): void {
  void safely(async () => {
    const actorHash = hashAccountIdentifier(params.actorUserId);
    const resourceHash = hashResourceId(params.attemptedResourceId);
    if (!actorHash) return;
    const ruleKey = 'access.cross_tenant.v1';

    await recordSecuritySignal({
      signalType: 'clinic_scope_denied',
      category: 'cross_tenant_access',
      severity: 'low',
      ruleKey,
      dedupeDimension: actorHash,
      organizationId: params.actorOrganizationId,
      clinicId: params.actorClinicId ?? null,
      actorUserId: params.actorUserId,
      ipAddress: params.ip ?? null,
      userAgent: params.userAgent ?? null,
      resourceType: params.attemptedResourceType,
      resourceId: resourceHash,
      safeMetadata: { method: params.method, routeTemplate: params.routeTemplate },
    });

    const windowMs = CROSS_TENANT_WINDOW_MINUTES() * 60 * 1000;
    const count = await countSignalsInWindow({ ruleKey, dedupeDimension: actorHash, windowMs });
    const threshold = CROSS_TENANT_THRESHOLD();
    if (count < threshold) return;

    const distinctResources = await prisma.securitySignalEvent.findMany({
      where: {
        ruleKey,
        dedupeDimension: actorHash,
        createdAt: { gte: new Date(Date.now() - windowMs) },
      },
      distinct: ['resourceId'],
      select: { resourceId: true },
      take: 25,
    });
    const isMultiResourceProbing = distinctResources.length > 1;

    await upsertIncidentFromSignal({
      sourceRule: ruleKey,
      sourceType: 'clinic_scope_denial',
      category: 'cross_tenant_access',
      severity: isMultiResourceProbing ? 'high' : 'medium',
      organizationId: params.actorOrganizationId,
      clinicId: params.actorClinicId ?? null,
      affectedResourceType: 'user',
      affectedResourceId: actorHash,
      title: isMultiResourceProbing ? 'Cross-tenant probing across multiple resources' : 'Repeated cross-tenant access denial',
      summary:
        `${count} denied cross-tenant access attempts within ${CROSS_TENANT_WINDOW_MINUTES()} minutes` +
        (isMultiResourceProbing ? `, across ${distinctResources.length} distinct target resources.` : '.'),
      metadata: {
        occurrenceCountAtDetection: count,
        distinctResourceCount: distinctResources.length,
        windowMinutes: CROSS_TENANT_WINDOW_MINUTES(),
        method: params.method,
        routeTemplate: params.routeTemplate,
      },
    });
  });
}

// ── Rule 3: Sensitive clinic export anomaly ──────────────────────────────

const EXPORT_LOCKOUT_ESCALATE_THRESHOLD = () => envInt('SECURITY_ALERT_EXPORT_LOCKOUT_ESCALATE_THRESHOLD', 3);
const EXPORT_LOCKOUT_WINDOW_MINUTES = () => envInt('SECURITY_ALERT_EXPORT_LOCKOUT_WINDOW_MINUTES', 60);

export interface ExportActorContext {
  organizationId: string;
  clinicId: string;
  actorUserId: string;
  ip?: string | null;
  userAgent?: string | null;
}

/** A step-up brute-force lockout was just reached (see clinicBulkExportPasswordAttempts.ts). Not an "ordinary mistake" — surfaced at medium on first occurrence, escalating if repeated. */
export function evaluateExportStepUpLockoutSignal(ctx: ExportActorContext): void {
  void safely(async () => {
    const actorHash = hashAccountIdentifier(ctx.actorUserId);
    if (!actorHash) return;
    const ruleKey = 'export.step_up_lockout.v1';
    const dedupeDimension = hashResourceId(`${ctx.actorUserId}:${ctx.clinicId}`) ?? actorHash;

    await recordSecuritySignal({
      signalType: 'export_step_up_lockout',
      category: 'export_anomaly',
      severity: 'medium',
      ruleKey,
      dedupeDimension,
      organizationId: ctx.organizationId,
      clinicId: ctx.clinicId,
      actorUserId: ctx.actorUserId,
      ipAddress: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      resourceType: 'clinic',
      resourceId: hashResourceId(ctx.clinicId),
    });

    const windowMs = EXPORT_LOCKOUT_WINDOW_MINUTES() * 60 * 1000;
    const count = await countSignalsInWindow({ ruleKey, dedupeDimension, windowMs });
    const severity: SecuritySignalSeverity = count >= EXPORT_LOCKOUT_ESCALATE_THRESHOLD() ? 'high' : 'medium';

    await upsertIncidentFromSignal({
      sourceRule: ruleKey,
      sourceType: 'clinic_bulk_export',
      category: 'export_anomaly',
      severity,
      organizationId: ctx.organizationId,
      clinicId: ctx.clinicId,
      affectedResourceType: 'clinic',
      affectedResourceId: hashResourceId(ctx.clinicId),
      title: 'Clinic bulk export step-up brute-force lockout',
      summary: `Step-up password brute-force lockout reached ${count} time(s) within ${EXPORT_LOCKOUT_WINDOW_MINUTES()} minutes for this clinic.`,
      metadata: { occurrenceCountAtDetection: count },
    });
  });
}

const EXPORT_REPLAY_THRESHOLD = () => envInt('SECURITY_ALERT_EXPORT_REPLAY_THRESHOLD', 3);
const EXPORT_REPLAY_WINDOW_MINUTES = () => envInt('SECURITY_ALERT_EXPORT_REPLAY_WINDOW_MINUTES', 15);

/** Repeated download-token replay / expired / invalid-token attempts. Never receives the raw or hashed token itself — only actor/clinic scope. */
export function evaluateExportTokenReplaySignal(ctx: ExportActorContext & { reason: 'already_downloaded' | 'expired' | 'invalid' }): void {
  void safely(async () => {
    const actorHash = hashAccountIdentifier(ctx.actorUserId);
    if (!actorHash) return;
    const ruleKey = 'export.token_replay.v1';
    const dedupeDimension = hashResourceId(`${ctx.actorUserId}:${ctx.clinicId}`) ?? actorHash;

    await recordSecuritySignal({
      signalType: 'export_token_replay_suspected',
      category: 'export_anomaly',
      severity: 'low',
      ruleKey,
      dedupeDimension,
      organizationId: ctx.organizationId,
      clinicId: ctx.clinicId,
      actorUserId: ctx.actorUserId,
      ipAddress: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      resourceType: 'clinic',
      resourceId: hashResourceId(ctx.clinicId),
      safeMetadata: { reason: ctx.reason },
    });

    const windowMs = EXPORT_REPLAY_WINDOW_MINUTES() * 60 * 1000;
    const count = await countSignalsInWindow({ ruleKey, dedupeDimension, windowMs });
    const threshold = EXPORT_REPLAY_THRESHOLD();
    if (count < threshold) return;

    await upsertIncidentFromSignal({
      sourceRule: ruleKey,
      sourceType: 'clinic_bulk_export',
      category: 'export_anomaly',
      severity: count >= threshold * 2 ? 'high' : 'medium',
      organizationId: ctx.organizationId,
      clinicId: ctx.clinicId,
      affectedResourceType: 'clinic',
      affectedResourceId: hashResourceId(ctx.clinicId),
      title: 'Repeated clinic export download-token replay/invalid attempts',
      summary: `${count} rejected download-token attempts (replay/expired/invalid) within ${EXPORT_REPLAY_WINDOW_MINUTES()} minutes for this clinic.`,
      metadata: { occurrenceCountAtDetection: count },
    });
  });
}

/** TEMP_STORAGE_UNSAFE and similarly severe generation integrity failures — rare, infra-level, surfaced at high on first occurrence. */
export function evaluateExportGenerationIntegritySignal(params: {
  organizationId: string;
  clinicId: string;
  jobId: string;
  failureCode: string;
}): void {
  void safely(async () => {
    const ruleKey = 'export.generation_integrity.v1';
    const dedupeDimension = hashResourceId(`${params.clinicId}:${params.failureCode}`) ?? params.failureCode;

    await recordSecuritySignal({
      signalType: 'export_generation_integrity_failure',
      category: 'export_anomaly',
      severity: 'high',
      ruleKey,
      dedupeDimension,
      organizationId: params.organizationId,
      clinicId: params.clinicId,
      resourceType: 'clinic_bulk_export_job',
      resourceId: hashResourceId(params.jobId),
      safeMetadata: { failureCode: params.failureCode },
    });

    const windowMs = 60 * 60 * 1000;
    const count = await countSignalsInWindow({ ruleKey, dedupeDimension, windowMs });

    await upsertIncidentFromSignal({
      sourceRule: ruleKey,
      sourceType: 'clinic_bulk_export',
      category: 'export_anomaly',
      severity: count >= 3 ? 'critical' : 'high',
      organizationId: params.organizationId,
      clinicId: params.clinicId,
      affectedResourceType: 'clinic',
      affectedResourceId: hashResourceId(params.clinicId),
      title: 'Clinic export generation integrity failure',
      summary: `Generation failed with a security-relevant integrity code (${params.failureCode}) ${count} time(s) in the last hour.`,
      metadata: { failureCode: params.failureCode, occurrenceCountAtDetection: count },
    });
  });
}

const EXPORT_CLEANUP_PERSISTENT_THRESHOLD = () => envInt('SECURITY_ALERT_EXPORT_CLEANUP_PERSISTENT_THRESHOLD', 3);

/** Artifact storage-deletion keeps failing across retries for the same job — persistent, not a one-off transient error. */
export function evaluateExportCleanupFailureSignal(params: { organizationId: string; clinicId: string; jobId: string }): void {
  void safely(async () => {
    const ruleKey = 'export.cleanup_failure.v1';
    const dedupeDimension = hashResourceId(params.jobId) ?? params.jobId;

    await recordSecuritySignal({
      signalType: 'export_artifact_cleanup_failure',
      category: 'export_anomaly',
      severity: 'medium',
      ruleKey,
      dedupeDimension,
      organizationId: params.organizationId,
      clinicId: params.clinicId,
      resourceType: 'clinic_bulk_export_job',
      resourceId: hashResourceId(params.jobId),
    });

    const count = await countSignalsInWindow({ ruleKey, dedupeDimension, windowMs: 7 * 24 * 60 * 60 * 1000 });
    if (count < EXPORT_CLEANUP_PERSISTENT_THRESHOLD()) return;

    await upsertIncidentFromSignal({
      sourceRule: ruleKey,
      sourceType: 'clinic_bulk_export',
      category: 'export_anomaly',
      severity: 'high',
      organizationId: params.organizationId,
      clinicId: params.clinicId,
      affectedResourceType: 'clinic_bulk_export_job',
      affectedResourceId: hashResourceId(params.jobId),
      title: 'Persistent clinic export artifact cleanup failure',
      summary: `Storage-object deletion for a clinic export artifact has failed ${count} time(s) — a sensitive ZIP may remain in storage longer than intended.`,
      metadata: { occurrenceCountAtDetection: count },
    });
  });
}

const EXPORT_REQUEST_BURST_THRESHOLD = () => envInt('SECURITY_ALERT_EXPORT_REQUEST_BURST_THRESHOLD', 5);
const EXPORT_REQUEST_BURST_WINDOW_MINUTES = () => envInt('SECURITY_ALERT_EXPORT_REQUEST_BURST_WINDOW_MINUTES', 60);

/** Abnormally repeated export requests by the same actor within a bounded period — escalates if they span multiple clinics. */
export function evaluateExportRequestBurstSignal(ctx: ExportActorContext): void {
  void safely(async () => {
    const actorHash = hashAccountIdentifier(ctx.actorUserId);
    if (!actorHash) return;
    const ruleKey = 'export.request_burst.v1';

    await recordSecuritySignal({
      signalType: 'export_request_created',
      category: 'export_anomaly',
      severity: 'low',
      ruleKey,
      dedupeDimension: actorHash,
      organizationId: ctx.organizationId,
      clinicId: ctx.clinicId,
      actorUserId: ctx.actorUserId,
      ipAddress: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      resourceType: 'clinic',
      resourceId: hashResourceId(ctx.clinicId),
    });

    const windowMs = EXPORT_REQUEST_BURST_WINDOW_MINUTES() * 60 * 1000;
    const count = await countSignalsInWindow({ ruleKey, dedupeDimension: actorHash, windowMs });
    const threshold = EXPORT_REQUEST_BURST_THRESHOLD();
    if (count < threshold) return;

    const distinctClinics = await prisma.securitySignalEvent.findMany({
      where: { ruleKey, dedupeDimension: actorHash, createdAt: { gte: new Date(Date.now() - windowMs) } },
      distinct: ['clinicId'],
      select: { clinicId: true },
      take: 25,
    });
    const isMultiClinic = distinctClinics.length > 1;

    await upsertIncidentFromSignal({
      sourceRule: ruleKey,
      sourceType: 'clinic_bulk_export',
      category: 'export_anomaly',
      severity: isMultiClinic ? 'high' : 'medium',
      organizationId: ctx.organizationId,
      clinicId: isMultiClinic ? null : ctx.clinicId,
      affectedResourceType: 'user',
      affectedResourceId: actorHash,
      title: isMultiClinic ? 'Repeated clinic export requests across multiple clinics' : 'Abnormally repeated clinic export requests',
      summary: `${count} clinic bulk export requests by the same user within ${EXPORT_REQUEST_BURST_WINDOW_MINUTES()} minutes` + (isMultiClinic ? `, across ${distinctClinics.length} distinct clinics.` : '.'),
      metadata: { occurrenceCountAtDetection: count, distinctClinicCount: distinctClinics.length },
    });
  });
}
