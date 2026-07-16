/**
 * gdprExport.ts — LEGACY, PERMANENTLY DISABLED (KVKK-HIGH-004).
 *
 * The old GET /api/clinic/export-data endpoint used to run 11 unbounded
 * Promise.all findMany calls synchronously in the request, scoped by
 * req.user.clinicId (a UI default, never a validated authorization scope),
 * with no step-up auth, no rate limit, no feature flag, and a fire-and-
 * forget (unawaited) audit log write. It has been replaced by the
 * asynchronous, tenant-isolated, step-up-authenticated flow in
 * routes/clinicBulkExport.ts (see docs/compliance/54-kvkk-secure-clinic-
 * bulk-export.md).
 *
 * This route is kept mounted ONLY to return a stable, non-sensitive
 * "permanently disabled" response — it must never query clinic/patient/
 * business data, never generate a file, and cannot be reactivated by any
 * query or body parameter. `authenticate` still runs (so we know who hit
 * it, for the audit trail) but `authorize` is intentionally removed since
 * every authenticated user gets the same disabled response regardless of
 * role.
 */

import express, { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { writeAuditLog, extractRequestMeta } from '../utils/auditLog.js';

const router = express.Router();

// authenticate already runs globally for the /api prefix (see index.ts) —
// req.user is populated before this handler runs. No `authorize` here: every
// authenticated role gets the same disabled response.
router.get('/clinic/export-data', (req: AuthRequest, res: Response) => {
  const user = req.user;
  if (user) {
    void writeAuditLog({
      organizationId: user.organizationId,
      clinicId: user.clinicId,
      actorUserId: user.id,
      actorRole: user.role,
      action: 'clinic_bulk_export_legacy_endpoint_attempted',
      entityType: 'clinic',
      entityId: user.clinicId,
      description: 'Legacy GET /api/clinic/export-data attempted (permanently disabled)',
      ...extractRequestMeta(req),
    });
  }

  res.status(410).json({ error: 'CLINIC_BULK_EXPORT_LEGACY_DISABLED' });
});

export default router;
