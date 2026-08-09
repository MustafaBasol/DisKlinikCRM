/**
 * imagingRequestServiceContract.typecheck.ts — F2-CT-32-R2-R1 compile-time
 * regression coverage for imagingService.updateRequest/cancelRequest's
 * expectedStatus precondition (see api.ts's ImagingRequestUpdateData and
 * docs/program/evidence/F2-CT-32-R2-R1_*.md for the full rationale).
 *
 * This file proves, at compile time only, that:
 *   - a call omitting expectedStatus does NOT typecheck (guarded by
 *     `@ts-expect-error`; if the call stopped being an error, tsc itself
 *     fails the build with "Unused '@ts-expect-error' directive")
 *   - a call supplying expectedStatus DOES typecheck
 *
 * Deliberately NOT a `tsx`-runnable `.test.ts`: api.ts reads
 * `import.meta.env` at module load time, which only Vite/vitest provide —
 * every other plain `tsx`-executed test in this repo avoids importing
 * services/api.ts for the same reason. This file is never imported or
 * executed anywhere; its functions are declared and exported only so the
 * TypeScript compiler retains and checks their bodies. Coverage comes
 * entirely from `tsc -b` / `npm run build`, which already includes all of
 * `src` (tsconfig.json's `include`) — no new script or test framework
 * needed.
 */

import { imagingService } from '../api';

// Valid calls — must typecheck cleanly (no @ts-expect-error above these).
export function assertValidCallsTypecheck() {
  imagingService.updateRequest('req-1', { expectedStatus: 'requested' });
  imagingService.updateRequest('req-1', { expectedStatus: 'requested', status: 'scheduled', notes: 'ok' });
  imagingService.cancelRequest('req-1', 'scheduled');
}

// Invalid calls — each must fail to typecheck, proving expectedStatus is
// enforced at the type level for every first-party caller.
export function assertOmittedExpectedStatusFailsTypecheck() {
  // @ts-expect-error — updateRequest's data must include expectedStatus
  imagingService.updateRequest('req-1', { status: 'scheduled' });

  // @ts-expect-error — updateRequest's data must include expectedStatus
  imagingService.updateRequest('req-1', {});

  // @ts-expect-error — cancelRequest requires expectedStatus as its 2nd arg
  imagingService.cancelRequest('req-1');

  // @ts-expect-error — expectedStatus must be a valid ImagingRequestStatus literal
  imagingService.cancelRequest('req-1', 'not-a-real-status');

  // @ts-expect-error — expectedStatus must be a valid ImagingRequestStatus literal
  imagingService.updateRequest('req-1', { expectedStatus: 'not-a-real-status' });
}
