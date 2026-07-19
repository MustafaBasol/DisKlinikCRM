# Enterprise Foundation Decision Set — F0-008

This is the compact, binding-vs-not summary of `docs/architecture/adr-foundation-review.md`. It answers one question per line: **what can the rest of the program rely on as of F0-008, and what can it not yet rely on?**

Original baseline: `origin/main` @ `7cf7a827277779091b9e34e726eebccd39f624ae`. **Correction-pass baseline (2026-07-19):** merged forward onto `origin/main` @ `1da9586995b625624b7385c14e70ba6a322def73` (PR #175, KVKK-HIGH-007 follow-up, merged) — see `adr-foundation-review.md` §0a. Task: F0-008 (documentation/ADR-review only — no schema, migration, runtime, or deployment change). Full rationale, evidence citations, and required ADR fields for every item below are in `adr-foundation-review.md`; this document does not repeat them.

## A. Binding architectural invariants (effective now)

These do not require further PoC, design, or external approval to be treated as binding by any future task. Violating one is a defect, not a judgment call.

1. NoraMedi remains a modular monolith. No framework rewrite. Express, React/Vite, Prisma, PostgreSQL retained absent future evidence of unsuitability. (ADR-001)
2. Service extraction is justified only for domains with evidenced, sustained cross-cutting friction that public contracts cannot resolve — none is evidenced today. (ADR-001)
3. Application-level tenant scoping (`clinicScope`/`clinicAccess`/`tenantGuard`) is the enforced tenant-isolation baseline and remains mandatory even after any future RLS or Prisma tenant-extension layer is added — RLS is additive, never a replacement. (ADR-002)
4. Shared database, shared schema is the default and only implemented tenant model. Schema-per-tenant is rejected as a default strategy. Database-per-tenant is rejected as a universal default. (ADR-003)
5. Dedicated tenant infrastructure is trigger-based, not universal — no trigger is currently met. (ADR-003)
6. Feature/release flags, commercial entitlements, and user permissions are three distinct control planes; none may be conflated. (ADR-014)
7. Security, tenant isolation, core KVKK evidence, audit, encryption, backup, and privacy controls can never be gated behind a commercial entitlement. (ADR-014)
8. All entitlement/permission checks must be enforced server-side (route/service/job layers) — frontend-only enforcement is prohibited. (ADR-014, `DEPENDENCY_MAP.md` §9)
9. A disabled module's workers/scheduled jobs must not keep running. (`DEPENDENCY_MAP.md` §9 rule 8)
10. Cross-domain reads/writes must go through an accepted public contract, domain event, or explicit application-service contract; direct cross-domain infrastructure/repository imports are prohibited except as a documented transitional exception (the 9 existing `WHA`/`IGM`→`PAT`/`APT` X-severity violations are recorded as exactly such a grandfathered exception, not a new violation). (ADR-015)
11. No Kubernetes adoption without independently measured and evidenced trigger: independent service count, multi-node autoscaling need, and operational capacity — none exist today. (ADR-016)
12. No queue platform selection (including BullMQ) and no outbox implementation is binding yet — see §B.
13. Schema, migration, and storage changes use expand-migrate-contract with backward compatibility and rollback, per program-wide decision principles (unchanged, restated — not newly decided by F0-008).
14. RLS and Prisma tenant-extension **implementation** (as opposed to design) remain blocked under the F0-007 architecture freeze boundary regardless of any PoC outcome. **Correction (2026-07-19 correction pass):** the KVKK-HIGH-007 continuation (PR #175) merged into `main` at commit `1da9586995b625624b7385c14e70ba6a322def73`, satisfying `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §5 condition 2 — but this gate was never conditioned on PR #175's merge status alone. It is governed by that document's §3 default freeze rules, which move only on §5 condition 5 (an explicit external "KVKK baseline stable" declaration) — not yet satisfied, since production migration application, rollback/tenant-impact verification, and production backfill execution are all still unconfirmed. This item's blocked status is unchanged by the merge.

## B. Approved direction requiring later implementation (not yet binding in detail)

The *principle* is accepted; the *how* is explicitly deferred to a named future task. Do not treat the named specifics below as decided.

| Area | Accepted direction | Deferred to | ADR |
|---|---|---|---|
| Object storage | Existing provider-agnostic abstraction (`fileStorage.ts`) and tenant-scoped key convention (`buildStorageKey`) is the pattern to build on | F0-011 (design; starting it needs a separate user decision) | ADR-008 |
| AI usage | No AI/clinical expansion beyond current WhatsApp-embedded scope without a governed gateway | F8 | ADR-009 |
| Official integrations | Adapter-boundary + delivery-ledger discipline for any future official channel, not the current ad hoc per-channel provider-factory pattern | F9 | ADR-010 |
| Imaging/PACS | Not built from scratch; Orthanc/DICOMweb is the leading candidate, not yet selected | F10 (component selection also NEEDS POC — see §C) | ADR-011 |
| Module contracts | 15 evidence-based contract candidates identified; CC-04 (appointment booking/cancellation command) is the recommended pilot | F2 | ADR-015 |
| Container/orchestration | Current bare-VPS+PM2 topology retained; no containerization mandated either | F7 (once triggered) | ADR-016 |
| Outbox event contracts | If/when an outbox is built, events must be versioned and consumers idempotent — binding on any future implementation, independent of timing | F6 (F0-010 design first) | ADR-006 |

## C. Decisions requiring a PoC before any acceptance

No direction is accepted yet for these — not even in principle beyond what is already program-wide policy.

| Area | PoC owner task | Why blocked | ADR |
|---|---|---|---|
| PostgreSQL RLS (policy model, role strategy, Prisma integration, performance) | F0-009 | No PoC evidence exists; explicitly frozen under tracker §8 item 3 and freeze boundary §3 item 11 | ADR-005 |
| Prisma + PgBouncer (pooling mode, RLS `SET` interaction, connection budgets) | F0-009 | PgBouncer presence in production is itself `UNVERIFIED`; no PoC exists | ADR-004 |
| Transactional outbox pattern (table design, dispatcher, retry/poison strategy) — whether/when to build it | F0-010 | No volume projections exist; frozen by freeze boundary §3 item 14 as it touches consent/audit flows | ADR-006 |
| Queue platform selection (BullMQ vs. alternatives) | F0-010 | No current queue exists (only PM2 cron + `JobLock`); "BullMQ preferred" is a **non-binding preference**, not a decision | ADR-007 |
| DICOM/PACS component selection (Orthanc/DICOMweb) | F10 (design phase, informed by F0-011 storage decision) | No technical validation performed yet | ADR-011 |

## D. Decisions requiring external legal / vendor / operational approval

Repository evidence alone cannot resolve these regardless of internal PoC results.

| Area | What's needed | Evidence it's blocked on external input | ADR |
|---|---|---|---|
| Object-storage provider + data residency | Vendor/legal decision on S3-compatible provider location (KVKK data-residency) | `docs/compliance/53§16`: retention/residency items explicitly deferred to legal counsel | ADR-008 |
| Official integration target (Ministry of Health, etc.) | Government technical/administrative requirements, certificate management | `MODULE_MAP.md`: confirmed no official-integration code exists; requirements are external to the repository | ADR-010 |
| Imaging/PACS clinical + regulatory validation | Separate legal and clinical validation (medical-device/AI regulatory classification) | `RELEASE_GATES.md` G4: explicit standing requirement, "ayrı yasal ve klinik validasyon" | ADR-011 |
| Backup/PITR retention periods for consent/clinical data | Legal counsel determination of retention windows | `docs/compliance/53§16`, `56§15`: clinical-image and consent retention periods explicitly pending legal review; `KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` §3: 5 items "Waiting for legal review" (international transfer, processor agreement, lawful-basis matrix, VERBİS, breach-response plan) | ADR-013 |

## E. Explicit non-decisions and rejected premature technologies

These are not merely "not yet decided" — they are actively rejected as *defaults*, per repository evidence and task decision principles. A future ADR may revisit any of them only against a named, measurable trigger.

- **Full application rewrite** — rejected; no evidence of current-stack unsuitability. (tracker §10, ADR-001)
- **Immediate NestJS migration** — rejected/deferred; no new evidence changes tracker §10's existing determination.
- **Immediate Next.js migration for the authenticated CRM** — rejected/deferred; same basis.
- **Immediate microservice decomposition** — rejected; 833-edge dependency density and 35 cycles show domains are not yet cleanly separable. (ADR-001)
- **Kafka as a current default** — rejected; no measurable event-volume/replay/multi-consumer trigger exists. No queue at all is currently justified by volume evidence. (ADR-007)
- **Kubernetes as a current default** — rejected; no independent service count, autoscaling need, or operational capacity evidenced. (ADR-016)
- **Schema-per-tenant** — rejected as a default strategy. (ADR-003)
- **Database-per-tenant as a universal default** — rejected. (ADR-003)
- **RLS/Prisma-tenant-extension as a replacement for application-level scoping** — rejected; RLS, if and when built, is additive only. (ADR-002)
- **Building PACS from scratch** — rejected; Orthanc/DICOMweb-style existing components are the required starting point for any future evaluation. (ADR-011)
- **BullMQ (or any queue) as a binding platform choice today** — explicitly not decided; "preferred near-term candidate" is recorded as non-binding. (ADR-007)
- **Any storage-key migration, RLS migration, `organizationId` backfill, tenant-extension rollout, physical module refactor, privacy/consent/retention model relocation, or attachment physical-deletion redesign** — all remain blocked by the F0-007 architecture freeze boundary; this document does not lift any of them.

## Status of this decision set

Agent work: completed. Documentation validation: see `docs/architecture/adr-foundation-review.md` §"Validation" in the accompanying PR description. Merge: not performed by this task. Deployment: not applicable. Production verification: not applicable. Human architecture review (ChatGPT/user) is still required before any item in §A is treated as final program policy — this task can bring an ADR to `ACCEPTED` status in the repository's own ADR index (documentation act), but per `docs/program/README.md` §5, `AGENT_COMPLETED` is the highest status this task may assign to itself; external review remains the next step.
