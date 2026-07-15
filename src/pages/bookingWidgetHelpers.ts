/**
 * bookingWidgetHelpers.ts
 *
 * Pure, unit-testable helpers extracted from BookingWidget.tsx for the
 * public-booking stale-slot / SLOT_UNAVAILABLE recovery flow. Kept free of
 * React state so they can be tested with plain node:assert (no DOM/RTL
 * dependency exists in this repo — see src/components/imaging/__tests__/*
 * for the same pattern).
 */

export interface PublicSlot {
  practitionerId: string;
  startTime: string; // ISO, UTC instant
  endTime: string;
  localStartTime: string; // "HH:MM" in clinic timezone
  localEndTime: string;
}

export interface SelectableTime {
  localStartTime: string;
  practitionerId: string;
}

type RawObject = Record<string, unknown>;

function isRawObject(value: unknown): value is RawObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeSlot(raw: unknown): PublicSlot | null {
  if (!isRawObject(raw)) return null;
  const practitionerId = readString(raw.practitionerId);
  const startTime = readString(raw.startTime);
  const endTime = readString(raw.endTime);
  const localStartTime = readString(raw.localStartTime);
  const localEndTime = readString(raw.localEndTime);
  if (!practitionerId || !startTime || !endTime || !localStartTime || !localEndTime) return null;
  return { practitionerId, startTime, endTime, localStartTime, localEndTime };
}

/** Parses the GET /booking/:clinicId/slots response body into typed slots. */
export function normalizePublicSlots(payload: unknown): PublicSlot[] {
  const response = isRawObject(payload) && isRawObject(payload.data) ? payload.data : payload;
  const raw = isRawObject(response) && Array.isArray(response.slots) ? response.slots : [];
  return raw.map(normalizeSlot).filter((slot): slot is PublicSlot => slot !== null);
}

/**
 * Deduplicated, sorted list of selectable times for the given doctor filter
 * (empty string = "any doctor" — all practitioners' slots are candidates).
 *
 * When multiple practitioners share the same local time in "any doctor"
 * mode, exactly one concrete (practitionerId, localStartTime) tuple is
 * chosen to represent that time button. The tie-break is deterministic and
 * explicit — lowest `practitionerId` wins — rather than depending on
 * whatever order the slots happened to arrive in from the backend. This
 * value is what actually gets submitted, so it must never be ambiguous.
 */
export function selectableTimesForDoctor(slots: PublicSlot[], doctorId: string): SelectableTime[] {
  const filtered = doctorId ? slots.filter((s) => s.practitionerId === doctorId) : slots;
  const seen = new Map<string, string>();
  for (const slot of filtered) {
    const current = seen.get(slot.localStartTime);
    if (current === undefined || slot.practitionerId < current) {
      seen.set(slot.localStartTime, slot.practitionerId);
    }
  }
  return Array.from(seen.entries())
    .map(([localStartTime, practitionerId]) => ({ localStartTime, practitionerId }))
    .sort((a, b) => a.localStartTime.localeCompare(b.localStartTime));
}

/** Removes exactly the rejected (practitionerId, localStartTime) slot — leaves all other slots, including other times for the same practitioner, untouched. */
export function removeStaleSlot(
  slots: PublicSlot[],
  rejected: { practitionerId: string; localStartTime: string },
): PublicSlot[] {
  return slots.filter(
    (slot) => !(slot.practitionerId === rejected.practitionerId && slot.localStartTime === rejected.localStartTime),
  );
}

/**
 * True only if the exact (practitionerId, localStartTime) tuple currently
 * selected by the customer is still present in a freshly fetched slot list.
 * Used after every availability refresh to decide whether to keep the
 * selection — the practitioner bound to a selection must never silently
 * change to a different practitioner; if the exact tuple is gone, the
 * selection is cleared instead so the customer picks again explicitly.
 */
export function isSelectedSlotStillOffered(
  slots: PublicSlot[],
  selection: { practitionerId: string; localStartTime: string },
): boolean {
  return slots.some(
    (slot) => slot.practitionerId === selection.practitionerId && slot.localStartTime === selection.localStartTime,
  );
}

/** True only for the specific 409 SLOT_UNAVAILABLE shape the public booking submit endpoint returns — never matches INVALID_NOTICE_EVIDENCE or other 409s. */
export function isSlotUnavailableError(err: unknown): boolean {
  const response = (err as { response?: { status?: number; data?: unknown } } | undefined)?.response;
  if (!response || response.status !== 409) return false;
  const data = response.data;
  return isRawObject(data) && data.code === 'SLOT_UNAVAILABLE';
}
