# NoraMedi Windows Bridge — Security

## Credential storage

The single bridge credential (the bearer token returned once by
`POST /api/public/imaging/bridge/pair`) is protected with **Windows DPAPI,
`DataProtectionScope.LocalMachine`** (`Security/CredentialProtector.cs`),
not `CurrentUser` scope — the service typically runs as `LocalSystem` with
no interactive user profile, so `LocalMachine` is the only scope that
survives a service restart or a different logged-in user.

- `DpapiCredentialStore.Save` writes atomically (temp file + `File.Move`
  overwrite) so a crash mid-write can never leave a half-written blob.
- `TryRead` never throws: a corrupted, tampered-with, or foreign-machine
  blob (DPAPI `CryptographicException`) is treated as "no credential," not
  surfaced as plaintext, and never logged.
- `Fingerprint()` returns a sha256 hash of the *encrypted* bytes on disk —
  used to detect credential rotation without ever decrypting just to check
  for a change (mirrors `bridge-agent/src/authState.ts`'s
  `tokenFileFingerprint`).
- The ProgramData directory and the credential file itself are locked down
  by `Security/ProgramDataAcl.cs` to LocalSystem + Administrators (+ an
  optional configured service account), with inheritance explicitly broken
  — a misconfigured parent ACL can never grant an unprivileged user access.

## Revoked / rotated credentials

`BridgeAuthState` mirrors the Node agent's pause/recover behavior:

1. A `401` from any endpoint calls `MarkInvalid()` — draining and heartbeat
   both stop immediately.
2. Every heartbeat tick, `CredentialChangedSinceInvalidated()` checks
   whether the on-disk credential fingerprint has changed since the
   invalidation. If so, one verification heartbeat is attempted; success
   calls `MarkValid()` and resumes normal operation with **no service
   restart required**.
3. Nothing about *why* a credential was rejected is ever exposed — the
   server itself returns the same generic 401 for missing, invalid, and
   revoked tokens alike (see `imagingBridgePublic.ts`), and the bridge
   never tries to distinguish them either.

## Provisioning without a plaintext credential over IPC

This was the one requirement in this PR that needed a real design decision,
not just "DPAPI-protect it." The naive approach — the future Manager app
calls the pairing HTTP endpoint itself, then hands the resulting plaintext
`bridgeCredential` to the service over the Named Pipe — was rejected for two
reasons:

1. It puts a plaintext credential in an IPC message at all, which the task
   explicitly forbids.
2. It doesn't actually fix itself with "the Manager DPAPI-protects it
   first": the Manager runs as the interactive clinic user, `DataProtectionScope.CurrentUser`
   DPAPI key material is tied to *that* user's profile, and the service
   runs as `LocalSystem` — `LocalSystem` cannot decrypt a `CurrentUser`-scoped
   blob from a different account. The two processes do not share a DPAPI
   key space.

**The actual design:** the Manager never touches the pairing HTTP endpoint
directly. It sends the Named Pipe operation `ProvisionWithPairingCode` with
only the short-lived, single-use, human-typed 8-digit pairing code (plus an
optional computer display name for the audit trail) —
`Ipc/PipePayloads.cs: ProvisionWithPairingCodeRequest` has no field that
could hold a credential of any kind, which is enforced structurally, not
just by convention (see `ProvisionWithPairingCode_NeverCarriesACredentialField`
in `BridgePipeServerTests`). The **service itself** — which already holds
the installation ID and an HTTP client — calls
`POST /api/public/imaging/bridge/pair` directly, receives the plaintext
credential over its own outbound HTTPS connection, and immediately
DPAPI-protects and persists it via `ICredentialStore`. The credential is
never returned to the caller over the pipe either — the response is just
`{ ok, bridgeAgentId, clinicName, bindingCount }`.

The pairing code itself is a much smaller attack surface even if it were
somehow observed: it is single-use, expires, is rate-limited per-IP and
per-code-hash, and locks after a small number of failed attempts (see
`server/src/routes/imagingBridgePublic.ts`'s `/imaging/bridge/pair` handler).

## Named Pipe IPC

- **Framing** (`Ipc/PipeFraming.cs`): 4-byte big-endian length prefix, then
  UTF-8 JSON. The declared length is checked against a 1 MiB ceiling
  **before** any body bytes are read — a hostile or buggy local caller
  cannot force an unbounded allocation, and the check never even attempts
  to read past the 4-byte prefix for an oversized declaration.
- **Validation**: unknown operations, malformed JSON envelopes, and
  malformed per-operation payloads all return a typed error response
  (`unknown_operation` / `invalid_payload`) rather than closing the
  connection abnormally or crashing the accept loop; a handler exception is
  caught and translated to `internal_error`.
- **Connection ACL** (`BridgePipeServer.CreateServerStream`): the pipe's
  `PipeSecurity` explicitly grants only LocalSystem, Administrators, and
  `BUILTIN\Users` (interactive/authenticated accounts) — never `Everyone`/
  anonymous. This is deliberately permissive to normal *local* users (not
  admin-only) because the whole self-service pitch is a non-technical
  clinic user running the Manager without elevation; it excludes remote and
  anonymous callers. Local Named Pipes created without a `\\server\` prefix
  are local-machine-only regardless of ACL.
- **Local paths are not a server-side secret over this transport.** The
  "never send the full folder path to the server" rule in the root spec is
  about the NoraMedi *server*, not this local IPC hop — `GetBindings`
  legitimately returns real folder paths because the Manager UI (same
  machine, same trust boundary as the service) needs them to let a user
  pick/verify a folder.

## Diagnostics / logging redaction

`Diagnostics/DiagnosticsRedactor.cs` is the single place these rules live:
credentials, full local paths, and original file names are never returned
from a redaction helper — the helpers always return a fixed `<redacted>`
sentinel regardless of input, so there is no code path where a substring of
the original value could leak through a bug in string slicing. `DiagnosticsSnapshot`
(the `ExportDiagnostics` payload) is an explicit allowlist of fields —
watchId + availability, not folder paths; counters; version/installation
identifiers — rather than a serialize-everything approach that would need
someone to remember to strip fields later.

## What is intentionally out of scope for this PR

WPF Manager and the WiX installer are covered by later PRs (3/4, both done
— see `architecture.md`). Real auto-update security is its own PR
(6/7) — see `docs/update-architecture.md` for its threat model, which is
additive to everything in this document (DPAPI credential storage, pipe
authorization, diagnostics redaction) and does not change any of it.
