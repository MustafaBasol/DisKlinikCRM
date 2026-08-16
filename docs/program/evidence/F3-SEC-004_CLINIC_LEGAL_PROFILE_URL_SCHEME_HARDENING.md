# F3-SEC-004 — Clinic Legal Profile Website URL Scheme Hardening

**Status: `AGENT_COMPLETED` / `TESTS_PASSED` / `PR_OPENED` (Draft) — not merged, not deployed, not production-verified. `R-076` stays `OPEN`.**

## 1. Task identity and phase

| Field | Value |
|---|---|
| Task ID | **F3-SEC-004 — issued by this task** |
| Title | Clinic Legal Profile Website URL Scheme Hardening |
| Phase | F3 — Production Hardening |
| Risk | R-076 (opened 2026-08-12 by F3-SEC-003 as an incidental finding; `OPEN`) |
| Priority | FIRST-CUSTOMER / URGENT |
| Task type | SECURITY FIX (defense in depth) + REGRESSION TESTS + EVIDENCE |
| Schema/migration change | **NO** |

**Task-ID collision check.** `F3-SEC-001`, `F3-SEC-002`, `F3-SEC-002-R1-LITE` and `F3-SEC-003` exist in this repository; **`F3-SEC-004` did not exist anywhere** (`grep -rn "F3-SEC-004"` over the tree returned only the risk-register/tracker mentions created by this task). The ID is therefore **newly issued** under the existing program task-ID rules.

**Scope boundary.** This is the explicitly documented parallel first-customer security fix taken while `F4-FCR-004` is externally blocked on the Türkiye secondary VPS/provider response. It does **not** mean F4 is complete, does **not** authorize F5, and does **not** alter `R-030`, `R-030-DB`, `R-030-FILES`, `FIRST_CUSTOMER_RECOVERY_GATE`, F4 completion state, or F5 authorization. None of those records were edited.

## 2. Baseline and branch

| Field | Value |
|---|---|
| `git rev-parse origin/main` (after `git fetch origin main`) | **`0c02b87ca832ce40ce704d018e06f5da31b3da7e`** |
| Branch | `fix/f3-sec-004-clinic-legal-profile-url-xss`, created from `origin/main`, clean tree, no rebase |
| PR | Draft — `fix(security): restrict clinic legal-profile website URLs (R-076)` |

No production access of any kind was performed by this task.

## 3. Root cause

`ClinicLegalProfile.website` was declared as `website: z.string().max(300).optional().nullable()` — length-capped, but with **no URL parse and no scheme allowlist**, in direct contrast to the two `.email()` fields immediately above it in the same schema object.

The value is settable by `OWNER` / `ORG_ADMIN` / `CLINIC_MANAGER`, is returned verbatim by the **unauthenticated** `GET /api/public/clinics/:clinicSlug/kvkk` once the profile is published, and was rendered by the public KVKK page directly as:

```tsx
<a href={data.legalProfile.website} target="_blank" rel="noopener noreferrer">
```

React escapes text content but does **not** neutralise a `javascript:` / `data:` / `vbscript:` URL sitting in an `href` — it warns and still navigates on click. A privileged clinic user could therefore persist a script URL that executes for any anonymous visitor to that clinic's public privacy notice: **stored XSS**.

The defect is one missing validation, but it has **three** independent surfaces (write, public API, render sink), and fixing only the write path leaves every already-persisted value live. Hence the defense-in-depth treatment below.

## 4. Write paths inspected (complete)

Every path that can persist `ClinicLegalProfile.website`:

| # | Path | Handler | Validates via |
|---|---|---|---|
| 1 | `PUT /api/clinics/:clinicId/legal-profile` | `clinicLegalProfile.ts` router.put | `legalProfileSchema.safeParse(req.body)` → `prisma.clinicLegalProfile.upsert` |
| 2 | `POST /api/clinics/:clinicId/legal-profile/publish` (optional body — atomic save+publish) | `clinicLegalProfile.ts` router.post | `legalProfileSchema.safeParse(req.body)` → `prisma.clinicLegalProfile.upsert` |
| 3 | `POST …/publish` publish-flag write | same handler | `prisma.clinicLegalProfile.update({ data: { isPublished: true } })` — writes **no** client-supplied field |

Both mutating paths share **one** schema object, so a single change to `legalProfileSchema` covers both. There is no third write path: `prisma.clinicLegalProfile.create(` does not appear in the route, and the admin UI (`src/components/settings/ClinicKvkkSection.tsx`) reaches the database only through paths 1 and 2. Test 36 pins all of this as a static scan of the route source, so a future fourth write path that skips the schema fails the suite.

`server/prisma/seed.ts` writes `Clinic.website` (a different model/field) and is dev-only.

## 5. Public/render sinks inspected (complete)

| Sink | Verdict |
|---|---|
| `src/pages/clinic/ClinicKvkkPublicPage.tsx:116` — `<a href={data.legalProfile.website}>` on the **unauthenticated** page | **The vulnerable sink.** Fixed. |
| `src/components/settings/ClinicKvkkSection.tsx:293` — `<input type="text" value={profile.website}>` | Safe. Authenticated, and an input `value` is not a navigable sink. Deliberately left unguarded so an admin can see and correct a bad value. |
| `server/src/services/privacy/clinicBulkExportFieldAllowlists.ts:25` | `Clinic.website`, a different field; export data, not an `href`. Out of scope. |

`grep` for `website` across `**/*.{ts,tsx}` returned 12 files; the remainder are `Patient.source === 'website'` enum values and WhatsApp/Instagram prompt text, none of which touch `legalProfile.website`. **No other UI, public or authenticated, renders this value as an `href`.**

## 6. Fix implemented

Three layers, each independently sufficient to prevent execution, none relying on React escaping.

### Layer 1 — write-time validation (`server/src/routes/clinicLegalProfile.ts`)

```ts
export const websiteSchema = z
  .string()
  .max(300)
  .refine((value) => value.trim() === '' || isSafeHttpUrl(value), {
    message: 'Website must be an absolute http:// or https:// URL',
  });
```

applied as `website: websiteSchema.optional().nullable()`. The existing **300-character maximum is preserved** and still evaluated first. Dangerous values are **rejected with 400**, never silently converted.

### Layer 2 — public API suppression (`server/src/routes/publicClinicKvkk.ts`)

```ts
export function toPublicLegalProfile<T extends { website?: string | null }>(profile: T): T {
  return { ...profile, website: sanitizeSafeHttpUrl(profile.website) };
}
```

An unsafe **legacy** value is replaced with `null` on the response, so it never crosses the unauthenticated boundary at all — not to our page, not to a cached response, not to any third-party consumer. This reads only; **the stored row is never rewritten**.

Deliberately **not** applied to the authenticated `GET` (`SAFE_SELECT`): suppressing it there would leave the clinic unable to see and correct the row it owns. Test 39 pins that asymmetry.

### Layer 3 — render-time sink guard (`src/pages/clinic/ClinicKvkkPublicPage.tsx`)

```tsx
const WebsiteCell: React.FC<{ value: string }> = ({ value }) => {
  const href = getSafeHttpUrl(value);
  return (
    <span data-testid="legal-profile-website">
      {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{value}</a> : value}
    </span>
  );
};
```

Layer 2 only protects responses served **after** the backend is redeployed; a cached response or a browser talking to an older server can still deliver an unsafe value. The sink therefore decides for itself.

### The shared guard (`server/src/utils/safeUrl.ts`, `src/utils/safeUrl.ts`)

```ts
export const SAFE_URL_PROTOCOLS: readonly string[] = ['http:', 'https:'];

export function isSafeHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { return false; }
  return SAFE_URL_PROTOCOLS.includes(parsed.protocol);
}
```

**A WHATWG `URL` parse, not a regex**, on purpose:

- `URL` normalises the scheme, so `JaVaScRiPt:` is caught identically to `javascript:`;
- `URL` **strips embedded tab/CR/LF before parsing**, so `java\tscript:alert(1)` — which browsers *do* execute and which a `startsWith('javascript:')` check waves straight through — is normalised to `javascript:` and caught;
- relative paths (`/x`) and protocol-relative refs (`//evil.example`) throw without a base, so "must be absolute" comes for free rather than needing its own rule.

The module is duplicated across server and client because the two are compiled from separate tsconfig roots with no shared package. Drift between them would mean the API and the render sink disagree about what is safe, so the frontend suite pins the two copies as byte-identical (`getSafeHttpUrl — security property` → *stays behaviourally identical to the server-side copy*).

### Empty-string / blank semantics (deliberate, backward-compatibility critical)

`''` and whitespace-only remain **valid**. `ClinicKvkkSection.tsx` initialises every text field to `''` and submits the whole profile object, so rejecting `''` would break saving for every clinic that simply leaves the website blank. Whitespace-only is treated as blank for the same reason and to match how `validatePublishFields` already applies `.trim()` to required fields.

## 7. Legacy-data behavior

| Question | Answer |
|---|---|
| Are existing rows rewritten or deleted? | **No.** No migration, no backfill, no `UPDATE`. |
| What happens to an already-persisted unsafe value? | Suppressed to `null` on the public API response (Layer 2), and — should one still reach the page — rendered as **inert escaped text with no anchor** (Layer 3). Never placed in an `href`, never navigated, never executed. |
| Why inert text rather than omission? | It keeps the fact that the field holds something visible, which is what tells the clinic to go fix it, at zero risk (React escapes it and there is nothing to click). |
| Can the clinic still repair it? | Yes — the authenticated settings form is intentionally unscrubbed, so the bad value is visible and editable. Saving a corrected value now goes through Layer 1. |
| Effect timing | An unsafe legacy value becomes **non-clickable immediately on frontend deployment**, before any data cleanup. |

Remediation of any unsafe rows found by the scan below is a **separate controlled task**, not this one.

## 8. Read-only production scan

Reports three integers and nothing else. **No URLs, no clinic names, no clinic IDs, no tenant identifiers, no PII.** Read-only — `SELECT` only, no `UPDATE`/`DELETE`/DDL.

```sql
-- F3-SEC-004 / R-076 — read-only counting scan of ClinicLegalProfile.website.
-- Emits three integers only. Safe to run on production.
SELECT
  count(*) FILTER (WHERE btrim(website) <> '')
    AS total_non_empty,
  count(*) FILTER (WHERE btrim(website) ~* '^https?://[^/?#[:space:]]'
                     AND website !~ '[\t\n\r]')
    AS accepted_http_https,
  count(*) FILTER (WHERE btrim(website) <> ''
                     AND NOT (btrim(website) ~* '^https?://[^/?#[:space:]]'
                                AND website !~ '[\t\n\r]'))
    AS potentially_unsafe
FROM "ClinicLegalProfile"
WHERE website IS NOT NULL;
```

Invocation on the production host:

```bash
psql "$DATABASE_URL" -At -f /tmp/r076_scan.sql
```

**Fidelity caveat, stated honestly.** SQL has no WHATWG URL parser, so this is a close approximation of the shipped `isSafeHttpUrl`, not the same function. It was checked against the full test-vector set and agrees on every one of them (`https://…`, `http://…`, leading-whitespace variants, and `https://` with no host, `javascript:`, `JaVaScRiPt:`, tab-obfuscated `java\tscript:`, `data:`, `vbscript:`, `file:`, `ftp:`, `blob:`, `//evil.example`, `/relative`, bare `clinic.example`, free text). The `[\t\n\r]` clause exists precisely because the URL parser strips those characters and a naive scheme regex would otherwise mis-classify an obfuscated value as safe. Residual divergence is confined to exotic inputs (e.g. a space inside the authority), where the SQL may count a value as accepted that the shipped guard rejects — i.e. it can **under-report**, never silently clear a `javascript:` row. The counts are intended to decide *whether* a remediation task is needed; that task would classify exactly, using the shipped helper.

**Expected result: `potentially_unsafe = 0`.** If it is greater than zero, open a separate controlled remediation task — do not fix rows from within F3-SEC-004.

## 9. Files changed

| File | Change |
|---|---|
| `server/src/utils/safeUrl.ts` | **new** — `SAFE_URL_PROTOCOLS`, `isSafeHttpUrl`, `sanitizeSafeHttpUrl` |
| `src/utils/safeUrl.ts` | **new** — browser twin: `SAFE_URL_PROTOCOLS`, `isSafeHttpUrl`, `getSafeHttpUrl` |
| `server/src/routes/clinicLegalProfile.ts` | `websiteSchema` refinement; `website` field now uses it |
| `server/src/routes/publicClinicKvkk.ts` | `toPublicLegalProfile` suppression at the unauthenticated boundary |
| `src/pages/clinic/ClinicKvkkPublicPage.tsx` | `WebsiteCell` render guard replaces the raw `href` |
| `server/src/tests/clinicLegalProfile.test.ts` | +11 cases (30–40) |
| `src/pages/clinic/__tests__/ClinicKvkkPublicPage.website.vitest.test.tsx` | **new** — 16 cases |
| `docs/program/RISK_REGISTER.md` | R-076 row updated (status advanced, **not** closed) |
| `docs/program/NORAMEDI_MASTER_TRACKER.md` | F3-SEC-004 entry |
| `docs/program/phases/F3_PRODUCTION_HARDENING.md` | F3-SEC-004 entry + change-history row |
| `docs/program/evidence/F3-SEC-004_…md` | this document |

No new npm test script was required: the backend cases extend the file already bound to `test:clinic-legal-profile` (preserving the F1-003-P1 "zero script-less test files" contract), and the frontend file is picked up by the existing `src/**/*.vitest.test.{ts,tsx}` include in `vitest.config.ts`.

## 10. Tests

| Command | Exit | Pass | Fail | Skip |
|---|---|---|---|---|
| `cd server && npm run test:clinic-legal-profile` | **0** | **40** | 0 | 0 |
| `npx vitest run src/pages/clinic/__tests__/ClinicKvkkPublicPage.website.vitest.test.tsx` | **0** | **16** | 0 | 0 |
| `npm run test:vitest` (full frontend suite, 12 files — regression check) | **0** | **200** | 0 | 0 |
| `cd server && npm run typecheck` (`prisma generate && tsc --noEmit`) | **0** | — | — | — |
| `npx tsc -b` (frontend) | **0** | — | — | — |
| `git diff --check` | **0** | — | — | — |

Backend cases 30–40 cover: accepted (`https`, `http`, URL with path/query, `null`, omitted, `''`, whitespace-only); rejected (`javascript:`, `JaVaScRiPt:`, `data:`, `vbscript:`, `file:`, `ftp:`, `blob:`, `//evil.example`, `/relative`, `relative/path`, bare `clinic.example`, `https://` with no host, free text, tab/newline/leading-space obfuscation); the error is attributed to the `website` field; the 300-char boundary (300 accepted / 301 rejected); the static scan proving both write paths share the schema; public-API suppression and non-mutation of the source object; the authenticated read staying unscrubbed; and the allowlist property.

Frontend cases cover: `https` and `http` → clickable anchor with the expected `href`, `target`, `rel`; nine legacy-fixture unsafe values → **no anchor at all**; unsafe value still rendered as inert text; no row when the API suppressed the value; a document-wide sweep asserting no `href`/`src` anywhere contains `javascript:`; the allowlist property; and server/client guard parity.

### Mutation / security-property verification (performed, then reverted)

`return SAFE_URL_PROTOCOLS.includes(parsed.protocol)` was temporarily replaced with `return true` in **both** copies of the guard — i.e. the protocol allowlist replaced with unconditional acceptance — and the suites re-run:

| Suite | Result under mutant |
|---|---|
| `npm run test:clinic-legal-profile` | exit **1** — 35 passed, **5 failed** |
| `ClinicKvkkPublicPage.website.vitest.test.tsx` | exit **1** — 7 passed, **9 failed** |

Both files were then restored (`grep -c MUTANT` → `0` in each) and the suites re-run green. Weakening the allowlist cannot pass silently.

### Not run, and why

`npm run lint` (`eslint . --ext ts,tsx`) **cannot run in this repository at any commit**: ESLint 9.39.4 is installed, there is no `eslint.config.*` flat config, and the script still uses the removed ESLint 8 `--ext` flag. This is pre-existing on `main`, unrelated to F3-SEC-004, and **no CI workflow invokes lint** (`grep -n "run lint" .github/workflows/*.yml` → no matches). Not fixed here; flagged.

## 11. Migration status

**MIGRATION_REQUIRED = NO.** `ClinicLegalProfile.website` stays `String?` — no Prisma schema edit, no migration file, no backfill, no data rewrite. The change is validation and rendering only.

## 12. Tenant isolation impact

**None.** No authorization expansion, no clinic-scope change, no cross-domain access. `LEGAL_PROFILE_ROLES` (`OWNER` / `ORG_ADMIN` / `CLINIC_MANAGER`), `authorize(...)` and `resolveEffectiveClinicId` are untouched; existing write authorization is preserved exactly. The only behavioural change for an authorized writer is that a non-http(s) website value is now rejected with 400 instead of accepted. No `SELECT` shape changed; the public endpoint returns the same fields, with one field's *value* nulled when unsafe.

## 13. KVKK / security impact

Reduces public stored-XSS exposure on an unauthenticated, clinic-facing KVKK page — the page whose entire purpose is to carry the privacy notice. No new processor or subprocessor, no new data egress, no change to secret handling, no new logging (the scan emits counts only, no URLs and no identifiers). No personal data is newly collected, transmitted or retained.

## 14. Backward compatibility

- Existing legitimate `http`/`https` values continue to render as clickable links, unchanged (same `href`, `target`, `rel`, styling).
- `''`, whitespace-only, `null` and omitted continue to save, so the settings form keeps working for clinics with no website.
- The public API response shape is unchanged; `website` was already optional/nullable, so a consumer already had to handle absence.
- Unsafe legacy values become **non-clickable immediately on frontend deployment**, before any data cleanup.
- One intended behaviour change: a write of a non-http(s), non-blank website now returns **400** instead of persisting. That is the fix.

**Known UX wart, flagged not fixed (out of scope).** `ClinicKvkkSection.tsx` renders a generic `t('kvkk.saveError')` for any failed save, so a user who types a scheme-less `clinic.example` now sees an opaque error rather than "add https://". This is a pre-existing generic-error pattern, not a regression introduced here, and correcting it means new i18n keys across locales — beyond this task's scope. **Recommended follow-up**, at the operator's discretion.

## 15. Rollback

Repository revert of the branch/PR. **No DB rollback, no migration to reverse, no data restored** — nothing was written to any database. Reverting restores the prior (vulnerable) behaviour exactly.

## 16. Program state — explicitly unchanged

`R-030`, `R-030-DB`, `R-030-FILES`, `FIRST_CUSTOMER_RECOVERY_GATE`, F4 completion state and F5 authorization are **not edited by this task**. The F3 exit gate is **not** advanced: R-076 is named by none of its three criteria, consistent with the R-034 / R-075 precedent.

**R-076 is `OPEN`.** At PR stage this task claims at most `AGENT_COMPLETED` / `TESTS_PASSED` / `PR_OPENED`. Closure requires `MERGED` + `DEPLOYED` + `PRODUCTION_VERIFIED`, and per the R-019/R-071/R-072/R-073/R-075 precedent F3-SEC-004 cannot close the risk it just remediated.

## 17. Exact next operator/reviewer action

1. Review and merge the Draft PR (`fix(security): restrict clinic legal-profile website URLs (R-076)`).
2. Deploy **frontend and backend together**; the frontend half is what makes existing unsafe values non-clickable.
3. Run the §8 read-only scan on production and record the three integers here.
4. Production-verify: a published clinic's KVKK page still links a legitimate `https` website; a `javascript:` write is rejected with 400.
5. Only then may architecture review consider `R-076` for closure — by a task other than F3-SEC-004.
6. If `potentially_unsafe > 0`, open a separate controlled remediation task for those rows.
