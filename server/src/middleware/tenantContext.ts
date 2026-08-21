/**
 * tenantContext.ts (middleware) — F3-2 request-boundary integration.
 *
 * Establishes the ambient tenant execution context for everything downstream of
 * `authenticate`, so that Layer 2 (`tenancy/prismaTenantGuard.ts`) has an answer
 * to "whose request is this?" without any route being edited.
 *
 * WHERE THE IDENTITY COMES FROM — AND WHERE IT DOES NOT
 * ----------------------------------------------------
 * Every field is copied from `req.user`, which `middleware/auth.ts` builds from
 * a verified session and a fresh database read of the User row: organization,
 * active clinic assignments and `canAccessAllClinics` are all server-derived.
 * Nothing here reads a header, a query parameter or a body field. The
 * `X-Clinic-Id` header and `?clinicId=` that `clinicAccess.ts` accepts are
 * deliberately IGNORED: they select a VIEW within the user's authorized set and
 * are validated by Layer 1 on every use, so letting them narrow — or widen —
 * the guard's boundary would put a client-supplied value on the security path.
 *
 * WHY `canAccessAllClinics` BECOMES `ORGANIZATION_WIDE` RATHER THAN A LIST
 * -----------------------------------------------------------------------
 * For an OWNER/ORG_ADMIN, `allowedClinicIds` holds only the clinics they are
 * explicitly assigned to, which is routinely a subset (often empty) of the
 * clinics they may actually see — `clinicScope.ts` resolves the real set from
 * the database on demand. Copying `allowedClinicIds` here would silently
 * under-scope those users and break org-wide dashboards; enumerating the
 * clinics eagerly would add a query to every request. `ORGANIZATION_WIDE` says
 * exactly what is true, and the guard resolves the set once, lazily, only if a
 * clinic-only model is actually touched.
 *
 * BEHAVIOURALLY INERT TODAY. Establishing a context filters nothing: no Prisma
 * extension is installed on `db.ts` (see prismaTenantGuard.ts's header for why
 * that is a freeze boundary, not an oversight). This middleware exists so that
 * request-boundary propagation and concurrency isolation are proven now, on the
 * real Express stack, rather than assumed at rollout time.
 */

import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.js';
import { runAsTenant, type TenantClinicScope } from '../tenancy/tenantContext.js';

/**
 * Mount AFTER `authenticate`. Requests that arrive without `req.user` (there
 * are none below the global `authenticate` mount, but the middleware must not
 * assume its own mount point) pass through with no context — which the guard
 * treats as a refusal for tenant-owned models, not as permission.
 */
export function tenantContextMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const user = req.user;
  if (!user) {
    next();
    return;
  }

  const clinicScope: TenantClinicScope = user.canAccessAllClinics
    ? { kind: 'ORGANIZATION_WIDE' }
    : { kind: 'EXPLICIT', clinicIds: [...user.allowedClinicIds] };

  try {
    // `next()` runs synchronously inside the AsyncLocalStorage run, so every
    // downstream handler — and every promise chain it starts — inherits the
    // store. Two concurrent requests get two distinct stores; that isolation is
    // asserted directly in tests/tenantContext.test.ts.
    void runAsTenant(
      {
        organizationId: user.organizationId,
        clinicScope,
        actor: { kind: 'USER', id: user.id, sessionId: user.sessionId },
        correlationId: req.id === undefined ? undefined : String(req.id),
      },
      async () => {
        next();
      },
    ).catch(next);
  } catch (err) {
    // runAsTenant validates its input synchronously; a malformed context is an
    // engineering defect and belongs in the Express error path, not swallowed.
    next(err);
  }
}
