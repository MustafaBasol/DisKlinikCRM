# F3-C2-ERR-004-R5 — IHS Legal/Governance Decision Packet (GlitchTip `SENTRY_DSN` Activation Gate)

**Phase:** F3 — Production Hardening · Criterion 2 · `F3-SEC-EXIT-001` §5 item 10 (external error tracking)
**Baseline:** `origin/main` @ `cdf0d66d0f522b392503c1c14a65a6b32254b2b8` (PR #467 merge commit)
**Branch:** `docs/f3-c2-err-004-r5-legal-governance-decision-packet`
**Predecessors:** [`F3-C2-ERR-002_ERROR_TRACKING_PROVIDER_DECISION.md`](F3-C2-ERR-002_ERROR_TRACKING_PROVIDER_DECISION.md) ·
[`F3-C2-ERR-004_GLITCHTIP_PRODUCTION_VERIFICATION_EVIDENCE.md`](F3-C2-ERR-004_GLITCHTIP_PRODUCTION_VERIFICATION_EVIDENCE.md) §15 ·
[`docs/compliance/62-kvkk-subprocessor-register.md`](../../compliance/62-kvkk-subprocessor-register.md) §1a

> ## THIS DOCUMENT MAKES NO LEGAL DETERMINATION.
>
> It does not configure `SENTRY_DSN`, create a NoraMedi GlitchTip project, send a
> synthetic or real production event, deploy anything, restart any process, touch
> GlitchTip runtime, VPS2 firewall/nginx, pgBackRest repo2, MinIO, or imaging/DICOM/CBCT
> systems, change runtime code, auth, or schema, or create a migration. It states
> **"repository evidence supports X"** and **"technical control Y is present/absent"**
> only. It does **not** state that IHS is legally sufficient as a subprocessor, that no
> DPA is legally required, or that KVKK permits activation — those are counsel/program-owner
> determinations recorded in §4 below, left blank for an authorized human to complete.
>
> **Expected and accepted outcome of this task: the hard gate in §5 stays
> `BLOCKED_PENDING_AUTHORIZED_DECISION`.** This task's purpose is to remove ambiguity
> about *what* is blocking activation and *who* must resolve it — not to force closure.

---

## 1. Authoritative sources inspected

Located by targeted search (`F3-C2-ERR-002`, `I1`–`I5`, `COUNSEL REVIEW PENDING`, `DPA`,
`subprocessor`, `IHS`, `SENTRY_DSN`, `Stage 4`, `Stage 5`, `error tracking`), not by
assumption or full-repository dump.

| Document | Role |
|---|---|
| [`docs/compliance/62-kvkk-subprocessor-register.md`](../../compliance/62-kvkk-subprocessor-register.md) §1a, §7, §9 row `1a`/`7c`, §10 item 7 | Authoritative register entry for the IHS hosting relationship; source of the `I1–I5` "provider/DPA items" citation and its own `UNDEFINED_IN_REPOSITORY` classification |
| [`docs/program/evidence/F3-C2-ERR-002_ERROR_TRACKING_PROVIDER_DECISION.md`](F3-C2-ERR-002_ERROR_TRACKING_PROVIDER_DECISION.md) | Authoritative provider decision, E1–E5 definitions (§6), KVKK classification (§7), deployment runbook incl. Stage 4 hard gate (§9), security baseline incl. encryption-at-rest rows (§11.4, §12, §12.1) |
| [`docs/program/evidence/F3-C2-ERR-004_GLITCHTIP_PRODUCTION_VERIFICATION_EVIDENCE.md`](F3-C2-ERR-004_GLITCHTIP_PRODUCTION_VERIFICATION_EVIDENCE.md) §15 (`R1` reconciliation) | E1–E5/`I1–I5` gate matrix, `IHS_KVKK_DSN_HARD_GATE = BLOCKED` decision and its two stated reasons |
| [`docs/program/NORAMEDI_MASTER_TRACKER.md`](../NORAMEDI_MASTER_TRACKER.md) (top entry, `F3-C2-ERR-004-R1-IHS-KVKK-GATE-RECONCILIATION`) | Live program-state entry restating the same gate and the `I1–I5` definition gap |
| [`docs/program/runbooks/F4_RECOVERY_OPERATIONS.md`](../runbooks/F4_RECOVERY_OPERATIONS.md) §22.7 | Contains a **different, actually-defined** `I1–I5` label (pgBackRest repo2 backup-independence evidence) — see §3.2 below for why this is not the same shorthand |
| [`docs/program/evidence/F4-IMAGING-001-R5_BACKUP_SOURCE_READ_AND_VPS2_STAGING_EVIDENCE.md`](F4-IMAGING-001-R5_BACKUP_SOURCE_READ_AND_VPS2_STAGING_EVIDENCE.md), [`F4-IMAGING-001-R6_...md`](F4-IMAGING-001-R6_STORAGE_PLACEMENT_DISCRIMINATOR_EVIDENCE.md) | Reuse the undefined KVKK-context `I1–I5` label as a gate-status citation only; add no definition |
| [`docs/program/RISK_REGISTER.md`](../RISK_REGISTER.md), [`docs/program/evidence/F4-FCR-003-R2_repo2_topology.json`](F4-FCR-003-R2_repo2_topology.json) | Reference the (backup-independence) `I1–I5` label in the F4/repo2 sense only |
| [`docs/program/ARCHITECTURE_DECISIONS.md`](../ARCHITECTURE_DECISIONS.md) `ADR-012` | Confirms no repository ADR sets a universal encryption-at-rest requirement; observability standard itself is `DEFERRED` |
| [`docs/program/evidence/INFRA_ENCRYPTION_RESIDENCY_EVIDENCE_001.md`](INFRA_ENCRYPTION_RESIDENCY_EVIDENCE_001.md) §3.3/§3.4 | Confirms the *primary* production host (unrelated to IHS/VPS2) has no guest-OS LUKS evidence either, and treats that as a flagged gap for a future remediation task, not an existing hard gate |
| `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` | Confirms `KVKK-CRIT-002` (subprocessor/DPA/Art. 9) is generically `Waiting for legal review`; no universal encryption-at-rest mandate found |

**I1–I5 search scope confirmation.** The KVKK-context `I1–I5` label appears in exactly
four documents: the subprocessor register, the `F3-C2-ERR-004` evidence document, the
master tracker, and `F4-IMAGING-001-R5`. **It was searched for directly in
`F3-C2-ERR-002` and does not appear there at all**, despite being cited by all four
using documents as originating from `F3-C2-ERR-002` §7.1/§9 — see §3.3.

---

## 2. Repository fact matrix

`FACT` / `RISK` / `LEGAL DECISION` / `TECHNICAL CONTROL` are kept as distinct concepts,
not collapsed into one column.

| Requirement / marker | Repository source | Current factual evidence | Technical status | Legal interpretation required? | Who can decide? | Blocks DSN activation? | Notes |
|---|---|---|---|---|---|---|---|
| **E1** — country evidence | `62-kvkk-subprocessor-register.md` §1a | Türkiye / NGN Data Center, program-owner-accepted 2026-08-20 | `SATISFIED_BY_ACCEPTED_PROVIDER_EVIDENCE`, documentary form (invoice/screenshot) not captured | No — factual/evidentiary | Program owner (evidence quality); no counsel role | Narrowed, not blocking on its own | Weaker evidentiary form than `F3-C2-ERR-002` §6 originally specified |
| **E2** — facility/location evidence | same | NGN Data Center named; no city | `PARTIALLY_SATISFIED` | No | Program owner | No, but weakens E1/E3 confidence | — |
| **E3** — independent corroboration | same | RIPE RDAP `country: TR`, `netname: IHS-VPS-NET5` | `PARTIALLY_SATISFIED` — geolocation-adjacent inference only | No | Program owner | No | §6 itself says geolocation alone is inference, not proof |
| **E4** — overseas replication/failover/migration | same | Provider states none, program-owner-accepted | `SATISFIED_BY_ACCEPTED_PROVIDER_EVIDENCE` | No (factual), but its *sufficiency* for the transfer conclusion is legal (DECISION-3) | Program owner (fact) / Counsel (legal sufficiency) | Feeds DECISION-3 | — |
| **E5** — backup/snapshot region | same | Türkiye, program-owner-accepted | `SATISFIED_BY_ACCEPTED_PROVIDER_EVIDENCE` | Same split as E4 | Same as E4 | Feeds DECISION-3 | — |
| Provider-side encryption at rest | `62-kvkk-subprocessor-register.md` §1a; `F3-C2-ERR-002` §7.3 item 2, §12 row 14 | **Not available / not offered** | `CONFIRMED_ABSENT` (technical fact) | No | — | Feeds DECISION-4 | Matches the register's existing pattern for the primary host (§1) |
| Guest LUKS/dm-crypt **capability** | `62-kvkk-subprocessor-register.md` §1a | Technically permitted by IHS | `CONFIRMED_AVAILABLE` (capability) | No | — | Feeds DECISION-4 | Capability ≠ configuration |
| Guest LUKS/dm-crypt **actual configuration** | `62-kvkk-subprocessor-register.md` §1a | Not established | `NOT_ESTABLISHED` | No (once measured, it will be a plain fact) | — (a `lsblk -f`/`cryptsetup status` read, not a decision) | Feeds DECISION-4/§6 | See §6 below — this is a technical-architecture question, classified `B` |
| Support access model | `62-kvkk-subprocessor-register.md` §1a | Provider staff do not retain routine post-credential-change access | `CONFIRMED_POSITIVE_CONTROL`, not independently audited | No | — | Feeds DECISION-5 | Real control, unaudited |
| Support audit-log evidence | same | Incomplete | `INCOMPLETE` | No | — | Feeds DECISION-5 | Availability of evidence, not a confidentiality breach |
| Sanitization/deprovision evidence | same | Incomplete | `INCOMPLETE` | No | — | Feeds DECISION-5 | — |
| Provider sub-subprocessor evidence | same | Incomplete (unknown whether IHS itself uses a sub-subprocessor) | `INCOMPLETE` | Yes, if a sub-subprocessor exists abroad | Counsel, once/if the fact is established | Feeds DECISION-5 | — |
| DPA/contract status | `62-kvkk-subprocessor-register.md` §1a; `F3-C2-ERR-002` §7.3 | No separate/custom DPA offered under IHS's standard online-service model | `CONFIRMED_ABSENT` (fact) | **Yes** — sufficiency of standard terms | **Counsel** | **Yes — DECISION-2** | This is the packet's central open legal question |
| Subprocessor characterization | `F3-C2-ERR-002` §7.3; register §1a | `LIKELY YES` a data processor/subprocessor (program's own technical/architectural assessment) | Architectural opinion, not a legal finding | **Yes** | **Counsel** | **Yes — DECISION-1** | `COUNSEL REVIEW PENDING` marker, still open |
| International-transfer relevance | `F3-C2-ERR-002` §4/§7.2; register §1a | `NOT ENGAGED` for Workload A, conditional on E1/E2/E4/E5 continuing to hold | Conditional technical/factual conclusion | **Yes** — whether the conditional evidence is legally sufficient | **Counsel** | **Yes — DECISION-3** | — |
| `I1–I5` shorthand (KVKK/DPA usage) | Register §1a/§10 item 7; `F3-C2-ERR-004` §15.2; master tracker | No discrete definition exists anywhere for this usage (verified directly, §3 below) | `UNDEFINED_IN_REPOSITORY` (repository-governance defect, now corrected — §3) | N/A once deprecated | Program owner (governance correction, done by this task) | Resolved by this task's §3 correction; underlying substance still feeds DECISIONS 1/2/5 | Distinguish from the unrelated, defined `I1–I5` in `F4_RECOVERY_OPERATIONS.md` §22.7 |
| Subprocessor register merge state | `git log` (this task) | PR #467 merged 2026-08-20T21:31:34Z, in `origin/main` | `MERGED = YES` | No | — | **No longer blocking** | `F3-C2-ERR-002` §9 Stage 4 step 1's merge sub-condition is now satisfied |
| Telemetry state | `F3-C2-ERR-004` §13/§15.4 | `INACTIVE` | Fact | No | — | N/A (downstream of the gate) | — |
| `SENTRY_DSN` state | same | `UNSET` in every environment | Fact | No | — | N/A | — |
| Synthetic event state | same | Not sent | Fact | No | — | N/A | — |

---

## 3. Resolving the I1–I5 governance defect

### 3.1 What the repository already says, verified directly

Four documents — the subprocessor register (§1a, §10 item 7), the `F3-C2-ERR-004`
evidence document (§15.2), the master tracker's top entry, and `F4-IMAGING-001-R5` —
use `I1–I5` as a bundled label for "provider/DPA items" and **each independently states
that no discrete definition of I1 through I5 exists anywhere in the repository**. This
task re-verified that claim by direct search rather than trusting the citation: a
pattern search for `I1`, `I2`, `I3`, `I4`, `I5` across the whole repository, followed by
manual inspection of every hit, confirms it. **No historical meaning is invented here.**

### 3.2 A second, unrelated, but genuinely defined `I1–I5` exists — and must not be conflated

`docs/program/runbooks/F4_RECOVERY_OPERATIONS.md` §22.7 ("CHECKPOINT 2 — secondary host
evidence") **does** define an `I1–I5`:

> `I1–I4` — Provider account, facility/region, hypervisor, netblock — each differing
> from `disklinik-prod-01`. `I5` — `repo2-host` resolves to an address not bound on
> production, checked from a third vantage point.

This is a real, authoritative, individually-enumerated definition — but it answers a
**different question**: whether the pgBackRest `repo2` backup target is genuinely on
independent infrastructure from the production primary (a backup-durability/failure-domain
concern for `R-030-DB`), not whether the IHS hosting relationship is a KVKK subprocessor
with a sufficient DPA. None of the four KVKK-context documents cites
`F4_RECOVERY_OPERATIONS.md` as the source of their `I1–I5`, and the substantive content
does not match (provider account/hypervisor/netblock/hostname-resolution vs.
"provider/DPA items"). **Per the task's own governance constraint, Option B (preserve an
existing definition) is not selected here, because doing so would require inferring that
these two labels mean the same thing — an inference, not a citation.** This is recorded
as a **repository-wide naming collision**, not a resolution of the KVKK usage.

### 3.3 A citation-accuracy defect, recorded rather than corrected retroactively

The KVKK-context `I1–I5` is repeatedly cited as originating in `F3-C2-ERR-002` §7.1/§9.
Direct search of that document confirms **the string `I1`–`I5` does not appear in it at
all**. This packet does not rewrite `F3-C2-ERR-002` (which is a decision-and-runbook
document whose own text is otherwise accurate and should not be silently edited to match
a citation that was never true), but records the defect here so future readers do not
re-search that document expecting to find it, and adds a pointer note to it (§7 below).

### 3.4 Governance correction — Option A selected

**`I1–I5` (the KVKK/DPA usage) shorthand is deprecated because no authoritative
individual definitions existed anywhere in this repository for that usage — confirmed by
direct search, not inferred.** It is replaced with five named, explicit decision
dimensions, derived directly from the substantive facts the register's §1a "Residual
vendor-management gaps" row and `F3-C2-ERR-002` §7.3 already record. **These names are
not a claim about what the historical `I1`–`I5` individually meant** — no such claim can
be made, because no historical enumeration exists to recover.

| Replaces | Named dimension | Substance (already recorded in the register/§7.3, not new) |
|---|---|---|
| (previously bundled into `I1–I5`) | `PROCESSOR_CHARACTERIZATION` | Is the IHS hosting relationship a processor/subprocessor for Workload A? → **DECISION-1** |
| (previously bundled into `I1–I5`) | `CONTRACT_DPA_SUFFICIENCY` | Are IHS's standard online-service terms, without a custom DPA, sufficient for this workload? → **DECISION-2** |
| (previously bundled into `I1–I5`, overlapping E4/E5) | `TRANSFER_RESIDENCY_POSTURE` | Does the Türkiye-only hosting/backup/no-overseas-replication evidence sufficiently avoid the international-transfer gate? → **DECISION-3** |
| (previously bundled into `I1–I5`) | `ENCRYPTION_AT_REST_DISPOSITION` | Is guest-side encryption required before telemetry activation, distinguishing legal minimum from NoraMedi's own security-program choice? → **DECISION-4** |
| (previously bundled into `I1–I5`) | `VENDOR_LIFECYCLE_EVIDENCE` | Which of sanitization-on-deprovision, sub-subprocessor chain, support-audit detail, and fixed IOPS/throughput are mandatory before activation vs. accepted residual risk? → **DECISION-5** |

This mapping is designed so each named dimension corresponds 1:1 to one line of the
human decision matrix in §4 and one line of the hard gate in §5 — eliminating the
"bundled shorthand" ambiguity the repository itself already flagged.

---

## 4. Human/counsel decision matrix

An authorized program owner/counsel can answer this section without reading the program
history. **The agent does not answer any of these.**

### DECISION-1 — Processor/subprocessor characterization

Is the IHS VPS hosting relationship to be treated as a processor/subprocessor
relationship for NoraMedi Workload A (GlitchTip)?

**Evidence:** `F3-C2-ERR-002` §7.1's four-role distinction classifies the hosting
provider as `LIKELY YES` a data processor/subprocessor, `COUNSEL` to confirm (§7.3).
GlitchTip the software is separately and already classified as *not* a subprocessor
(self-operated open source, receives no data) — that part is not reopened here. IHS
holds NoraMedi-controlled data (the Workload A payload) on its disks/hypervisor/snapshots.

**Authorized answer:** `[ ] APPROVED   [ ] REJECTED   [ ] NEEDS ADDITIONAL EVIDENCE`

---

### DECISION-2 — Contract/DPA sufficiency

Are the available standard IHS service terms, without a separate/custom DPA, sufficient
for this specific limited Workload A processing relationship?

**Evidence:** Register §1a: "No separate/custom DPA is offered by IHS under its standard
online-service model" (program-owner-accepted, 2026-08-20). `F3-C2-ERR-002` §7.3 item 1:
the hosting DPA question for Workload A alone (fixed message + 4 bounded fields, no
patient data) is materially lighter than for Workloads B/C (health data), which are not
authorized or in scope here.

*Do NOT answer this — reserved for counsel.*

**Authorized answer:** `[ ] APPROVED   [ ] REJECTED   [ ] NEEDS ADDITIONAL EVIDENCE`

---

### DECISION-3 — International-transfer gate

Does the Türkiye-only infrastructure evidence sufficiently avoid an international-transfer
gate for Workload A, subject to continued Türkiye-only hosting/backup/no-overseas-replication
evidence?

**Evidence:** E1 (Türkiye/NGN Data Center), E4 (no overseas replication/failover/migration),
E5 (Türkiye backup/snapshot region) are each `SATISFIED_BY_ACCEPTED_PROVIDER_EVIDENCE`, but
in a **weaker documentary form** than `F3-C2-ERR-002` §6 originally specified (a recorded
support/provider statement, not a captured invoice/screenshot/contract clause). E2/E3 are
only `PARTIALLY_SATISFIED`. `F3-C2-ERR-002` §7.2: under Türkiye-resident hosting, KVKK Art. 9
machinery is not engaged because there is no transfer abroad — conditional on this evidence
continuing to hold.

*Do NOT answer this — reserved for counsel.*

**Authorized answer:** `[ ] APPROVED   [ ] REJECTED   [ ] NEEDS ADDITIONAL EVIDENCE`

---

### DECISION-4 — Encryption-at-rest requirement before activation

Is guest-side encryption-at-rest required before telemetry activation, given
provider-side encryption is absent?

**This question distinguishes two independent tracks, deliberately kept separate:**

- **Legal requirement** — a KVKK Art. 9 / general data-security-obligation question.
  *Reserved for counsel; not answered here.*
- **NoraMedi security-program requirement** — an architecture/program-owner choice that
  may be *stricter* than the legal minimum. §6 below gives the repository's own current
  technical-architecture answer to this half: **`RECOMMENDED_BUT_NOT_EXISTING_HARD_GATE`**
  for Workload A specifically (see §6 for full evidence and citations). The architecture
  reviewer/program owner may elevate it to a hard requirement; this task does not do so
  unilaterally.

**Authorized answer (legal track):** `[ ] REQUIRED   [ ] NOT REQUIRED   [ ] NEEDS COUNSEL REVIEW`
**Authorized answer (NoraMedi security-program track):** `[ ] ELEVATE TO HARD GATE   [ ] ACCEPT AS RECOMMENDED-ONLY (current default per §6)   [ ] DEFER TO A FOLLOW-UP INFRA TASK`

---

### DECISION-5 — Mandatory vendor-management evidence vs. accepted residual risk

Which residual vendor-management evidence is mandatory before first-customer telemetry
activation versus accepted tracked residual risk?

**Evidence, recorded exactly as evidenced (register §1a "Residual vendor-management
gaps" row), not inflated:**

| Item | Nature | Current status |
|---|---|---|
| Sanitization on deprovision | Lifecycle control | Incompletely evidenced |
| Provider sub-subprocessor chain | Confidentiality-relevant if it exists and is abroad | Unknown/incomplete |
| Support audit-log detail | Audit/verification control | Incompletely evidenced |
| Fixed IOPS/throughput guarantee | **Availability**, not confidentiality/KVKK | Absent |

Per the task's own instruction, the availability-only gap (fixed IOPS/throughput) is
**not** treated as a confidentiality/KVKK blocker absent evidence to the contrary — it is
listed here for completeness, not pre-classified as mandatory.

**Authorized answer (per item):**
Sanitization: `[ ] MANDATORY BEFORE ACTIVATION   [ ] ACCEPTED RESIDUAL RISK`
Sub-subprocessor chain: `[ ] MANDATORY BEFORE ACTIVATION   [ ] ACCEPTED RESIDUAL RISK`
Support audit-log detail: `[ ] MANDATORY BEFORE ACTIVATION   [ ] ACCEPTED RESIDUAL RISK`
Fixed IOPS/throughput: `[ ] MANDATORY BEFORE ACTIVATION   [ ] ACCEPTED RESIDUAL RISK (default — availability-only)`

---

## 5. Technical DSN hard gate

```
IHS_KVKK_DSN_HARD_GATE = BLOCKED_PENDING_AUTHORIZED_DECISION
```

Required before `PASS`:

| Condition | Status |
|---|---|
| Repository subprocessor register merged | **YES** — PR #467 merged 2026-08-20T21:31:34Z (`cdf0d66d`) |
| Authorized processor/subprocessor characterization | `PENDING` — DECISION-1 |
| Authorized contract/DPA sufficiency disposition (`APPROVED` or `ACCEPTED_RESIDUAL_RISK`) | `PENDING` — DECISION-2 |
| International-transfer disposition | `PENDING` — DECISION-3 |
| Required-at-activation encryption control disposition (explicit) | `PENDING` — DECISION-4 (technical pre-classification done, §6; final disposition still open) |
| Mandatory vendor evidence disposition (explicit, per item) | `PENDING` — DECISION-5 |

**Current result: `BLOCKED_PENDING_AUTHORIZED_DECISION`.** One of six sub-conditions is
satisfied (the merge); five require an authorized human decision this task does not and
must not make. **This is the expected and accepted outcome of this task** — the purpose
is an explicit binary gate with named blockers, not forced closure.

---

## 6. LUKS technical-gate classification

**Question:** does NoraMedi's own accepted architecture/security policy already require
guest-side encryption before any Workload A telemetry data is stored on the IHS VPS?

**Classification: `B — RECOMMENDED_BUT_NOT_EXISTING_HARD_GATE` (for Workload A specifically).**

**Evidence:**

1. `F3-C2-ERR-002` §12 ("Security baseline checklist — workload A scope"), row 14:
   "Encryption at rest ... Record which is in force; do not assume" is tagged
   `EVIDENCE_REQUIRED` — the same tier as general host-hardening rows (OS patching,
   log rotation), **not** the `REQUIRED_BEFORE_STAGE_2` tag that row 1 (Türkiye hosting
   evidence) explicitly carries. No row ties encryption-at-rest to a specific deployment
   stage gate for Workload A.
2. `F3-C2-ERR-002` §7.3 item 2 states encryption-at-rest "stops being a checklist row and
   becomes a primary control" — but this sentence is written under the **R1 amendment's
   shared-host / Workload B and C analysis** (full PostgreSQL dumps and DICOM/CBCT
   imaging — special-category health data), not under Workload A.
3. `F3-C2-ERR-002` §12.1 ("Additional gates before workload B or C") lists `B/C-4 —
   Encryption at rest determined as provider-side vs guest-side, and recorded" as one of
   eight gates, and its own header states explicitly: **"None of these apply to workload
   A, and none of them block it. All of them apply before any backup or imaging data
   reaches this host."**
4. Workload A's payload is defined and bounded by `F3-C2-ERR-002` §5 (a fixed message
   plus four bounded fields) and is explicitly **not** patient, tenant, or health data —
   §5.2's stop-and-revert list forbids any such data from ever appearing in it.
5. No repository ADR (`docs/program/ARCHITECTURE_DECISIONS.md`) sets a universal
   encryption-at-rest requirement; `ADR-012` (observability standard) is itself
   `DEFERRED`. `INFRA_ENCRYPTION_RESIDENCY_EVIDENCE_001.md` §3.3 treats the *unrelated,
   primary* production host's lack of guest-OS LUKS evidence as "a confirmed gap ...
   flag for a separate remediation task," not an existing blocking policy.

**Conclusion:** for Workload A only, guest-side encryption-at-rest is a recorded,
evidence-required item and a good-practice recommendation, but is **not** currently an
existing hard gate in NoraMedi's own accepted architecture. It **is** already a hard gate
(`B/C-4`) for the unauthorized, unscoped Workloads B/C, which this task does not open.

**This task does not configure LUKS.** If DECISION-4 in §4 elevates guest-side
encryption to a hard requirement for Workload A, that is separate, future,
narrowly-scoped infrastructure work (candidate task ID: `F3-C2-ERR-004-R6-IHS-LUKS-ENABLEMENT`,
not opened by this task) — it must not be silently folded into a future DSN-activation
task's scope.

---

## 7. Governance updates made by this task

| File | Change |
|---|---|
| `docs/program/evidence/F3-C2-ERR-004_R5_IHS_LEGAL_GOVERNANCE_DECISION_PACKET.md` (this file) | New — the decision packet |
| `docs/compliance/62-kvkk-subprocessor-register.md` | §1a and §10 item 7: point the `I1–I5` reference at this packet's §3 deprecation and §4 decision matrix, instead of the bare "undefined" note |
| `docs/program/evidence/F3-C2-ERR-004_GLITCHTIP_PRODUCTION_VERIFICATION_EVIDENCE.md` | §15 addendum (R5) recording the merge-state change (PR #467 now merged), the `I1–I5` deprecation, and a pointer to this packet's hard gate |
| `docs/program/evidence/F3-C2-ERR-002_ERROR_TRACKING_PROVIDER_DECISION.md` | Short provenance-correction note added at top: the `I1–I5` label attributed to this document by later documents does not appear in it; pointer to this packet |
| `docs/program/NORAMEDI_MASTER_TRACKER.md` | New dated top entry recording this task, the gate status, and the citation correction |

No runtime, schema, route, or migration file is touched. `docs/program/evidence/README.md`
indexing is left as-is unless it requires a new-file listing convention (checked in §8).

---

## 8. Lifecycle

```
AGENT_COMPLETED               = YES  (documentation/governance scope only)
TESTS/VALIDATION_PASSED       = see delivery report — git diff --check, docs-only diff scope
PR_OPENED                     = see delivery report
MERGED                        = NO
DEPLOYED                      = NO
PRODUCTION_VERIFIED            = NO
SENTRY_DSN_CONFIGURED          = NO
NORAMEDI_GLITCHTIP_PROJECT_CREATED = NO
SYNTHETIC_PRODUCTION_EVENT_SENT = NO
LUKS_CONFIGURED                = NO
```

`F3-SEC-EXIT-001` §5 item 10 = **`NOT_SATISFIED`** · `F3_EXIT_CRITERION_2` =
**`NOT_SATISFIED`** · `F3_EXIT_GATE` = **`NOT SATISFIED`** · `F3_COMPLETE` = **`NO`** ·
`F4_TRANSITION_AUTHORIZED` = **`NO`** ·
**`IHS_KVKK_DSN_HARD_GATE = BLOCKED_PENDING_AUTHORIZED_DECISION`**.

**Exact next task:** program owner/counsel completes §4 DECISION-1 through DECISION-5.
Only after all five are recorded with an authorized answer (and DECISION-4's
NoraMedi-security-program track is explicitly disposed, including whether a LUKS
enablement task is opened) may a subsequent, separately authorized technical task
re-evaluate §5 and proceed to `F3-C2-ERR-002` §9 Stage 3 (deploy with DSN unset).
