# 49 — Imaging Bridge Web Onboarding (PR 5/7)

Self-service onboarding UI for the Windows imaging bridge, built on top of
the authenticated pairing endpoints introduced in PR 1
(`docs/47-imaging-bridge-contract.md`) and the installer shipped in PR 4
(`windows-bridge/docs/installer.md`). This PR adds no new pairing contract —
it only adds a `GET /api/imaging/bridge-onboarding/config` endpoint and a
guided web wizard that replaces the old manual/raw-token flow for normal
clinic staff.

## Clinic workflow

1. Settings → Imaging → add/select the imaging devices the bridge should use.
2. Click **Start Setup** on the "NoraMedi Bridge for Windows" card.
3. Select the devices this computer will connect (step 1 of the wizard).
4. Download and run `NoraMediBridgeSetup.exe` on the clinic computer, approve
   the Windows admin prompt (step 2 — no PowerShell, no manual config file).
5. Enter a friendly computer name and generate an 8-digit pairing code
   (step 3). The code is shown once, expires in 10 minutes, and only ever
   lives in the browser tab's memory (never localStorage/sessionStorage/URL/
   logs).
6. Enter that code into NoraMedi Bridge Manager on the clinic computer.
7. The web wizard polls pairing status every ~4s and shows a success screen
   once Manager redeems the code (step 4/5), including the devices that were
   bound.
8. Select local watch folders for each device inside NoraMedi Bridge Manager
   — this PR does not touch folder selection, which is Manager's job.

The legacy "register bridge agent" raw-token flow (device ID copy, JSON
`config.json` snippet) is removed from the normal Settings → Imaging UI.
The underlying `POST /api/imaging/bridges` endpoint is untouched for
compatibility/support use, but the web UI only creates bridges through
pairing sessions from here on.

## Feature gating (disabled by default)

```env
IMAGING_BRIDGE_ONBOARDING_ENABLED=false
IMAGING_BRIDGE_INSTALLER_DOWNLOAD_URL=
IMAGING_BRIDGE_INSTALLER_VERSION=
IMAGING_BRIDGE_INSTALLER_SHA256=
IMAGING_BRIDGE_INSTALLER_SIGNED=false
```

`getBridgeOnboardingConfig()` (`server/src/services/imaging/bridgeOnboardingConfig.ts`)
is fail-closed:

- `enabled` is `false` unless `IMAGING_BRIDGE_ONBOARDING_ENABLED` is the exact
  string `'true'`.
- Even when enabled, `installerAvailable` is only `true` when the download
  URL, version, and SHA-256 are all present and well-formed:
  - the download URL must be `https://`, except a `localhost`/`127.0.0.1`
    `http://` URL is accepted outside `NODE_ENV=production` (local dev only);
  - the version must look like `x.y.z` (or `x.y.z.w`);
  - the SHA-256 must be exactly 64 hex characters.
- `signed` is only ever read from `IMAGING_BRIDGE_INSTALLER_SIGNED` — the
  service never hardcodes `true`, so an unsigned installer (see
  `windows-bridge/docs/installer.md` — signing isn't done yet) can never be
  misreported as signed. The web card/wizard show an explicit pilot/unsigned
  warning when `signed: false`.

`GET /api/imaging/bridge-onboarding/config` is gated by the same
`IMAGING_MANAGE_ROLES` (`OWNER`, `ORG_ADMIN`, `CLINIC_MANAGER`) as the rest
of imaging device/bridge management — mirrored on the frontend by the
existing `canManageImagingDevices()` permission helper, which already gates
the entire Settings → Imaging tab.

## Frontend behavior worth knowing

- `src/components/imaging/onboardingHelpers.ts` holds the pure logic
  (device eligibility, pairing status derivation, countdown, poll
  gating) — covered by
  `src/components/imaging/__tests__/onboardingHelpers.test.ts`
  (`npm run test:onboarding-helpers`).
- Polling (`BridgeSetupWizard.tsx`) uses a single `setInterval`, guards
  against overlapping requests with an in-flight ref, pauses while the tab
  is hidden (`document.hidden`), and stops on any terminal pairing status,
  component unmount, or wizard close.
- Switching the active clinic (`useClinic()`) while a pairing is pending
  cancels it (best-effort) and closes the wizard — a pairing created for one
  clinic can't be left dangling and reused after a clinic switch.
- No `window.confirm` is used anywhere in the wizard; destructive/blocking
  interactions reuse the existing `ConfirmDialog` pattern elsewhere in the
  panel (device/bridge delete and revoke).

## What this PR does not do

- No changes to the pairing contract, rate limits, or Named Pipe
  authorization from PR 1/2.
- No auto-update or release-download infrastructure (PR 6).
- No production enablement — `IMAGING_BRIDGE_ONBOARDING_ENABLED` ships
  `false`, same posture as `BRIDGE_SELF_SERVICE_ENABLED` on the Windows side.
