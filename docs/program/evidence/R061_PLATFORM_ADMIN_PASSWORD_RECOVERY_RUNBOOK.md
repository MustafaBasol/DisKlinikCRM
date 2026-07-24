# R-061 — PlatformAdmin Password Recovery CLI Runbook

**Task identity:** Implementation of a controlled, auditable PlatformAdmin password recovery CLI, required to unblock R-061 authenticated production verification for `admin@noramedi.com` (normal login currently returns HTTP `401` against a confirmed-valid bcrypt hash — see production diagnosis in the related R-061 evidence files).
**Worktree:** `D:\wt\r061-platform-auth-diagnosis`, branch `audit/r061-platform-admin-auth-diagnosis`, base `origin/main` @ `40810b9d4ecab45a17dcc66437e199d6aa0c832d`.
**Related risk:** [R-061](../RISK_REGISTER.md) (`OPEN`).
**Related evidence:** [R061_PACKAGE_A_AUTHENTICATED_PRODUCTION_VERIFICATION.md](R061_PACKAGE_A_AUTHENTICATED_PRODUCTION_VERIFICATION.md), [R061_REMAINING_AUTHENTICATED_VERIFICATION_PACKAGE.md](R061_REMAINING_AUTHENTICATED_VERIFICATION_PACKAGE.md), [R061_RESIDUAL_SAFE_RESET_PRODUCTION_VERIFICATION.md](R061_RESIDUAL_SAFE_RESET_PRODUCTION_VERIFICATION.md).

## 1. Purpose

`admin@noramedi.com` exists, is active, has MFA disabled, and has a structurally valid bcrypt hash (`$2b$`, 60 bytes, no outer whitespace), yet normal login returns HTTP `401`. The current password is therefore unknown or does not match the stored hash. This CLI provides the smallest safe, auditable way for an operator to set a new known password for a specific PlatformAdmin account, so that R-061's authenticated verification chain can proceed.

This CLI does **not** modify the login route, does not normalize the login lookup, does not touch MFA, and cannot be used to test whether a login succeeds.

## 2. What was implemented

- `server/src/scripts/platform-admin-recover-password.ts` — the CLI. Exports a pure core function (`recoverPlatformAdminPassword`) separate from the CLI entry point, so the refusal logic, transaction, and audit shape are independently testable.
- `server/src/tests/platformAdminPasswordRecovery.test.ts` — targeted tests (dry-run no-writes, account absent, inactive, ambiguous match, missing confirmation, password mismatch, policy failure, successful recovery, MFA-preserved, audit shape, transaction rollback on audit failure, no-secrets-in-output, no-password-via-argv, non-interactive refusal).
- `server/package.json` — added `platform-admin:recover-password` and `test:platform-admin-password-recovery` scripts.

No other files were modified. The normal login route (`POST /api/platform/auth/login`), `middleware/platformAuth.ts`'s authentication logic, and MFA setup/verify/disable routes are untouched.

## 3. Preconditions

- Run from `server/` with a `DATABASE_URL` pointing at the **correct target database** (dev/staging for rehearsal; production only per the sequence in §8, under existing change-management authorization).
- The target PlatformAdmin account's email is known exactly.
- The operator has a real interactive terminal (TTY) available — the CLI refuses to run non-interactively for the real (non-dry-run) path.

## 4. Dry-run command

```
cd server
npx tsx src/scripts/platform-admin-recover-password.ts \
  --email admin@noramedi.com --confirm-email admin@noramedi.com --dry-run
```

(equivalently: `npm run platform-admin:recover-password -- --email admin@noramedi.com --confirm-email admin@noramedi.com --dry-run`)

Dry-run prints only safe account state (matched/active/MFA-enabled/created-at/masked ID). It never hashes anything, never writes to the database, never invalidates anything, and never writes an audit row.

## 5. Execution command

```
cd server
npx tsx src/scripts/platform-admin-recover-password.ts \
  --email admin@noramedi.com --confirm-email admin@noramedi.com --confirm
```

The CLI will then:

1. Re-verify the account (exact normalized match, single match, active).
2. Prompt: `New PlatformAdmin password:` — hidden, nothing echoed (not even asterisks).
3. Prompt: `Confirm new password:` — hidden, second independent entry.
4. Reject if the two entries differ, or if the password fails the application's shared policy (`validatePassword` in `server/src/utils/helpers.ts` — same policy used by `routes/auth.ts` and `routes/users.ts`).
5. Hash with `bcryptjs` at cost factor `12` (matches every other `bcrypt.hash(..., 12)` call in this codebase).
6. In one database transaction: update **only** `PlatformAdmin.passwordHash` (and Prisma's auto-managed `updatedAt`), then write one `PlatformAdminAuditEvent` row. If the audit insert fails, the password update rolls back with it — a successful hash change without its audit row cannot happen.
7. Print a safe summary (see §9) — **not** the password, **not** the hash, **not** the full account ID.

## 6. Hidden-prompt behavior

- The password is read character-by-character from a raw-mode TTY; nothing is echoed to the screen (no plaintext, no asterisks).
- Backspace/Delete edit the in-memory buffer; Ctrl+C aborts cleanly (raw mode is restored) without writing anything.
- The password is **never** accepted via `--password`/`--new-password`/`--pass`/`--pwd`/`--confirm-password` CLI flags — the CLI refuses to start if any of these are present in argv, even if empty.
- The CLI refuses to run its real (non-dry-run) path at all unless `process.stdin.isTTY` and raw-mode support are present, so it cannot be driven by a pipe, a redirected file, or an automation harness — the only path to the destructive branch is a human at a real terminal.

## 7. Audit attribution decision

A recovery operation cannot be attributed to an authenticated PlatformAdmin session, because the account being recovered is, by definition, the one that cannot authenticate. `PlatformAdminAuditEvent.actorPlatformAdminId` is already nullable (`String?`) and already has `onDelete: SetNull` semantics — this is existing, intentional nullable/system-actor support (preferred option 1 in the task's attribution order), not a gap requiring a migration. This CLI writes:

```
action:            "platform_admin.password_recovered"
resourceType:       "PlatformAdmin"
resourceKey:        <admin.id>            (stable, non-secret identifier — same pattern as other resourceKey usage in this table)
actorPlatformAdminId: null                (operator/system action; never faked as the target admin)
previousValue:      null
newValue:           null
outcome:            "success"
safeMetadata:       { method: "operator_cli", sessionsInvalidated: <n>, mfaPreserved: true }
```

No schema change was needed or made for attribution.

## 8. Session invalidation decision — documented limitation, not invented

PlatformAdmin sessions are stateless JWTs (`middleware/platformAuth.ts`, `generatePlatformToken`/`authenticatePlatformAdmin`), valid for 8 hours from issuance, verified only by signature and a `jti` claim. **There is no persistent PlatformAdmin session table**, and — unlike the clinic `User` model, which has a `passwordChangedAt` column checked by `middleware/auth.ts` (`decoded.iat < passwordChangedAt` invalidates stale tokens) — `PlatformAdmin` has **no equivalent field**.

Consequence: this CLI cannot revoke a JWT already issued to the target admin. `sessionsInvalidated` is always `0`, and this is recorded honestly in the audit row and the printed summary, not hidden or approximated.

**Proposed follow-up (not implemented in this task, per scope):** add `passwordChangedAt DateTime?` to `PlatformAdmin` (mirroring `User`) plus the same `iat < passwordChangedAt` check in `platformAuth.ts`. This is the smallest schema change that would close the gap; it was not made here because this task's scope is the recovery CLI itself, and inventing session infrastructure was explicitly out of scope.

## 9. Rollback / failure behavior

- Every refusal (account not found, inactive, ambiguous match, email-confirmation mismatch, missing `--confirm`, password mismatch, policy failure, non-interactive execution, forbidden argv flag) exits non-zero **before** any database write.
- The password update and the audit insert run inside one `prisma.$transaction`. If the audit insert throws for any reason, Prisma rolls back the password update automatically — verified by a dedicated test that forces the audit write to fail and asserts the stored hash is unchanged and no audit row exists.
- No partial state (hash changed without an audit row, or vice versa) is possible.

## 10. Post-reset rule — this CLI does not test login

The CLI prints, on every successful run:

> This CLI does NOT test login. Perform exactly ONE normal platform-admin login now, through the real login route, to confirm the new password works.

The operator must not use this CLI to probe whether a password is correct, must not run it more than once per investigation without reviewing the dry-run output first, and must perform exactly one real login attempt afterward — consistent with R-061's existing single-attempt stop condition for authenticated verification.

## 11. Evidence to capture (per real run)

- Full dry-run console output (safe fields only).
- Confirmation that the account matched, was active, and MFA was reported preserved.
- The audit event's `id`, `action`, `resourceKey` (admin ID), `outcome`, and `safeMetadata`, read back from the database (read-only `SELECT`, not the CLI's own claim).
- `PlatformAdmin.updatedAt` before/after, read back read-only.
- The outcome of the single subsequent real login attempt (HTTP status only).

Do **not** capture: the plaintext password, the bcrypt hash, or the full PlatformAdmin ID in any evidence file.

## 12. Commands that must never be used

- Any direct SQL `UPDATE "PlatformAdmin" SET "passwordHash" = ...` — this bypasses the shared password policy, the bcrypt cost factor convention, and — critically — the audit trail. **Direct SQL password updates are prohibited.**
- Any script or command that logs, prints, or persists the plaintext password or the resulting hash.
- Running this CLI with a password supplied via `--password`/env var/pipe — the CLI refuses these, but operators must not attempt to work around that refusal (e.g. by patching the script).
- Repeated/looped login attempts to "test" whether the reset worked — exactly one login attempt only.

## 13. MFA confirmation

This CLI updates only `PlatformAdmin.passwordHash` (and Prisma's auto-managed `updatedAt`). `totpSecretEncrypted` and `totpEnabledAt` are never read for writing and never appear in the update payload — verified by a test that asserts both fields are byte-for-byte unchanged after a successful recovery. MFA state (enabled or disabled) is unconditionally preserved.

## 14. Production runbook sequence (prepared, not executed by this task)

1. Deploy the merged implementation.
2. Verify production SHA and health.
3. Run the CLI with `--dry-run`; review the safe output.
4. Run the CLI with `--confirm`; enter the new password twice via the hidden prompt.
5. Read back (read-only) the audit event and the account's `updatedAt` timestamp.
6. Perform exactly **one** normal platform-admin login.
7. If login succeeds, immediately re-run the already-approved R-061 non-activating chain: authenticated `GET` policy → `PATCH runtimeEnabled:false` → verify setting/audit → `DELETE` reset → verify `removed:true` → second `DELETE` → verify `removed:false` → confirm final row absent/default-false.
8. Remove any temporary scripts/artifacts created solely for this verification pass.
9. Prepare final R-061 documentation reconciliation.
10. Do **not** set `runtimeEnabled:true`. Do **not** use patient data at any point in this sequence.

This task did not execute any of the above against production. No production access, no real password reset, and no login attempt occurred during this task.
