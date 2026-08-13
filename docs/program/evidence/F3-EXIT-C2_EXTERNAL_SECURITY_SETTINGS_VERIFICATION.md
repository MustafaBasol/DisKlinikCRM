# F3-EXIT-C2 — External Security-Settings Verification and Decision-Owner Acceptance

**Task ID:** `F3-EXIT-C2`
**Phase:** F3 — Production Hardening
**Date:** 2026-08-13
**Baseline:** `origin/main` @ `021c43d5fbeae3c9b03c904ac30b0bb4708c80ad` (PR #406's merge commit), clean worktree, no drift
**Branch:** `docs/f3-exit-c2-external-security-verification`
**Type:** Verification / evidence-closure only. **No runtime, schema, migration, dependency or configuration file is changed by this task, and no external control-plane setting was mutated.**

---

## 0. What this task is and is not

This task determines whether **F3 exit criterion 2** is *provably* satisfied. It does **not** attempt to make it green, and it does not perform remediation.

It is an **external verification** task. Where a fact could be observed from outside (GitHub's control plane, the public TLS endpoints), it was observed directly and recorded. Where a fact requires production-host or production-database access, it is recorded as `BLOCKED` with an explicit operator command package (§9) — never inferred, and never upgraded to `PASS` because the repository "probably" reflects production.

**This task does not close R-073 or R-019.** Repository policy forbids an agent self-closing a risk; the decision-owner templates are reproduced unsigned in §8.

---

## 1. Authoritative criterion wording

F3's exit gate, verbatim and unreordered (`docs/program/phases/F3_PRODUCTION_HARDENING.md:102-106`):

```
## Exit gate (Çıkış kapısı)

- Gözlemlenebilirlik standardı canlıda kanıtla çalışıyor (log/metrik/trace/alarm)
- Güvenlik sertleştirme kontrol listesi kapatılmış
- Olay müdahale prosedürü tatbikatla doğrulanmış
```

Criterion 2 is the second bullet: **"Güvenlik sertleştirme kontrol listesi kapatılmış"** — *the security-hardening checklist is closed.*

**Criterion 2 is not atomic.** The phase document's own live decomposition (`F3_PRODUCTION_HARDENING.md:12`) states what remains:

> Independent external verification of GitHub repository Code security and analysis settings, TLS certificate/protocol, Redis/replica topology, and platform-admin MFA-enrollment coverage (all `PASS_WITH_EXTERNAL_VERIFICATION`/`OPEN_EXTERNAL_CONFIGURATION` since F3-SEC-EXIT-001); plus decision-owner acceptance records for **R-073** and **R-019**, both still `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION`.

The referenced checklist is `evidence/F3-SEC-EXIT-001_FIRST_CUSTOMER_SECURITY_HARDENING_GATE.md`, items A–X, whose §5 "External production verification checklist" enumerates **ten** external items, not four. **This discrepancy is itself a finding — see §7.**

---

## 2. Dependency and blocker inventory

| Item | Tracker state at task start | Required evidence | Owner | Blocking criterion 2? |
|---|---|---|---|---|
| Criterion 1 (observability) | `SATISFIED` (2026-08-13, F3-OBS-002-CLOSE) | — | — | No — already satisfied, not transitive |
| Criterion 2 (security checklist) | `NOT SATISFIED`, unassessed since F3-SEC-EXIT-001 | This document | — | **Is the criterion** |
| Criterion 3 (IR drill) | `NOT SATISFIED` — awaits a program-owner sufficiency decision on F3-IR-001's `SIMULATED` tabletop | Program-owner decision | Program owner | No (separate criterion) |
| R-074 | `CLOSED` (2026-08-13) | — | — | No |
| R-073 (platform-admin session revocation) | `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION` | Signed decision-owner acceptance (Path A or B) | **Unnamed — field blank** | **YES** |
| R-019 (platform-admin yetki aşımı) | `Durum` = `OPEN`; adjacent token `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION` | Signed decision-owner acceptance | **Unnamed — field blank** | **YES** |
| R-018 (log sızıntısı) | `OPEN` / `UNVERIFIED` | 103 grandfathered + 92 review-only sites | F3-IMPL-004/006/007 lineage | **Contested — see §7.3** |
| R-076 (probable stored XSS) | `OPEN` | Own remediation task | Unassigned | No — its own row says *"F3 (not part of F3's 3-item exit gate)"* |
| R-077 (script drift) | `OPEN`, half-resolved | Drift-prevention mechanism | — | No — not named by any criterion |

No older document was found claiming criterion 2 is already complete. Every reference is mutually consistent at `NOT SATISFIED`.

---

## 3. Criterion-2 evidence matrix

| Lane | Repo evidence | External/control-plane evidence | Production evidence | Decision-owner evidence | Verdict |
|---|---|---|---|---|---|
| GitHub security settings | `.github/dependabot.yml` present (version updates only) | **Observed live via `gh api`** — Dependabot alerts **disabled**, Dependabot security updates **disabled**, secret scanning + push protection **enabled** | N/A | N/A | **FAIL** — **remediated 2026-08-13, see §15: now `PASS`** |
| TLS certificate/protocol | `nginx.conf` correctly disclaims TLS; F0-006 records host Nginx 1.24.0 | **Observed live** — valid Let's Encrypt cert, 4/4 SAN coverage, TLS 1.2/1.3 only, TLS 1.0/1.1 rejected at the wire | Endpoints serving 200/301/302 | N/A | **PASS** (cipher enumeration / OCSP / CT = `NOT VERIFIED`) |
| Redis / API-replica topology | `ecosystem.config.cjs` — `exec_mode: 'fork'`, no `instances` key → single instance by contract | N/A | `REDIS_URL` **proven set** (`redis.ts:41` startup log) + `/api/readyz` `redis=ok` | N/A | **PARTIAL / BLOCKED** — replica count not confirmed by the checklist's own `pm2 jlist` command; Redis bind/auth/exposure unverified |
| Platform Admin MFA coverage | MFA implemented and fails closed *when enrolled* (`platformAdmin.ts:95-107`); enrollment **optional** (`schema.prisma:1547`) | N/A | Login confirmed working; **silent on whether MFA was exercised** | N/A | **BLOCKED** — the §5 enrollment-coverage SQL has never been run |
| R-073 acceptance | Implementation + DB-backed tests complete; migration applied in production | N/A | Non-destructive only; revocation behaviour never demonstrated live | **Template unsigned, owner field blank** | **EXTERNAL_ACCEPTANCE_PENDING** |
| R-019 acceptance | 37/37 mutation endpoints `AUDITED_DURABLY`, 0 unaudited | N/A | Deployed 2026-08-12 | **Template unsigned, owner field blank** | **EXTERNAL_ACCEPTANCE_PENDING** |

---

## 4. GitHub security verification

Repository `MustafaBasol/DisKlinikCRM`, observed 2026-08-13 via authenticated `gh` (read-only GET only; no setting was modified). Token scopes: `gist, read:org, repo, user, workflow`.

**Material context: the repository is PUBLIC** (`"private": false`, `"visibility": "public"`). This is why secret scanning and push protection are available and enabled without a GHAS licence, and it is why `security_and_analysis` carries no `advanced_security` key. It also means anything ever committed to history is world-readable — relevant to this program's prior credential-exposure incident.

| GitHub control | Expected | Observed | Verdict |
|---|---|---|---|
| Default branch | `main` | `"default_branch":"main"` | PASS |
| Ruleset on `main` | enforced | Ruleset `17553831` "Protect main branch", `enforcement:"active"`, `bypass_actors: []` | PASS |
| Legacy branch protection | — | HTTP 404 `"Branch not protected"` (superseded by the ruleset) | N/A |
| Force-push protection | blocked | rule `non_fast_forward` present | PASS |
| Deletion protection | blocked | rule `deletion` present | PASS |
| Conversation resolution | required | `required_review_thread_resolution: true` | PASS |
| Required PR approvals | ≥1 | **`required_approving_review_count: 0`** | **FAIL** (out of criterion-2 scope — see §7.2) |
| Required status checks | ≥1 | **no `required_status_checks` rule exists** | **FAIL** (out of criterion-2 scope — see §7.2) |
| **Dependabot alerts** | **`Enabled`** | **HTTP 404 — `"Vulnerability alerts are disabled."`** | **FAIL** — **remediated 2026-08-13, see §15: now `Enabled` (HTTP 204)** |
| **Dependabot security updates** | **`Enabled`** | **`{"enabled":false,"paused":false}`; `security_and_analysis.dependabot_security_updates.status = "disabled"`** | **FAIL** — **remediated 2026-08-13, see §15: now `{"enabled":true,"paused":false}`, `status:"enabled"`** |
| Secret scanning | enabled | `status: "enabled"`; functionally confirmed — alerts endpoint returned data | PASS |
| Secret scanning push protection | enabled | `status: "enabled"` | PASS |
| Secret scanning non-provider patterns | — | `status: "disabled"` | Informational |
| Code scanning / CodeQL | enabled | HTTP 404 `"no analysis found"`; **no CodeQL workflow exists** in `.github/workflows/*.yml` | FAIL (see §7.2) |
| Private vulnerability reporting | enabled | `{"enabled":false}` | FAIL (see §7.2) |
| Actions permissions | scoped | `allowed_actions:"all"`, `sha_pinning_required:false` | PARTIAL |
| Default `GITHUB_TOKEN` permissions | read | `default_workflow_permissions:"read"`, `can_approve_pull_request_reviews:false` | PASS |

### 4.1 The decisive finding

F3-SEC-EXIT-001 §5 item 1 states the requirement literally:

> **Dependabot alerts enabled** (item W) — repository Settings → Code security and analysis → confirm "Dependabot alerts" and "Dependabot security updates" are both `Enabled`.

**Both are observed disabled.** This is a `FAIL`, not a `BLOCKED`: three independent endpoints agree, and each returned an explicit "disabled" message rather than a permission error. No endpoint in this lane hit a genuine scope wall.

This also narrows the meaning of R-075's earlier closure (production `npm audit` = 0 vulnerabilities): that was a **point-in-time** result. With Dependabot alerts off, there is **no continuous vulnerability monitoring at all** — precisely the residual the R-075 row itself flagged as untouched.

### 4.2 Secret-scanning alert

One historical alert exists, already `resolved` as `false_positive`, for a test fixture in `server/src/tests/`. **The secret value is deliberately not reproduced in this document.** No action required; recorded only to evidence that secret scanning is genuinely active rather than merely toggled.

---

## 5. TLS verification

`openssl` is not available on the verification workstation; all certificate and protocol evidence was gathered with .NET `SslStream` over `TcpClient` from PowerShell, plus hand-constructed raw TLS `ClientHello` records sent directly over TCP for legacy-protocol testing, plus `curl.exe` for HTTP behaviour.

All four hostnames recorded as production surfaces by `F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md:93` were tested: `api.noramedi.com`, `app.noramedi.com`, `noramedi.com`, `www.noramedi.com`.

### 5.1 Certificate (single certificate serves all four hosts)

| Field | Value |
|---|---|
| Subject | `CN=app.noramedi.com` |
| Issuer | `CN=YE2, O=Let's Encrypt, C=US` |
| NotBefore | `2026-06-28 19:47:45 UTC` |
| NotAfter | `2026-09-26 19:47:44 UTC` |
| Days remaining (from 2026-08-13) | **44** |
| SAN | `api.noramedi.com`, `app.noramedi.com`, `noramedi.com`, `www.noramedi.com` |
| Chain validation | Succeeded (real .NET chain validation, no bypass callback) |
| Negotiated protocol | TLS 1.3 |

The expiry date `2026-09-26` recorded by F3-SEC-EXIT-001 is hereby **re-verified as still current**, rather than trusted — as that document itself instructed.

**Times are recorded in UTC deliberately.** The verification workstation is UTC+2, and .NET's `X509Certificate2.NotAfter` returns **local** time, which reads `2026-09-26 21:47:44`. Adversarial review caught this as a discrepancy against a UTC reading, and it is resolved here rather than left latent: both are the same instant, and the UTC form is authoritative. This is the same class of timezone-reading hazard the F3-OBS-002/R-074 closure already recorded against a provider UI (`+02:00`), so it is called out explicitly rather than silently normalised.

### 5.2 Protocol matrix

| Protocol | Result | Basis |
|---|---|---|
| TLS 1.0 | **Rejected by server** | Local Schannel refuses to offer it (inconclusive alone); a raw hand-built `ClientHello` (`0x0301`) sent over a plain TCP socket returned a fatal TLS alert `protocol_version` from all four hosts |
| TLS 1.1 | **Rejected by server** | Same method, `ClientHello` `0x0302`, same fatal `protocol_version` alert |
| TLS 1.2 | Supported | Explicit `AuthenticateAsClient(..., Tls12, ...)` succeeded |
| TLS 1.3 | Supported | Negotiated by default |

The raw-socket method matters: a `SslStream` failure alone would only have proven the *local* Windows stack refuses legacy TLS. The wire-level fatal alert is genuine server-side evidence.

### 5.3 HTTP behaviour and headers

| Host | Result | HSTS |
|---|---|---|
| `api.noramedi.com/api/health` | `200 OK` | `max-age=15552000; includeSubDomains` |
| `app.noramedi.com/` | `302` → `/login` | present, plus CSP |
| `http://noramedi.com/` | `301` → `https://noramedi.com/` | — (redirect confirmed) |
| `https://noramedi.com/` (apex) | `200 OK`, real content (~3069-byte body, `Last-Modified: Wed, 05 Aug 2026`) | **absent — no HSTS, CSP, X-Frame-Options or X-Content-Type-Options** |
| `www.noramedi.com` | `301` → apex | **absent** |

**Finding (widened by adversarial review):** the apex is **not** a redirect stub — it is a live, unauthenticated production surface serving real content with **none** of the security headers `api.` and `app.` carry. `www.` also returns no HSTS on its redirect. Exposure is limited (HTTP→HTTPS is enforced by 301) but non-zero on a first trust-on-first-use request, and HSTS is never established for the apex origin at all. Recorded as a follow-up, not a criterion-2 blocker.

### 5.4 Not verified

Full cipher-suite enumeration, OCSP stapling, and Certificate Transparency presence — **`NOT VERIFIED`**, no tooling available. These are deliberately **not** claimed as PASS by assumption. Certificate auto-renewal is likewise **not** verified; with 44 days remaining this is not urgent, but it is unproven.

---

## 6. Redis / replica topology

### 6.1 What "replica topology" actually means here

Traced to source. F3-SEC-EXIT-001 item L and §5 item 3 define it:

> confirm `REDIS_URL` is actually configured in production, **and** confirm the current API process topology (single instance vs. PM2-cluster/multiple replicas) — the fallback's correctness impact depends entirely on replica count.

So the criterion-2 item concerns the **number of running `noramedi-api` PM2 instances**, because `getRedis()`'s in-memory fallback is per-process: with multiple API replicas and no working Redis, rate-limit counters silently desynchronise. It is **not** about Redis master/replica/Sentinel/cluster, and **not** about PostgreSQL streaming replication — the latter is explicitly deferred to F7 (`F7_HORIZONTAL_SCALE_AND_HA.md:42`, *"PostgreSQL replica + failover kurulumu ve tatbikatı"*).

### 6.2 Status

| Component | Expected (repo-evidenced) | Observed | Security exposure known? | Verdict |
|---|---|---|---|---|
| `REDIS_URL` configured in production | Required by item L | **Proven** — `redis.ts:41` logs `[redis] Shared store enabled via REDIS_URL.` only when the variable is set and non-empty; that line was observed at production startup (F3-PROD-002), and `/api/readyz` reported `redis=ok`, which additionally proves the connection works | N/A | **PASS** |
| API replica count | 1 (`ecosystem.config.cjs`: `exec_mode:'fork'`, no `instances` key) | Single PID (`607545`) observed, consistent with one instance — but the checklist's own named command (`pm2 jlist` instance count) has not been run | N/A | **PARTIAL** |
| Redis bind address / `protected-mode` / `requirepass` / public exposure | Single hardened node; no HA required at F3 | **Nothing in the repository proves any of these either way** | **No** | **BLOCKED** |
| PostgreSQL replication | Deferred to F7 by design | None exists or is claimed | N/A | **NOT APPLICABLE to F3** |

A `PING`-level health check proves reachability only. It says nothing about bind address, authentication, or whether port 6379 is exposed to the internet. Those remain genuinely unknown.

---

## 7. Scope findings

### 7.1 The four-item summary is narrower than the ten-item checklist

`F3_PRODUCTION_HARDENING.md:12` names four external items. The checklist it points at (`F3-SEC-EXIT-001` §5) lists **ten**. The six not named in the summary are, on current evidence:

| §5 item | Status |
|---|---|
| 4 — webhook secrets configured per connection (SQL) | Never run |
| 5 — `CSRF_SECRET` actually set and ≥32 chars in production | Never verified |
| 7 — host Nginx config diffed against repo intent | Never done |
| 8 — firewall / WAF | No repository evidence either way; explicitly unclaimed |
| 9 — backup encryption-at-rest / off-host replication | `AWAITING_OPERATOR_EVIDENCE` / `AWAITING_PROVIDER_EVIDENCE` (`INFRA_ENCRYPTION_RESIDENCY_EVIDENCE_001.md:64`); off-host backup absence separately confirmed (R-030 `OPEN`) |
| 10 — external error tracking | Confirmed absent; deliberately deferred |

**This task does not resolve which list governs**, and deliberately does not pick the narrower one to make closure easier. Because criterion 2 fails on the four named items regardless, the discrepancy does not change the verdict — but it **must** be resolved by the decision owner before any future closure attempt, or closure will rest on an ambiguity. Recorded as an explicit open question.

### 7.2 Findings outside criterion 2's literal scope

Criterion 2's GitHub item is worded "Code security and analysis settings". The following are real security findings that fall **outside** that wording and are therefore **not** counted as criterion-2 blockers, to avoid silently redefining the criterion:

- `main`'s ruleset requires **0 approving reviews** and **no status checks**. Notably, `ci-pr.yml:45-50` deliberately exposes a stable `PR Gate` job described in-repo as *"the ONE stable, always-present job this workflow exposes as a check"* — a required-check contract that was designed but never wired into the ruleset.
- No CodeQL workflow; code scanning has never run.
- Private vulnerability reporting disabled (relevant given the repository is public).
- GitHub Actions allow **all** actions with no SHA pinning.
- Apex domain lacks HSTS and other security headers (§5.3).

Each is proposed as separate remediation in §10.

### 7.3 Does R-018 block criterion 2?

Argued from the literal text, both ways:

- **Against blocking:** the "Exit gate" section (`:102-106`) names no risk IDs. The phase document's own live decomposition of what remains for criterion 2 (`:12`) does **not** mention R-018. "Security requirements" (`:142`) is a separately-headed section, not stated anywhere to be identical to the exit gate.
- **For blocking:** `:142` reads *"R-018 (log sızıntısı) ve R-019 (admin aşımı) kontrollerinin kanıtla kapatılması"* — and R-019, its sibling in that exact sentence, **is** named as a criterion-2 blocker. R-018 is also item P inside the very checklist criterion 2 refers to.

**Verdict: unresolved by the documents, and this task will not invent an answer.** It is flagged for the decision owner. The criterion already fails on independent grounds, so nothing here depends on the outcome.

---

### 7.4 Adversarial review

An independent adversarial pass was run against this document's own closure argument, instructed to break it. It independently re-executed the GitHub API calls, the raw-`ClientHello` TLS probes against all four hosts, the MFA greps, and `test:totp`. **Its findings are folded in below rather than summarised away, including the three that made this document worse for the closure argument.**

**Accepted and applied:**

1. **Certificate timestamp was ambiguous.** Reported as local time without saying so. Corrected to UTC in §5.1, with the reconciliation shown. This is the same timezone hazard class the R-074 closure already recorded.
2. **The HSTS gap is wider than first recorded.** `www.` also lacks HSTS, and the apex serves real content rather than a redirect stub. §5.3 corrected.
3. **The blocking list was under-stated.** R-018, the six unassessed §5 items (external error tracking especially), and R-030's backup-durability gap were discussed in §7 but absent from the verdict's blocking reasons. §11 now names them.
4. **`test:totp` 19/19 must not sit next to the MFA verdict unqualified.** It exercises only the TOTP crypto primitive — base32, code generation/verification, otpauth URI. It covers **none** of the login route, the `totpEnabledAt` gate, or the `MFA_REQUIRED`/`MFA_INVALID` responses. Qualified in §14.
5. **"Docker blocked" was imprecise.** Restated in §14 as the specific observed fact.

**Confirmed, not downgraded:**

- The GitHub `FAIL` was independently reproduced call-for-call. Solid.
- The TLS `PASS` was independently reproduced for **all four** hosts, including identical certificate serial and the exact fatal-alert bytes (`15 03 01 00 02 02 46` for TLS 1.0, `15 03 02 00 02 02 46` for TLS 1.1). Judged the strongest evidence in this package, and genuinely proven rather than extrapolated from one handshake.
- The "replica = API instance count" reading was judged **textually justified, not self-serving narrowing** — it is sourced from the criterion's own phrase plus item L's own definition.
- No secret leakage found in this document. The previously-rotated monitoring credential from the R-074 closure is deliberately not restated, and no raw API output beyond boolean settings is reproduced.
- No premature F4 authorisation and no criterion-3 claim.

**Recorded but not adopted:** the review noted that R-030's row assigns remediation to F4, which *could* justify excluding it from an F3 criterion — but observed that nobody has actually made that argument for criterion 2. It is therefore listed in §11 as unresolved rather than silently excluded in either direction.

---

## 8. R-073 and R-019 — decision-owner acceptance

Neither risk is closed by this task, and neither may be.

The program's rule is explicit and repeated — `RISK_REGISTER.md:98`: *"not self-marked `CLOSED` … unilateral agent judgment on a risk it just remediated is not risk acceptance"*; `F3-PROD-001` §9: *"repository policy does not permit an agent to self-close either risk."*

**There is no named decision owner.** Both templates in `F3-PROD-001` §9 leave `Decision owner: ______________________` blank. The only authority pattern cited anywhere is an *analogy* to a different risk's closure (R-072: *"external confirmation authority: ChatGPT architecture review and Mustafa Basol (merge decision)"*) — offered as an example of a completed record, not as an assignment.

| Risk | Current wording | Owner | Evidence on record | State |
|---|---|---|---|---|
| R-073 | `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION` | **Unnamed** | F3-SEC-002 implementation + 12 dedicated DB-backed tests; migration `20260811120000_…` confirmed applied in production; normal login confirmed post-deploy. **Destructive revocation proof deliberately not performed.** | `EXTERNAL_ACCEPTANCE_PENDING` |
| R-019 | `Durum` = `OPEN`; adjacent token `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION` | **Unnamed** | F3-IMPL-005(+R1): 37/37 platform-admin mutation endpoints `AUDITED_DURABLY`, 0 `UNAUDITED_PERSISTED_MUTATION`; deployed 2026-08-12. Break-glass procedure and scope-boundary mitigations remain separately open. | `EXTERNAL_ACCEPTANCE_PENDING` |

**Documentation defect recorded, not silently corrected:** R-019's row places `OPEN` in the `Durum` column and the `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION` token in the trailing `Kanıt` (evidence) column, which therefore carries no evidence link. R-018's row shows the same shape with `UNVERIFIED`. Both readings agree the risk is not closed, so no status is ambiguous — but the column placement should be repaired by whichever task next legitimately edits those rows.

---

## 9. Operator command package

The following are the **only** outstanding actions that can move criterion 2's blocked lanes. All are read-only. **Do not paste back any raw output containing a credential.**

### 9.1 Platform Admin MFA enrollment coverage (§5 item 2 — required verbatim)

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE "totpEnabledAt" IS NOT NULL) AS mfa_enrolled
FROM "PlatformAdmin" WHERE "isActive" = true;
```

Criterion: `mfa_enrolled = total`, **or** an explicit per-admin written acceptance of the gap. Output is two integers — safe to paste in full.

### 9.2 API replica count + Redis posture

```bash
# API instance count — the actual "replica topology" question
pm2 jlist | grep -E '"name":"noramedi-(api|worker)"|"pm_id"|"exec_mode"'

# Is Redis listening, and on which interface?
ss -lntp | grep 6379

# Replication / persistence / exposure posture
redis-cli INFO replication
redis-cli INFO persistence | grep -E 'rdb_|aof_'
redis-cli CONFIG GET bind
redis-cli CONFIG GET protected-mode

# Whether auth is required — REDACTED form, do NOT run plain CONFIG GET requirepass
redis-cli CONFIG GET requirepass | tail -n1 | awk '{ if (length($0)>0) print "requirepass: SET"; else print "requirepass: EMPTY" }'
```

Run from a machine **outside** the VPS network to test public exposure (running it on the host proves nothing):

```bash
nc -zv -w3 <production-host-public-ip> 6379
```

**Redact before pasting back:** the raw output of `CONFIG GET requirepass` (send only `SET`/`EMPTY`), and the values of `REDIS_URL` / `DATABASE_URL`. To confirm a variable's presence without revealing it:

```bash
pm2 env <id> | sed 's/=.*/=SET/' | grep REDIS_URL
```

### 9.3 GitHub settings remediation (external control-plane change, requires approval)

Settings → Code security and analysis → enable **Dependabot alerts** and **Dependabot security updates**. This is a control-plane change and is **not** performed by this task.

---

## 10. Proposed remediation tasks

None are implemented here. No code, schema, or configuration is touched.

| Task ID | Title | Type | Dependency | Rollback |
|---|---|---|---|---|
| `F3-EXIT-C2-REM-001` | Enable Dependabot alerts and security updates | External control-plane setting | None | Restore prior toggle state (note: disabling restores a *worse* posture; not recommended) |
| `F3-EXIT-C2-OPS-001` | Operator evidence run: MFA enrollment SQL + Redis/API-replica posture (§9) | Operator, read-only | None | N/A — read-only |
| `F3-EXIT-C2-DEC-001` | Decision-owner acceptance records for R-073 and R-019 | Decision | Named owner must exist | Withdraw the signed record |
| `F3-SEC-004` | Wire `PR Gate` as a required status check and require ≥1 approving review | External control-plane setting | None | Restore prior ruleset value |
| `F3-SEC-005` | Add CodeQL workflow; enable private vulnerability reporting | Repository + control plane | None | Revert workflow commit |
| `F3-SEC-006` | Apex-domain security headers (HSTS/CSP/XFO/XCTO) | Production nginx config | Operator | Restore prior nginx config |
| `F3-SEC-007` | Fix R-076 stored XSS (`ClinicLegalProfile.website` scheme validation) | Code | None | Revert commit |
| — | Resolve the four-item vs ten-item checklist scope question (§7.1) and the R-018 question (§7.3) | Decision | Decision owner | — |

---

## 11. Criterion-2 verdict

```
F3_EXIT_CRITERION_2 = NOT_SATISFIED
```

**Blocking reasons, in order of severity:**

1. ~~**FAIL — GitHub Code security and analysis settings.** Dependabot alerts and Dependabot security updates are both observed **disabled**, directly contradicting F3-SEC-EXIT-001 §5 item 1's literal requirement that both be `Enabled`. This is an observed failure, not missing evidence.~~ **[Remediated 2026-08-13, F3-SEC-EXIT-001-R2 — see §15.]** Both settings are now independently re-verified `Enabled`. **This specific reason is resolved: `GITHUB_SECURITY_SETTINGS_LANE = PASS`.** It no longer blocks criterion 2 on its own, but criterion 2 as a whole remains `NOT_SATISFIED` on reasons 2–7 below, none of which this remediation touched.
2. **BLOCKED — Platform Admin MFA enrollment coverage.** MFA is implemented and fails closed *when enrolled*, but enrollment is optional by design, and the mandated coverage SQL has never been run against production. There are additionally **zero** negative tests for the login-time MFA gate.
3. **PARTIAL/BLOCKED — Redis / API-replica topology.** `REDIS_URL` is proven configured and working; the API replica count is strongly indicated as 1 but not confirmed by the checklist's own command, and Redis bind/auth/exposure are entirely unverified.
4. **EXTERNAL_ACCEPTANCE_PENDING — R-073 and R-019.** Both await a signed decision-owner record. No decision owner is named anywhere. Neither may be self-closed.
5. **BLOCKED — external error tracking (§5 item 10).** Confirmed absent in-repo. F3-SEC-EXIT-001's own §6 (`:124`) calls this *"a named F3 exit-gate requirement regardless"* of that task's scope. It has been deferred by every F3 task since and is still unimplemented — the F3-OBS-002-CLOSE entry restates it as *"deliberately deferred, still unimplemented."*
6. **UNRESOLVED — R-018.** `F3_PRODUCTION_HARDENING.md:142` requires *"R-018 … ve R-019 … kontrollerinin kanıtla kapatılması"* in one sentence, and R-019 **is** treated as a criterion-2 blocker. R-018 is `OPEN` and — unlike R-076, which carries an explicit *"not part of F3's 3-item exit gate"* carve-out — has **no** such disclaimer. This task will not resolve the ambiguity by assertion; see §7.3. Until a decision owner rules, R-018 must be treated as a **possible** blocker, not silently excluded.
7. **UNRESOLVED — the other five §5 items** (webhook secrets, `CSRF_SECRET` production value, host nginx config diff, firewall/WAF, backup encryption/off-host durability). None has ever been assessed. Backup durability additionally maps to **R-030**, which is `OPEN`; its row assigns remediation to F4, which *may* justify excluding it from an F3 criterion — but no such argument has actually been made for criterion 2, so it is recorded as unresolved rather than excluded.

Only the TLS lane passes.

**The verdict does not depend on resolving reasons 5–7.** Reason 1 alone (an observed control-plane failure) and reasons 2–4 (blocked/pending) are independently sufficient. Reasons 5–7 are recorded so that a future closure attempt cannot succeed by quietly adopting the narrowest reading of the checklist.

---

## 12. Program state

```
F3_EXIT_CRITERION_1     = SATISFIED       (unchanged; R-074 CLOSED)
F3_EXIT_CRITERION_2     = NOT_SATISFIED   (this task; GitHub sub-lane since remediated 2026-08-13 — see §15)
F3_EXIT_CRITERION_3     = NOT_SATISFIED   (unchanged; unassessed by this task)
F3_EXIT_GATE            = NOT_SATISFIED
F3_COMPLETE             = NO
F4_TRANSITION_AUTHORIZED = NO
```

**[Updated 2026-08-13, F3-SEC-EXIT-001-R2]:** `GITHUB_SECURITY_SETTINGS_LANE = PASS` (Dependabot alerts + Dependabot security updates + secret scanning + push protection all independently verified `enabled`). `F3_EXIT_CRITERION_2` remains `NOT_SATISFIED` — reasons 2–7 above are untouched by this remediation. See §15.

Criterion 3 is **not** assessed by this task and is **not** inferred. It remains dependent on a program-owner sufficiency decision regarding F3-IR-001's explicitly `SIMULATED` / `NOT_PRODUCTION_VERIFIED` tabletop drill.

---

## 13. Migration / rollback / impact

```
Migration required: NO
Migration created:  NO
Migration applied:  NO
Schema changed:     NO
```

**Rollback:** revert this documentation commit/PR. Nothing else is affected — no runtime artefact is produced by this task.

External settings have separate rollbacks, noted per row in §10. No insecure rollback is proposed: in particular, MFA must never be disabled to restore availability, and disabling Dependabot to "restore" prior state is explicitly not recommended.

```
Runtime behavior changed:               NO
Tenant query behavior changed:          NO
Authentication behavior changed:        NO
Secrets changed:                        NO
Schema changed:                         NO
Migration:                              NO
Production config changed:              NO
External control-plane settings changed: NO
KVKK data flow changed:                 NO
Cross-domain access changed:            NO
```

**Security/KVKK note:** this task changed nothing, but it *records* that continuous dependency-vulnerability alerting is currently absent on a public repository processing health data. That is a real, currently-live gap, not a theoretical one.

---

## 14. Delivery state

```
Agent work completed:  YES
Tests passed:          YES (scoped — see below)
PR opened:             (see tracker entry)
CI passed:             PENDING
Merged:                NO
Deployed:              N/A (documentation only)
Production verified:   NO — this task performed no production access
```

Commands run and exact counts:

```
Command: npm run test:totp     (in server/)
Result:  PASS
passed:  19
failed:  0
skipped: 0
exit:    0
```

**This green result must not be read as MFA assurance.** `totp.test.ts` exercises only the TOTP crypto primitive — base32 handling, code generation/verification with drift window, otpauth URI construction. It covers **none** of the `/platform/login` route, the `totpEnabledAt` gate, or the `MFA_REQUIRED`/`MFA_INVALID` responses. It proves the algorithm is correct; it proves nothing about the login gate, which has **zero** test coverage.

`npm run test:platform-backup` → 24 passed / **1 failed** (a pre-existing `401` vs `403` status-code assertion in a generic token-type test, unrelated to MFA and untouched by this task).

**Not run, and not claimed:** `test:auth`'s platform-admin portion, `test:platform-admin-password-recovery`, `test:platform-admin-session-revocation`, `test:security-incidents`. All four require PostgreSQL; the observed fact is that `127.0.0.1:5544` refused connection (`P1001`) and no disposable-runtime instance was provisioned for this documentation-only task. Their state is **unverified by this task**, not assumed passing. (Adversarial review correctly objected to an earlier, looser phrasing that asserted Docker itself was unavailable — the precise observed fact is the refused connection.)

No documentation-link or tracker-consistency validation script exists in this repository (`package.json` was inspected); none is therefore claimed. This is a `docs/program/**`-only change; `ci-pr.yml` applies no path filter to the workflow trigger, so the standard PR Gate applies.

---

## 15. F3-SEC-EXIT-001-R2 — Dependabot Remediation and Independent Re-Verification (2026-08-13)

**Task ID:** `F3-SEC-EXIT-001-R2`. **Type:** targeted remediation, scoped to exactly the two GitHub Dependabot settings this document's §4/§11 named as the decisive `FAIL`. **Branch:** `docs/f3-sec-exit-001-r2-dependabot-remediation`. **Baseline:** `origin/main` @ `0d85748d1192609bbc391e71c43b3fed4822066d` (PR #408's merge commit), fetched fresh; confirmed a simple fast-forward from this document's own `021c43d5…` baseline (`git merge-base --is-ancestor 021c43d… 0d85748… ` → exit `0`), no semantic conflict. Isolated worktree: `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f3-sec-exit-001-r2-dependabot-remediation`.

### 15.1 Scope

**Authorized and performed — exactly two settings, nothing else:**

1. Dependabot vulnerability alerts: disabled → **enabled**.
2. Dependabot security updates (automated security fixes): disabled → **enabled**.

**Explicitly not touched** (verified unchanged, §15.4): CodeQL/code scanning, branch protection/rulesets, required reviews, required status checks, private vulnerability reporting, Actions permissions, SHA-pinning policy, secret scanning, push protection, repository visibility, collaborator permissions, workflow configuration, and no production/application/runtime file.

### 15.2 Pre-change state (independently observed, read-only, before mutation)

```
gh api repos/MustafaBasol/DisKlinikCRM/vulnerability-alerts -i
  → HTTP/2.0 404 Not Found — "Vulnerability alerts are disabled."

gh api repos/MustafaBasol/DisKlinikCRM/automated-security-fixes
  → {"enabled":false,"paused":false}

gh api repos/MustafaBasol/DisKlinikCRM --jq '.security_and_analysis'
  → {"dependabot_security_updates":{"status":"disabled"},
     "secret_scanning":{"status":"enabled"},
     "secret_scanning_non_provider_patterns":{"status":"disabled"},
     "secret_scanning_push_protection":{"status":"enabled"},
     "secret_scanning_validity_checks":{"status":"disabled"}}

gh api repos/MustafaBasol/DisKlinikCRM --jq '{full_name,private,permissions,default_branch}'
  → {"default_branch":"main","full_name":"MustafaBasol/DisKlinikCRM",
     "permissions":{"admin":true,...},"private":false}

gh auth status → MustafaBasol, scopes: gist, read:org, repo, user, workflow
```

Consistent in every particular with §4's original observation — same two settings disabled, same repository (`full_name` exact match), secret scanning/push protection already `enabled`, authenticated account has `admin:true` on this exact repo (sufficient permission, no ambiguity).

### 15.3 Mutation (control-plane change, timestamp UTC)

```
PUT repos/MustafaBasol/DisKlinikCRM/vulnerability-alerts        → HTTP/2.0 204 No Content   (2026-08-13T14:22:54Z)
PUT repos/MustafaBasol/DisKlinikCRM/automated-security-fixes    → HTTP/2.0 204 No Content   (2026-08-13T14:22:55Z)
```

No request body on either call — these are the minimal, smallest-supported mutations for each endpoint (GitHub's documented "enable" calls). No other endpoint was called with a mutating verb (`PUT`/`POST`/`PATCH`/`DELETE`) at any point in this task.

### 15.4 Post-change independent verification (not inferred from the 204 responses above)

```
gh api repos/MustafaBasol/DisKlinikCRM/vulnerability-alerts -i
  → HTTP/2.0 204 No Content   (per GitHub API semantics: 204 = enabled, 404 = disabled)

gh api repos/MustafaBasol/DisKlinikCRM/automated-security-fixes
  → {"enabled":true,"paused":false}

gh api repos/MustafaBasol/DisKlinikCRM --jq '{full_name,private,security_and_analysis}'
  → {"full_name":"MustafaBasol/DisKlinikCRM","private":false,
     "security_and_analysis":{
       "dependabot_security_updates":{"status":"enabled"},
       "secret_scanning":{"status":"enabled"},
       "secret_scanning_non_provider_patterns":{"status":"disabled"},
       "secret_scanning_push_protection":{"status":"enabled"},
       "secret_scanning_validity_checks":{"status":"disabled"}}}

gh api repos/MustafaBasol/DisKlinikCRM --jq '.id' → 1237628641
```

**Before → after:**

| Control | Before | After |
|---|---|---|
| Dependabot alerts | `disabled` (404) | **`enabled`** (204) |
| Dependabot security updates | `disabled` (`enabled:false`) | **`enabled`** (`enabled:true, paused:false`) |
| Secret scanning | `enabled` | `enabled` — **unchanged** |
| Secret scanning push protection | `enabled` | `enabled` — **unchanged** |

### 15.5 Adversarial review (independent subagent, own `gh api` calls, instructed to falsify)

An independent reviewer re-ran every check above from scratch (not trusting this document's own claims) plus additionally queried `branches/main/protection`, `/rulesets`, and `/actions/permissions` to hunt for any unrelated drift. Findings, each `SURVIVES` (none `FALSIFIED`, no `CRITICAL` finding):

1. **Dependabot alerts really enabled** — `SURVIVES` (204, reproduced independently).
2. **Dependabot security updates really enabled** — `SURVIVES` (`enabled:true`, `status:"enabled"`, reproduced independently).
3. **No unrelated setting changed** — `SURVIVES`. `secret_scanning`/`secret_scanning_push_protection` identical before/after. `main`'s ruleset (`id 17553831`) has `created_at`/`updated_at` both `2026-06-11T14:01:14` — unchanged since months before this task, proving it was not touched by this mutation. `branches/main/protection` still 404 (governed by the ruleset, not classic protection — same as before). Actions permissions (`allowed_actions:"all"`, `sha_pinning_required:false`) match this document's own §4 table exactly, unaltered. Repository visibility still `private:false`.
4. **GitHub security-settings lane now `PASS`** — `SURVIVES`. All four sub-controls (Dependabot alerts, Dependabot security updates, secret scanning, push protection) independently read `enabled`.
5. **F3 Exit Criterion 2 overall still `NOT_SATISFIED`** — `SURVIVES`. The reviewer re-read this document's own §11 (7 blocking reasons) and `CURRENT_PHASE.md`'s F3-EXIT-C2 entry and confirmed reasons 2–7 (Platform Admin MFA enrollment coverage, Redis/API-replica topology, R-073/R-019 decision-owner acceptance, external error tracking, R-018 ambiguity, the five other unassessed §5 checklist items) are unchanged and still open — nothing in this remediation's live `gh api` state or in either document shows any of them closed.

### 15.6 Criterion impact (explicit, not left implicit)

```
GITHUB_SECURITY_SETTINGS_LANE = PASS   (as of 2026-08-13, this task)
F3_EXIT_CRITERION_2            = NOT_SATISFIED   (unchanged — reasons 2–7 of §11 remain open)
F3_EXIT_GATE                   = NOT_SATISFIED
F3_COMPLETE                    = NO
F4_TRANSITION_AUTHORIZED       = NO
```

This task does **not** close R-073, R-019, R-018, or the R-075 residual-monitoring note beyond the narrow fact that continuous Dependabot alerting now exists (see `RISK_REGISTER.md` R-075, updated same-day). It does **not** assess criterion 3 (unaffected, untouched). **Likely next task** (not decided or invented here): Platform Admin MFA enrollment-coverage verification (§9.1's SQL has still never been run) or Redis/PM2 replica-topology verification (§9.2) — both are read-only operator-evidence tasks named in §9 above, neither requiring an agent decision on which comes first.

### 15.7 Migration / runtime / impact

```
Migration required:                      NO
Schema changed:                          NO
Runtime/application code changed:        NO
Production deployment:                   NO
External control-plane settings changed: YES — exactly the two authorized Dependabot settings
Tenant/KVKK data flow changed:           NO
Secrets changed/exposed:                 NO — no token, credential, or raw header value reproduced in this section
```

### 15.8 Validation commands run (this R2 pass)

```
Command: git diff --check
Purpose: verify no whitespace-conflict markers in the documentation diff
Result:  N/A at time of writing this section (run once all doc edits complete — see final PR body for actual result)

Command: git merge-base --is-ancestor 021c43d5fbeae3c9b03c904ac30b0bb4708c80ad 0d85748d1192609bbc391e71c43b3fed4822066d
Purpose: confirm this document's original baseline is a clean ancestor of this task's baseline (simple fast-forward, no semantic conflict)
Result:  PASS (exit 0)
```

No application/runtime test suite was run — no runtime, schema, or dependency file was touched by this task, per its own explicit scope.

### 15.9 Rollback

**Documentation:** `git revert` the merge commit that lands this section.

**GitHub control plane:** technically, `DELETE repos/MustafaBasol/DisKlinikCRM/vulnerability-alerts` and a corresponding disable call would restore the pre-change toggle state. **This rollback must not be executed** without explicit separate instruction — enabled vulnerability monitoring is the desired production-security target for a public repository processing health data, and disabling it would restore a strictly worse security posture. Reverting the documentation commit does **not** revert the GitHub settings, and vice versa — these are two independent rollback planes, exactly as this document's own §13 already notes for its original scope.

---

## 16. F3-SEC-EXIT-001-R3 — Platform Admin MFA Enrollment Coverage & Login-Gate Verification (2026-08-13)

**Task ID:** `F3-SEC-EXIT-001-R3`. **Type:** verification-first, read-only. **Branch:** `docs/f3-sec-exit-001-r3-platform-admin-mfa-coverage`. **Baseline:** `origin/main` @ `231b959f056e2fccd8b6019e04943cce8b6946f2` (PR #412's merge commit, F3-SEC-EXIT-001-R2), clean fast-forward from this document's §15 baseline. Isolated worktree: `.claude/worktrees/docs+f3-sec-exit-001-r3-platform-admin-mfa-coverage`. Orchestrated as Lane 0 (program context) + Lanes A–C (parallel: architecture, test inventory, production-evidence prep) + Lane D (independent re-verification) + Lane E (adversarial falsification attempt), plus direct test execution by the orchestrating session.

### 16.1 Scope

This task answers exactly the two questions §9.1/§15.6 of this document left open for Platform Admin MFA: (1) has the enrollment-coverage SQL ever been run against production, and (2) does the login-time MFA gate have negative test coverage. **No production data was mutated, no admin enrolled/unenrolled, no MFA secret reset, no session revoked, no auth route edited.**

### 16.2 Architecture — login-gate fail-closed behavior (Lane A, independently reconfirmed by Lane D and Lane E)

Login endpoint: `POST /auth/login`, `server/src/routes/platformAdmin.ts:62-128`. MFA gate, `:95-107`:

```js
if (admin.totpEnabledAt) {
  const totpCode = String(req.body.totpCode ?? '').trim();
  if (!totpCode) {
    return res.status(401).json({ error: 'MFA code required', code: 'MFA_REQUIRED' });
  }
  const totpSecret = decryptSecretTagged(admin.totpSecretEncrypted);
  if (!totpSecret || !verifyTotp(totpSecret, totpCode)) {
    return res.status(401).json({ error: 'Invalid MFA code', code: 'MFA_INVALID' });
  }
}
```

Both branches `return` strictly before session/token issuance (`createSessionId`/`generatePlatformToken`/`issueSessionCookies`, `:111-124`) — **no code path issues a session to an enrolled admin (`totpEnabledAt` non-null) without a valid TOTP code.** Three independent lanes (A, D, E) read this code fresh and reached the identical conclusion; Lane E specifically searched for a bypass (env-gated skip, debug/impersonation route, alternate login path) and found none — `server/src/routes/auth.ts` (clinic-user login) is a wholly separate model/route with zero `PlatformAdmin` references.

**Enrollment remains optional by design, confirmed at the schema level** (`server/prisma/schema.prisma:1533-1561`): `PlatformAdmin.totpEnabledAt DateTime?` is nullable with no constraint forcing it non-null; `totpSecretEncrypted String?` likewise; no `mfaEnabled` boolean column exists (`mfaEnabled` is a *derived* response field, `!!admin.totpEnabledAt`). No recovery/backup-code mechanism exists anywhere in the codebase (repo-wide grep for `recoveryCode`/`backupCode`: zero matches). For a non-enrolled admin, the entire block above is skipped and a session issues on password alone — this is the accepted, by-design behavior this document's §4 already recorded, not a new gap. `verifyTotp` (`server/src/utils/totp.ts:78-102`) was separately checked by Lane E for logic bugs (off-by-one window, type coercion, timing side-channel) — none found; it regex-validates a 6-digit code, checks a ±1 step window with `crypto.timingSafeEqual` and no early exit (a documented anti-timing-leak design choice), and does not distinguish "expired" from "wrong" codes (both collapse to `MFA_INVALID`). **No TOTP replay-protection mechanism exists — confirmed unimplemented, not merely untested** (no nonce/used-code ledger anywhere near the TOTP or PlatformAdmin code paths).

### 16.3 Test coverage — the login-gate has zero route/DB-integration coverage (Lane B, independently reconfirmed by Lane D and Lane E)

Grepped all of `server/src/tests/` for `auth/login`, `totpCode`, `MFA_REQUIRED`, `MFA_INVALID` — **zero matches in any test file.** No test in this repository ever calls `POST /auth/login` with a request body, enrolled or not. This means none of the following are integration-tested at the route level: enrolled admin + missing OTP, enrolled admin + invalid OTP, enrolled admin + valid OTP, non-enrolled admin login, or an inconsistent MFA state (`totpEnabledAt` set but `totpSecretEncrypted` null, or vice versa) at login time.

What **is** genuinely covered, and must not be conflated with the above:

- `server/src/tests/totp.test.ts` (19/19 passing) — a **pure crypto-primitive suite** for `verifyTotp()`/`generateTotp()`/`base32Encode`/`buildOtpAuthUri`. No HTTP layer, no `PlatformAdmin` DB row. Proves the algorithm is correct; proves nothing about whether the login route enforces it.
- `server/src/tests/platformAdmin.test.ts` (118/118 passing) — solid, genuinely DB-backed, route-level audit-trail coverage of the **enrollment/disable flow** (`POST /auth/mfa/setup`, `/auth/mfa/verify`, `/auth/mfa/disable`), invoked via the extracted route middleware chain directly. This is a different set of endpoints from `/auth/login` and does not exercise the login-time gate.
- `server/src/tests/platformAdminSessionRevocation.test.ts` (15/15 passing) — DB-backed, but tests the `authenticatePlatformAdmin` middleware (validating an already-issued token on *subsequent* requests, e.g. after deactivation or password reset), not the login route's initial MFA branch.
- `server/src/tests/platformAdminPasswordRecovery.test.ts` (22/22 passing) — DB-backed CLI/route tests; confirms password recovery preserves MFA state (`mfaPreserved: true`) and revokes prior sessions via `passwordChangedAt`, but the "post-recovery token" used to prove revocation is minted directly in the test (`generatePlatformToken()`), explicitly documented in-file as simulating, not calling, `/auth/login`.

**`MFA_NEGATIVE_TEST_COVERAGE = FAIL`** — this document's §4 already flagged "zero negative tests for the login-time MFA gate"; this task confirms the gap is unchanged and narrows it precisely: the gap is specifically the `/auth/login` route's own OTP branch, not MFA testing in general (enrollment/disable and post-login revocation are both well tested).

### 16.4 Test execution (this session, against a disposable local test database — not production, not the repository's ordinary dev DB)

The worktree's `server/.env` (copied in by the operator for local dev use) pointed at an unreachable `127.0.0.1:5544` (`P1001`, no Postgres process running on this machine). Per explicit operator instruction, a disposable, throwaway `postgres:16-alpine` Docker container (`noramedi-mfa-test-db`, database `noramedi_test`, user/password `postgres`/`postgres`) was started on `127.0.0.1:5544`, the repository's real Prisma migrations were applied via `prisma migrate deploy` (no `db push`), and `DATABASE_URL` was overridden **only as a per-process environment variable** for each test invocation — `server/.env` itself was never modified. The container was removed at the end of this task.

```
Command: npm run test:auth      (sessionCookieCsrf.test.ts + platformAdmin.test.ts)
Result:  15/15 + 118/118 = 133/133 passed, 0 failed, exit 0

Command: npm run test:totp
Result:  19/19 passed, 0 failed, exit 0

Command: npm run test:platform-admin-session-revocation
Result:  15/15 passed, 0 failed, exit 0

Command: npm run test:platform-admin-password-recovery
Result:  22/22 passed, 0 failed, exit 0

Total: 189/189 passed, 0 failed, 0 skipped, across 4 npm scripts / 5 test files.
```

All suites pass. Consistent with §16.3: passing suites confirm existing behavior (enrollment audit trail, session revocation, password recovery, TOTP math) is correct, but — because none of them call `/auth/login` — a 100% pass rate here does **not** constitute login-gate assurance and must not be read as such.

### 16.5 Production enrollment coverage — still not established (Lane C)

**No direct production database access exists for this or any prior Claude Code session in this program.** Confirmed by searching `docs/program/runbooks/` and `docs/program/PRODUCTION_TOPOLOGY.md`, plus a repository-wide grep for any documented agent-initiated production DB access — none found. `PRODUCTION_TOPOLOGY.md` places production Postgres on `disklinik-prod-01`, reachable only through the deploy/ops path; every prior production-evidence task in this program (F3-PROD-001, F3-PROD-002, F3-IMPL-002-PROD-RECON, this document's own §15) followed the same pattern — the operator runs a prepared read-only command and reports back redacted aggregate results. This task's `server/.env` was independently confirmed to be local/dev configuration (a `DATABASE_URL` variable exists; no part of its value was printed, connected to as if it were production, or represented as production evidence).

The confirmed schema (`server/prisma/schema.prisma:1533-1561`) matches §9.1's original SQL exactly (`"PlatformAdmin"`, `"totpEnabledAt"`, `"isActive"`) — **the SQL from §9.1 is confirmed correct and still valid as written.** This task extends it with an inactive-admin count and a structural-inconsistency check, both additive and still redaction-safe (aggregate-only, no row output):

```sql
-- Extends §9.1 (unchanged, still the primary criterion query)
SELECT
  COUNT(*) FILTER (WHERE "isActive" = true)                                  AS total_active_platform_admins,
  COUNT(*) FILTER (WHERE "isActive" = true AND "totpEnabledAt" IS NOT NULL)  AS mfa_enrolled_active,
  COUNT(*) FILTER (WHERE "isActive" = true AND "totpEnabledAt" IS NULL)      AS mfa_not_enrolled_active,
  COUNT(*) FILTER (WHERE "isActive" = false)                                 AS inactive_disabled_count
FROM "PlatformAdmin";

-- New: structural MFA-state inconsistency check (also aggregate-only)
SELECT
  COUNT(*) FILTER (WHERE "totpEnabledAt" IS NOT NULL AND "totpSecretEncrypted" IS NULL) AS enabled_without_secret,
  COUNT(*) FILTER (WHERE "totpEnabledAt" IS NULL AND "totpSecretEncrypted" IS NOT NULL)  AS secret_without_enabled
FROM "PlatformAdmin";
```

```
Command: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <file containing the two SELECTs above>
Purpose: Confirm Platform Admin MFA coverage and detect inconsistent TOTP enrollment state, in aggregate only.
Environment: production (disklinik-prod-01)
Read-only: YES
Sensitive values returned: NO — four/two integers only, no row-level data
```

Use an existing `.pgpass`/env-based credential mechanism for `$DATABASE_URL` — do not type or paste the connection string, and do not paste back anything other than the resulting integers. **`MFA_ENROLLMENT_COVERAGE = BLOCKED_PENDING_OPERATOR_EVIDENCE`** — unchanged from §9.1/§15.6; this remains the sole outstanding action for this specific lane.

### 16.6 Independent re-verification and adversarial review (Lanes D and E)

Lane D re-read every cited file independently (not trusting Lane A/B's line numbers) and reconfirmed all ten claims with no disagreement, producing the same three verdicts. Lane E attempted to falsify seven claims (production enrollment, fail-closed behavior, invalid-OTP rejection, "tests cover the login gate," no sensitive-data exposure, R-073 bearing, Criterion-2 classification) and could not falsify any of them — all seven `SURVIVE`, with one nuance carried forward: `platformAdmin.test.ts` does test MFA *enrollment* endpoints thoroughly; only the login-gate's own OTP branch remains untested, a narrower and more precise framing than "zero MFA tests."

### 16.7 Sensitive-data / redaction review (required disclosure, not silently omitted)

While reviewing this task's own handling of `server/.env` for the redaction-review sub-task, the Lane E subagent printed a partial connection string (username and password) for the **local, disposable "smoke" test database** configured in this worktree's `server/.env` — this is a local development credential, not a production credential, was not committed to any file in this repository, and is not reproduced in this document. It is disclosed here because it appeared in an internal agent transcript, which this program's own convention treats as an exposure event worth recording even at low severity; **the operator has been notified out-of-band and may wish to rotate that local smoke-test credential.** No production credential, admin email, password hash, TOTP secret, or JWT was printed, logged, or transmitted by any lane in this task.

### 16.8 Classification (governing decision matrix applied)

```
MFA_ENROLLED_LOGIN_FAILS_CLOSED = PASS
MFA_ENROLLMENT_COVERAGE         = BLOCKED_PENDING_OPERATOR_EVIDENCE
MFA_NEGATIVE_TEST_COVERAGE      = FAIL
PLATFORM_ADMIN_MFA_LANE         = BLOCKED   (Case C governs: enrollment coverage blocked overrides an otherwise-correct code path; Case D's NOT_READY framing does not apply because enrollment coverage is not PASS)
```

A correct, fail-closed login gate does **not** by itself satisfy this lane — production coverage has still never been measured, and the negative-test gap is a second, independent deficiency that would remain even if the SQL above came back `mfa_enrolled = total`. **Recommended minimal follow-up task** (implementation, explicitly out of scope for this verification-only task and requiring its own PR): add a route/DB-integration test suite exercising `POST /auth/login` directly for missing-OTP (expect `401 MFA_REQUIRED`), invalid-OTP (expect `401 MFA_INVALID`), valid-OTP (expect `200` + session, DB-seeded enrolled admin with a real TOTP secret), and non-enrolled-admin login (expect `200` + session, no OTP required) — mirroring the existing DB-backed fixture patterns already used in `platformAdminSessionRevocation.test.ts`.

> **[Superseded 2026-08-13, F3-SEC-EXIT-001-R3A — see §17.]** The operator has since executed §16.5's SQL against production. `MFA_ENROLLMENT_COVERAGE` is no longer `BLOCKED_PENDING_OPERATOR_EVIDENCE` — it is now measured. This §16.8 block is preserved unedited as dated, point-in-time evidence (it was correct when written); §17 records the full chronological lifecycle (initial `FAIL` measurement → supported-flow remediation → final `PASS` measurement) and the resulting classification. **`MFA_NEGATIVE_TEST_COVERAGE = FAIL` is unchanged and still governs:** `PLATFORM_ADMIN_MFA_LANE` moves from `BLOCKED` to `NOT_READY` (Case D now applies — enrollment coverage is `PASS`, but the route-level negative-test gap remains open), not to `PASS`.

### 16.9 Criterion / risk impact

```
GITHUB_SECURITY_SETTINGS_LANE = PASS          (unchanged, §15)
PLATFORM_ADMIN_MFA_LANE       = BLOCKED       (this task; previously an unqualified narrative note in §4, now a formal three-axis verdict)
F3_EXIT_CRITERION_2           = NOT_SATISFIED (unchanged — reasons 3–7 of §11 remain open regardless of this task's findings)
F3_EXIT_GATE                  = NOT_SATISFIED
F3_COMPLETE                   = NO
F4_TRANSITION_AUTHORIZED      = NO
```

**[Superseded 2026-08-13, F3-SEC-EXIT-001-R3A — see §17]:** `PLATFORM_ADMIN_MFA_LANE` is now `NOT_READY`, not `BLOCKED` — production enrollment coverage has since been measured and remediated to `PASS`; the negative-test gap alone now governs the lane's non-`PASS` state. `F3_EXIT_CRITERION_2` and `F3_EXIT_GATE` remain `NOT_SATISFIED`, unchanged.

**R-073 and R-019 are NOT closed and NOT touched by this task.** Lane E confirmed both directly: R-073 (`RISK_REGISTER.md:98`, Platform Admin JWT/session revocation) concerns `authenticatePlatformAdmin`'s DB-backed revocation check, orthogonal to the login-time MFA gate; R-019 (`RISK_REGISTER.md:117`, platform-admin privilege overreach/audit coverage) concerns audit-trail completeness, likewise unrelated. Both remain `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION` with no named decision owner — this task does not name one and does not propose closing either.

### 16.10 Migration / runtime / tenant / KVKK impact

```
Migration:                          NO (disposable local test DB only; server/.env untouched)
Schema:                             NO
Runtime code:                       NO
Production data mutation:           NO
Tenant query behavior:              NO
KVKK data-flow behavior:            NO
Auth behavior change:               NO
Read-only production security evidence: YES (operator command package prepared, not yet executed)
```

### 16.11 Test commands / counts (repeated for the required-format section)

```
npm run test:auth                                    → 133/133 passed, 0 failed
npm run test:totp                                    → 19/19 passed, 0 failed
npm run test:platform-admin-session-revocation       → 15/15 passed, 0 failed
npm run test:platform-admin-password-recovery        → 22/22 passed, 0 failed
git diff --check                                     → clean (verified before PR open)
```

### 16.12 Rollback

**Documentation:** `git revert` the merge commit that lands this section. No production rollback is applicable — this task performed no production mutation. The disposable local test database container was removed at the end of this task; no lasting local-environment change remains.

### 16.13 Architecture-review closure block

```
Accepted findings:
  - MFA_ENROLLED_LOGIN_FAILS_CLOSED = PASS, converged across 3 independent lanes (A/D/E), file:line cited.
  - MFA_NEGATIVE_TEST_COVERAGE = FAIL, converged across 3 independent lanes (A/D/E), zero login-route test matches confirmed by direct grep.
  - MFA_ENROLLMENT_COVERAGE = BLOCKED_PENDING_OPERATOR_EVIDENCE — no production access exists in this program's Claude Code sessions; operator command package prepared (§16.5), extends but does not replace §9.1's original SQL.
Rejected/unverified claims:
  - None of Lane E's 7 falsification attempts succeeded; all findings SURVIVE as stated.
Current task status:
  PLATFORM_ADMIN_MFA_LANE = BLOCKED. F3_EXIT_CRITERION_2 = NOT_SATISFIED (unchanged). F3_EXIT_GATE = NOT_SATISFIED (unchanged).
Merge safe:
  YES — documentation-only diff, no runtime/schema/production file touched, git diff --check clean.
Deployment safe:
  N/A — nothing to deploy; no application code changed.
Exact next task:
  Either (a) operator executes §16.5's SQL against production and reports back the four/two integers, or (b) a minimal implementation task adds POST /auth/login route/DB-integration tests per §16.8's recommendation — both are independent, either can proceed first. Redis/PM2 replica-topology verification (§9.2) remains the next planned blocker after MFA if MFA is not prioritized first.
```

---

## 17. F3-SEC-EXIT-001-R3A — Production MFA Enrollment Evidence, DB-Credential-Exposure Remediation, and Criterion-2 Reconciliation (2026-08-13)

**Task ID:** `F3-SEC-EXIT-001-R3A`. **Type:** documentation/evidence reconciliation only — no login-route implementation, no runtime/schema/route change performed by this task. **Branch:** `docs/f3-sec-exit-001-r3-platform-admin-mfa-coverage` (same branch/PR as §16 — this is a revision of that PR, not a new one). **Baseline:** `origin/main` @ `231b959f056e2fccd8b6019e04943cce8b6946f2` (PR #412's merge commit) — independently re-confirmed unchanged since §16's own baseline (`git merge-base --is-ancestor` from this task's branch head against `origin/main` returns non-ancestor in the expected direction, and `origin/main`'s tip is still `231b959f…`, i.e. zero new commits landed upstream between §16 and this task — a clean continuation, not a rebase).

### 17.1 What this task closes

§16.5/§16.8 left `MFA_ENROLLMENT_COVERAGE = BLOCKED_PENDING_OPERATOR_EVIDENCE` because the mandated SQL (§9.1, extended in §16.5) had never been run against production. **The operator has since run it — twice, bracketing a remediation.** This task records that chronological lifecycle, reconciles every stale `BLOCKED`/`BLOCKED_PENDING_OPERATOR_EVIDENCE` statement this document and the phase/tracker files carried, and separately records a production database-credential-exposure incident that occurred during the first query attempt and was remediated by the operator before this task began. **This task performs no production access itself** — every production fact below is operator-executed and operator-reported, exactly as every other production-evidence entry in this program (§15, §16.5, F3-PROD-001, F3-PROD-002).

### 17.2 Chronological MFA lifecycle

**Step 1 — initial production measurement (§9.1's original SQL, first-ever execution):**

```
total active platform admins = 1
mfa_enrolled                 = 0
mfa_not_enrolled             = 1
enabled_without_secret       = 0
secret_without_enabled       = 1
```

**Initial classification:** `MFA_ENROLLMENT_COVERAGE = FAIL` (not `BLOCKED` — the SQL now had an answer, and the answer was a failure: the sole active Platform Admin was not enrolled). The nonzero `secret_without_enabled` also confirms a pending/incomplete enrollment attempt existed on the row (a `totpSecretEncrypted` value with no corresponding `totpEnabledAt`) — consistent with, not contradicted by, the schema-level design §16.2 already documented (`totpSecretEncrypted` is written at `POST /auth/mfa/setup` time, before `POST /auth/mfa/verify` sets `totpEnabledAt`). Remediation was required to reach coverage.

**Step 2 — supported remediation.** The Platform Admin completed enrollment through the **existing application MFA setup/verify flow** (`POST /auth/mfa/setup` then `POST /auth/mfa/verify`, the same two endpoints §16.3 already confirmed are DB-backed and audit-trailed by `platformAdmin.test.ts`'s 118/118). **No direct database mutation of `totpEnabledAt` was performed by anyone at any point.** Setup generated a fresh pending TOTP secret (superseding whatever partial state produced Step 1's `secret_without_enabled = 1` row); the admin then completed a real authenticator-app TOTP verification against that fresh secret, and verification succeeded through the application's own `verifyTotp()` logic (`server/src/utils/totp.ts:78-102`, independently re-read and found bug-free by three lanes in §16.2). This is enrollment via the product's own supported path, not an operator or agent shortcut.

**Step 3 — final production measurement (§16.5's extended SQL, re-run after remediation):**

```
total_active_platform_admins = 1
mfa_enrolled_active          = 1
mfa_not_enrolled_active      = 0
inactive_disabled_count      = 0

enabled_without_secret       = 0
secret_without_enabled       = 0
```

**Final classification:** `MFA_ENROLLMENT_COVERAGE = PASS` — `mfa_enrolled_active = total_active_platform_admins` (1 = 1), zero inactive/disabled admins to separately reason about, and **both** structural-inconsistency checks read zero: no admin has a TOTP secret without `totpEnabledAt` set, and none has `totpEnabledAt` set without a secret. Production Platform Admin MFA state is now structurally consistent, measured directly, not inferred.

### 17.3 Final classification (supersedes §16.8, does not overwrite it)

```
MFA_ENROLLED_LOGIN_FAILS_CLOSED = PASS   (unchanged from §16.2 — architecture was never in question, re-affirmed here)
MFA_ENROLLMENT_COVERAGE         = PASS   (this task — was BLOCKED_PENDING_OPERATOR_EVIDENCE)
MFA_NEGATIVE_TEST_COVERAGE      = FAIL   (unchanged from §16.3 — zero login-route integration tests exist, this task adds none)
PLATFORM_ADMIN_MFA_LANE         = NOT_READY   (Case D governs: a correct fail-closed code path plus now-measured PASS enrollment coverage, but the route-level negative-test gap is real and independent — the lane cannot be called production-ready until that gap closes)
```

**Why `NOT_READY` and not `PASS`.** Enrollment coverage measures whether the system's *current data* is in the desired state; it says nothing about whether the login route's MFA branch is *guarded by a regression test* that would catch a future breakage. §16.3 already established, and this task changes nothing about, the fact that no test in this repository ever calls `POST /auth/login` with a `totpCode`. A future code change could silently reintroduce a bypass (e.g. an early `return` before the MFA check, a misordered conditional) and every currently-passing suite — `test:auth`, `test:totp`, `test:platform-admin-session-revocation`, `test:platform-admin-password-recovery` — would keep passing, because none of them exercises that branch. That is precisely the residual risk `NOT_READY` is meant to name, and it is why this task explicitly declines the instruction it was given not to follow: it does **not** classify the lane `PASS`.

**Why `MFA_ENROLLED_LOGIN_FAILS_CLOSED` is not re-verified from scratch here.** This task performed no code inspection beyond re-reading §16.2's own citations to confirm they still describe the current `platformAdmin.ts:95-107` (no drift possible — `origin/main` has not advanced since §16, per §17's baseline note above). The architecture verdict is carried forward, not re-derived.

### 17.4 Production DB-credential-exposure incident and remediation

**What happened.** During the Step 1 production query attempt (§17.2), the production PostgreSQL connection credential was accidentally exposed in terminal/chat output during that session. This is a real exposure event, not a hypothetical — recorded here factually, per this program's own established convention (§16.7 recorded a lower-severity local-credential disclosure the same way; F3-OBS-002-CLOSE §"R3" recorded and remediated a monitoring-credential exposure the same way).

**Critical redaction rule applied throughout this section and this entire task:** the old database password, the new database password, any full `DATABASE_URL`, any TOTP secret, the Platform Admin email, and any JWT/session value are **never** reproduced below or anywhere else in this document. This section describes the incident and its remediation by classification and state only, exactly as instructed.

**Remediation sequence, as performed by the operator (chronological, state-only):**

1. The production PostgreSQL role password was rotated interactively using PostgreSQL's own tooling (the old password is confirmed invalid as of this rotation — see §17.5).
2. `/var/www/noramedi/server/.env` was updated with the new credential, without the new credential ever being printed to any terminal or chat output this program's transcripts would capture.
3. The new credential was verified functional with a successful read-only `SELECT 1` against production.
4. The first PM2 reload attempt after rotation produced `/api/health` → HTTP `503`.
5. **Investigation found the root cause precisely:** `.env` on disk correctly contained the new `DATABASE_URL`, but the running `noramedi-api` PM2 process still carried the **old** `DATABASE_URL` in its process environment — a `DATABASE_URL_MISMATCH` between the file on disk and the live process.
6. **Root cause, stated as a general mechanism:** PM2 persists and reuses a process's environment across `reload`/`restart` unless that environment is explicitly replaced; `dotenv.config()` (used by this application's startup, per `server/src/index.ts`/`worker.ts`) does **not** override a variable that is already present in `process.env` when the process starts — it only fills variables that are absent. A stale `DATABASE_URL` already resident in PM2's stored process environment therefore took precedence over the freshly-updated `.env` file, and the application kept attempting to authenticate with the just-invalidated old password.
7. `noramedi-api` was deleted from PM2 and recreated fresh from the repository's `ecosystem.config.cjs`, with no `DATABASE_URL` set in the surrounding shell environment at creation time — eliminating any stale inherited value at the source rather than attempting to override it in place.
8. Post-recreation verification: `/api/health` → `{"status":"ok"}`; the `noramedi-api` PM2 process's own reported `DATABASE_URL` environment value → `NOT_PRESENT` (i.e. the process now sources it exclusively from `.env` via `dotenv.config()` at startup, with nothing stale left to shadow it).
9. `noramedi-worker` was independently deleted and recreated from the same `ecosystem.config.cjs`, for the identical reason — it was equally exposed to the same stale-inherited-environment mechanism, whether or not it had actually manifested a failure yet.
10. **Final production verification, both processes:**

```
noramedi-api:
  status=online, cwd=/var/www/noramedi/server, role=api, restart_time=0

noramedi-worker:
  status=online, cwd=/var/www/noramedi/server, role=worker, restart_time=0

API health:
  {"status":"ok"}

Worker PM2 DATABASE_URL:
  NOT_PRESENT
```

Both processes show `restart_time=0` — consistent with a clean delete-and-recreate (a fresh PM2 app record) rather than an in-place reload, and consistent with `role=api`/`role=worker` both reporting `declared=true` (the same `NORAMEDI_PROCESS_ROLE`-based proof F3-PROD-002 established as direct runtime evidence that `ecosystem.config.cjs`'s `env` block reached the process, re-applicable here for the identical reason).

11. `pm2 save` completed successfully — the current clean process list is persisted to `/root/.pm2/dump.pm2`, so a future host reboot restores this remediated state rather than any stale prior one.
12. The temporary backup `/var/www/noramedi/server/.env.before-db-password-rotation` was deleted after successful verification — no lingering copy of the pre-rotation `.env` (which would have contained the now-invalidated old credential) remains on disk.

**Incident classification:**

```
PRODUCTION_DB_CREDENTIAL_EXPOSURE = REMEDIATED
DB_CREDENTIAL_ROTATION            = PRODUCTION_VERIFIED
API_RUNTIME_POST_ROTATION         = PRODUCTION_VERIFIED
WORKER_RUNTIME_POST_ROTATION      = PRODUCTION_VERIFIED
```

**Explicitly not claimed:** this task does not claim the overall production security posture or F3's exit gate is closed by this remediation. It closes one specific, self-contained incident (an exposed credential, now rotated and confirmed invalid; two PM2 processes, now confirmed running with the new credential sourced correctly). It has no bearing on `F3_EXIT_CRITERION_2`'s other open blocking reasons (§11) and is not counted toward closing any of them.

### 17.5 Operational finding — durable risk, not fixed here

**The finding, stated precisely (per explicit instruction, quoted near-verbatim rather than paraphrased into ambiguity):** PM2's inherited/stored process environment can retain a stale secret across `pm2 startOrReload ... --update-env` if that variable already exists in PM2's stored process environment, while the application's own startup uses `dotenv.config()` without override — meaning `dotenv.config()` never gets the chance to correct a value PM2 has already injected into `process.env` before the application's own code runs. This is a general mechanism, not specific to `DATABASE_URL` — any secret-bearing environment variable managed the same way (`REDIS_URL`, `JWT_SECRET`, `CSRF_SECRET`, etc.) is equally exposed to it, though only `DATABASE_URL` was actually observed to misbehave in this incident.

**This task does not change runtime code.** No `ecosystem.config.cjs`, deploy script, or application startup file is touched by this task. The fix applied in production (§17.4 steps 7–9: delete-and-recreate the PM2 app record rather than reload-in-place) is an **operational** workaround performed by the operator directly against the running PM2 daemon, not a repository change, and is not proposed as the permanent fix here.

**Proposed follow-up task (not opened, not implemented by this task):** evaluate whether the deployment runbook/`ecosystem.config.cjs` contract should be changed so that secret-bearing environment variables are never persisted in PM2's own stored process environment at all — for example, by having PM2 launch the process with an explicitly empty/scrubbed environment for secret-bearing keys (forcing every secret to originate from `.env` via `dotenv.config()` on every single start, with no PM2-level shadowing possible even after a future in-place reload), or by adding a documented deploy-runbook step that always deletes-and-recreates rather than reload-in-place whenever a secret rotates. This task takes no position on which of those (or another) approach is correct — that judgment belongs to whoever implements the follow-up, with the actual deploy/`ecosystem.config.cjs` code in front of them. Recorded here as a durable operational risk observed in production, not a code defect found in the repository.

### 17.6 Reconciliation of stale statements

The following statements, present in this document and the phase/tracker files before this task, are stale as of §17.2/§17.3 and are reconciled — not deleted, per this program's own additive-correction convention (§15.9, F3-IMPL-002-PROD-RECON's banner precedent):

| Stale statement | Where | Reconciled to |
|---|---|---|
| `MFA_ENROLLMENT_COVERAGE = BLOCKED_PENDING_OPERATOR_EVIDENCE` | §16.5, §16.8, §16.9, §16.13, `CURRENT_PHASE.md`, `NORAMEDI_MASTER_TRACKER.md` | `MFA_ENROLLMENT_COVERAGE = PASS` (§17.2 Step 3, §17.3) |
| `PLATFORM_ADMIN_MFA_LANE = BLOCKED` | §16.8, §16.9, §16.13, `CURRENT_PHASE.md`, `NORAMEDI_MASTER_TRACKER.md`, `F3_PRODUCTION_HARDENING.md` | `PLATFORM_ADMIN_MFA_LANE = NOT_READY` (§17.3) |
| "production SQL not yet executed" / "operator command package prepared, not yet executed" | §16.5, §16.10 | Executed twice, bracketing a remediation — see §17.2 |
| §11 reason 2 ("**BLOCKED** — Platform Admin MFA enrollment coverage … the mandated coverage SQL has never been run against production") | §11 (pre-dates §16 entirely, written by the original F3-EXIT-C2 task) | Narrowed: enrollment coverage is now `PASS` and no longer contributes to criterion 2's `NOT_SATISFIED` verdict; criterion 2 remains `NOT_SATISFIED` on reasons 3–7, unchanged, plus the still-open negative-test gap this task does not close |

**Not reconciled, and deliberately left as dated historical text:** §16.2's architecture findings, §16.3's test-inventory findings, and §16.4's test-execution results are all still accurate as written — nothing in this task contradicts or supersedes them, so they are left untouched rather than reconciled.

### 17.7 Criterion-2 verdict (unchanged in outcome, reasons narrowed)

```
F3_EXIT_CRITERION_2 = NOT_SATISFIED
F3_EXIT_GATE        = NOT_SATISFIED
F3_COMPLETE         = NO
F4_TRANSITION_AUTHORIZED = NO
```

§11's seven blocking reasons, re-assessed in light of this task:

1. GitHub Code security and analysis settings — already resolved (§15/§15.6), unaffected by this task.
2. Platform Admin MFA enrollment coverage — **was** blocking (`BLOCKED`, no evidence ever collected); **now `PASS`, no longer blocking on the enrollment-coverage axis.** The lane as a whole is still not production-ready (`NOT_READY`, §17.3) because of the negative-test gap, which was already a **separate** deficiency named in reason 2's own original wording ("There are additionally zero negative tests for the login-time MFA gate") — that half of reason 2 is untouched by this task and continues to block.
3. Redis/API-replica topology — unaffected, still `PARTIAL/BLOCKED`.
4. R-073/R-019 decision-owner acceptance — unaffected, still `EXTERNAL_ACCEPTANCE_PENDING`, no owner named, not touched by this task.
5. External error tracking — unaffected, still `BLOCKED`/absent.
6. R-018 scope ambiguity — unaffected, still unresolved.
7. The other five unassessed §5 checklist items — unaffected, still unresolved.

**Criterion 2 does not depend on reason 2 alone**, and reasons 3–7 are each independently sufficient to keep it `NOT_SATISFIED` on their own — exactly as §11's own closing paragraph already stated before this task. This task narrows reason 2 from a full block to a half-block (the negative-test half only) and does not change the criterion's overall verdict.

### 17.8 Existing test evidence — not rerun

Per this task's explicit scope (documentation/evidence reconciliation only, no login-route implementation), no test suite was rerun. §16.4/§16.11's previously accepted results stand as the current evidence:

```
npm run test:auth                                    → 133/133 passed, 0 failed
npm run test:totp                                    → 19/19 passed, 0 failed
npm run test:platform-admin-session-revocation       → 15/15 passed, 0 failed
npm run test:platform-admin-password-recovery        → 22/22 passed, 0 failed
Total: 189/189 passed, 0 failed
```

**These still do not constitute `/api/platform/auth/login` MFA branch integration coverage** — unchanged from §16.3/§16.8's own qualification. The open test gap (§16.8's recommended follow-up, itemized in full below) remains the exact next implementation task.

### 17.9 Exact open test gap (restated, unchanged)

1. Enrolled admin + correct password + missing OTP → expect `401`, `code=MFA_REQUIRED`, no session/token issued.
2. Enrolled admin + invalid OTP → expect `401`, `code=MFA_INVALID`, no session/token issued.
3. Enrolled admin + valid OTP → expect `200`, session issued.
4. Non-enrolled active admin + correct password → no OTP required, expect `200`.
5. Inactive Platform Admin → remains rejected.

**Not implemented in this PR, per explicit task scope.**

### 17.10 Migration / runtime / tenant / KVKK impact

```
Migration:                          NO
Schema:                             NO
Runtime code:                       NO
Test code:                          NO
Login-route code:                   NO — explicitly out of scope for this task
Production data mutation by this task: NO — the MFA enrollment and DB-credential rotation described above were operator-performed against production directly, not by any code this task authored or executed
Tenant query behavior:              NO
KVKK data-flow behavior:            NO
Auth behavior change (by this task): NO
```

**Security/KVKK note:** production Platform Admin MFA state is now structurally consistent (§17.2 Step 3) and the exposed database credential is confirmed rotated and the old value confirmed invalid (§17.4). Both are positive, currently-live improvements to production security posture. Neither is a repository/code change, and neither closes F3's exit gate.

### 17.11 Rollback

**Documentation:** `git revert` the commit(s) that land this section, or amend the same PR branch, per this program's normal documentation-rollback convention. No application code, schema, or migration is touched, so no code rollback path exists or is needed.

**Production:** not applicable to this task in the destructive sense — this task performed no production mutation itself. The production actions described in §17.2/§17.4 were operator-performed and are already complete and verified; reverting this documentation commit does not and cannot undo them, exactly as §15.9 already established for a structurally identical case (GitHub settings vs. documentation being independent rollback planes). Rotating the database password back to its old (now-exposed) value would be a **regression**, not a rollback, and is explicitly not recommended.

### 17.12 Validation commands executed for this task

```
git fetch origin main
git status --short
git diff --check
git diff --stat
git diff --name-only
```

Purpose: confirm the branch is a clean continuation of its existing baseline (no drift since §16), confirm only `docs/program/**` files are touched, confirm no whitespace/conflict-marker defects, and confirm no credential value appears anywhere in the diff — verified by manual review of every added line against the redaction rule in §17.4, without printing any secret value to check for its own presence (a pattern-based sanity pass was used instead, described in the PR body / final report, not reproduced here since doing so would itself risk exposure).

### 17.13 Closure block

```
Accepted findings:
  - MFA_ENROLLED_LOGIN_FAILS_CLOSED = PASS (carried forward from §16.2, unchanged, not re-derived by this task).
  - MFA_ENROLLMENT_COVERAGE = PASS — production measured twice (FAIL, then PASS after supported-flow remediation), operator-executed and operator-reported, both measurements internally consistent (structural-inconsistency checks both zero in the final run).
  - MFA_NEGATIVE_TEST_COVERAGE = FAIL — unchanged from §16.3, this task adds no test.
  - PLATFORM_ADMIN_MFA_LANE = NOT_READY — supersedes §16.8's BLOCKED; Case D of the governing decision matrix now applies.
  - Production DB credential exposure = REMEDIATED; rotation, API runtime, and worker runtime all PRODUCTION_VERIFIED post-rotation.
  - PM2 stale-inherited-environment-vs-dotenv mechanism recorded as a durable operational finding; not fixed by this task; follow-up proposed, not opened.
Rejected or unverified claims:
  - None raised against this task's own claims within this task; §16's Lane E adversarial findings are unaffected and not re-litigated here.
Current task status:
  F3-SEC-EXIT-001-R3 evidence reconciliation complete (this R3A revision), but PLATFORM_ADMIN_MFA_LANE = NOT_READY. F3_EXIT_CRITERION_2 = NOT_SATISFIED. F3_EXIT_GATE = NOT_SATISFIED.
Merge safe:
  Only after this amended PR's exact-head CI succeeds and review confirms no secret leakage in the diff.
Deployment safe:
  N/A for this PR — it remains docs-only. Current production runtime is healthy after the operator's independent remediation (§17.4), which is already live and already verified, independent of this PR's merge status.
Exact next task:
  Implement the minimal POST /api/platform/auth/login MFA route/DB integration test suite (§17.9) — the sole remaining item standing between PLATFORM_ADMIN_MFA_LANE and PASS.
```

---

## 18. F3-EXIT-C2-LANE-F — Webhook-Secret Verification Query: Defect Record and Correction (2026-08-13)

**Task ID:** `F3-EXIT-C2-LANE-F` (Lane F of `F3-SEC-EXIT-001-R4-MASTER`).
**Type:** Documentation / evidence only. **No runtime, schema, migration, dependency, CI or configuration file is changed by this task. No production access was performed. No external control-plane setting was mutated.**
**Branch:** `docs/f3-exit-c2-lane-f-webhook-secret-checklist-fix`.
**Baseline:** `origin/main` @ `0ad59802bc5f9dcd567ef1d2fd72ec3797bb3f8b` (PR #414's merge commit, F3-SEC-EXIT-001-R4 Lane A), fetched fresh, clean worktree, no drift.

### 18.1 What this section closes

§7.1 and §11 reason 7 of this document record that **§5 item 4 of the governing checklist (webhook secrets configured per connection) had never been assessed**. This task assessed it — and found that the check itself could never have succeeded, because the command the checklist mandated does not run against this repository's schema. This section is the historical record of that defect; the *corrected* command now lives in the governing checklist itself (`F3-SEC-EXIT-001_FIRST_CUSTOMER_SECURITY_HARDENING_GATE.md` §5 item 4), per this program's convention that the checklist carries the current command and the evidence document carries the history.

This section does **not** claim the item now passes. The corrected query has been executed only against a disposable, empty local database to prove it runs (§18.3); it has **never** been executed against production, so no production coverage is measured.

### 18.2 Defect record

```
OLD_CHECK         = SUPERSEDED
REASON            = schema-invalid query (undefined column + undefined relation), plus row-id exposure
DATE_DISCOVERED   = 2026-08-13 (F3-SEC-EXIT-001-R4-MASTER, Lane F)
DATE_INTRODUCED   = 2026-08-11 (F3-SEC-EXIT-001, original authoring of §5 item 4)
ERRORS_OBSERVED   = OBSERVED_ON_DISPOSABLE_LOCAL_MIGRATED_DB — see §18.3
PRODUCTION_EXECUTION = NO
REPLACEMENT_CHECK = F3-SEC-EXIT-001_FIRST_CUSTOMER_SECURITY_HARDENING_GATE.md §5 item 4 (corrected 2026-08-13)
```

**The superseded command, reproduced verbatim so it is not lost:**

```sql
SELECT id, "webhookSecretEncrypted" IS NOT NULL AS has_secret FROM "WhatsAppConnection";
SELECT id, "webhookSecretEncrypted" IS NOT NULL AS has_secret FROM "ExternalCalendarConnection";
```

It shipped with the parenthetical *"(Adjust table/column names to the exact current schema; confirm no row has `has_secret = false` in production.)"* — i.e. its own author flagged that the names were unverified. That caveat is the reason this is recorded as an **authoring defect**, not as a regression caused by later schema drift: the names were never correct for any commit in this repository's history.

**Four independent defects, each sufficient on its own to invalidate the check:**

| # | Defect | Evidence |
|---|---|---|
| 1 | `WhatsAppConnection` has **no** `webhookSecretEncrypted` column. Its real secret columns are `metaWebhookSecret` and `webhookSecret`. | `server/prisma/schema.prisma:1695`, `:1703` |
| 2 | There is **no** `ExternalCalendarConnection` model anywhere in the schema. The real model is `ExternalCalendarIntegration`. | `server/prisma/schema.prisma:3428`; no `ExternalCalendarConnection` exists — only a *function* name, `getExternalCalendarConnectionRecordByReceiverKey`, which is the likely source of the mistaken table name |
| 3 | `InstagramConnection` — a third model that genuinely carries a per-connection `webhookSecret` and is genuinely reachable by an inbound signed webhook — was **omitted entirely**. | `server/prisma/schema.prisma:1902`; consumed at `server/src/routes/instagramWebhook.ts:184, 305-313` |
| 4 | Both statements `SELECT id`, returning row identifiers. This program's own redaction rule (§9, §16.5, §17.4 of this document) requires production evidence to be aggregate-only. The mandated command therefore conflicted with the mandated redaction policy. | this document §9 preamble: *"Do not paste back any raw output containing a credential"*; §16.5: *"aggregate-only, no row output"* |

### 18.3 Errors OBSERVED — disposable local migrated database, NOT production

```
ERRORS_OBSERVED      = OBSERVED_ON_DISPOSABLE_LOCAL_MIGRATED_DB
PRODUCTION_EXECUTION = NO
```

**These are real observed errors, not predictions — and they were observed on a throwaway local database, never on production.** Both statements of the superseded command were executed on 2026-08-13 against a disposable PostgreSQL 16 container holding this repository's full migrated schema. Verbatim output:

```
=== ORIGINAL §5 item 4, query 1 ===
ERROR:  column "webhookSecretEncrypted" does not exist
LINE 1: SELECT id, "webhookSecretEncrypted" IS NOT NULL AS has_secre...
                   ^
=== ORIGINAL §5 item 4, query 2 ===
ERROR:  relation "ExternalCalendarConnection" does not exist
LINE 1: ...okSecretEncrypted" IS NOT NULL AS has_secret FROM "ExternalC...
                                                             ^
```

**Execution context, for reproducibility:**

| Field | Value |
|---|---|
| Database | disposable container `noramedi-r4-lanea-db`, image `postgres:16-alpine`, DB `noramedi_r4_lanea`, bound `127.0.0.1:5546` (loopback only) |
| Created | 2026-08-13T17:28:38Z |
| Schema state | `npx prisma migrate deploy` → *"All migrations have been successfully applied."* (2026-08-13T17:28:56Z), applied from the Lane A worktree at `origin/main` @ `8000c276915e5c3aa7b460acce4ec4455e1b8ec8` |
| Command | `docker exec -i noramedi-r4-lanea-db psql -U postgres -d noramedi_r4_lanea -v ON_ERROR_STOP=1 < orig1.sql` / `< orig2.sql` (each statement run separately, so both errors surface) |
| Executed | 2026-08-13T19:09:02Z; output captured 19:09:06Z |
| Data content | **empty database** — schema only, zero connection rows. No secret, ciphertext or row identifier existed to be exposed. |
| Container lifetime | already removed; `docker ps -a --filter name=noramedi-r4-lanea-db` returns nothing as of this writing |

The SQLSTATE classes are `42703` (undefined_column) for statement 1 and `42P01` (undefined_table) for statement 2. Those class codes are a **derived mapping** of the observed messages — `psql` printed the messages above without the SQLSTATE, so the codes remain an inference while the messages themselves are observed.

Two further facts that keep this evidence in proportion:

1. **Production has never run this query, corrected or superseded.** This program grants its Claude Code sessions no production database access (§16.5). Nothing here measures production configuration.
2. **The corrected replacement was executed on the same disposable database and returned `SQL_EXIT=0`** with four scope rows, all `total = 0, with_secret = 0` — because the database was empty. That proves the corrected command *parses and runs against the real migrated schema*. It proves **nothing** about webhook-secret coverage, since a trivially-empty result satisfies `with_secret = total` vacuously.

### 18.3a Provenance correction — how the record went wrong

An earlier revision of this section asserted `ERRORS_OBSERVED = NOT_EXECUTED` and stated that the query *"was never executed against production, or against any database, by this task or any prior one."* **That statement was incorrect and is withdrawn.**

How it arose: the assessing session verified execution status only against **its own** session record — where the query genuinely had not been run — and then generalised that scope-limited negative into a claim about all prior work, without inspecting the preceding session's transcript. A conservative-sounding claim was therefore made outside the evidence that supported it. The error was caught by the program owner, who noticed the contradiction against the preceding delivery report, and resolved from the preceding session's primary tool-call record (transcript `fe276944-8cc2-4746-b964-001d808359d6`, tool_use `toolu_01XojxHy8HG5LLP8rQynFi4r`).

The general rule this records: a negative existence claim (*"never happened"*) requires evidence covering **every** place it could have happened. Where that coverage is absent, the correct value is `UNVERIFIED`, not `NOT_EXECUTED`.

Nothing about the underlying schema defect changes. Defects 1–4 in §18.2 stand exactly as written; they are now supported by executed evidence in addition to the static schema comparison.

### 18.4 Independently confirmed models and secret columns

Confirmed directly against `server/prisma/schema.prisma` at the baseline SHA, not assumed from the prior delivery's summary. The prior delivery's finding is **confirmed correct**, with one addition it did not state (the runtime consumer of each column, and the scope filter each consumer applies):

| Model | Secret column(s) | Runtime consumer | Scope filter used at runtime |
|---|---|---|---|
| `WhatsAppConnection` (`:1667`) | `metaWebhookSecret` (`:1695`), `webhookSecret` (`:1703`) | Meta Cloud webhook HMAC — `routes/metaWhatsAppWebhook.ts:232, 375`; effective secret = `decrypt(metaWebhookSecret)` OR-else `decrypt(webhookSecret)` | `provider = 'meta_cloud_api' AND isActive = true` (`:218`, `:302`, `:363`) |
| `WhatsAppConnection` (same model, second path) | `webhookSecret` (`:1703`) only | Evolution-API public-API tenant credential — `routes/whatsapp.ts:1166-1186`, constant-time compare of the decrypted per-connection value | `provider = 'evolution_api' AND isActive = true` (`:1170`) |
| `InstagramConnection` (`:1883`) | `webhookSecret` (`:1902`) | Instagram webhook HMAC — `routes/instagramWebhook.ts:305-313` | `isActive = true` (`:170`) |
| `ExternalCalendarIntegration` (`:3428`) | `webhookSecretEncrypted` (`:3448`) | DigiDentiS webhook HMAC — `routes/externalCalendarWebhook.ts:83-96` | resolved by `webhookReceiverKey` only — **see §18.5(b)** |

### 18.5 Two findings surfaced by this correction, neither previously recorded

**(a) Evolution-API WhatsApp connections were missing from item O's own scope sentence.** Item O in §2 of the checklist names only *"Instagram, Meta WhatsApp, each DigiDentiS external-calendar connection"*. But `routes/whatsapp.ts:1107-1113` establishes that an Evolution-API connection's `webhookSecret` is the **tenant-identifying inbound credential** for the public WhatsApp API — the authorization-order comment is explicit: *"Verify it against each active Evolution connection's own `webhookSecret` … this IS the tenant signal."* A missing per-connection secret there does not merely disable signature checking; it pushes the request onto the `LEGACY_SINGLE_CONNECTION_COMPATIBILITY` path, which is only ever accepted under a strict single-active-connection topology and fails closed the moment a second connection exists. That is a live multi-tenant authorization property, so those rows belong in the required scope. Item O's Notes cell has been corrected in place with a dated marker; its original wording is preserved in the same cell.

**(b) `ExternalCalendarIntegration` webhook lookup does not filter on `enabled`.** `getExternalCalendarConnectionRecordByReceiverKey` (`services/externalCalendar/externalCalendarConnectionService.ts:169-174`) is a bare `findUnique` on `webhookReceiverKey`, and `routes/externalCalendarWebhook.ts` contains **zero** references to `enabled` (verified by grep). A disabled integration row is therefore still reachable by anyone holding its receiver key. This is **not** classified as an exploitable hole: `requireWebhookSecretInProduction` (`utils/secrets.ts:13-15`) makes a secretless row reject in production, and a row *with* a secret still requires a valid HMAC signature. It is recorded because the corrected query's PASS scope deliberately requires only `enabled = true` rows, and that narrowing must be justified explicitly rather than assumed — `enabled = false` rows are reported as a separate, clearly non-gating row rather than dropped from the result.

### 18.6 Corrected check — requirements traceability

The corrected command now in `F3-SEC-EXIT-001` §5 item 4 satisfies each stated requirement:

| Requirement | How it is met |
|---|---|
| returns only aggregate counts | every branch is `COUNT(*)` / `COUNT(*) FILTER (...)`; no non-aggregate column is projected |
| exposes no IDs | no `id` column appears anywhere; `scope` is a literal string authored in the query, not row data |
| exposes no secret / ciphertext / plaintext | the secret columns appear only inside `IS NOT NULL` predicates, never in a select list |
| distinguishes provider/state where required | separate `scope` rows for `meta_cloud_api`, `evolution_api`, unrecognized providers, Instagram, calendar-enabled, calendar-disabled, and both inactive sets |
| covers every active/enabled relevant connection model | all three secret-bearing models, both WhatsApp provider paths |
| explicit PASS condition | `PASS iff (a) with_secret = total for every required = true row AND (b) whatsapp_unrecognized_provider__active.total = 0` |
| unsupported/legacy providers not silently PASS | clause (b) — an unrecognized active provider fails the check even if those rows happen to carry secrets |
| explicit limitation for non-null-but-undecryptable legacy values | recorded in the checklist itself: `with_secret` proves `NOT NULL` only; `tryDecryptConnectionSecret` (`routes/whatsapp.ts:1145-1154`) turns a corrupted value into `null` at runtime, so `with_secret = total` is **necessary but not sufficient** |

**Note on the result shape.** A fourth column, `required`, was added to the requested `scope | total | with_secret` shape. Without it the PASS condition would depend on a reader correctly remembering which scope names gate and which are informational — exactly the class of ambiguity that produced the original defect. The extension is called out here rather than made silently.

### 18.7 Residual gap this correction does NOT close

A read-only SQL check cannot prove a stored ciphertext decrypts — that needs `ENCRYPTION_KEY` and an application-side oracle. Until such an oracle exists, `WEBHOOK_SECRET_DECRYPTABILITY = UNVERIFIABLE_BY_SQL` stands as a permanent qualifier on any PASS this item ever records. A follow-up (a read-only script that loads the application's own decrypt helper and emits per-scope `decryptable`/`undecryptable` counts and nothing else) is **noted, not opened, and not implemented by this task** — it would be executable code, which is outside this docs-only PR's boundary.

### 18.8 Lane-F classification

```
WEBHOOK_SECRET_CHECKLIST_QUERY   = CORRECTED
OLD_CHECK                        = SUPERSEDED (preserved verbatim, §18.2)
WEBHOOK_SECRET_PRODUCTION_STATUS = NOT_MEASURED — corrected query never executed against production
CORRECTED_QUERY_EXECUTABILITY    = PROVEN (SQL_EXIT=0 on disposable migrated schema, empty DB)
F3_SEC_EXIT_001_S5_ITEM_4        = STILL_OPEN (the check is now runnable; it has not been run on production)
```

**This lane does not move `F3_EXIT_CRITERION_2`.** §11 reason 7 named the webhook-secret item as unassessed; it remains unassessed. What changed is that the mandated command would have failed on contact with production, and now would not.

### 18.9 Migration / runtime / tenant / KVKK impact

```
Migration required:                      NO
Migration created:                       NO
Migration applied:                       NO
Schema changed:                          NO
Runtime/application code changed:        NO
Test code changed:                       NO
CI/workflow changed:                     NO
Production deployment:                   NO
Production data mutation:                NO
External control-plane settings changed: NO
Tenant query behavior changed:           NO
Authentication behavior changed:         NO
Secrets changed or exposed:              NO — no secret, ciphertext, connection string or row id appears in this diff
KVKK data-flow changed:                  NO
```

### 18.10 Validation commands run

```
Command: git diff --check
Purpose: whitespace / conflict-marker defects in the documentation diff
Result:  clean, exit 0

Command: git diff --name-only origin/main
Purpose: confirm the diff touches only docs/program/evidence/**
Result:  2 files, both under docs/program/evidence/

Command: git rev-parse origin/main
Purpose: baseline confirmation
Result:  0ad59802bc5f9dcd567ef1d2fd72ec3797bb3f8b
```

No application test suite was run: no runtime, schema, test or dependency file is touched by this task. No documentation-link or evidence-consistency validation script exists in this repository — re-confirmed against the current root `package.json` (only a frontend `lint` script exists; no docs/evidence validator), so none is claimed. `ci-pr.yml` applies no path filter to its `on:` trigger, so the standard PR Gate applies to this docs-only PR.

### 18.11 Rollback

`git revert` the merge commit that lands this section. Reverting restores the superseded, schema-invalid command as the governing check — which would be a **regression**, not a recovery, and should only be done if this correction is itself found wrong. No production, schema, or control-plane state is touched by this PR, so there is no second rollback plane.

### 18.12 Closure block

```
Accepted findings:
  - The checklist's mandated webhook-secret query was schema-invalid and could never have run: undefined column
    "webhookSecretEncrypted" on "WhatsAppConnection", undefined relation "ExternalCalendarConnection".
    Confirmed twice over: by direct read of server/prisma/schema.prisma at the baseline SHA, and by OBSERVED
    execution failure on a disposable local migrated database (§18.3). Not observed on production.
  - InstagramConnection.webhookSecret was omitted from the original check entirely.
  - Evolution-API WhatsApp connections were omitted from item O's scope sentence; they consume a per-connection
    webhookSecret as the tenant-identifying inbound credential (routes/whatsapp.ts:1107-1113).
  - ExternalCalendarIntegration webhook resolution does not filter on `enabled`; recorded, classified as
    non-exploitable (production fail-closed still applies), and used to justify the corrected query's PASS scope.
  - with_secret proves NOT NULL only; decryptability is unverifiable by SQL and is recorded as a standing residual.
Rejected or unverified claims:
  - ERRORS_OBSERVED is NOT populated with production errors. The failures were observed on a disposable, empty,
    loopback-bound local database (§18.3). PRODUCTION_EXECUTION = NO. No future document may cite them as a
    production result.
  - The SQLSTATE codes 42703 / 42P01 remain DERIVED: psql printed the messages without SQLSTATEs.
  - An earlier revision of this section claimed the query "was never executed anywhere". That claim was WRONG and
    is withdrawn — see §18.3a for the correction and its cause.
  - The corrected query's clean run proves executability only; the database was empty, so with_secret = total held
    vacuously. It is NOT evidence of webhook-secret coverage.
  - No claim is made that webhook secrets are configured in production. WEBHOOK_SECRET_PRODUCTION_STATUS = NOT_MEASURED.
Current task status:
  Lane F complete as a documentation correction. F3_SEC_EXIT_001_S5_ITEM_4 = STILL_OPEN.
  F3_EXIT_CRITERION_2 = NOT_SATISFIED (unchanged by this lane).
Merge safe:
  Docs-only diff under docs/program/evidence/**; git diff --check clean; no secret in the diff.
  Merge decision belongs to the program owner — this task does not merge.
Deployment safe:
  N/A — nothing to deploy.
Exact next task:
  Operator executes the corrected §5 item 4 query against production (read-only, aggregate-only, safe to paste in
  full) and reports the scope / total / with_secret / required rows.
```
