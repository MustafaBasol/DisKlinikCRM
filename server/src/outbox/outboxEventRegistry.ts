/**
 * outboxEventRegistry.ts — F5-2 versioned event contract registry.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * An outbox whose producer may write any string as `eventType` and any JSON as
 * `payload` is not an event system; it is a durable `console.log` with retries.
 * Three specific things go wrong, and this repository has already paid for two
 * of them elsewhere:
 *
 *   1. NOBODY KNOWS WHAT A CONSUMER MAY RELY ON. A producer adds a field, a
 *      consumer starts reading it, a third caller publishes the same event
 *      without it, and the failure surfaces as a retry loop in a background job
 *      at 03:00 rather than as a type error at build time.
 *   2. A BREAKING PAYLOAD CHANGE IS INVISIBLE. Rows written by yesterday's code
 *      are still sitting in `pending` when today's code deploys. Without a
 *      version, the new consumer silently misreads them; with a version, it
 *      refuses them loudly and they are inspectable. ADR-006 records "versioned
 *      events and idempotent consumers" as an ALREADY-BINDING invariant,
 *      independent of the ADR's own status.
 *   3. PHI LEAKS INTO AN OPERATIONAL TABLE. `OutboxEvent.payload` is read by
 *      operators inspecting a backlog and is retained until a retention sweep
 *      removes it. F5-1P experiment E20 proved a per-contract field allowlist
 *      catches a `patientName`/`tcKimlik` payload in BOTH directions — rejected
 *      at publish, and dead-lettered rather than retried at consume.
 *
 * THE CONTRACT
 * ------------
 * A durable event exists only if it is registered here, as an exact
 * (eventType, eventVersion) pair. The registry states, per version:
 * who produces it, who consumes it, which payload fields are permitted, how
 * tenant ownership works, how business idempotency is derived, how many
 * attempts it gets, and what its retention/privacy class is.
 *
 * VERSIONING RULE
 * ---------------
 * A BREAKING payload change (removing a field, changing a field's meaning or
 * type, making an optional field required) is a NEW VERSION. Both versions then
 * live here until every row of the old one has drained, and both need a
 * consumer. A purely additive OPTIONAL field may stay on the same version only
 * when every registered consumer provably ignores unknown-but-allowed fields —
 * which is why `payloadFields` distinguishes required from optional rather than
 * being one flat list.
 *
 * WHAT THIS FILE IS NOT
 * ---------------------
 * It holds no consumer implementations (see `outboxConsumerRegistry.ts`) and it
 * performs no I/O. Infrastructure owns storage, claiming, retry and metrics;
 * DOMAINS own what an event MEANS. This file is the seam between the two, and
 * it is deliberately data plus pure validators so a drift test can hold it to
 * the code without a database.
 */

/**
 * How the event's tenant identity is established. Mirrors the vocabulary of
 * `utils/tenantModelClassification.ts` on purpose — an event's ownership must
 * be describable in the same terms as a row's.
 */
export type OutboxEventTenancy =
  /** Belongs to exactly one clinic; `clinicId` is required on the row. */
  | 'CLINIC_OWNED'
  /** Belongs to an organization but to no single clinic; `clinicId` is null. */
  | 'ORGANIZATION_OWNED';

/**
 * How long the row (and therefore its payload) may live. Consumed by the
 * retention design; F5-2 records the class, it does not implement the sweep.
 */
export type OutboxRetentionClass =
  /** Identifiers only, no special category data. Ordinary operational retention. */
  | 'OPERATIONAL_IDENTIFIERS'
  /**
   * The payload references a health-related interaction (an appointment), even
   * though it carries only identifiers. Retention must not exceed the retention
   * of the record it points at.
   */
  | 'HEALTH_ADJACENT_IDENTIFIERS';

export interface OutboxPayloadContract {
  /** Fields that MUST be present. Missing one is MALFORMED_PAYLOAD. */
  readonly required: readonly string[];
  /** Fields that MAY be present. Anything outside required+optional is refused. */
  readonly optional: readonly string[];
}

export interface OutboxEventContract {
  readonly eventType: string;
  readonly eventVersion: number;
  /** One line: what fact this event asserts. */
  readonly description: string;
  /** Module that is allowed to publish it. Recorded for boundary review. */
  readonly producer: string;
  /** Registered consumer key that handles it. Must resolve in outboxConsumerRegistry.ts. */
  readonly consumerKey: string;
  readonly tenancy: OutboxEventTenancy;
  readonly aggregateType: string;
  readonly payload: OutboxPayloadContract;
  /**
   * How the business idempotency key is derived, in prose, so a reviewer can
   * check that two publishes of the same real-world fact produce the same key.
   * The derivation itself lives with the producer.
   */
  readonly idempotency: string;
  /**
   * What a duplicate delivery must do. Every registered contract must be able
   * to answer this — it is the whole reason at-least-once delivery is
   * acceptable.
   */
  readonly duplicateBehavior: string;
  /** Bounded attempts before the row is dead-lettered as MAX_ATTEMPTS_EXCEEDED. */
  readonly maxAttempts: number;
  readonly retention: OutboxRetentionClass;
}

/**
 * Field names that must never appear in ANY outbox payload, whatever a contract
 * declares. A second, contract-independent net: a future contract author cannot
 * widen their own allowlist into PHI, because this check runs first and fails
 * the registry's own self-test at module load.
 *
 * Matching is case-insensitive and substring-based on purpose — `patientName`,
 * `patient_name` and `PatientNameSurname` are all the same mistake.
 */
export const FORBIDDEN_PAYLOAD_FIELD_FRAGMENTS: readonly string[] = Object.freeze([
  'name',
  'phone',
  'email',
  'tckimlik',
  'tckn',
  'identity',
  'address',
  'note',
  'body',
  'text',
  'message',
  'content',
  'token',
  'secret',
  'credential',
  'password',
  'birth',
  'diagnos',
  'treatment',
]);

/**
 * THE REGISTRY.
 *
 * One entry per (eventType, eventVersion). F5-2 deliberately registers ONE
 * contract: the narrow first integration selected on repository evidence (see
 * the F5-2 evidence document). Registering speculative contracts to demonstrate
 * the infrastructure would be exactly the "authorization to migrate every
 * cron/job" that ADR-006's acceptance conditions refuse.
 */
export const OUTBOX_EVENT_CONTRACTS: readonly OutboxEventContract[] = Object.freeze([
  {
    eventType: 'appointment_request.confirmation_requested',
    eventVersion: 1,
    description:
      'A staff member converted an AppointmentRequest into an Appointment, and the patient is owed ' +
      'a confirmation message on the channel the request arrived from.',
    producer: 'routes/appointmentRequests.ts (conversion transaction)',
    consumerKey: 'appointment-request-confirmation',
    tenancy: 'CLINIC_OWNED',
    aggregateType: 'AppointmentRequest',
    payload: Object.freeze({
      // Identifiers only. Everything the consumer needs to render the message
      // is re-read from durable state at dispatch time, which is also what
      // makes a replay days later produce a correct message rather than a
      // stale one.
      required: Object.freeze(['appointmentRequestId', 'appointmentId']),
      optional: Object.freeze([]),
    }),
    idempotency:
      'appointment-request-confirmation:<appointmentId>. An Appointment is created exactly once per ' +
      'converted request (enforced by the conversion transaction advisory lock and ' +
      'AppointmentRequest.status), so the appointment id is a stable one-per-real-world-fact key. ' +
      'A replay reuses the SAME key, which is what makes replay safe.',
    duplicateBehavior:
      'Suppressed. The consumer records an OutboxConsumerExecution keyed on the idempotency key ' +
      'BEFORE sending; a duplicate delivery observes `completed` and performs no send.',
    maxAttempts: 5,
    retention: 'HEALTH_ADJACENT_IDENTIFIERS',
  },
] as const);

// ─────────────────────────────────────────────────────────────────────────────
// Lookups + validation. Pure; no I/O.
// ─────────────────────────────────────────────────────────────────────────────

function contractKey(eventType: string, eventVersion: number): string {
  return `${eventType}@${eventVersion}`;
}

const CONTRACTS_BY_KEY: ReadonlyMap<string, OutboxEventContract> = new Map(
  OUTBOX_EVENT_CONTRACTS.map((c) => [contractKey(c.eventType, c.eventVersion), c]),
);

const VERSIONS_BY_TYPE: ReadonlyMap<string, readonly number[]> = (() => {
  const acc = new Map<string, number[]>();
  for (const c of OUTBOX_EVENT_CONTRACTS) {
    const list = acc.get(c.eventType) ?? [];
    list.push(c.eventVersion);
    acc.set(c.eventType, list);
  }
  for (const [k, v] of acc) acc.set(k, Object.freeze([...v].sort((a, b) => a - b)) as number[]);
  return acc;
})();

export function getOutboxEventContract(
  eventType: string,
  eventVersion: number,
): OutboxEventContract | undefined {
  return CONTRACTS_BY_KEY.get(contractKey(eventType, eventVersion));
}

export function isRegisteredEventType(eventType: string): boolean {
  return VERSIONS_BY_TYPE.has(eventType);
}

export function getRegisteredVersions(eventType: string): readonly number[] {
  return VERSIONS_BY_TYPE.get(eventType) ?? [];
}

/**
 * Why a contract lookup or a payload failed. Returned rather than thrown so the
 * dispatcher can turn it into a dead-letter code without a try/catch dance, and
 * so the producer can throw a typed error with the same vocabulary.
 */
export type OutboxContractViolation =
  | { readonly kind: 'UNREGISTERED_EVENT'; readonly eventType: string }
  | {
      readonly kind: 'UNSUPPORTED_VERSION';
      readonly eventType: string;
      readonly eventVersion: number;
      readonly registeredVersions: readonly number[];
    }
  | {
      readonly kind: 'MALFORMED_PAYLOAD';
      readonly eventType: string;
      readonly eventVersion: number;
      /** Field NAMES only — never values. This string reaches logs. */
      readonly reason: string;
    };

export function resolveContract(
  eventType: string,
  eventVersion: number,
): { ok: true; contract: OutboxEventContract } | { ok: false; violation: OutboxContractViolation } {
  const contract = getOutboxEventContract(eventType, eventVersion);
  if (contract) return { ok: true, contract };
  if (!isRegisteredEventType(eventType)) {
    return { ok: false, violation: { kind: 'UNREGISTERED_EVENT', eventType } };
  }
  return {
    ok: false,
    violation: {
      kind: 'UNSUPPORTED_VERSION',
      eventType,
      eventVersion,
      registeredVersions: getRegisteredVersions(eventType),
    },
  };
}

/**
 * Validate a payload against its contract.
 *
 * Enforced at BOTH ends deliberately (F5-1P E20): at publish, so a bad payload
 * never reaches the table; and at dispatch, so a row written by an older
 * application version — or by a direct database write — is dead-lettered rather
 * than handed to a consumer that would then be reasoning about PHI it should
 * never have received.
 *
 * `reason` never contains a VALUE, only field names, because it is persisted
 * and logged.
 */
export function validatePayload(
  contract: OutboxEventContract,
  payload: unknown,
): { ok: true } | { ok: false; violation: OutboxContractViolation } {
  const fail = (reason: string): { ok: false; violation: OutboxContractViolation } => ({
    ok: false,
    violation: {
      kind: 'MALFORMED_PAYLOAD',
      eventType: contract.eventType,
      eventVersion: contract.eventVersion,
      reason,
    },
  });

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail('payload must be a plain object');
  }

  const keys = Object.keys(payload as Record<string, unknown>);
  const allowed = new Set<string>([...contract.payload.required, ...contract.payload.optional]);

  const unexpected = keys.filter((k) => !allowed.has(k));
  if (unexpected.length > 0) {
    return fail(`unexpected field(s): ${unexpected.sort().join(', ')}`);
  }

  const missing = contract.payload.required.filter((k) => !keys.includes(k));
  if (missing.length > 0) {
    return fail(`missing required field(s): ${missing.sort().join(', ')}`);
  }

  // Identifier-shaped values only. A contract that one day needs a number or a
  // boolean must widen this deliberately; today, allowing arbitrary nested
  // objects is exactly how a whole patient record ends up in the table.
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string') return fail(`field ${key} must be a string identifier`);
    if (value.length === 0) return fail(`field ${key} must not be empty`);
    if (value.length > 200) return fail(`field ${key} exceeds the identifier length limit`);
  }

  return { ok: true };
}

/**
 * Self-test, run once at module load.
 *
 * The registry is the thing that is supposed to make PHI in a payload
 * impossible, so it must not be possible to write a registry entry that permits
 * it. Failing at import — rather than in a test that someone might not run — is
 * deliberate: a process that would accept a PHI-carrying contract must not
 * start. `tests/outboxEventRegistry.test.ts` asserts the same rules explicitly
 * so the failure is legible rather than a bare startup crash.
 */
function assertRegistryIsSelfConsistent(): void {
  const seen = new Set<string>();
  for (const c of OUTBOX_EVENT_CONTRACTS) {
    const key = contractKey(c.eventType, c.eventVersion);
    if (seen.has(key)) {
      throw new Error(`outboxEventRegistry: duplicate contract ${key}`);
    }
    seen.add(key);

    if (!Number.isInteger(c.eventVersion) || c.eventVersion < 1) {
      throw new Error(`outboxEventRegistry: ${key} has a non-positive-integer eventVersion`);
    }
    if (c.maxAttempts < 1 || !Number.isInteger(c.maxAttempts)) {
      throw new Error(`outboxEventRegistry: ${key} has an invalid maxAttempts`);
    }
    if (c.payload.required.length === 0) {
      throw new Error(
        `outboxEventRegistry: ${key} declares no required payload field. An event whose payload ` +
          'is entirely optional cannot be validated and cannot identify its own aggregate.',
      );
    }

    const overlap = c.payload.required.filter((f) => c.payload.optional.includes(f));
    if (overlap.length > 0) {
      throw new Error(`outboxEventRegistry: ${key} lists ${overlap.join(', ')} as both required and optional`);
    }

    for (const field of [...c.payload.required, ...c.payload.optional]) {
      const lower = field.toLowerCase();
      for (const fragment of FORBIDDEN_PAYLOAD_FIELD_FRAGMENTS) {
        // `...Name` is how PHI arrives; `...id` fields that merely CONTAIN a
        // forbidden fragment as part of an identifier suffix are still refused,
        // because a field called `patientNameId` is a smell worth blocking.
        if (lower.includes(fragment)) {
          throw new Error(
            `outboxEventRegistry: ${key} permits payload field "${field}", which contains the ` +
              `forbidden fragment "${fragment}". Outbox payloads carry identifiers only; re-read ` +
              'the content from durable state in the consumer instead.',
          );
        }
      }
    }
  }
}

assertRegistryIsSelfConsistent();

/** Exported so the drift test can re-run the same assertions and report them legibly. */
export { assertRegistryIsSelfConsistent };
