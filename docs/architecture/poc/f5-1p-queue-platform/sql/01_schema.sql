-- F5-1P — disposable queue-platform PoC schema.
--
-- THIS IS NOT A MIGRATION. It lives outside server/prisma/migrations/ on
-- purpose so that no tooling can apply it to a real database by accident, and
-- so that `prisma migrate` never sees it. It is applied only by the harness
-- (server/src/tests/poc/queuePocEnvironment.ts) against a throwaway container.
--
-- Field set follows docs/architecture/queue-outbox-poc-design.md §7.3, which
-- explicitly evaluates rather than authorizes these columns. Nothing here is
-- proposed for server/prisma/schema.prisma.

-- ---------------------------------------------------------------------------
-- Business state. Tenant-owned, mirroring the two-level ownership shape the
-- F3-1 registry uses (organization -> clinic).
-- ---------------------------------------------------------------------------
CREATE TABLE poc_appointment (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT        NOT NULL,
  clinic_id        TEXT        NOT NULL,
  patient_ref      TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'booked',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX poc_appointment_tenant_idx ON poc_appointment (organization_id, clinic_id);

-- ---------------------------------------------------------------------------
-- Outbox. Candidate A's durable event source.
--
-- status: pending -> claimed -> processed | failed(retryable) | dead
-- locked_at/locked_by are the lease fields; available_at drives backoff.
-- ---------------------------------------------------------------------------
CREATE TABLE poc_outbox_event (
  id               TEXT PRIMARY KEY,
  event_type       TEXT        NOT NULL,
  event_version    INTEGER     NOT NULL DEFAULT 1,
  aggregate_type   TEXT        NOT NULL,
  aggregate_id     TEXT        NOT NULL,
  organization_id  TEXT        NOT NULL,
  clinic_id        TEXT,
  payload          JSONB       NOT NULL,
  idempotency_key  TEXT        NOT NULL,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  available_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  status           TEXT        NOT NULL DEFAULT 'pending',
  attempt_count    INTEGER     NOT NULL DEFAULT 0,
  max_attempts     INTEGER     NOT NULL DEFAULT 3,
  last_error_code  TEXT,
  locked_at        TIMESTAMPTZ,
  locked_by        TEXT,
  lease_expires_at TIMESTAMPTZ,
  processed_at     TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ
);

-- §7.9: the dispatcher's hot path is "pending/failed rows that are due now".
CREATE INDEX poc_outbox_due_idx
  ON poc_outbox_event (status, available_at)
  WHERE status IN ('pending', 'failed');

-- Lease reclamation scan.
CREATE INDEX poc_outbox_lease_idx
  ON poc_outbox_event (status, lease_expires_at)
  WHERE status = 'claimed';

-- Tenant-scoped inspection / fairness accounting.
CREATE INDEX poc_outbox_tenant_idx ON poc_outbox_event (organization_id, clinic_id, status);

-- ---------------------------------------------------------------------------
-- Side-effect ledger. THE central correctness instrument of this PoC.
--
-- Both candidates write here when they perform their "external" side effect.
-- The UNIQUE constraint on idempotency_key is what makes duplicate business
-- effects detectable: a duplicate delivery that is correctly suppressed
-- produces one row; a duplicate that is NOT suppressed raises a unique
-- violation, which the harness records as a real failure rather than hiding.
--
-- This is deliberately in PostgreSQL for BOTH candidates, to demonstrate the
-- point queue-outbox-poc-design.md §9 makes: BullMQ's own jobId/dedupe is a
-- transport-level property and is NOT a business idempotency mechanism.
-- ---------------------------------------------------------------------------
CREATE TABLE poc_side_effect (
  id               BIGSERIAL PRIMARY KEY,
  idempotency_key  TEXT        NOT NULL UNIQUE,
  candidate        TEXT        NOT NULL,
  organization_id  TEXT        NOT NULL,
  clinic_id        TEXT,
  event_id         TEXT        NOT NULL,
  delivered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  worker_id        TEXT        NOT NULL
);
CREATE INDEX poc_side_effect_candidate_idx ON poc_side_effect (candidate, organization_id, clinic_id);

-- Every attempt, including suppressed duplicates. Lets the harness prove
-- "delivered twice, executed once" rather than merely "executed once".
CREATE TABLE poc_side_effect_attempt (
  id               BIGSERIAL PRIMARY KEY,
  idempotency_key  TEXT        NOT NULL,
  candidate        TEXT        NOT NULL,
  outcome          TEXT        NOT NULL,
  attempted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  worker_id        TEXT        NOT NULL
);
CREATE INDEX poc_side_effect_attempt_key_idx ON poc_side_effect_attempt (idempotency_key);

-- ---------------------------------------------------------------------------
-- Dead-letter store. A failed job must stay inspectable (design §7.14) and
-- must not carry PHI -- payload_digest, never the payload itself.
-- ---------------------------------------------------------------------------
CREATE TABLE poc_dead_letter (
  id               BIGSERIAL PRIMARY KEY,
  candidate        TEXT        NOT NULL,
  event_id         TEXT        NOT NULL,
  event_type       TEXT        NOT NULL,
  organization_id  TEXT        NOT NULL,
  clinic_id        TEXT,
  attempt_count    INTEGER     NOT NULL,
  last_error_code  TEXT        NOT NULL,
  payload_digest   TEXT        NOT NULL,
  dead_lettered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  replayed_at      TIMESTAMPTZ
);
CREATE INDEX poc_dead_letter_candidate_idx ON poc_dead_letter (candidate, organization_id);

-- ---------------------------------------------------------------------------
-- Inbound ledger. Shape-compatible with the REAL MessagingInboundEvent
-- (server/prisma/schema.prisma) so the "durable acceptance -> fast ACK ->
-- enqueue" flow can be modelled WITHOUT touching production inbound code.
-- The unique constraint mirrors the real model's
-- @@unique([channel, provider, connectionId, providerMessageId]).
-- ---------------------------------------------------------------------------
CREATE TABLE poc_inbound_event (
  id                   TEXT PRIMARY KEY,
  channel              TEXT        NOT NULL,
  provider             TEXT        NOT NULL,
  connection_id        TEXT,
  provider_message_id  TEXT        NOT NULL,
  organization_id      TEXT,
  clinic_id            TEXT,
  status               TEXT        NOT NULL DEFAULT 'received',
  attempts             INTEGER     NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at         TIMESTAMPTZ,
  CONSTRAINT poc_inbound_event_provider_uq
    UNIQUE (channel, provider, connection_id, provider_message_id)
);

-- ---------------------------------------------------------------------------
-- Metrics sink for the observability experiment (queue depth / oldest age).
-- ---------------------------------------------------------------------------
CREATE TABLE poc_metric_sample (
  id           BIGSERIAL PRIMARY KEY,
  candidate    TEXT        NOT NULL,
  metric       TEXT        NOT NULL,
  value        DOUBLE PRECISION NOT NULL,
  sampled_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
