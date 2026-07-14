# NoraMedi Windows Bridge — Auto-Update Server Contract (PR 6/7 + PR 7/7)

## Endpoint

`GET /api/public/imaging/bridge/update`

- Authenticated with the paired bridge's own bearer credential (the same
  token used for `/bootstrap` and `/heartbeat` — see `docs/security.md`).
  A missing/unknown/revoked token gets the same generic `401` as every
  other bridge endpoint.
- Rate-limited per token hash (`imaging-bridge-update-token`, 10/min) —
  the background loop only polls every `CheckIntervalMinutes`, so this is
  a generous ceiling against a misbehaving/compromised agent, not a
  legitimate-traffic constraint.
- **PR 7 change:** the response is **no longer identical for every caller**.
  The underlying release descriptor is still one global configuration (no
  per-clinic patient/business data is ever involved), but staged-rollout
  eligibility — computed from the authenticated bridge's own agent ID and
  channel, both already resolved server-side by `authenticateBridgeAgent`,
  never from any client-supplied value — can now cause `release` to be
  `null` for one bridge and populated for another even under the identical
  global config. See "Staged rollout" below.

Response shape (`server/src/services/imaging/bridgeUpdateConfig.ts`):

```json
{
  "mode": "disabled" | "notify" | "automatic",
  "release": {
    "releaseId": "rel-0.4.8-2026-07-13",
    "version": "0.4.8",
    "downloadUrl": "https://cdn.noramedi.com/bridge/NoraMediBridgeSetup-0.4.8.exe",
    "sha256": "<64-char lowercase hex>",
    "signed": true,
    "publisherThumbprint": "<40-char hex Authenticode cert thumbprint>",
    "minimumSourceVersion": "0.4.0",
    "notes": "Adds secure auto-update.",
    "channel": "stable" | "pilot",
    "rolloutPercent": 100,
    "forced": false,
    "rollback": {
      "version": "0.4.7",
      "downloadUrl": "https://cdn.noramedi.com/bridge/NoraMediBridgeSetup-0.4.7.exe",
      "sha256": "<64-char lowercase hex>",
      "publisherThumbprint": "<40-char hex>"
    } | null
  }
}
```

`release` is `null` whenever the mode is `disabled`, the configured metadata
is malformed/incomplete (fail closed — see below), or (PR 7) this specific
bridge is not in the release's rollout cohort / on the release's channel.

## Canonical validation

All version/URL/hash parsing lives in one place,
`server/src/services/imaging/releaseMetadataValidation.ts`, shared with
`bridgeOnboardingConfig.ts` (the unauthenticated web-onboarding installer
card, PR 5). Neither file re-implements these checks — see the source
regression tests in `imagingBridgeUpdate.test.ts` that assert this.

## Environment variables

All in `server/.env.example`. Every one of these is read fresh on each
request (no restart-only caching) except that the Node process itself only
re-reads `process.env` at request time, so a running server does need a
restart to pick up a changed `.env` file.

| Variable | Required | Notes |
|---|---|---|
| `IMAGING_BRIDGE_UPDATE_MODE` | No (default `disabled`) | `disabled` \| `notify` \| `automatic`. Unrecognized value → `disabled`. |
| `IMAGING_BRIDGE_UPDATE_VERSION` | For `notify`/`automatic` | `x.y.z` or `x.y.z.w`. |
| `IMAGING_BRIDGE_UPDATE_DOWNLOAD_URL` | For `notify`/`automatic` | HTTPS required in production; `http://localhost`/`127.0.0.1` accepted only outside production. |
| `IMAGING_BRIDGE_UPDATE_SHA256` | For `notify`/`automatic` | 64-char lowercase hex. |
| `IMAGING_BRIDGE_UPDATE_SIGNED` | No (default `false`) | Must be `true`, with a valid thumbprint below, for the release to be offered **at all** in production — an unsigned release is never offered in production regardless of mode. |
| `IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT` | When signed=true | 40-char hex Authenticode certificate thumbprint. This is the release's declared trust anchor — the bridge pins **this value**, not a separate client-side config, so key rotation is a pure server-side deploy (see "Key rotation" below). |
| `IMAGING_BRIDGE_UPDATE_MIN_SOURCE_VERSION` | No | If set, a bridge running an older version than this is told `Unsupported` rather than offered the release. |
| `IMAGING_BRIDGE_UPDATE_NOTES` | No | Free text surfaced in the Manager. |
| `IMAGING_BRIDGE_UPDATE_RELEASE_ID` | For `notify`/`automatic` (PR 7) | Opaque cohort-hash input, safe charset, max 128 chars. Changing it reshuffles rollout cohorts. |
| `IMAGING_BRIDGE_UPDATE_ROLLOUT_PERCENT` | No (default `100`) (PR 7) | Integer 0-100. `0` pauses rollout without touching `IMAGING_BRIDGE_UPDATE_MODE`. |
| `IMAGING_BRIDGE_UPDATE_CHANNEL` | No (default `stable`) (PR 7) | `stable` \| `pilot`. Exact match against the bridge's `updateChannel`. |
| `IMAGING_BRIDGE_UPDATE_FORCED` | No (default `false`) (PR 7) | Bypasses rollout percentage only — never channel/mode/minimum-version. |
| `IMAGING_BRIDGE_ROLLBACK_VERSION` / `_DOWNLOAD_URL` / `_SHA256` / `_PUBLISHER_THUMBPRINT` | No (PR 7) | All four or none — a partial set is rejected. The previously-trusted release the bridge caches as its one-step rollback target before installing this one. |

## Update modes

- **`disabled`** (default) — `CheckForUpdates` always resolves to a typed
  "disabled" state. No download URL, hash, or version is ever exposed to a
  bridge in this mode, even if the other env vars are set (an operator's
  half-finished config can't accidentally leak into the wire response).
- **`notify`** — the bridge downloads and verifies a newer release
  automatically (so the Manager can immediately show "ready to install"),
  but only an explicit, admin-gated `InstallUpdate` triggers the actual
  install.
- **`automatic`** — additionally allows the background loop to launch the
  install itself, subject to the queue-drain-safety check (never while an
  item is actively uploading).

## Key rotation

Rotating the signing certificate is an operational, server-side-only
change:

1. Generate/acquire the new certificate; note its thumbprint.
2. Update `IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT` to the new
   thumbprint **before** publishing any release signed with the new key.
3. Deploy the new release, signed with the new certificate, with
   `IMAGING_BRIDGE_UPDATE_SHA256` matching that exact signed file.

A bridge that already fetched the *old* thumbprint mid-rotation simply
fails closed (`WrongPublisher`) against a release signed by the
not-yet-published new key — safe direction to fail.

**PR 7 addition — bridge-side dual-pin overlap window:** the server-side
`IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT` value above is still a single
value per release descriptor (the server can only ever declare one signer
per release). The actual current+next overlap window is a **bridge-side**
mechanism — `Trust/PinnedPublisherThumbprints.Values` can hold two
compiled-in accepted thumbprints simultaneously, so different releases in
the fleet can be signed by either the outgoing or incoming certificate
during a rotation without any bridge rejecting a legitimately-signed
release. See `windows-bridge/docs/update-runbook.md` "Publisher trust-pin
rotation" for the full sequence.

## Staged rollout (PR 7)

`bridgeUpdateConfig.ts`'s `getBridgeUpdateConfig(eligibility)` takes the
authenticated bridge's own `{ bridgeAgentId, updateChannel }` (resolved by
`authenticateBridgeAgent`, never client-supplied) and filters the release:

- **Channel**: exact match against `ImagingBridgeAgent.updateChannel`
  (schema default `'stable'`).
- **Rollout cohort**: `sha256(bridgeAgentId + ':' + releaseId)`, first 4
  bytes as a big-endian uint32, `mod 100 < rolloutPercent`. Deterministic —
  the same bridge gets the same answer for the same release on every call;
  a new `releaseId` reshuffles cohorts. Never `Math.random()`, never
  re-evaluated per-request beyond this pure function of stable inputs.
- **Forced** releases (`IMAGING_BRIDGE_UPDATE_FORCED=true`) skip the
  rollout-percentage check but still respect channel and
  `minimumSourceVersion`.

This is intentionally a single global release config plus a percentage/
channel knob — not a per-clinic campaign system. See
`imagingBridgeUpdate.test.ts` for the full boundary/stability/isolation test
coverage (0%, 1%, 50%, 100%, repeated-call stability, distinct release IDs,
channel mismatch, kill switch).

## Tenant isolation

The underlying release configuration is still one global descriptor — no
clinic identifier, patient data, or business data is read or returned.
Per-bridge rollout eligibility uses only the authenticated bridge's own
agent ID and channel (never another bridge's or clinic's identifiers,
never a client-supplied query parameter — see the source-regression test
asserting the handler never reads `req.query`/`req.body`). A revoked/invalid
credential is rejected identically to every other bridge endpoint.
