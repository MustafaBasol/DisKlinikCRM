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
