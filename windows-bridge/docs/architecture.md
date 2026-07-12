# NoraMedi Windows Bridge — Architecture

This is PR 2/7 of the self-service imaging bridge: the permanent .NET Core
and Windows Service foundation. It is a from-scratch, DPAPI/SQLite/Named-Pipe
based rewrite of the behavior proven by the Node.js `bridge-agent/` reference
implementation (see `docs/47-imaging-bridge-contract.md` and
`docs/48-imaging-bridge-agent.md` in the repository root) — `bridge-agent/`
is not deleted or modified and remains a separate, independent product until
this replacement passes its own release gate.

```
Vendor imaging software ──(export)──► Watched folder (per FolderBinding)
                                           │ FolderWatchAdapter (polling,
                                           │ stability window, magic-byte
                                           │ validation, source immutable)
                                           ▼
                              SqliteBridgeQueue (spool/ + queue.db)
                              pending → processing → {completed | failed}
                                           │
                                           ▼
                         BridgeApiClient (bootstrap / heartbeat / studies)
                         Bearer <credential>, retry w/ exponential backoff+jitter
                                           │
                                           ▼
                                  NoraMedi server
                     (POST /api/public/imaging/bridge/{pair,heartbeat,studies}
                      GET  /api/public/imaging/bridge/bootstrap)

                              ▲
                              │ Named Pipe IPC (local only)
                    (future) NoraMedi Bridge Manager (WPF, PR 3)
```

## Projects

- **NoraMedi.Bridge.Core** — all bridging logic, platform-agnostic within
  Windows: acquisition, validation, hashing, the SQLite queue, DPAPI/ACL
  security primitives, the HTTP client, the Named Pipe IPC transport, and
  `BridgeOrchestrator`, which wires all of it together and implements
  `IBridgePipeRequestHandler`.
- **NoraMedi.Bridge.Service** — a thin OS-integration shell (`Worker` +
  `Program.cs`) that reads configuration, constructs a `BridgeOrchestrator`
  and a `BridgePipeServer`, and hosts them as a `Microsoft.Extensions.Hosting`
  `BackgroundService` — runnable as a registered Windows Service
  (`AddWindowsService`) or interactively for development.
- **tests/*.Tests, tests/*.IntegrationTests** — xUnit, no mocking framework;
  fakes are hand-written (`ScriptedHttpMessageHandler`,
  `FakeBridgePipeRequestHandler`) and pipe/queue tests exercise the real
  `NamedPipeServerStream`/`Microsoft.Data.Sqlite` stack rather than mocking
  the OS.

## Core components

| Namespace | Responsibility |
|---|---|
| `Acquisition` | `IImagingAcquisitionAdapter` (extensibility point), `FolderWatchAdapter`, `SingleFolderWatcher` (polling-based stability detection — deliberately not FileSystemWatcher-only, for UNC-share reliability parity with the Node agent's `chokidar usePolling=true`) |
| `Validation` | `FileSignatureValidator` — magic-byte detection for JPEG/PNG/WebP/DICOM Part-10, byte-for-byte identical to `server/src/services/imaging/imagingUploadValidation.ts` and `bridge-agent/src/fileType.ts` |
| `Hashing` | `IngestKeyHasher` — sha256 hex digest, the "ingestKey" the server independently recomputes and compares |
| `Queue` | `SqliteBridgeQueue` — pending/processing/failed/completed state machine, crash recovery, `BackoffCalculator` |
| `Security` | `CredentialProtector` (DPAPI), `DpapiCredentialStore`, `InstallationIdProvider`, `ProgramDataAcl`, `BridgeAuthState` |
| `Http` | `BridgeApiClient` — bootstrap/heartbeat/studies/pair, response classification |
| `Ipc` | `BridgePipeServer`/`BridgePipeClient`, `PipeFraming`, the `PipeOperation` surface |
| `Diagnostics` | `DiagnosticsRedactor`, `DiagnosticsSnapshot` |
| `Runtime` | `BridgeOptions`, `FolderBindingsStore`, `BridgeOrchestrator` (the composition root for bridging logic) |

## Feature flag

`BridgeOptions.Enabled` (config key `BridgeSelfService:Enabled`, default
**false**) gates the entire product. When disabled, the service still
installs, starts, and answers every Named Pipe query (`ConnectionState:
"disabled"`) — but never watches a folder, never contacts the server, and
never spends a credential. This lets the service ship and be installed on
pilot machines well before the self-service release gate (7 PRs, full E2E,
security review) is satisfied.

## Node agent parity

| Behavior | Node (`bridge-agent/`) | .NET (this PR) |
|---|---|---|
| Folder watching | chokidar, `usePolling: true` | Custom poller, same rationale (UNC reliability) |
| Stability detection | `awaitWriteFinish` (size-based) | Same algorithm: size unchanged across the stability window |
| File types | JPEG/PNG/WebP/DICOM Part-10, magic-byte only | Identical set and detection logic |
| Ingest key | sha256 hex, agent-computed, server-reverified | Identical |
| Upload filename | `<ingestKey><ext>`, never the original name | Identical |
| `studyDate` | Never sent (server stamps its own) | Identical |
| Duplicate response | Treated as success | Identical |
| Backoff | `min(cap, base·2^n)·(1+jitter[0,0.1))` | Identical formula, same defaults (60s/15min) |
| Queue persistence | Per-item directories on disk (`pending/processing/failed`) | SQLite state column + a private spool dir per ingestKey |
| Startup recovery | Reclaim `processing/`, quarantine orphans, clean `.staging-*` | Same three behaviors, translated to the SQLite+spool model |
| Credential storage | Plain file, ACL-restricted | DPAPI LocalMachine-protected blob, ACL-restricted directory |
| Token/credential rotation | Poll token file fingerprint | `BridgeAuthState.CredentialChangedSinceInvalidated()` (same fingerprint-diff idea) |

## What is deliberately NOT in this PR

WPF Manager (PR 3), the WiX installer (PR 4, see `docs/installer.md`), web
onboarding UI (PR 5), and the secure auto-updater (PR 6, see
`docs/update-architecture.md`) are done. Production hardening/E2E (PR 7),
DICOM C-STORE/DICOMweb, TWAIN/WIA, vendor SDK adapters, CBCT are still out
of scope — see the root spec's "Scope exclusions." `CheckForUpdates` now
performs a real, authenticated check against the NoraMedi server and
truthfully reports its result — see `docs/update-architecture.md`.
