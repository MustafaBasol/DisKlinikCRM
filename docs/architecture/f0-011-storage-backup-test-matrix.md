# F0-011 — Object Storage and Backup Migration PoC / Verification Matrix

Task: F0-011 · Phase: F0 — Baseline, Program Control, and Architecture Validation
Companion to: [`object-storage-backup-migration-design.md`](object-storage-backup-migration-design.md)

**This document does not authorize running any of these experiments.** They are the exact specification a future, separately-scheduled PoC task must execute, in a disposable environment, never production, never the shared development database, never against production object storage or production backups. No experiment below was executed to produce this document.

**Environment (mandatory, non-negotiable):** a disposable PostgreSQL instance and a disposable object-storage bucket/namespace (either a throwaway MinIO instance or a throwaway bucket on whichever provider a future PoC selects for measurement purposes only — provider selection for measurement is not the same as provider selection for production, and this document does not conflate the two). All experiments are destroyed after the PoC run; no state persists between PoC executions unless a specific experiment's design calls for it (none do). No production credentials, production data, or production backup artifacts are used in any experiment.

For every experiment: setup, action, expected result, failure interpretation, security significance, acceptance threshold, cleanup, rollback.

---

## 1. Tenant-safe object put/get/delete

- **Setup:** Two disposable tenants (org A, org B), each with a scoped storage credential/prefix per the design doc's §7 tenant-isolation model.
- **Action:** Put, get, and delete an object as org A using org A's own scoped path.
- **Expected result:** All three operations succeed and only affect org A's prefix.
- **Failure interpretation:** Any operation succeeding against a path outside org A's prefix is a critical tenant-isolation defect, not a tuning issue.
- **Security significance:** Baseline correctness gate — every other experiment assumes this passes.
- **Acceptance threshold:** 100% — zero tolerance.
- **Cleanup:** Delete disposable objects/buckets.
- **Rollback:** N/A (disposable environment).

## 2. Cross-org access denial

- **Setup:** Org A object exists; org B has valid credentials for its own prefix only.
- **Action:** Org B attempts get/put/delete against org A's object key, both via the application authorization layer and (if applicable) directly against storage credentials.
- **Expected result:** Denied at both layers.
- **Failure interpretation:** Any success is a critical, stop-the-line finding.
- **Security significance:** Directly tests the design doc's §7.2 "DB-row lookup is the authorization boundary, not the key" claim.
- **Acceptance threshold:** Zero cross-org access (absolute, per design doc §16.1).
- **Cleanup:** Standard.
- **Rollback:** N/A.

## 3. Same-org unauthorized-clinic denial

- **Setup:** Org A has clinics X and Y; a user scoped to clinic X only.
- **Action:** User attempts to access clinic Y's object via the application route.
- **Expected result:** Denied by the scoped `findFirst` pattern the design doc §7.1 documents as already in place.
- **Failure interpretation:** Success indicates a regression in the existing scoping pattern, not a new-feature gap.
- **Security significance:** Confirms a future object-storage backend does not weaken an existing, working control.
- **Acceptance threshold:** Zero unauthorized cross-clinic access (absolute).
- **Cleanup:** Standard.
- **Rollback:** N/A.

## 4. Signed URL expiration

- **Setup:** If presigned URLs are adopted per design doc §7.4 — issue a URL with a short TTL (e.g. 60s).
- **Action:** Attempt to use the URL after TTL expiry.
- **Expected result:** Denied.
- **Failure interpretation:** A usable expired URL is a critical finding.
- **Security significance:** Tests whether the presigned-URL model (if adopted) preserves equivalent time-boundedness to the existing export bearer-token model.
- **Acceptance threshold:** Zero post-expiry access.
- **Cleanup:** Standard.
- **Rollback:** N/A. **Not applicable if presigned URLs are not adopted** — this experiment is conditional on that open design question.

## 5. Signed URL replay

- **Setup:** Same as Experiment 4, URL still within TTL.
- **Action:** Use the same URL twice (or N times).
- **Expected result:** Per design doc §7.2/§7.4, recommend single-use semantics mirroring the existing export bearer-token model; if multi-use-within-TTL is instead the chosen design, this experiment measures whether that choice is intentional and documented, not a defect by default.
- **Failure interpretation:** Depends on which model is chosen — the PoC's job is to make the choice explicit and evidenced, not to assume single-use is mandatory.
- **Security significance:** Replay risk assessment for whichever model is chosen.
- **Acceptance threshold:** Behavior matches the documented design choice, whichever it is.
- **Cleanup:** Standard.
- **Rollback:** N/A.

## 6. Path traversal defense

- **Setup:** Attempt object keys containing `../`, absolute paths, null bytes, UNC-style prefixes.
- **Action:** Submit each via every code path that accepts a key (upload, lookup, migration backfill).
- **Expected result:** Rejected by `isSafeStorageKey()` or its future equivalent at every entry point, not just the primary upload route.
- **Failure interpretation:** Any accepted malicious key is critical.
- **Security significance:** Confirms the existing `isSafeStorageKey()` control (design doc §6.2) extends to any new operation added per §6.1, not only the original ones.
- **Acceptance threshold:** 100% rejection.
- **Cleanup:** Standard.
- **Rollback:** N/A.

## 7. MIME mismatch

- **Setup:** A file whose extension/declared Content-Type does not match its magic bytes (e.g. a `.pdf`-named executable).
- **Action:** Upload via the attachment/imaging path.
- **Expected result:** Rejected by the existing magic-byte validation (`isAllowedFileSignature`/`IMAGING_ALLOWED_MIME`), preserved unchanged by any storage-backend migration.
- **Failure interpretation:** Acceptance indicates a regression in an existing, working control.
- **Security significance:** Confirms migration does not bypass upload-time validation.
- **Acceptance threshold:** 100% rejection of mismatched files.
- **Cleanup:** Standard.
- **Rollback:** N/A.

## 8. Oversized upload

- **Setup:** A file exceeding the existing size cap (10 MB attachments / `MAX_FILE_MB` imaging).
- **Action:** Upload attempt.
- **Expected result:** Rejected before any bytes reach storage (multer's `limits.fileSize`, unchanged by migration).
- **Failure interpretation:** Acceptance, or partial storage of an oversized file, is a defect.
- **Security significance:** Resource-exhaustion protection.
- **Acceptance threshold:** 100% rejection, zero partial writes.
- **Cleanup:** Standard.
- **Rollback:** N/A.

## 9. Malware-hook failure

- **Setup:** A future antivirus/malware scan hook (design doc §6.3, not yet built) configured to reject a known-bad test signature (e.g. EICAR).
- **Action:** Upload the test file.
- **Expected result:** Rejected before promotion to persistent storage; for the asynchronous imaging-scan model, quarantined and never promoted to a servable state.
- **Failure interpretation:** A servable/downloadable infected file is critical.
- **Security significance:** Validates the scan-hook design before any real deployment.
- **Acceptance threshold:** 100% rejection/quarantine, zero servable infected files.
- **Cleanup:** Standard.
- **Rollback:** N/A. **Conditional** — only executable once a scan hook exists; this document does not build one.

## 10. Checksum mismatch

- **Setup:** A file whose stored checksum is deliberately corrupted post-write (simulating bit rot or a failed transfer).
- **Action:** Run the verification step (design doc §6.3/§10.1 stage 7).
- **Expected result:** Detected, flagged, not silently served or marked verified.
- **Failure interpretation:** A silently-passed mismatch is a critical migration-integrity defect.
- **Security significance:** Directly tests the "zero checksum mismatch after verified migration" acceptance criterion (design doc §16.1).
- **Acceptance threshold:** 100% detection.
- **Cleanup:** Standard.
- **Rollback:** N/A.

## 11. Multipart interruption/resume

- **Setup:** A large (imaging-scale) file upload, interrupted mid-transfer.
- **Action:** Resume, or abort-and-restart, per the multipart-abort-cleanup gap named in design doc §6.1.
- **Expected result:** No orphaned partial multipart upload left billing/occupying storage indefinitely; a resumed upload produces a byte-identical result to an uninterrupted one (checksum-verified).
- **Failure interpretation:** An orphaned multipart upload or a corrupted resumed file is a defect.
- **Security significance:** Imaging-scale reliability; also a cost-control concern (abandoned multipart uploads accrue storage cost on most providers).
- **Acceptance threshold:** Zero orphaned multipart uploads after the PoC's own cleanup; 100% checksum match on resumed uploads.
- **Cleanup:** Explicit abort-multipart-upload cleanup pass at PoC teardown.
- **Rollback:** N/A.

## 12. Duplicate upload idempotency

- **Setup:** The same file (same idempotency key, e.g. the imaging bridge's clinicId+sha256 `ingestKey` pattern) submitted twice.
- **Action:** Submit, then resubmit.
- **Expected result:** Second submission is detected as a duplicate and does not create a second object/DB row (mirrors the existing `ingestKey` dedup precedent, design doc §6.3).
- **Failure interpretation:** A duplicate row/object indicates the idempotency key is not being honored end-to-end through the new storage path.
- **Security significance:** Storage-cost and data-integrity concern; also relevant to migration backfill idempotency (Experiment 17).
- **Acceptance threshold:** Zero duplicate objects/rows for a repeated idempotent submission.
- **Cleanup:** Standard.
- **Rollback:** N/A.

## 13. Delete idempotency

- **Setup:** An object already deleted.
- **Action:** Issue the delete operation again.
- **Expected result:** No error, no side effect — mirrors `fileStorage.ts`'s existing documented idempotent `deleteFile()` behavior.
- **Failure interpretation:** An error or unexpected side effect on a repeated delete is a regression from current behavior.
- **Security significance:** Operational reliability for retry-safe cleanup jobs.
- **Acceptance threshold:** 100% idempotent.
- **Cleanup:** Standard.
- **Rollback:** N/A.

## 14. DB commit without object success

- **Setup:** Inject a failure so the DB row commits but the object write fails (or is not yet confirmed).
- **Action:** Attempt the combined upload flow under this injected fault.
- **Expected result:** Per the existing attachment-upload pattern (`attachments.ts:174-177`, which rolls back the stored file if the DB insert fails — the inverse ordering), a future dual-write or object-store-primary design must define and test the equivalent guarantee for this ordering: either the DB write must not commit until the object write is confirmed, or a reconciliation mechanism must detect and repair the orphaned DB row.
- **Failure interpretation:** A DB row pointing at a non-existent object, undetected, is a data-integrity defect that would surface to a user as "file not found" for a record that appears complete.
- **Security significance:** Directly informs the migration ledger's reconciliation requirement (design doc §10.3).
- **Acceptance threshold:** 100% of injected failures are either prevented (atomic ordering) or detected within a bounded window (reconciliation sweep) — no silent orphaned DB row survives past that window.
- **Cleanup:** Standard.
- **Rollback:** N/A.

## 15. Object success without DB commit

- **Setup:** Inject the inverse failure — object write succeeds, DB transaction rolls back or never commits.
- **Action:** Same combined upload flow, inverse fault injection.
- **Expected result:** An orphaned object with no DB reference; must be detectable by the reverse-orphan detection capability the design doc §7.2 names as a required-but-not-yet-built capability (`listObjects`-based).
- **Failure interpretation:** An undetectable orphaned object is a cost/hygiene issue, not a security issue per se, but indicates the reverse-orphan detection design is incomplete.
- **Security significance:** Storage-cost control; also relevant to §8's "residual copies" reasoning if the orphaned object contains PHI with no DB-side access control pointing at it (an orphan is, by definition, unreachable through the normal authorized path, but should still be inventoried and eventually cleaned up).
- **Acceptance threshold:** 100% of injected orphans are detected by the reverse-orphan sweep within its designed interval.
- **Cleanup:** Delete detected orphans as part of the PoC's own teardown.
- **Rollback:** N/A.

## 16. Dual-write partial failure

- **Setup:** During the design doc §10.1 stage 5 (dual-write) simulation, inject a failure on the object-store leg only, local leg succeeds.
- **Action:** Attempt a write under this fault.
- **Expected result:** The application-visible outcome (what the user sees as "did my upload succeed") must be well-defined and consistent — not silently divergent between the two backends.
- **Failure interpretation:** A write that appears to succeed to the user but has silently failed on one backend is the core risk dual-write is meant to surface, not hide.
- **Security significance:** Data-consistency foundation for the entire migration design.
- **Acceptance threshold:** 100% of injected partial failures are surfaced (logged, metriced, and either retried or flagged) — none silently disappear.
- **Cleanup:** Standard.
- **Rollback:** Disable dual-write flag if the failure rate under fault injection exceeds the PoC's own predefined threshold.

## 17. Backfill retry

- **Setup:** A migration-ledger row in `failed` status (design doc §10.2) with `attemptCount` below the retry ceiling.
- **Action:** Run the backfill worker again.
- **Expected result:** The row is retried, not skipped and not duplicated.
- **Failure interpretation:** A skipped or duplicated retry indicates the ledger's status-transition logic is unsound.
- **Security significance:** Migration correctness/completeness.
- **Acceptance threshold:** 100% of eligible failed rows are retried exactly once per invocation.
- **Cleanup:** Standard.
- **Rollback:** N/A.

## 18. Backfill duplicate

- **Setup:** A migration-ledger row already in `verified` status.
- **Action:** Run the backfill worker again over the same source inventory.
- **Expected result:** No-op — the already-verified row is skipped, no duplicate destination object is created.
- **Failure interpretation:** A duplicate destination object or a re-copy of an already-verified row indicates the backfill is not idempotent, contradicting design doc §10.3's explicit idempotency requirement.
- **Security significance:** Storage-cost control; also a correctness signal for the migration ledger design overall.
- **Acceptance threshold:** Zero duplicate destination objects across repeated backfill runs.
- **Cleanup:** Standard.
- **Rollback:** N/A.

## 19. Source/destination checksum reconciliation

- **Setup:** A full disposable-environment copy of a representative file set, checksummed at source, migrated, checksummed at destination.
- **Action:** Compare all checksums.
- **Expected result:** 100% match for every successfully migrated file; any mismatch halts that file's migration (per design doc §10.3's stop-the-line requirement) without blocking unrelated files/tenants.
- **Failure interpretation:** Any silent mismatch is critical — this is the direct test of the "zero checksum mismatch after verified migration" acceptance criterion.
- **Security significance:** Core migration-integrity gate.
- **Acceptance threshold:** 100% checksum match for all rows marked `verified`; zero rows reach `verified` status with a mismatch.
- **Cleanup:** Standard.
- **Rollback:** Per-file halt-and-flag, not a global migration abort, unless the mismatch rate crosses the stop-the-line threshold (design doc §10.3).

## 20. Provider outage

- **Setup:** Simulate the object-storage provider being unreachable (network partition, forced 5xx, or a local MinIO instance stopped).
- **Action:** Attempt reads and writes during the outage; observe local-fallback behavior (design doc §10.1 stage 9).
- **Expected result:** Reads fall back to local storage if the local copy still exists and local-fallback is still in the design's observation window; writes either queue/retry or fail loudly (not silently) — exact behavior is a PoC decision, but silence is never acceptable.
- **Failure interpretation:** A silent write-loss during an outage is critical.
- **Security significance:** Availability/reliability; directly informs the health-check operation named as a gap in design doc §6.1.
- **Acceptance threshold:** Zero silent write loss; local-fallback reads succeed for any file still present locally during the fallback window.
- **Cleanup:** Restore connectivity, verify state reconciles.
- **Rollback:** Disable object-store-primary mode, revert to local-primary, if outage-handling does not meet the threshold.

## 21. Local fallback

- **Setup:** Object-store-primary mode active (design doc §10.1 stage 8+), local fallback still available (stage 9).
- **Action:** Force a read that would normally hit object storage to fail, observe fallback to local.
- **Expected result:** Fallback succeeds transparently for any file not yet subject to local-deletion (stage 10+).
- **Failure interpretation:** A failed fallback for a file that should still be locally present is a defect in the fallback logic, not a data-loss event per se (the object-store copy still exists), but should be treated as a reliability regression.
- **Security significance:** Availability.
- **Acceptance threshold:** 100% successful fallback for files within the fallback-eligible window.
- **Cleanup:** Standard.
- **Rollback:** N/A — this experiment tests the rollback mechanism itself.

## 22. Provider credential rotation

- **Setup:** Rotate the disposable environment's storage credentials mid-test, per design doc §12's "rotation must not require a code deployment" requirement.
- **Action:** Rotate, then attempt an operation.
- **Expected result:** New credential picked up without a deployment (environment-variable reload or equivalent mechanism the PoC defines); old credential, if revoked, no longer works.
- **Failure interpretation:** A required deployment to rotate credentials, or a stale credential continuing to work after revocation, are both findings — the latter more severe (security), the former an operational-burden finding.
- **Security significance:** Credential-compromise recovery speed (also relevant to restore scenario 11, design doc's restore-design intent).
- **Acceptance threshold:** New credential functional within the PoC's target rotation window; old credential non-functional immediately after revocation.
- **Cleanup:** Standard.
- **Rollback:** N/A.

## 23. Bulk clinic migration fairness

- **Setup:** Multiple disposable tenants with very different backlog sizes (one large, several small), backfill run concurrently.
- **Action:** Run the migration worker across all tenants simultaneously.
- **Expected result:** No single tenant's large backlog starves the others' migration progress — mirrors the fairness reasoning F0-010's design already applies to its own worker pool (bounded concurrency, not tenant-partitioned claim).
- **Failure interpretation:** A small tenant waiting disproportionately long behind one large tenant's backlog is a fairness defect.
- **Security significance:** Availability/fairness, not a confidentiality/integrity issue, but operationally important for a multi-tenant migration rollout.
- **Acceptance threshold:** PoC-defined fairness metric (e.g. no tenant waits more than N× the single-tenant baseline); exact threshold is a PoC output, not asserted here.
- **Cleanup:** Standard.
- **Rollback:** N/A.

## 24. Migration worker crash recovery

- **Setup:** Kill the migration worker process mid-backfill, with several rows in `copying` status.
- **Action:** Restart the worker.
- **Expected result:** In-flight rows are recovered (via a lease-expiry mechanism mirroring `JobLock`/`clinicBulkExportWorker.ts`'s existing precedents, per design doc §10.3), not stuck indefinitely, not double-processed.
- **Failure interpretation:** A permanently stuck `copying` row, or a double-copy on recovery, is a defect.
- **Security significance:** Migration completeness/correctness.
- **Acceptance threshold:** 100% of in-flight rows recover to a terminal or retryable state within the lease-expiry window.
- **Cleanup:** Standard.
- **Rollback:** N/A.

## 25. Restore deleted attachment

- **Setup:** A disposable clinic with a known attachment set; delete one attachment (application-level, respecting `legalHold=false`); take a backup snapshot beforehand.
- **Action:** Restore from the pre-deletion backup into a disposable environment.
- **Expected result:** The attachment reappears in the disposable restore target, verified byte-identical via checksum.
- **Validation:** Checksum match; DB row and object both present and consistent.
- **Tenant isolation check:** Restore target must not expose any other tenant's data beyond what the backup snapshot itself contained.
- **KVKK impact:** None — this is a recovery scenario for an operationally (not KVKK-) deleted file; if the deletion had been a KVKK-driven anonymization instead, see Experiment 30.
- **Expected RPO/RTO:** Per design doc §9.4 proposed targets — PoC measures actual achieved values against them.
- **Failure interpretation:** A missing or corrupted restored file is a backup-integrity defect.
- **Cleanup:** Destroy the disposable restore target.
- **Rollback/cutback:** N/A — this is itself the recovery procedure.

## 26. Restore imaging study

- **Setup:** Same pattern as Experiment 25, for an `ImagingStudy`/`ImagingImage` set, given imaging's higher sensitivity and plausibly larger size.
- **Action:** Restore from backup into a disposable environment.
- **Expected result:** Full study (all constituent images) restored, checksum-verified, no lossy alteration of originals (per design doc §11's no-lossy-compression rule, restated here as a restore-integrity check).
- **Validation:** Per-image checksum match; study/series relational integrity intact.
- **Tenant isolation check:** Same as Experiment 25.
- **KVKK impact:** Higher sensitivity than Experiment 25 — restore target must be as tightly access-controlled as production.
- **Expected RPO/RTO:** Per §9.4, imaging-specific transfer-duration proposal is a PoC measurement, not a prior claim.
- **Failure interpretation:** Same as Experiment 25, at higher severity given imaging's `VERY_HIGH` sensitivity classification.
- **Cleanup:** Destroy the disposable restore target.
- **Rollback/cutback:** N/A.

## 27. Full PostgreSQL restore

- **Setup:** Use the existing `runRestoreTest()` capability (`backupService.ts:167-277`) as the starting point, run against a disposable target, not the pattern it already implements internally (`createdb`/`dropdb` against a throwaway DB name) — but this experiment should also independently verify the same procedure works against a fully separate disposable environment, not just a throwaway same-instance DB name, to produce the durable evidence R-032 currently lacks.
- **Action:** Full restore from the most recent backup artifact.
- **Expected result:** Restored database passes the existing row-count sanity checks plus an expanded integrity check (spot-check referential integrity across a sample of PHI-bearing tables).
- **Validation:** Sanity queries pass; spot-checked referential integrity intact.
- **Tenant isolation check:** N/A at this granularity (full-database restore); tenant isolation within the restored data is unchanged from production since RLS/application-scoping is unaffected by a DB-level restore.
- **KVKK impact:** None beyond the existing production KVKK posture, since this reproduces the same data.
- **Expected RPO/RTO:** Per §9.4 proposed database RTO (≤4h PoC target).
- **Failure interpretation:** Any sanity-check or spot-check failure means R-032 remains open even after this experiment — the point of this experiment is to actually produce the durable evidence that has been missing.
- **Cleanup:** Destroy the disposable restore target.
- **Rollback/cutback:** N/A.

## 28. Point-in-time recovery

- **Setup:** Requires WAL archiving/PITR to be configured in the disposable environment first (not configured in production today, R-031) — this experiment is conditional on that PoC-only setup, which this document does not authorize for production.
- **Action:** Restore to a specific point in time between two backup snapshots.
- **Expected result:** Database state matches the target timestamp, verified via a known marker transaction committed at a recorded time during setup.
- **Validation:** Marker transaction present/absent exactly as expected for the chosen recovery point.
- **Tenant isolation check:** Same as Experiment 27.
- **KVKK impact:** None beyond Experiment 27's.
- **Expected RPO/RTO:** Tests whether the proposed ≤15-minute PITR RPO (§9.4) is achievable — a PoC measurement, not a prior claim.
- **Failure interpretation:** Inability to hit the target point, or data corruption at the recovery point, is a defect in the PITR configuration being tested, not evidence PITR is infeasible in general.
- **Cleanup:** Destroy the disposable environment entirely (WAL archives included).
- **Rollback/cutback:** N/A.

## 29. Object-storage provider outage (distinct from Experiment 20 — provider-level, not network-level)

- **Setup:** If the PoC's chosen measurement provider supports a simulated region/service outage (or the PoC substitutes a MinIO instance taken fully offline as a proxy), configure it.
- **Action:** Attempt reads/writes during the simulated outage.
- **Expected result:** Same expectations as Experiment 20, at the provider-outage granularity specifically (as opposed to a generic network partition) — relevant because provider-level outages may have different failure signatures (e.g. specific error codes/retry-after headers) than a raw network partition.
- **Failure interpretation:** Same as Experiment 20.
- **Security significance:** Availability; informs whether a single-provider design (§13) needs a documented outage runbook.
- **Acceptance threshold:** Same as Experiment 20.
- **Cleanup:** Standard.
- **Rollback:** Same as Experiment 20.

## 30. Region/provider loss

- **Setup:** Simulate total, non-recoverable loss of the primary object-storage provider/region (not a transient outage) in the disposable environment.
- **Action:** Attempt recovery using only the off-site/secondary-copy mechanism (design doc §9.2) — if no secondary copy exists in the PoC's tested configuration, this experiment's expected result is "recovery is not possible," which is itself the finding this experiment is designed to surface.
- **Expected result:** If a secondary copy/replication was configured for the PoC run, recovery succeeds from it; if not, this experiment documents the actual current exposure (the "no-secondary-copy model" from §9.2's own comparison table) as a measured, not merely theoretical, gap.
- **Validation:** Recovered data checksum-matches the last known-good state (if a secondary copy exists).
- **Tenant isolation check:** Same as Experiment 25.
- **KVKK impact:** A total, unrecoverable provider loss with no secondary copy would be a reportable data-loss incident under KVKK if it occurred in production — this experiment exists specifically to surface that exposure before it is real.
- **Expected RPO/RTO:** Depends entirely on whether a secondary copy exists; if not, RPO/RTO are effectively infinite — the experiment's output is this exact finding.
- **Failure interpretation:** "No secondary copy configured" is not itself an experiment failure — it is the expected, documented current-state finding this experiment is designed to produce, which then becomes a direct input to the off-site-backup business decision (§9.4).
- **Cleanup:** Destroy the disposable environment.
- **Rollback/cutback:** N/A.

## 31. Credential compromise

- **Setup:** Simulate a leaked storage credential in the disposable environment.
- **Action:** Rotate/revoke the credential (Experiment 22's mechanism) and verify the compromised credential is denied immediately afterward; separately, review what the compromised credential could have accessed (least-privilege check, design doc §12).
- **Expected result:** Immediate denial post-revocation; the credential's scope (per §12's least-privilege requirement) limits blast radius to what a future implementation actually needs, not broader.
- **Failure interpretation:** A credential scoped broader than necessary, or a delay in effective revocation, are both findings.
- **Security significance:** Directly tests the least-privilege and rotation requirements in design doc §12.
- **Acceptance threshold:** Immediate (PoC-measured) revocation effectiveness; credential scope matches the documented least-privilege design.
- **Cleanup:** Standard.
- **Rollback:** N/A.

## 32. Accidental mass deletion

- **Setup:** Simulate an operator or buggy job issuing a bulk-delete across many objects in the disposable environment.
- **Action:** Execute the bulk delete; attempt recovery via versioning (if enabled, §9.2) or backup (§9).
- **Expected result:** Recovery succeeds if versioning/backup was configured for the PoC run; if not, this experiment measures the actual current exposure, same reasoning as Experiment 30.
- **Validation:** Recovered objects checksum-match pre-deletion state.
- **Tenant isolation check:** Recovery must not restore or expose any other tenant's objects beyond what the mass-deletion incident actually affected.
- **KVKK impact:** An unrecoverable accidental mass deletion of PHI-bearing attachments/imaging would be a reportable incident.
- **Expected RPO/RTO:** PoC-measured, dependent on which recovery mechanism (versioning vs. backup) is exercised.
- **Failure interpretation:** Same reasoning as Experiment 30 — an unrecoverable outcome is itself the finding.
- **Cleanup:** Destroy the disposable environment.
- **Rollback/cutback:** N/A.

## 33. Ransomware-style encryption/deletion

- **Setup:** Simulate a compromised credential being used to overwrite or delete a large number of objects with corrupted/encrypted content, in the disposable environment.
- **Action:** Attempt recovery via immutable-copy/object-lock (§9.2, if configured for the PoC run) or off-site backup.
- **Expected result:** Recovery succeeds only if an immutable or off-site copy exists that the compromised credential could not itself have altered — this is the specific property this experiment tests (a credential that can also delete the backup is not a defense against this scenario).
- **Validation:** Recovered content checksum-matches pre-incident state; recovered copy is confirmed to have been unreachable by the same compromised credential path.
- **Tenant isolation check:** Same as Experiment 32.
- **KVKK impact:** Same as Experiment 32, at higher severity (deliberate/malicious scenario, likely reportable).
- **Expected RPO/RTO:** PoC-measured.
- **Failure interpretation:** If the only available "backup" was reachable and alterable by the same compromised credential, that is the core finding — it means the design does not actually provide ransomware protection, only accidental-deletion protection, and the immutable-copy requirement (§9.4) must be treated as non-optional rather than a nice-to-have.
- **Cleanup:** Destroy the disposable environment.
- **Rollback/cutback:** N/A.

## 34. Database restored to a point where object references differ from object state

- **Setup:** Take a DB backup at time T1; after T1, add new attachments (new objects, new DB rows) and delete an old attachment (object deleted, DB row deleted) before T2; restore the DB to T1 into a disposable environment while object storage remains at its T2 state.
- **Action:** Query the restored DB for attachments; attempt to fetch each referenced object from the (still-T2) object storage.
- **Expected result:** Two mismatch classes are both possible and must both be handled without crashing or exposing wrong data: (a) DB row references an object that was deleted after T1 (object missing — must be a clean "not found," not an error that exposes internal state) — actually since object storage is at T2, a T1 DB row's referenced object should still exist (deletion happened after T1); (b) DB is missing rows for objects created between T1 and T2 (true orphans, detectable by reverse-orphan scan, §7.2).
- **Validation:** Every DB-row-to-object lookup either resolves correctly or fails cleanly and loggably; the reverse-orphan scan correctly identifies post-T1 objects with no matching restored DB row.
- **Tenant isolation check:** Standard.
- **KVKK impact:** This is the sharpest scenario for the "deleted/anonymized patient reappears after restore" risk (§8) — if a patient's attachment was deleted (for a legitimate, non-KVKK operational reason) between T1 and T2, restoring the DB to T1 makes that attachment's DB row reappear, and if the object was NOT yet deleted at T1 in this specific ordering it would still resolve — this experiment's real purpose is to enumerate every ordering combination and confirm none of them silently corrupts an authorization/visibility expectation.
- **Expected RPO/RTO:** N/A (this is a consistency test, not a recovery-speed test).
- **Failure interpretation:** Any silent, un-logged mismatch is a defect; the acceptable outcome is a mismatch that is detected, logged, and surfaced for manual reconciliation.
- **Cleanup:** Destroy the disposable environment.
- **Rollback/cutback:** N/A.

## 35. Deleted/anonymized patient does not reappear after restore, and retention-cleaned records after restore, and partial tenant restore without cross-tenant exposure, and performance under representative load (combined final experiment group)

- **Setup:** (a) A patient anonymized via `patientAnonymization.ts` before the backup was taken vs. after; (b) records that `dataRetentionCleanupJob.ts` or the export-cleanup jobs would have removed, present in an older backup; (c) a multi-tenant disposable environment where only one tenant's data needs restoring; (d) a representative synthetic upload/download load profile.
- **Action:** (a) Restore a backup taken *before* an anonymization event, confirm the design's reconciliation requirement — the restored DB row will show pre-anonymization `originalName`; this must be treated as an expected, documented consequence of restoring to a pre-anonymization point in time, not a silent regression, and any such restore must trigger a mandatory re-application of the anonymization event log (if one exists) before the restored environment is used for anything beyond forensic recovery. (b) Restore a backup containing retention-eligible-but-not-yet-cleaned rows, confirm the retention job, when run against the restored environment, correctly re-applies its cleanup logic (idempotent by design per F0-010's inventory of `dataRetentionCleanupJob.ts`). (c) Perform a partial, single-tenant restore and confirm no other tenant's data is exposed in the restore target. (d) Run the representative load profile and record p50/p95/p99 for upload/download, throughput, and error rate.
- **Expected result:** (a) The pre-anonymization state reappearing is expected and must be flagged, not silently served to a user — this is the single most important unresolved question this document surfaces (§8, §19) and this experiment is designed to force it into the open with concrete evidence rather than leave it theoretical. (b) Retention job re-converges the restored environment to the correct state. (c) Zero cross-tenant exposure in a partial restore. (d) Performance numbers recorded as PoC output, no threshold asserted in advance.
- **Validation:** (a) An explicit, logged flag on any DB row whose state differs from what the current (non-restored) anonymization/retention log would produce. (b)/(c) as stated. (d) Numbers recorded, compared against the proposed targets in §9.4/§16.2 as a gap analysis, not a pass/fail gate (since those targets are themselves proposals).
- **Tenant isolation check:** (c) is the check.
- **KVKK impact:** (a) is the highest-KVKK-impact experiment in this entire matrix — it directly tests the "zero reappearance of legally deleted/anonymized patient content without explicit reconciliation" acceptance criterion (design doc §16.1). Because file bytes are never deleted on anonymization in the current design (§3), the specific reappearance risk here is metadata (`originalName`) reverting, not file content reappearing from nowhere — but that distinction must be explicitly confirmed by this experiment, not assumed.
- **Expected RPO/RTO:** (d) covers the performance-proposal list in §16.2.
- **Failure interpretation:** Any silent reappearance of pre-anonymization metadata without an explicit flag/reconciliation step is treated as a failure of the absolute acceptance criterion in §16.1, not a tunable gap.
- **Cleanup:** Destroy the disposable environment.
- **Rollback/cutback:** N/A — this experiment group's findings feed directly into whatever reconciliation mechanism a future implementation task designs; this document does not design that mechanism itself, only proves the requirement for it.

---

## Coverage note

This matrix intentionally groups the task's items 34-35 differently than a strict 1-per-experiment mapping in a few places (Experiment 35 combines four related scenarios that share one disposable-environment setup, to avoid four near-duplicate environment-provisioning sections) — no scenario named in the task's restore-scenario or PoC-matrix lists was dropped; every one of the 35 numbered items in the task specification is addressed above, either as its own experiment or as an explicitly-labeled sub-part of Experiment 35. No experiment in this matrix was executed. All are specifications for a future, separately-authorized PoC task.
