# F3-WA-META-COEX-002 — NoraMedi Meta App Production Readiness & Official Coexistence Enrollment

Task ID (ClickUp): `869egqrnk` · Parent Epic: F3-WA-META-COEX (`869egqrad`) · Phase: F3 — Production Hardening

**Outcome: STATE C — BLOCKED / UNVERIFIED**, with several items additionally requiring **STATE B — USER ACTION REQUIRED** (live Meta Business/Developer Dashboard access this environment does not have). No Meta production configuration was made or recommended for immediate action. No runtime code was modified.

This document distinguishes three evidence classes throughout, per the task's Gate 0 requirement:

- **[REPO]** — directly observed from repository source (`git`, `Read`/`Grep` against tracked files) in this session
- **[GITHUB]** — directly observed from the GitHub API (PRs, branches) in this session
- **[UNVERIFIED]** — a Meta-provider requirement that could **not** be confirmed against primary Meta documentation or a live Meta Dashboard in this session; no assumption is substituted

There are no **[ASSUMED]** entries in this document by design (task instruction: "there should be none").

---

## 0. Critical program-control discrepancy found before any Meta verification work

The task brief states the predecessor **F3-WA-META-COEX-001 was "ACCEPTED by program owner"** and instructs this task to record it in `NORAMEDI_MASTER_TRACKER.md` as `AGENT_COMPLETED / AUDIT_ACCEPTED / READ_ONLY / NO_PR / NOT_DEPLOYED / NOT_PRODUCTION_VERIFIED`.

**[REPO]** A targeted search of the entire `docs/program/` tree (`grep -ri` for `F3-WA-META-COEX`, `WA-META`, `META_COEX`, `Coexistence`, `Embedded Signup` combined with `WhatsApp`) found **zero references** to `F3-WA-META-COEX-001`, its ClickUp ID, or any Coexistence-specific evidence file, anywhere in `NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, `phases/F3_PRODUCTION_HARDENING.md`, `RISK_REGISTER.md`, or `evidence/README.md`.

**[GITHUB]** A GitHub PR search across the repository for `meta`, `whatsapp`, `coexistence`, `embedded signup`, `WA-META`, `COEX`, and the ClickUp ID `869eg` found **zero PRs** referencing COEX-001. The only F3-phase WhatsApp/Meta-adjacent PRs found are historical, pre-F3 feature work (e.g. PR #109 "Make Meta WhatsApp connection UI Embedded Signup-first", PR #110–112, #118–119, #39, #32) — none carry an F3-WA-META-COEX task tag.

**One artifact is suggestive but inconclusive:** this session's own branch, `claude/noramedi-meta-app-readiness-fjqzxe`, was reported by `git fetch --prune` as `[deleted]` on `origin` — i.e. a remote branch of that exact name existed and was removed (consistent with, but not proof of, a prior squash-merge-and-delete). No corresponding merged PR, commit, or evidence file was found under that branch name or any derivative.

**Disposition:** per this task's own authority hierarchy (§ Program Control: "1. current repository origin/main" is authoritative over the task brief's prose, and "Do not overwrite newer repository evidence"), **the claim that COEX-001 was completed and accepted is not corroborated by repository or GitHub evidence.** This document does **not** write a COEX-001 status entry into `NORAMEDI_MASTER_TRACKER.md`, because doing so would assert a historical fact this session cannot verify — which the task's own rules forbid ("Do not rewrite historical entries," "No fabricated conclusions"). This is surfaced as **USER ACTION REQUIRED item #0** (§13 below) rather than resolved unilaterally.

Independent of that discrepancy, this session **did** independently reproduce and confirm several of the technical findings attributed to COEX-001 (raw OAuth dialog usage, missing CSRF state validation, absent `subscribed_apps`/phone-registration provisioning) directly from current repository source — see §6/§11/§12. Those specific technical claims are corroborated by fresh, independent code inspection regardless of whether the COEX-001 task record itself exists.

---

## 1. Baseline (§1 of task)

**[REPO/GITHUB]**

| Field | Value |
|---|---|
| `origin/main` SHA | `1e7c3bbd1012f0c83ec1747b9f12f5cde9c12661` (merge commit, PR #358 / F3-IMPL-003) |
| Working tree at session start | Clean (`git status --short` empty) |
| Starting branch | `claude/noramedi-meta-app-readiness-fjqzxe`, HEAD = `origin/main`, no drift |
| `git worktree list` | Single worktree, no other active worktrees on this host |
| Branch used for this task's documentation | `docs/f3-wa-meta-coex-002-meta-app-readiness`, created fresh from `origin/main` @ `1e7c3bb` |

`origin/main` had advanced since F3-IMPL-002's baseline (`1909b18`) by two merges (F3-IMPL-002 itself, `d1765a5`→`1e7c3bb` via F3-IMPL-003/#358); no relevant WhatsApp/Meta file changed in that delta (confirmed via `git diff --name-only` on the two merge commits touching only `ecosystem.config.cjs`, `scripts/noramedi-deploy.sh`, `processRole.ts`, and `platformAdmin.ts`/tests).

---

## 2. Current F3 parallel work (§2 of task)

**[GITHUB]** PR #356, `fix(logging): PII/PHI runtime log hygiene wave 1 (F3-IMPL-004)`, branch `feature/f3-impl-004-pii-log-hygiene-wave1`, **state: open, not merged**, based on `origin/main` @ `1909b18` (stale relative to current `origin/main`, i.e. not yet rebased). This confirms F3-IMPL-004 is a real, currently-active task — contrary to this session's first read of `F3-IMPL-003`'s own evidence doc, which only *proposed* `F3-IMPL-004` as a placeholder ID "to avoid colliding with any task already using that id" for an unrelated platform-admin-audit follow-up. That naming collision (two different pieces of work both informally called "F3-IMPL-004") is noted here as a minor program-hygiene finding, not something this task resolves.

**[REPO]** PR #356's actual diff was not inspected in depth (out of this task's targeted scope), but its title scope ("PII/PHI runtime log hygiene") is disjoint from the five WhatsApp/Meta files this task was scoped to (§3). This task made **no changes to any file that could plausibly be touched by F3-IMPL-004**, satisfying the task's isolation requirement.

---

## 3. CodeGraph scope and repository files inspected (§3 of task)

**CodeGraph tool: not available in this session's tool surface** (`ToolSearch` for "CodeGraph" returned no matching deferred tool). This is a documented fallback, not a silent scope expansion: targeted `Grep`/`Read` inspection was used instead, strictly bounded to the five files the task named plus their two direct dependents that the task itself implied (`MetaCallbackPage.tsx`, the OAuth redirect target the launch flow `window.open`s) and the `WhatsAppConnection` Prisma model. No repository-wide search was performed.

Files inspected:

- `server/src/routes/organizationWhatsApp.ts` (1,297 lines) — OAuth callback route, token exchange, connection persistence
- `server/src/routes/metaWhatsAppWebhook.ts` (432 lines) — webhook verification/routing
- `server/src/services/whatsapp/MetaCloudWhatsAppProvider.ts` (342 lines) — Graph API send/receive client
- `server/src/services/metaTemplateService.ts` (302 lines) — template sync
- `src/pages/WhatsAppConnections.tsx` (1,444 lines) — frontend launch/callback-handling UI
- `src/pages/MetaCallbackPage.tsx` (133 lines) — OAuth popup redirect target (not in the task's named list; read because `WhatsAppConnections.tsx` line 552 `window.open`s directly to it, making it load-bearing for the CSRF/postMessage-origin assessment in §11)
- `server/prisma/schema.prisma` — `WhatsAppConnection` model only (lines 1662–1714); `ClinicWhatsAppConnection` model header (1716+)
- `server/.env.example`, `.env.example` — variable names only
- `docs/program/RISK_REGISTER.md` — grep for `R-018`/`R-019`/`R-022`/`WhatsApp`/`Meta App`

### Established facts (frontend Meta onboarding launch path → callback → persistence)

1. **Launch (`WhatsAppConnections.tsx:528–557`):** `handleMetaEmbeddedSignup()` builds a URL by hand — `https://www.facebook.com/{VITE_META_GRAPH_API_VERSION}/dialog/oauth?client_id=...&redirect_uri=...&response_type=code&scope=whatsapp_business_management,whatsapp_business_messaging` plus, only if a config ID is present, `config_id` and `extras={"setup":{},"featureType":"","sessionInfoVersion":"3"}`. It is opened with `window.open(...)`, **not** via the Meta JS SDK (`FB.init`/`FB.login`). No `state` parameter is ever added to this URL. This is a raw OAuth-dialog popup, not the JS SDK Embedded Signup call Meta's Coexistence flow is documented (per COEX-001 and the search evidence in §6) to require.
2. **Redirect target (`MetaCallbackPage.tsx`):** served at `VITE_META_REDIRECT_URI`. Reads `code`, `state`, `error` from the query string and `postMessage`s them (origin-restricted to `window.location.origin`) to `window.opener`. Never validates `state` against anything — it only forwards whatever value Meta's redirect happened to carry.
3. **Popup message handler (`WhatsAppConnections.tsx:562–617`):** validates `event.origin === window.location.origin` (correct use of `postMessage` origin checking) and `data.type === 'meta_signup_callback'`, then calls `whatsappConnectionService.metaCallback({ code, wabaId, phoneNumberId, phoneNumber, displayName, businessId, linkedClinicIds })`. **`data.state` is read into the payload type but never sent to the backend and never compared against anything client-side.**
4. **Backend callback (`organizationWhatsApp.ts:940–1030`):** `metaCallbackSchema` (Zod) has **no `state` field at all**. The route exchanges `code` for a token via `POST https://graph.facebook.com/{META_GRAPH_API_VERSION}/oauth/access_token` using `META_APP_ID`/`META_APP_SECRET`/`META_REDIRECT_URI` from `process.env`, encrypts the resulting token (`encryptSecret`, AES-256-GCM per the Prisma model comment) into `metaAccessTokenEncrypted`, and upserts a `WhatsAppConnection` row keyed by `(organizationId, metaPhoneNumberId)`.
5. **No `state` generation or validation exists anywhere in this call path** — confirmed by `grep -i "state|csrf|nonce"` across `organizationWhatsApp.ts` returning zero hits outside an unrelated docstring. See §11.
6. **No `subscribed_apps`, phone-registration, or PIN/two-step-verification Graph API call exists anywhere in `MetaCloudWhatsAppProvider.ts`, `organizationWhatsApp.ts`, or `metaTemplateService.ts`** — `grep -i "subscribed_apps|register|two_step|pin"` across these files returned zero relevant hits. The only Graph API calls found are outbound message sends (`messages` endpoint) and template CRUD. See §12.
7. **No token refresh / `debug_token` / long-lived-token-exchange logic exists** in `metaTemplateService.ts` or the provider. The Prisma schema carries a `metaTokenStatus`/`metaTokenExpiresAt`/`metaTokenLastCheckedAt` tracking triad and a comment "Meta tokens expire ~60 days unless refreshed," but no code path that actually performs a refresh was found in the five inspected files.
8. **Webhook route (`metaWhatsAppWebhook.ts`):** implements Meta's standard `hub.mode`/`hub.verify_token`/`hub.challenge` GET verification handshake against `META_WEBHOOK_VERIFY_TOKEN` (global) with a per-connection `metaWebhookVerifyToken` override path. This part of the contract matches the generically-documented Meta webhook verification pattern (stable across Graph API versions) and is the one piece of this task's scope that did **not** require primary-source re-verification to describe accurately, since it was inspected as literal running code, not inferred.

None of the above required scope expansion beyond the named files plus the one direct dependent (`MetaCallbackPage.tsx`) noted above.

---

## 4–7, 9, 12. Meta provider-contract verification — BLOCKED (Gate 0)

**This is the load-bearing blocker for the entire task.** Per Gate 0, only primary Meta documentation, Meta's official Postman collection, or direct Meta Dashboard evidence may serve as final evidence for any Meta-provider-contract claim (account model, permissions, Advanced Access, App Review, Embedded Signup/Coexistence launch contract, QR behavior, `subscribed_apps`/phone-registration requirements, Business verification, Tech Provider/Solution Partner enrollment).

### What was attempted

1. **Direct fetch of primary Meta sources** (`WebFetch`) against:
   - `https://developers.facebook.com/docs/whatsapp/embedded-signup/coexistence`
   - `https://developers.facebook.com/docs/whatsapp/embedded-signup/`
   - `https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/`
   - `https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation`
   - `https://www.facebook.com/business/help/whatsapp-business-app-coexistence`

   **Every one of these returned `EGRESS_BLOCKED`** — the tool's own error, not a 404 or content issue: `"Access to developers.facebook.com is blocked by the network egress proxy."` / same for `www.facebook.com`.

2. **Confirmed this is a policy-level block, not a transient failure.** Direct `curl` to `developers.facebook.com` failed identically (`exit 56`, `CONNECT tunnel failed, response 403`), and the environment's own proxy-status endpoint (`$HTTPS_PROXY/__agentproxy/status`) logged the event explicitly: `{"kind":"connect_rejected","detail":"gateway answered 403 to CONNECT (policy denial or upstream failure)","host":"developers.facebook.com:443"}`. This reproduces — independently, in a different session/container — the exact limitation COEX-001 is reported to have hit ("the audit environment could not directly load developers.facebook.com").
3. **Attempted an alternate first-party route via `web.archive.org`** (an archived copy of Meta's own page text would still count as first-party content). `WebFetch` for `web.archive.org` was rejected outright by the tool itself ("Claude Code is unable to fetch from web.archive.org"), independent of the egress proxy.
4. **`WebSearch`** (explicitly permitted only to *locate* an official source, never as final evidence per Gate 0) surfaced search-engine-synthesized snippets referencing `developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/...` pages, including claims that `extras.featureType` must be `whatsapp_business_app_onboarding` (with `coexistence` said to be a deprecated value) and `extras.sessionInfoVersion` should be `"3"`. **These snippets are explicitly not treated as verified evidence in this document** — they could not be corroborated against the actual page (blocked, per above), they are a third-party search summary of Meta's docs rather than the docs themselves, and Gate 0 forbids finalizing on search-result summaries. They are recorded here only as a lead for whoever next has unblocked access, not as a verdict.
5. No Postman collection, Meta Business Dashboard, or Meta Developer Dashboard access was available in this session (no credentials, no browser session, no user-supplied screenshots at the time of this report).

### Verdicts

Every item under task §§4, 5, 6, 7, 9, and 12 that depends on the current Meta provider contract is classified **`UNVERIFIED`** in this session, specifically:

| Item | Verdict | Why |
|---|---|---|
| One-App/many-WABA architecture validity | `UNVERIFIED` | Cannot confirm current Meta Tech Provider/multi-WABA rules from primary source |
| Meta Business Portfolio requirement | `UNVERIFIED` | — |
| Business verification requirement | `UNVERIFIED` | — |
| Tech Provider enrollment requirement | `UNVERIFIED` | — |
| Solution Partner enrollment requirement | `UNVERIFIED` | — |
| WhatsApp product / App Review requirement | `UNVERIFIED` | — |
| Advanced Access requirement (per permission) | `UNVERIFIED` | — |
| Facebook Login for Business requirement | `UNVERIFIED` | — |
| Exact permission set (`whatsapp_business_management`, `whatsapp_business_messaging`, `business_management`) — necessity/access-tier | `UNVERIFIED` (repo-observed: the frontend currently requests only the first two as OAuth `scope`, §3 item 1 — that is a repo fact, not a Meta-requirement verdict) | — |
| Embedded Signup exact JS SDK contract (`FB.init`, `FB.login`, `config_id`, `response_type`, `override_default_response_type`, `extras`, `featureType`, `sessionInfoVersion`) | `UNVERIFIED` | Search-engine snippets exist (see above) but are explicitly excluded as final evidence by Gate 0 |
| Whether raw `facebook.com/dialog/oauth` redirect (what the repo currently does — §3 item 1) is a supported alternative to the JS SDK popup for Coexistence specifically | `UNVERIFIED` | This is the single most consequential open question for the "Architectural Decision" in the mission brief, and it cannot be answered from this session |
| Coexistence QR: still part of official flow / Meta-rendered / raw QR ever returned to NoraMedi / eligibility conditions / existing WA Business App account fate / same-number continued use | `UNVERIFIED` (all sub-items individually, per task instruction not to generalize) | — |
| `subscribed_apps` requirement | `UNVERIFIED` (Meta requirement) / **repo fact:** not implemented (§3 item 6) | — |
| Phone registration / PIN (two-step verification) requirement | `UNVERIFIED` (Meta requirement) / **repo fact:** not implemented (§3 item 6) | — |
| WABA/phone discovery, token exchange model, long-lived credential model, expiration/renewal, deauthorization/offboarding | `UNVERIFIED` (Meta requirement) / **repo fact:** no refresh logic exists (§3 item 7) | — |
| Full production readiness matrix (§9 of task: business verification, App status, live mode, domains, redirect URI validity, JS SDK allowed domain, App Review, Advanced Access, webhook fields subscription, WABA subscription capability, token strategy, env separation) | `UNVERIFIED` throughout | Every row requires either primary Meta docs (blocked) or live Dashboard access (not available — see §13) |

No configuration or implementation recommendation is made on any of the above per Gate 0's explicit instruction to STOP.

---

## 8. NoraMedi Meta App environment-variable inventory (§8 of task)

**[REPO] Expected variable names** (from `.env.example` / `server/.env.example`, names only, no values read or printed):

| Variable | Side | Status in this session's environment |
|---|---|---|
| `META_APP_ID` | backend | `ABSENT` (not set in this ephemeral session container) |
| `META_APP_SECRET` | backend | `ABSENT` |
| `META_GRAPH_API_VERSION` | backend | `ABSENT` (code default `v23.0` used if unset — `organizationWhatsApp.ts:981`) |
| `META_EMBEDDED_SIGNUP_CONFIG_ID` | backend | `ABSENT` |
| `META_REDIRECT_URI` | backend | `ABSENT` |
| `META_WEBHOOK_VERIFY_TOKEN` | backend | `ABSENT` |
| `ENCRYPTION_KEY` | backend | `ABSENT` |
| `VITE_META_APP_ID` | frontend | `ABSENT` |
| `VITE_META_EMBEDDED_SIGNUP_CONFIG_ID` | frontend | `ABSENT` |
| `VITE_META_GRAPH_API_VERSION` | frontend | `ABSENT` |
| `VITE_META_REDIRECT_URI` | frontend | `ABSENT` |

**Critical caveat — this table describes this session's isolated container only, not production.** This session runs in a freshly-cloned, ephemeral cloud environment with no production credentials, no VPS access, and no Meta Dashboard session. `ABSENT` here means "not present in this sandbox's `env`" — it is **not** evidence about whether NoraMedi's actual production or staging VPS has these variables set. That determination is `UNVERIFIED` and requires the user (§13, item #2).

No value of any of the above was read, printed, or stored at any point in this session — only `.env.example` variable **names** and this session's own (empty) `env` variable **names** were inspected, exactly as the task's secret-handling rules require.

---

## 10. Environment separation (dev/staging/production) — recommendation

**[REPO fact, general Meta-platform reasoning, not a Meta-source-verified claim]:** the repository currently has exactly one set of `META_*`/`VITE_META_*` variable names, with no dev/staging/prod suffixing or environment-scoping convention visible in `.env.example`. Combining this with generally-known (not re-verified here, since Gate 0 blocks it) Meta OAuth mechanics — a single Meta App has one fixed set of "Valid OAuth Redirect URIs" and "App Domains," and `state`/`code`/webhook payloads are not environment-tagged by Meta — sharing one Meta App across dev/staging/production would very likely create:

- **Webhook collision:** one webhook URL/verify-token per Meta App; simultaneous dev and prod traffic could not be cleanly routed without additional in-repo disambiguation logic that does not currently exist.
- **Redirect-domain collision:** every environment's callback origin (`VITE_META_REDIRECT_URI`) would need to be simultaneously whitelisted on the same App, widening the App's registered domain surface.
- **Credential blast radius:** a single `META_APP_SECRET` compromise in any one environment would compromise all environments' token-exchange capability.
- **WABA/testing contamination risk:** test WABAs/phone numbers created during dev/staging testing would be discoverable/connectable through the same App as production customer WABAs, with no repository-level guard preventing a dev-environment code path from writing a production `WhatsAppConnection` row.

**Recommendation (not yet Meta-source-verified, flagged as such):** separate Meta Apps per environment (dev / staging / production) is the safer default and is consistent with how the repository already separates other provider credentials by environment convention elsewhere in `.env.example`. **This recommendation should be re-confirmed once Gate 0's block is lifted**, specifically for two open questions this session cannot answer: (a) whether Meta's Coexistence/Embedded Signup feature has any App-count or App-review restrictions that make multiple Apps operationally harder than for standard Cloud API-only integrations, and (b) whether Tech-Provider-tier accounts (if NoraMedi's model requires that tier — itself `UNVERIFIED`, §4–7) have different multi-App norms. No Meta App was created or modified as part of issuing this recommendation.

---

## 11. Security review (§11 of task)

| Finding | Classification | Evidence |
|---|---|---|
| OAuth `state` param not generated with a stored nonce, not sent from frontend to backend, not validated on callback (CSRF exposure on the Embedded Signup callback) | **`CONFIRMED`** | §3 items 1–5: `WhatsAppConnections.tsx:538-543` (no `state` added to outbound URL), `MetaCallbackPage.tsx:32,40` (reads/forwards `state` but never checks it), `WhatsAppConnections.tsx` message handler (destructures `data.state` at line 569 but never uses it), `organizationWhatsApp.ts` `metaCallbackSchema` (no `state` field, so the backend could not validate it even if the frontend sent it) |
| `postMessage` origin verification | `REJECTED` as a finding — implemented correctly | `WhatsAppConnections.tsx:564`: `if (event.origin !== window.location.origin) return;` is present and correct; `MetaCallbackPage.tsx:58`: `opener.postMessage(payload, ALLOWED_ORIGINS[0])` correctly targets same-origin rather than `'*'` |
| App Secret handling in token exchange | `REJECTED` as a finding — implemented correctly | `organizationWhatsApp.ts:995-1006`: `client_secret` sent via URL-encoded POST body (not query string/URL), never logged, never returned to the client |
| Token-at-rest encryption | `REJECTED` as a finding — implemented correctly, within its threat model | `metaAccessTokenEncrypted` / AES-256-GCM via `encryptSecret` (Prisma schema comment, corroborated by `organizationWhatsApp.ts:1057` call site) |
| Duplicate `phone_number_id` risk | `REJECTED` as a finding — guarded | `organizationWhatsApp.ts:1033-1036`: lookup keyed on `(organizationId, metaPhoneNumberId)` before insert, `metaPhoneNumberId` also carries a DB-level `@unique` constraint (schema line 1683) — this prevents two organizations from silently attaching to the same Meta phone number |
| Tenant mix-up during callback / WABA ownership verification | `CONFIRMED` gap, narrower than a full mix-up: the callback route trusts whatever `phoneNumberId`/`wabaId`/`businessId` the frontend sends after a successful Meta OAuth exchange, with **no server-side call back to Meta's Graph API to confirm the authenticated token actually owns that WABA/phone number** before persisting the connection. Combined with the missing CSRF state validation above, a crafted callback-page interaction could plausibly attach an attacker-controlled or mismatched WABA/phone identifier to a victim organization's connection record. This is a code-level finding from direct inspection (`organizationWhatsApp.ts:940-1030` accepts `wabaId`/`phoneNumberId`/`businessId` from client-submitted JSON with no server-side Graph API cross-check against the exchanged `accessToken`) — **not fixed here** (out of scope, §14 of task), flagged as an implementation requirement for the next runtime task |
| Authorization-code leakage (via logs, referrers, etc.) | `UNVERIFIED` | Would require log-output inspection under load / production log review, out of this task's static-code-only scope |
| Replay of a captured `code` | `REJECTED` as a material finding — inherently mitigated by Meta's own OAuth `code` single-use/short-TTL semantics (a Meta-platform property, not something the repo implements or needs to) |

**No auth was weakened.** No fix was applied to the `CONFIRMED` CSRF and WABA-ownership-verification gaps — per task instruction §14, these are recorded as implementation requirements for **F3-WA-META-COEX-004** (frontend/backend implementation task), not resolved in this documentation-only task.

---

## 12. Post-signup dependency confirmation for COEX-003

Repo-observed facts only (Meta-requirement verdicts are `UNVERIFIED`, §4–7 above, and are **not** repeated here as if resolved):

| Dependency | Meta-requirement verdict | Repo-implementation fact |
|---|---|---|
| `subscribed_apps` (Graph API webhook-app-subscription step) | `UNVERIFIED` | **Not implemented** anywhere in the five inspected files |
| Phone registration / PIN (two-step verification) | `UNVERIFIED` | **Not implemented** |
| WABA discovery / phone number discovery (post-signup enumeration calls) | `UNVERIFIED` | **Not implemented** — the callback route relies entirely on client-submitted `wabaId`/`phoneNumberId` (§11) rather than calling Graph API to discover them server-side |
| Webhook subscription (per-WABA, distinct from app-level `subscribed_apps`) | `UNVERIFIED` | **Not implemented** in the inspected files; `metaWhatsAppWebhook.ts` only implements the inbound verification handshake and payload routing, not outbound subscription management |
| System-user/BISU access | `UNVERIFIED` | **Not implemented** — token model is the OAuth user-token from the Embedded Signup exchange only, no system-user provisioning code found |
| Token exchange | Standard OAuth `code`→token Graph API call — this specific mechanic (POST to `/oauth/access_token` with `client_id`/`client_secret`/`code`/`redirect_uri`) is implemented and matches the generic OAuth2 authorization-code pattern; **not independently re-verified against current Meta-specific documentation** in this session | **Implemented** (`organizationWhatsApp.ts:991-1023`) |
| Long-lived credential model / token expiration / renewal | `UNVERIFIED` | Tracking fields exist (`metaTokenStatus`/`metaTokenExpiresAt`/`metaTokenLastCheckedAt`) but **no renewal code path found** |
| App deauthorization / offboarding | `UNVERIFIED` | No deauthorization webhook handler or offboarding flow found in the inspected files |

This table is the authoritative input this task can hand to **F3-WA-META-COEX-003** for now: everything in the "repo-implementation fact" column is a real, confirmed gap; everything in the "Meta-requirement verdict" column must be independently re-verified by whoever next has primary-source Meta access before COEX-003 designs the provisioning flow.

---

## 13. User action required

Multiple items in this task cannot be closed without a human interacting with the Meta Business/Developer Dashboard, or clarifying program history. None of the following were guessed or fabricated.

**#0 — COEX-001 program-history discrepancy (§0 above).** No dashboard action needed; needs the program owner to clarify: does `F3-WA-META-COEX-001` evidence exist somewhere outside this repository (e.g. not yet merged, or tracked in an external system), or was it not actually completed/accepted as the task brief states? This blocks recording any COEX-001 status entry in `NORAMEDI_MASTER_TRACKER.md` without fabricating one.

**#1 — Meta App / Business account model, verification, and enrollment status.** Needed to answer §4 verdicts (Business verification, Tech Provider/Solution Partner enrollment, App Review, Advanced Access).
1. Open: Meta Business Suite → Business Settings → **Business Info**, and separately, developers.facebook.com → your App → **App Review** → **Permissions and Features**.
2. Inspect: the Business Verification status badge (e.g. "Verified"/"Not started"/"In review"), and, for each of `whatsapp_business_management`, `whatsapp_business_messaging`, `business_management`: whether it shows **Standard Access** or **Advanced Access**, and whether an App Review submission exists/its status.
3. Do **not** share: App Secret, any access token, any system-user token, login password, 2FA code, `ENCRYPTION_KEY`.
4. Safe to share: a screenshot of the Business Verification status page; a screenshot of the App Review → Permissions and Features list (approval column only); the App's numeric **App ID** (not secret) if convenient — masking the last few digits is fine and preferred.
5. Decision this unblocks: whether NoraMedi's current Meta App already satisfies the enrollment prerequisites this mission needs, or whether Business Verification / App Review submission is a prerequisite step that has to happen before any Embedded Signup work can go live for real clinics.

**#2 — Actual production/staging environment variable presence.** Needed because this session's own container has none of the `META_*`/`VITE_META_*` variables set (§8) and cannot see the real VPS.
1. On the production (and staging, if separate) host, run (read-only, no output piping to any external service): `env | grep -oE '^(VITE_)?META_[A-Z_]+' | sort -u` and, separately, `printenv ENCRYPTION_KEY >/dev/null && echo SET || echo ABSENT`.
2. Do **not** share the actual values — only which variable **names** are `SET` vs `ABSENT`, exactly as the commands above already redact.
3. Decision this unblocks: whether the runtime prerequisites for the current (raw-OAuth) flow are even configured in production today, independent of whether that flow is the correct one going forward.

**#3 — Embedded Signup Config ID and Coexistence feature availability.** Needed to answer §6/§7 verdicts.
1. Open: developers.facebook.com → your App → **WhatsApp** → **Configuration** (or **Embedded Signup** setup screen, naming varies by Meta's current UI).
2. Inspect: whether a Configuration ID exists at all for this App; if it does, whether its feature/flow type is described in the dashboard UI as Coexistence / "WhatsApp Business app onboarding" (Meta's UI copy is the ground truth here, not this document's earlier search-snippet lead about a renamed `featureType`); whether the Coexistence option is even offered as a selectable flow type for this App (Meta gates this by region/vertical/account eligibility in ways this session cannot verify).
3. Do **not** share: any embedded webview session token, any code visible in a completed test run.
4. Safe to share: a screenshot of the Configuration/Embedded Signup setup screen showing the flow-type selector and whether Coexistence is present/selectable; the Configuration ID itself (not secret, but mask it in shared program docs per the task's own preference for masking non-secret IDs too).
5. Decision this unblocks: whether §6's "Classify existing NoraMedi frontend: READY / PARTIAL / NOT_READY" can be answered — it currently cannot, because it depends on knowing the actual current Configuration's flow type, which this session cannot see.

Until #1–#3 are answered (and #0 is clarified), **no further Meta-provider-contract verdict in this document can move past `UNVERIFIED`**, and per Gate 0, no dependent configuration or implementation action should be taken.

---

## 14. Repository changes made by this task

**None to runtime code.** This task did not modify, and did not need to modify, any of the files listed in the task's explicit prohibition (`organizationWhatsApp.ts`, `metaWhatsAppWebhook.ts`, `services/whatsapp/**`, `WhatsAppConnections.tsx`, `schema.prisma`, migrations). Only this evidence document and the minimal, additive changelog lines in `CURRENT_PHASE.md` / `phases/F3_PRODUCTION_HARDENING.md` described in the delivery report were added.

---

## 15. Validation performed

- `git diff --check` — run against the final diff before commit (result recorded in the delivery report)
- `git status --short` — confirms only `docs/program/**` paths changed
- `git diff --name-only origin/main` — confirms no runtime file appears
- Manual secret scan of the full diff for `META_APP_SECRET`, `access_token`, `Authorization:`, `Bearer`, `ENCRYPTION_KEY`, `client_secret`, `appsecret_proof`, `token=` — see delivery report for exact result

No automated test suite was run — this is documentation/evidence-only work with no runtime code change, so `TESTS_PASSED` is `NOT_APPLICABLE` per task §19.
