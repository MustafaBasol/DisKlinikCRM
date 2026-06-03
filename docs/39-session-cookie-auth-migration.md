# Session Cookie Auth Migration

Status: implemented and verified on 2026-06-02. Production web deployment
topology confirmed on 2026-06-03.

This document must be updated after each related auth/session operation so the
repo always contains the current implementation state and remaining migration
work.

## Scope

Clinic auth now uses the `hcrm_session` HttpOnly cookie. Platform admin auth uses
the separate `hcrm_platform_session` HttpOnly cookie.

Login responses must not expose session JWTs in the response body. The frontend
uses `/api/auth/me` and `/api/platform/me` to read the current user/admin from
the active cookie session.

## Completed Changes

- Added dedicated session cookie utilities for clinic and platform sessions.
- Added signed, session-bound CSRF token creation and verification.
- Clinic auth now checks `hcrm_session` first and keeps Bearer auth as a logged
  migration fallback.
- Platform auth now checks `hcrm_platform_session` first and keeps Bearer auth as
  a logged migration fallback.
- Clinic login and platform login now set session and CSRF cookies and no longer
  return JWT tokens in the response body.
- Added logout endpoints:
  - `POST /api/auth/logout`
  - `POST /api/platform/auth/logout`
- Added CSRF refresh endpoints:
  - `GET /api/auth/csrf`
  - `GET /api/platform/auth/csrf`
- Applied CSRF protection to protected clinic and platform routes.
- Left public/webhook routes outside auth and CSRF protection.
- Updated frontend clinic auth to use cookie sessions, `/auth/me`, and
  `withCredentials`.
- Updated frontend platform auth to use cookie sessions, `/platform/me`, and
  `withCredentials`.
- Removed active frontend use of `hcrm_token`, `platform_token`, and
  `platform_admin`; remaining references only clear legacy values.
- Updated CSV export to use cookie credentials instead of an Authorization
  header.
- Added auth/CSRF tests and included them in the backend test suite.
- Added deployment env examples for `CSRF_SECRET`,
  `SESSION_COOKIE_SAMESITE`, `SESSION_COOKIE_SECURE`, and
  `SESSION_COOKIE_DOMAIN`.
- Added startup warnings for missing/weak `CSRF_SECRET` in production and
  malformed cookie domain values.
- Filtered CORS wildcard origin configuration out of the credentialed session
  allowlist and added an explicit startup warning.
- Added configuration flags to disable Bearer fallback after migration:
  - `AUTH_BEARER_FALLBACK_ENABLED`
  - `CLINIC_BEARER_FALLBACK_ENABLED`
  - `PLATFORM_BEARER_FALLBACK_ENABLED`
- Added production startup warnings while clinic/platform Bearer fallback remains
  enabled.
- Added CSRF token age validation so signed CSRF tokens expire with the session
  window and excessive future `iat` values are rejected.

## CSRF

Unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`) require a signed CSRF token
when the request is authenticated by cookie. CSRF tokens are bound to the
session `jti`, signed with `CSRF_SECRET` when configured, and rejected after the
session max-age window.

Readable CSRF cookies:

- Clinic: `csrf_token`
- Platform: `platform_csrf_token`

Public and webhook routes remain outside auth and CSRF:

- `/api/public/**`
- `/api/register/**`
- `/api/auth/login`
- `/api/platform/auth/login`

This preserves the current WhatsApp Evolution webhook, Meta WhatsApp webhook,
Instagram webhook, public booking, and public WhatsApp service flows.

## Cookie Deployment Settings

Confirmed production web topology:

- Frontend: `https://<domain>`
- Web API: `https://<domain>/api`
- Frontend API base URL: `VITE_API_URL=/api`
- Web session cookie: HttpOnly + Secure + `SameSite=Lax`
- `SESSION_COOKIE_DOMAIN` must stay empty because frontend and API share the
  same origin.

Default setup:

- `SESSION_COOKIE_SAMESITE=lax`
- `SESSION_COOKIE_SECURE=false` in local development
- `SESSION_COOKIE_SECURE=true` in production
- no cookie domain unless app and API share a parent domain

Use `SESSION_COOKIE_SAMESITE=none` and `SESSION_COOKIE_SECURE=true` only when
the frontend and API are cross-site and both are served over HTTPS. Set
`SESSION_COOKIE_DOMAIN=.example.com` only when the frontend/API subdomains need
to share cookies under the same parent domain.

## Bearer Fallback

Bearer auth is still accepted by clinic and platform middleware for migration.
It is logged as fallback use. Do not remove Bearer support until production-like
cookie/SameSite/domain settings and the full test/build suite are passing.

Fallback can now be disabled without code changes:

- `AUTH_BEARER_FALLBACK_ENABLED=false` disables Bearer fallback globally.
- `CLINIC_BEARER_FALLBACK_ENABLED=false` disables only clinic Bearer fallback.
- `PLATFORM_BEARER_FALLBACK_ENABLED=false` disables only platform Bearer
  fallback.

For the confirmed web deployment, Bearer fallback is only a migration bridge.
After web cookie auth is verified in production-like/staging and fallback logs
are clean, disable it with `AUTH_BEARER_FALLBACK_ENABLED=false`.

Future mobile token auth must not reuse this web migration fallback.

## Verification

Completed verification:

- Backend typecheck: passed.
- Backend auth tests: passed.
- Full backend test suite: passed.
- Frontend production build: passed.

Latest local hardening update:

- Added production configuration warnings for CSRF/cookie/CORS settings.
- Added tests for CSRF secret and cookie domain warning behavior.
- Verification after this update: backend typecheck passed, backend auth tests
  passed.
- Final verification after this update: full backend test suite passed and
  frontend production build passed.

Latest fallback-control update:

- Added runtime flags to disable Bearer fallback when deployment is ready.
- Added tests for fallback flag parsing, production warnings, and platform
  middleware rejection when fallback is disabled.
- Verification after this update: backend typecheck passed, backend auth tests
  passed, full backend test suite passed, frontend production build passed.

Latest CSRF lifetime update:

- CSRF token validation now enforces the session max-age window and rejects
  excessive future timestamps.
- Added tests for expired and future-dated CSRF tokens.
- Verification after this update: backend typecheck passed, backend auth tests
  passed, full backend test suite passed, frontend production build passed.

Production topology update:

- Confirmed same-origin web deployment: `https://<domain>` and
  `https://<domain>/api`.
- Confirmed web env target: `VITE_API_URL=/api`.
- Confirmed cookie target: HttpOnly Secure cookie, `SameSite=Lax`, empty
  `SESSION_COOKIE_DOMAIN`.
- Confirmed future mobile auth must be a separate flow, not the legacy Bearer
  fallback.
- Verification after this update: documentation/config comments only; code
  behavior already matches this topology.

Known build warning:

- Vite reports large frontend chunks over 500 kB. This is unrelated to the auth
  migration and was not changed in this task.

## Remaining Work

- Deploy with strong, distinct secrets:
  - `JWT_SECRET`
  - `PLATFORM_JWT_SECRET`
  - `CSRF_SECRET`
- Monitor logs for Bearer fallback usage after deployment.
- Remove Bearer fallback only after production-like cookie settings are verified
  and tests/build still pass.
- Once Bearer fallback logs are clean, set the relevant fallback flags to
  `false`, run the full test/build suite, then remove fallback code in a later
  cleanup.

## Future Mobile Auth

If a mobile app is added later, it must use a separate auth flow rather than web
cookies or the migration Bearer fallback.

Expected mobile direction:

- API may live at `https://api.<domain>` or under `/api/mobile/*`.
- Mobile clients must not use browser cookies or localStorage for auth.
- Use short-lived access tokens and refresh token rotation.
- Store refresh tokens in iOS Keychain / Android Keystore or equivalent secure
  storage.
- Keep mobile token auth isolated from web cookie auth.
