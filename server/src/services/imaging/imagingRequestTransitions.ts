/**
 * imagingRequestTransitions.ts — ImagingRequest (çekim istemi) durum-akışı
 * kuralları. Route katmanı ve testler tarafından paylaşılır; "geçerli geçiş
 * nedir" tek yerde tanımlanır (labOrderStatusTransitions.ts deseni).
 *
 * Flow: requested -> scheduled -> received. `cancelled` ve `failed` her
 * terminal-olmayan durumdan erişilebilir ve kendileri terminaldir. `received`
 * da terminaldir — bir isteme çalışma (study) bağlandıktan sonra istem
 * yeniden açılmaz.
 */

import { IMAGING_REQUEST_STATUSES } from '../../schemas/index.js';

export type ImagingRequestStatus = (typeof IMAGING_REQUEST_STATUSES)[number];

const TERMINAL_STATUSES: readonly ImagingRequestStatus[] = ['received', 'cancelled', 'failed'];

export const ALLOWED_REQUEST_TRANSITIONS: Record<ImagingRequestStatus, ImagingRequestStatus[]> = {
  requested: ['scheduled', 'received', 'cancelled', 'failed'],
  scheduled: ['received', 'cancelled', 'failed'],
  received: [],
  cancelled: [],
  failed: [],
};

export type RequestTransitionResult =
  | { ok: true }
  | { ok: false; code: 'invalid_transition' | 'already_terminal'; message: string };

export function validateRequestTransition(
  from: ImagingRequestStatus,
  to: ImagingRequestStatus,
): RequestTransitionResult {
  if (TERMINAL_STATUSES.includes(from)) {
    return { ok: false, code: 'already_terminal', message: `Imaging request is already ${from} and cannot change status.` };
  }
  if (!ALLOWED_REQUEST_TRANSITIONS[from]?.includes(to)) {
    return { ok: false, code: 'invalid_transition', message: `Cannot move an imaging request from ${from} to ${to}.` };
  }
  return { ok: true };
}

/** Bir çalışma (study) yalnızca henüz sonuçlanmamış istemlere bağlanabilir. */
export function canAttachStudyToRequest(status: ImagingRequestStatus): boolean {
  return status === 'requested' || status === 'scheduled';
}
