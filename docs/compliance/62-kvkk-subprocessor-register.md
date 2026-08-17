# 62 — KVKK-CRIT-002 / Subprocessor Register

**STATUS: `DRAFT_FOR_COUNSEL_REVIEW`.**

This document is **not** a legal determination that any listed provider is a lawful
subprocessor, that any required contract/DPA/SCC is in place, or that international
transfer requirements are satisfied. It is a factual inventory — built strictly from
what is verifiable in this repository (environment-variable names, integration code,
existing audit documents) plus explicit `TO BE VERIFIED` markers wherever a fact was
not independently confirmed. **No legal entity name, contract term, data-residency
region, or transfer mechanism is asserted anywhere below unless a specific evidence
source is cited for it.** Where no such source exists, the field says
`TO BE VERIFIED` — it is never guessed.

This register is incorporated by reference into
`docs/compliance/61-kvkk-data-processing-agreement.md` Annex C. Update this single
document, not the DPA template, when a provider's status changes.

## 0. Classification legend

| Status | Meaning |
|---|---|
| `ACTIVE` | Repository evidence (env var wired into working code, integration routes present) confirms the platform currently has a live technical integration with this provider, for at least some clinics/configurations. |
| `CONFIGURABLE, NOT CONFIRMED ACTIVE` | The platform supports connecting to this category of provider, but no repository evidence confirms a specific vendor is actually configured/used in production today. |
| `NOT YET INTEGRATED` | Code exists for the category but currently only a placeholder/mock implementation is registered — no real third-party vendor receives data through this path yet. |
| `NO SUBPROCESSOR IDENTIFIED` | No third-party vendor relationship was found in the repository for this category as of this document's drafting. |

## 1. Hosting / VPS infrastructure

| Field | Value |
|---|---|
| Category | Infrastructure hosting (VPS, compute, network) |
| Status | `ACTIVE` (a production VPS clearly exists and serves the platform — `docs/program/PRODUCTION_TOPOLOGY.md`), but the **hosting company's identity is `TO BE VERIFIED`** |
| Provider name | `TO BE VERIFIED`. The 2026-07-15 compliance audit (`docs/compliance/archive/NoraMedi_KVKK_Denetim_Raporu_2026-07-15_v3_REVIZE_full.md` §8/§11) refers to the provider as "Hostinger" when describing checklist items (disk/volume encryption, snapshot encryption settings) to verify — but the later, independently-gathered production-topology evidence (`docs/program/evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md`, `docs/program/evidence/F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md`, `docs/program/PRODUCTION_TOPOLOGY.md`) describes the VPS/topology in detail (host `disklinik-prod-01`, Ubuntu, PM2, host Nginx) but does **not** itself name or independently re-confirm a hosting company. Do not treat "Hostinger" as confirmed until an independent production-evidence check (e.g. WHOIS/reverse-DNS/billing-panel screenshot) resolves it. |
| Data processed | All platform data at rest and in transit through this host: database (PostgreSQL), application file storage (`server/uploads/`), database backups (same host, per `docs/program/PRODUCTION_TOPOLOGY.md` §6), Redis (rate-limit counters only, not patient data). |
| Data residency / region | `TO BE VERIFIED` — not established in any reviewed document. |
| Contract / DPA status | `TO BE VERIFIED` — no hosting contract or DPA document exists in this repository; this register cannot confirm whether one exists outside the repository. |
| Encryption at rest | `TO BE VERIFIED` — disk/volume encryption, PostgreSQL storage-level encryption, and backup encryption are all listed as unverified in `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` §4 and `docs/program/PRODUCTION_TOPOLOGY.md` §7. |
| International transfer relevance | `TO BE VERIFIED` — depends on the confirmed hosting region; if the region is Türkiye, Art. 9 international-transfer analysis for the hosting layer itself may not apply (as opposed to the AI/messaging subprocessors below, which are cross-border regardless of hosting region). |
| Risk notes | This is the single highest-priority `TO BE VERIFIED` item in this register — every other operational-security item downstream of it (backup safety, encryption-at-rest, snapshot handling) depends on first confirming who the actual provider is and what their platform offers. |

## 2. AI-assisted messaging: Google (Gemini)

| Field | Value |
|---|---|
| Category | AI processing (message drafting assistance) |
| Status | `ACTIVE` — `GEMINI_API_KEY` is a wired, functioning configuration variable (`server/.env.example`), and the archive audit report confirms a real integration exists and sends live traffic to `generativelanguage.googleapis.com` when a clinic has this feature enabled. |
| Provider name | Google (Gemini API). Which product tier — free AI Studio tier vs. paid Vertex AI/Enterprise tier — is **`TO BE VERIFIED`**; this materially affects whether Google may use submitted content for model training (per `docs/compliance/archive/NoraMedi_KVKK_Denetim_Raporu_2026-07-15_v3_REVIZE_full.md` §7, row for Google: "hangi ürün kademesi ... kod incelemesiyle kesinleşmedi"). |
| Data processed | Per the same archive report §7: only the patient's first name and a masked message history (email/phone-shaped substrings redacted, bounded to 10 messages / 300 characters) — a documented data-minimization measure. This reduces exposure; it does **not** remove the Art. 9 transfer obligation, and it is not itself a substitute for a transfer-mechanism decision. |
| Data residency / region | `TO BE VERIFIED` — the archive report explicitly withdrew an earlier, unverified "US-based processing" claim (§7: "'ABD' iddiası bu revizyonda geri çekildi"). Do not reassert a specific region without new evidence. |
| Contract / DPA status | `TO BE VERIFIED` — no Google DPA/contract document exists in this repository. |
| International transfer mechanism | **Not yet selected.** `docs/compliance/61-...md` §7 records this as an open counsel decision (Art. 9 post-2024 regime; consent is one option among several, not the only one). |
| Risk notes | Whether the platform contracting entity or each individual clinic is the counterparty to Google's terms is itself `TO BE VERIFIED` (archive report §7) — this affects who is the "processor→subprocessor" party in the KVKK sense for this specific relationship. |

## 3. Messaging channels: Meta (WhatsApp Business Cloud API, Instagram)

| Field | Value |
|---|---|
| Category | Communication channel delivery (patient messaging) |
| Status | `ACTIVE` — `META_APP_ID`/`META_APP_SECRET`/`META_GRAPH_API_VERSION`/`META_EMBEDDED_SIGNUP_CONFIG_ID`/webhook verify tokens for both WhatsApp and Instagram are wired configuration (`server/.env.example`), and existing consent-gating code (`channelConsentGate.ts`, per the compliance tracker) confirms a live integration. |
| Provider name | Meta Platforms (WhatsApp Business Cloud API; Instagram). Exact Meta Business/Cloud API plan tier is `TO BE VERIFIED` (archive report §7). |
| Data processed | Message content sent/received through the enabled channel(s), where the clinic has enabled that channel and channel-specific consent exists (`ChannelConsentLog`). |
| Data residency / region | `TO BE VERIFIED` — not established in any reviewed document. |
| Contract / DPA status | `TO BE VERIFIED` — no Meta contract/DPA document exists in this repository. Whether the platform or each clinic is the direct contracting party with Meta is also `TO BE VERIFIED` (archive report §7). |
| International transfer mechanism | **Not yet selected** — same open status as §2 above; see `docs/compliance/61-...md` §7. |
| Risk notes | The archive report (§7, follow-up item 7) separately flags a question about "Evolution API" (an unofficial WhatsApp client) usage and whether it creates additional KVKK/Meta-ToS risk beyond the official Cloud API path — `TO BE VERIFIED`; this register does not resolve that question, only records it so it is not lost. |

## 4. Email delivery (SMTP)

| Field | Value |
|---|---|
| Category | Transactional/notification email delivery |
| Status | `CONFIGURABLE, NOT CONFIRMED ACTIVE` — `server/.env.example` documents a generic SMTP integration (`MAIL_ENABLED`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`/`SMTP_REPLY_TO`) explicitly designed to work with "any SMTP provider: Brevo, Mailgun, Postmark, Amazon SES, own server" — the repository does not select or hard-code a specific vendor. |
| Provider name | `TO BE VERIFIED` — depends entirely on what is actually configured in the production environment; this register cannot determine that from source code alone. |
| Data processed | Recipient email address, and whatever notification content the platform sends via email (transactional notifications) — exact content categories `TO BE VERIFIED` by reviewing the specific email templates in active use. |
| Data residency / region | `TO BE VERIFIED` — depends on the actual configured provider. |
| Contract / DPA status | `TO BE VERIFIED`. |
| International transfer relevance | `TO BE VERIFIED` — most listed example providers (Brevo, Mailgun, Postmark, Amazon SES) are non-Turkish; if any is the actual configured provider, the same Art. 9 analysis as §§2–3 applies and has likewise not yet been performed. |
| Risk notes | Confirming the actual production `SMTP_HOST` value (without exposing `SMTP_PASS`) is a low-effort, high-value next verification step — this is a configuration read, not a code change. |

## 5. SMS delivery

| Field | Value |
|---|---|
| Category | SMS notification/reminder delivery |
| Status | `NOT YET INTEGRATED` — verified by direct code inspection: `server/src/services/sms/smsProviders.ts` registers only `MockSmsProvider` instances (`mock_turkey`, `mock_europe`) and its own module docstring states real Turkey/Europe SMS companies are "connected later by implementing `SmsProvider` and adding them here." `server/src/services/sms/platformSmsProviders.ts` supports a `PlatformSmsProvider` database-configuration model (encrypted credentials, per-region routing) for when a real provider is connected, but as of this document's drafting, no real SMS vendor is wired into the registry that model resolves against. |
| Provider name | `NO SUBPROCESSOR IDENTIFIED` at the code level today. If/when a real provider (e.g. a Turkish operator like Netgsm/İleti Merkezi, or an international provider like Twilio) is integrated, this row must be updated **before** that integration is used with real patient data, and the DPA (`docs/compliance/61-...md`) and international-transfer analysis (§7 of that document) must be revisited for it. |
| Risk notes | This is the one subprocessor category in this register where the honest answer is "not active yet," not merely "unverified" — do not treat future SMS-provider selection as pre-approved by this register; it requires its own subprocessor-authorization and transfer-mechanism review at the time it is actually implemented. |

## 6. Object storage / file backup (S3-compatible)

| Field | Value |
|---|---|
| Category | Object storage (attachments/imaging files), offsite backup |
| Status | `NOT YET INTEGRATED` in production — `server/.env.example` and `docs/program/PRODUCTION_TOPOLOGY.md` §6 both confirm the platform's dual-mode storage abstraction (`fileStorage.ts`) currently runs in `LOCAL_VPS_STORAGE` mode; no S3-compatible bucket/credentials are configured in production evidence gathered by F0-002/F0-006 (`docs/program/PRODUCTION_TOPOLOGY.md` §7: "Offsite backup copy | Not found, not supplied — treated as absent"). The codebase does have S3-capable code paths (`@aws-sdk/lib-storage`, per `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` §6.2 file list) for the export-package feature, but that is a capability, not evidence of a configured production S3 subprocessor — `docs/program/LAUNCH_GATES.md` §2.E explicitly restates this distinction ("S3 capability ≠ proof of production S3 use"). |
| Provider name | `NO SUBPROCESSOR IDENTIFIED` for object storage today. |
| Database backup destination | Same host as the production database (`/root/noramedi-backups`, per `docs/program/PRODUCTION_TOPOLOGY.md` §6) — this is **not** a third-party subprocessor relationship distinct from §1 (Hosting), since it is the same VPS. **[2026-08-15, F4-FCR-002 — advance notice; this row is CORRECT AS WRITTEN TODAY and is NOT changed by that task.]** The clause "since it is the same VPS" is the entire load-bearing reason this row is not a subprocessor entry, so **the row stops being true the moment a pgBackRest `repo2` on any other host is activated** — at that point the backup destination becomes a distinct hosting relationship holding full physical copies of the database plus a continuous WAL stream, i.e. özel nitelikli sağlık verisi. F4-FCR-002 built that capability in the repository and **activated nothing**: no `repo2` is configured and the secondary Türkiye VPS is not procured. **[2026-08-17, F4-FCR-004 — factual correction, scope limited to this clause.]** This row previously also stated that `archive_mode` remains `off`; that ceased to be true when F4-FCR-002A activated pgBackRest/PITR on the production primary. The operator-executed read-only preflight of 2026-08-16 recorded `archive_mode=on` with `archive_command=pgbackrest --stanza=noramedi archive-push %p` (`../program/runbooks/F4_RECOVERY_OPERATIONS.md` §22.4a), and `R-031` closed on that evidence. **This changes nothing about this row's subprocessor conclusion**: WAL is archived to `repo1`, which is on the same VPS, so the "since it is the same VPS" reasoning below still holds and this row remains correct as written. It stops being correct the moment a `repo2` exists. This row must be corrected, and §1 given a second hosting entry, **before** any byte leaves the production host — not after. Prerequisites are enumerated in [`../program/runbooks/F4_RECOVERY_OPERATIONS.md`](../program/runbooks/F4_RECOVERY_OPERATIONS.md) §16.2. Note also that pgBackRest the **software** is not a subprocessor (self-operated open source — the same reasoning this register already accepted for GlitchTip); the subprocessor, if any, is the **host** the repository lives on. |
| Risk notes | If/when object storage or an offsite backup destination is added (tracked separately under `docs/architecture/object-storage-backup-migration-design.md` and the KVKK-HIGH-001 conditional item), this register must be updated with that provider's identity, region, and DPA status before real patient files are migrated to it. **[2026-08-14, F3-C2-ERR-002-R1 — advance notice, nothing activated]** a concrete candidate for exactly that transition now exists: the **NoraMedi Türkiye Secondary Infrastructure VPS** (§7's decision row) is intended to carry an **off-host backup target** and **clinic imaging / object storage** alongside GlitchTip. If either happens, **this section's `NOT YET INTEGRATED` status and the "Database backup destination" row above both become wrong** — that row's reasoning ("same host … not a third-party subprocessor relationship distinct from §1") depends on the backup staying on the production host. **Neither workload is authorized, designed or deployed today**; see `docs/program/evidence/F3-C2-ERR-002_ERROR_TRACKING_PROVIDER_DECISION.md` §7.3/§8/§11.2 for the gates that must be met first, including a DPA scoped to special-category health data. |

## 7. Monitoring / alerting / observability

| Field | Value |
|---|---|
| Category | Application/infrastructure monitoring, error tracking, alerting |
| Status | **`ACTIVE` since 2026-08-13 for two external availability-monitoring providers** (UptimeRobot and Healthchecks.io — see the two rows below), activated by `docs/program/evidence/F3-OBS-002_LIVE_OBSERVABILITY_WIRING_ALERT_VERIFICATION.md` §17. **`NO SUBPROCESSOR IDENTIFIED` still holds for error tracking / APM / log aggregation** — ADR-012 (observability) remains `DEFERRED`, no Sentry/Datadog-class provider has been adopted, and `server/src/utils/errorTracking.ts` stays a no-op unless a `SENTRY_DSN` is set. **[Narrow factual correction, 2026-08-14, F3-C2-ERR-001 — status token unchanged]** this row previously added "and `@sentry/node` separately installed (neither is done)"; the package **is** now a pinned dependency (`@sentry/node@10.70.0`, `server/package.json`), so that half is no longer true. **Nothing else changes: no provider has been adopted, no DSN is set in any environment, and the dependency is never even imported unless one is** (the import is dynamic and DSN-gated), so no data has been or can currently be transmitted to any error-tracking provider and this row's status stays `NO SUBPROCESSOR IDENTIFIED`. Activating it requires this register to be updated **first** — see §10 item 6, and the runbook + provider/KVKK classification in `docs/program/evidence/F3-OBS-001_PRODUCTION_OBSERVABILITY_MINIMUM.md` §15.8/§15.10 (which recommends a self-hosted provider precisely to avoid creating a new subprocessor and a cross-border transfer). **Superseded and preserved as history:** this row previously read `NO SUBPROCESSOR IDENTIFIED` outright, citing ADR-012 `DEFERRED` and `docs/program/LAUNCH_GATES.md` §2.F's "no monitoring/alerting stack exists", with manual/human monitoring substituting during a pilot — accurate until the activation above. |
| Error tracking — provider **model** decision (2026-08-14, F3-C2-ERR-002) | **A provider *model* has been decided; no provider has been deployed and this row's status token above is UNCHANGED (`NO SUBPROCESSOR IDENTIFIED` for error tracking).** The adopted model is **self-hosted GlitchTip on a Türkiye-located host** — see `docs/program/evidence/F3-C2-ERR-002_ERROR_TRACKING_PROVIDER_DECISION.md`. **[Amended 2026-08-14, F3-C2-ERR-002-R1 — provider decision unchanged, host scope reframed]** that host is no longer scoped as observability-only: it is the **NoraMedi Türkiye Secondary Infrastructure VPS**, intended to carry three logically separate workloads — **(A)** GlitchTip, **(B)** off-host backup target, **(C)** clinic imaging / object storage. **Only workload A is decided; B and C are scoped, not designed or authorized** (their design remains `docs/architecture/object-storage-backup-migration-design.md` (F0-011), phase `F4_STORAGE_AND_BACKUP`, phase `F10_IMAGING_DICOM_AND_AI`). **This materially raises what the hosting provider would hold** — workload A is a fixed message plus four bounded fields, but workload B would be full PostgreSQL dumps and workload C would be DICOM/CBCT imaging, i.e. **special categories of personal data (health data)**. Consequences recorded so they cannot be lost: the hosting DPA must be scoped to special-category data under KVKK Art. 6 (**`COUNSEL REVIEW PENDING`**); provider support-access restrictions must be answered contractually; encryption at rest becomes a primary control and the **provider-side vs guest-side** distinction becomes decisive; and **§6 below is engaged, not only this section** — §6 currently reasons that the database backup destination is *"the same host … **not** a third-party subprocessor relationship distinct from §1"*, which **workload B invalidates**, while workload C invalidates its `NOT YET INTEGRATED` token. **§1 and §6 must both be updated before workload B or C carries real data; none of that is triggered by the present task, which activates neither workload and deploys nothing.** Rationale: GlitchTip is Sentry-protocol compatible (the merged boundary needs no change) and, self-operated, creates **no software subprocessor** and **no KVKK Art. 9 cross-border transfer** — unlike GlitchTip hosted EU or Sentry SaaS, both of which land in Frankfurt, for which **no Türkiye adequacy decision is in evidence**. **One correction this decision forces, and it must not be lost:** `F3-OBS-001` §15.10 recorded the self-hosted option as adding no new subprocessor *"(runs on infrastructure already in the register)"*. Under a **separate** VPS that parenthetical is **no longer true** — the **hosting infrastructure provider is a new relationship** and is **`LIKELY YES` a data processor/subprocessor, `COUNSEL REVIEW PENDING`** (exact characterization depends on the platform-vs-clinic contracting structure, the same open question recorded for §2/§3). Distinguish four roles, which are routinely conflated: **software provider** (GlitchTip — receives no data, not a subprocessor), **hosting infrastructure provider** (new, in scope), **data processor/subprocessor** (the hosting provider, pending counsel), and **cross-border transfer** (engaged by destination country, not by vendor existence — **not engaged** if Türkiye hosting is evidenced). **Required before this row may move to `ACTIVE`:** Türkiye data-location evidence (that document §6, items E1–E5), a new hosting row here naming the provider/region/DPA/encryption-at-rest/backup region, and the §9 row `7c` update. **Related but NOT resolved by this decision:** §1 above still records the *existing* production hosting provider's identity **and region** as `TO BE VERIFIED`, so this register cannot presently evidence that NoraMedi's primary production database is in Türkiye either. |
| Provider 1 — UptimeRobot | **External HTTP uptime prober.** Three monitors poll public endpoints every 5 minutes: `GET https://api.noramedi.com/api/livez` and two against `GET https://api.noramedi.com/api/readyz` (one general, one asserting the literal body substring `"name":"redis","status":"ok"`). **Data transmitted: none by NoraMedi** — this is an inbound prober; it receives only what those two endpoints return. **Data received by the provider:** HTTP status code, response latency, and the response body of `/livez` and `/readyz`. Both endpoint payloads are **fixed-shape operational health documents** (`{"status","role","checks":[{"name","status"}]}`) containing no patient, tenant, user, clinic, session or free-text field — verified by reading `server/src/routes/health.ts` and `server/src/utils/readiness.ts`, whose reason vocabulary is a closed set and which are explicitly built never to leak a connection string, credential or raw driver error. Additionally: the provider learns NoraMedi's public API hostname and observes its availability pattern, and NoraMedi's operator email address is held by the provider as alert-recipient contact data. **Provider identity, corporate entity, hosting region, account tier, DPA and international-transfer mechanism: `TO BE VERIFIED` / `COUNSEL REVIEW PENDING`.** |
| Provider 2 — Healthchecks.io | **Dead-man's-switch (heartbeat) receiver.** Three checks (`noramedi-pm2`, `noramedi-disk`, `noramedi-backup`), Period 5 minutes / Grace 15 minutes, pinged outbound from the production host by `scripts/noramedi-opscheck.sh` under a root systemd oneshot + timer. **Data transmitted: heartbeat metadata only — no payload body is sent.** Each ping is a bare HTTPS GET to a per-check URL; the provider therefore receives the fact and timing of the ping, the outcome encoded solely by which URL was called (the base URL for success, a `/fail`-suffixed URL for failure), and — unavoidably, as with any HTTP request — the production host's **source IP address** and request timing. **No check name, hostname, disk percentage, backup filename, PM2 process name, log line, error text or any application data is transmitted**; the script's own design forbids it and this is asserted by a dedicated "No secret leakage" test case. The three ping URLs are themselves treated as credentials, held only in `/etc/noramedi/opscheck.env` (`root:root`, `0600`, not git-tracked). NoraMedi's operator email address is held by the provider as alert-recipient contact data. **Provider identity, corporate entity, hosting region, account tier, DPA and international-transfer mechanism: `TO BE VERIFIED` / `COUNSEL REVIEW PENDING`.** |
| Intentional-transmission assessment | **No patient, health, or tenant personal data is intentionally transmitted to either provider**, and no code path exists that would route such data to them. This is an assessment of the *current, code-verified* data flows only. It is **not** a legal conclusion, **not** a determination that no personal data whatsoever is involved (operator email and source IP are personal data), and **not** an international-transfer clearance. The relevant question of whether operator contact data and host IP metadata, transferred to providers whose hosting region is unverified, require a KVKK Art. 9 transfer mechanism is **`COUNSEL REVIEW PENDING`** — see §10. |
| Redis (rate-limiting) | Self-hosted, same host as the application (`docs/program/PRODUCTION_TOPOLOGY.md` §1) — used only as an optional, fail-open store for rate-limit counters, not a monitoring/observability product and not a distinct third-party subprocessor. Listed here only to avoid it being mistaken for an unlisted monitoring vendor. |
| Risk notes | The two providers above were chosen and wired specifically because neither requires shipping application logs or error payloads off-host — an availability prober and a heartbeat receiver, not a log sink. That materially limits incidental-personal-data exposure compared with the error-tracking/APM adoption this row previously anticipated. **That anticipated risk is unchanged and still live for any future adoption:** if a monitoring/error-tracking SaaS (e.g. Sentry, Datadog, or similar) is adopted later, it very likely will receive application logs/error payloads that could incidentally contain personal data unless a redaction policy (still `UNVERIFIED`/`DEFERRED` per R-018/ADR-012) is implemented first — that provider must be added to this register, and the redaction policy should exist **before**, not after, adoption. A second, narrower operational note: the alert-recipient email address is configured in each provider's console and is deliberately **never committed to this repository**, so this register records its existence as a data category without reproducing its value. |

## 8. GitHub / source-control and development systems

| Field | Value |
|---|---|
| Category | Source-code hosting, issue tracking, CI |
| Status | `ACTIVE` for source code and development artifacts (the repository itself is hosted on GitHub, per PR references throughout `docs/program/`) — but classified as **out of scope as a patient-data subprocessor** unless evidence emerges that real patient data has been committed, attached to an issue/PR, or otherwise transmitted through it. |
| Data processed | Source code, commit history, PR/issue discussion, CI logs. This register does not identify any confirmed instance of real patient data being placed into any of these surfaces — the existing PR/task discipline in `docs/program/` explicitly favors disposable/synthetic test data and documents when synthetic values are used (e.g. `docs/program/NORAMEDI_MASTER_TRACKER.md`'s repeated "synthetic values only" notes for production log verification). |
| Provider name | GitHub, Inc. (a Microsoft subsidiary) — named here only because the repository's own PR URLs confirm its use for source control; not independently verified against a signed GitHub Enterprise/Terms-of-Service DPA document, which `TO BE VERIFIED` if this classification is ever revisited. |
| Risk notes | This entry exists to make an explicit, documented decision — "GitHub is a development-system subprocessor, not currently a production-patient-data subprocessor" — rather than silently omitting it. If any future workflow ever attaches real patient data to a GitHub issue, PR, or CI artifact (e.g. a bug report with a real export file), that specific incident should be treated as a potential security/privacy incident under `docs/compliance/63-kvkk-personal-data-breach-procedure.md`, not as this register's steady-state classification. |

## 9. Summary table

| # | Provider / category | Status | Data-transfer relevance | Contract/DPA status |
|---|---|---|---|---|
| 1 | Hosting / VPS | `ACTIVE` (provider identity `TO BE VERIFIED`) | `TO BE VERIFIED` (depends on region) | `TO BE VERIFIED` |
| 2 | Google (Gemini) | `ACTIVE` | International transfer likely — mechanism not selected | `TO BE VERIFIED` |
| 3 | Meta (WhatsApp/Instagram) | `ACTIVE` | International transfer likely — mechanism not selected | `TO BE VERIFIED` |
| 4 | Email (SMTP, vendor-agnostic) | `CONFIGURABLE, NOT CONFIRMED ACTIVE` | `TO BE VERIFIED` | `TO BE VERIFIED` |
| 5 | SMS | `NOT YET INTEGRATED` | N/A until a provider is chosen | N/A |
| 6 | Object storage / offsite backup | `NOT YET INTEGRATED` | N/A until a provider is chosen | N/A |
| 7a | Monitoring/alerting — UptimeRobot (external HTTP uptime prober) | `ACTIVE` (since 2026-08-13, F3-OBS-002) | `TO BE VERIFIED` — provider hosting region unverified; receives `/livez`+`/readyz` operational health responses (no patient/tenant data), plus operator alert-email and observed availability pattern | `TO BE VERIFIED` / `COUNSEL REVIEW PENDING` |
| 7b | Monitoring/alerting — Healthchecks.io (dead-man's-switch heartbeat receiver) | `ACTIVE` (since 2026-08-13, F3-OBS-002) | `TO BE VERIFIED` — provider hosting region unverified; receives heartbeat metadata, ping timing and production-host source IP only (no payload body, no application data), plus operator alert-email | `TO BE VERIFIED` / `COUNSEL REVIEW PENDING` |
| 7c | Monitoring/alerting — error tracking / APM / log aggregation | `NO SUBPROCESSOR IDENTIFIED` (ADR-012 `DEFERRED`; no Sentry/Datadog-class provider adopted) | N/A until a provider is chosen | N/A |
| 8 | GitHub / development systems | `ACTIVE` (development-only; not a patient-data subprocessor on current evidence) | N/A (out of production-data scope) | `TO BE VERIFIED` if scope changes |

## 10. Required next actions (non-exhaustive, for counsel/operator sequencing — not a commitment this document makes on anyone's behalf)

1. Independently confirm the hosting provider's identity and region (§1) — the single
   highest-leverage unresolved fact, since it gates the encryption/backup/residency
   sub-questions underneath it.
2. Confirm the Google Gemini product tier (free vs. paid) actually in use (§2) — this
   determines whether submitted content is contractually excluded from model training.
3. Confirm the Meta Cloud API contracting party (platform vs. each clinic) (§3).
4. Confirm the actual configured SMTP provider, if any, in production (§4).
5. Select and document an Art. 9 international-transfer mechanism for §§2–3 (and §4 if
   the confirmed SMTP provider is non-Turkish) — see `docs/compliance/61-...md` §7.
6. Re-run this register's classification whenever a new provider category (SMS, object
   storage, monitoring) moves from `NOT YET INTEGRATED`/`NO SUBPROCESSOR IDENTIFIED` to
   `ACTIVE` — do not let that transition happen without an update here.

---

**This register does not certify KVKK compliance for any listed provider relationship.
Every `TO BE VERIFIED` marker above must be resolved — by independent verification,
not assumption — before it can be relied upon as a complete or accurate subprocessor
inventory for legal or contractual purposes.**
