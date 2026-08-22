/**
 * messagingReliability.ts — F5-3R. The operator HTTP contract over the F5-3
 * messaging reliability services.
 *
 *   GET  /api/ops/messaging/reliability/metrics          — organization-scoped health
 *   GET  /api/ops/messaging/reliability/dead             — paginated DLQ
 *   POST /api/ops/messaging/reliability/dead/:id/replay  — audited replay
 *
 * WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT
 * -------------------------------------------------
 * F5-3 shipped DLQ inspection, metrics and replay as SERVICES with no HTTP
 * surface, and recorded that as deliberate scope control: "role authorization
 * for replay is therefore undecided by design — that contract is its own
 * reviewable change." This file is that change, and nothing more. The services
 * are called, not rewritten; their refusal vocabulary is mapped to status
 * codes, not reinterpreted.
 *
 * It adds **no** outbox surface. F5-2's `replayDeadOutboxEvent` is a different
 * domain with a different replay semantic (a new event with causation, versus
 * reusing the row because the provider's message id IS the identity), and
 * exposing it through a messaging route would collapse two lifecycles that were
 * deliberately kept apart. An outbox operator route, if wanted, is its own task.
 *
 * THE AUTHORIZATION MODEL, IN ONE PLACE
 * -------------------------------------
 * Every handler derives its scope from `req.user` and NOTHING else:
 *
 *   organizationId  <- req.user.organizationId          (never the body/query)
 *   clinicScope     <- canonical role + allowedClinicIds
 *   actor           <- req.user.id / req.user.role
 *
 * A request body that tries to name a tenant is REFUSED rather than silently
 * ignored (§ `assertNoTenantOverride`). Silent ignoring is safe today and
 * becomes unsafe the moment someone adds `...req.body` to a service call; a
 * refusal is a test that keeps failing until the mistake is removed.
 *
 * WHY CROSS-ORGANIZATION IS 404 AND CROSS-CLINIC IS 403
 * ----------------------------------------------------
 * They are genuinely different disclosures, and collapsing them loses
 * information an operator needs.
 *
 *   - Another organization's event id must be indistinguishable from a
 *     nonexistent one, or the endpoint is an id oracle across tenants. The
 *     service already returns `NOT_FOUND` for both; this route keeps that.
 *   - A SIBLING CLINIC inside the caller's own organization is different: the
 *     caller already knows their organization has other clinics, so `403
 *     CROSS_CLINIC_REFUSED` discloses nothing new — and it tells a clinic
 *     manager to escalate to an org admin rather than open a bug saying the
 *     event vanished. Turning that into a 404 would trade a real operational
 *     signal for a confidentiality gain that does not exist.
 */

import express, { Response } from 'express';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { normalizeRole, canViewMessagingReliability, canReplayMessagingInboundEvent } from '../utils/roles.js';
import {
  listDeadInboundEventPage,
  getOrganizationMessagingMetrics,
  MESSAGING_DLQ_MAX_PAGE_SIZE,
  MESSAGING_DLQ_DEFAULT_PAGE_SIZE,
  type MessagingClinicScope,
} from '../messaging/messagingInboundDlq.js';
import {
  replayDeadInboundEvent,
  MAX_INBOUND_REPLAYS_PER_EVENT,
  type MessagingReplayRefusal,
} from '../messaging/messagingInboundReplay.js';
import { safeErrorFields } from '../utils/safeError.js';

const router = express.Router();

/** The three roles the accepted runbook role table names as operators. */
const OPERATOR_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'];

// ─── Scope derivation ────────────────────────────────────────────────────────

/**
 * Build the caller's clinic reach from the session.
 *
 * OWNER/ORG_ADMIN reach every clinic in their own organization — the same rule
 * `operationalMonitoring.ts`'s `getAllowedClinicFilter` already applies to
 * audit logs, so the two operator surfaces cannot disagree about what an org
 * admin can see.
 *
 * Everyone else is EXPLICIT over `allowedClinicIds`. **An empty list reaches
 * nothing**, which is the correct fail-closed reading and is asserted by test:
 * `[]` never means "all" anywhere in this repository, and this is one of the
 * places where getting it backwards would be a cross-clinic disclosure.
 */
function deriveClinicScope(user: NonNullable<AuthRequest['user']>): MessagingClinicScope {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  if (role === 'OWNER' || role === 'ORG_ADMIN') return { kind: 'ORGANIZATION_WIDE' };
  return { kind: 'EXPLICIT', clinicIds: user.allowedClinicIds ?? [] };
}

function isClinicRequestable(clinicId: string, scope: MessagingClinicScope): boolean {
  if (scope.kind === 'ORGANIZATION_WIDE') return true;
  return scope.clinicIds.includes(clinicId);
}

/**
 * Fields that describe WHOSE data this is. The authoritative row already holds
 * every one of them, so a request that supplies one is either confused or
 * probing — and in both cases the right answer is to stop, not to quietly drop
 * it and carry on.
 */
const TENANT_OVERRIDE_FIELDS = [
  'organizationId',
  'organization_id',
  'clinicId',
  'clinic_id',
  'provider',
  'channel',
  'connectionId',
  'connection_id',
  'providerMessageId',
  'rawPayload',
  'payload',
  'status',
  'attempts',
  'replayCount',
] as const;

function findTenantOverride(body: unknown): string | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body as Record<string, unknown>);
  for (const field of TENANT_OVERRIDE_FIELDS) {
    if (keys.includes(field)) return field;
  }
  return null;
}

function parseIntParam(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const parsed = Number(String(raw));
  return Number.isFinite(parsed) ? parsed : undefined;
}

// ─── GET /api/ops/messaging/reliability/metrics ──────────────────────────────

/**
 * Organization-scoped reliability snapshot. Counts, two ages, failure codes and
 * a channel/provider breakdown — no per-clinic, per-connection or per-message
 * dimension, and no message content of any kind.
 *
 * This is NOT the platform-wide metric. That one lives on the platform-admin
 * router and answers a different question ("is messaging healthy everywhere"),
 * which a tenant must not be able to ask.
 */
router.get(
  '/ops/messaging/reliability/metrics',
  authorize(OPERATOR_ROLES),
  async (req: AuthRequest, res: Response) => {
    if (!canViewMessagingReliability(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    }

    try {
      const metrics = await getOrganizationMessagingMetrics({
        organizationId: req.user!.organizationId,
        scope: deriveClinicScope(req.user!),
      });
      return res.json(metrics);
    } catch (err: unknown) {
      console.error('[messaging-reliability] metrics failed', safeErrorFields(err));
      return res.status(500).json({ error: 'Failed to load messaging reliability metrics', code: 'INTERNAL_ERROR' });
    }
  },
);

// ─── GET /api/ops/messaging/reliability/dead ─────────────────────────────────

router.get(
  '/ops/messaging/reliability/dead',
  authorize(OPERATOR_ROLES),
  async (req: AuthRequest, res: Response) => {
    if (!canViewMessagingReliability(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    }

    const scope = deriveClinicScope(req.user!);

    // A requested clinic is validated against the scope and REFUSED, not
    // quietly intersected away. "I asked for clinic X and got an empty list"
    // is indistinguishable from "clinic X has no dead events", and an operator
    // debugging a missing message deserves to be told which one it is.
    const requestedClinicId = req.query['clinicId'] ? String(req.query['clinicId']) : null;
    if (requestedClinicId && !isClinicRequestable(requestedClinicId, scope)) {
      return res.status(403).json({ error: 'Access denied to requested clinic', code: 'CROSS_CLINIC_REFUSED' });
    }

    try {
      const page = await listDeadInboundEventPage({
        organizationId: req.user!.organizationId,
        scope,
        clinicId: requestedClinicId,
        channel: req.query['channel'] ? String(req.query['channel']) : undefined,
        provider: req.query['provider'] ? String(req.query['provider']) : undefined,
        page: parseIntParam(req.query['page']),
        pageSize: parseIntParam(req.query['limit']),
      });

      return res.json({
        ...page,
        maxPageSize: MESSAGING_DLQ_MAX_PAGE_SIZE,
        defaultPageSize: MESSAGING_DLQ_DEFAULT_PAGE_SIZE,
      });
    } catch (err: unknown) {
      console.error('[messaging-reliability] dead listing failed', safeErrorFields(err));
      return res.status(500).json({ error: 'Failed to list dead messaging events', code: 'INTERNAL_ERROR' });
    }
  },
);

// ─── POST /api/ops/messaging/reliability/dead/:id/replay ─────────────────────

/**
 * HTTP status for each service refusal.
 *
 * Every code is stable and is returned in the body as well as implied by the
 * status, because a client that has to parse prose to tell `NOT_TERMINAL` from
 * `ALREADY_PROCESSED` will eventually get it wrong.
 */
const REPLAY_REFUSAL_STATUS: Readonly<Record<MessagingReplayRefusal, number>> = Object.freeze({
  // Cross-ORGANIZATION and genuinely-absent are indistinguishable on purpose.
  NOT_FOUND: 404,
  // Cross-CLINIC inside the caller's own organization. See the module docstring.
  CROSS_CLINIC_REFUSED: 403,
  // State conflicts: the row exists and is visible, it just is not replayable now.
  NOT_TERMINAL: 409,
  ALREADY_PROCESSED: 409,
  REPLAY_LIMIT_EXCEEDED: 409,
  // Capability conflicts: replaying would provably do nothing.
  NO_REDELIVERY_HANDLER: 422,
  UNROUTABLE: 422,
  NO_STORED_PAYLOAD: 422,
});

router.post(
  '/ops/messaging/reliability/dead/:id/replay',
  authorize(OPERATOR_ROLES),
  async (req: AuthRequest, res: Response) => {
    if (!canReplayMessagingInboundEvent(req.user!)) {
      return res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    }

    const override = findTenantOverride(req.body);
    if (override) {
      return res.status(400).json({
        error: `Field "${override}" is not accepted: replay re-drives the stored event exactly as it arrived.`,
        code: 'TENANT_FIELDS_NOT_ACCEPTED',
      });
    }

    const eventId = String(req.params['id'] ?? '');
    if (!eventId) {
      return res.status(400).json({ error: 'Event id is required', code: 'INVALID_REQUEST' });
    }

    try {
      const result = await replayDeadInboundEvent({
        eventId,
        authorization: {
          organizationId: req.user!.organizationId,
          clinicScope: deriveClinicScope(req.user!),
          actorUserId: req.user!.id,
          actorRole: req.user!.role,
        },
      });

      if (!result.ok) {
        const status = REPLAY_REFUSAL_STATUS[result.refusal] ?? 400;
        return res.status(status).json({ error: 'Replay refused', code: result.refusal });
      }

      return res.json({
        eventId: result.eventId,
        replayCount: result.replayCount,
        maxReplays: MAX_INBOUND_REPLAYS_PER_EVENT,
      });
    } catch (err: unknown) {
      console.error('[messaging-reliability] replay failed', safeErrorFields(err));
      return res.status(500).json({ error: 'Failed to replay messaging event', code: 'INTERNAL_ERROR' });
    }
  },
);

export default router;
