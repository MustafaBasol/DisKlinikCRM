/**
 * DigiDentisAuthClient.ts — OAuth2 client-credentials token acquisition and
 * caching for the DigiDentiS v3.2.0 API.
 *
 * See DigiDentisSigning.ts's header comment: the exact token endpoint
 * shape is an assumed placeholder pending real v3.2.0 documentation.
 *
 * Tokens are cached in-process, keyed by connection id, and never persisted
 * to the database or logged. A crashed/restarted process simply re-fetches.
 */

import { DIGIDENTIS_PATHS, DIGIDENTIS_TOKEN_SKEW_MS } from './digidentisConfig.js';
import { ExternalCalendarAuthError, ExternalCalendarTransientError } from '../externalCalendarErrors.js';

type CachedToken = { accessToken: string; expiresAt: number };

const tokenCache = new Map<string, CachedToken>();

export type FetchLike = typeof fetch;

export type DigiDentisAuthConfig = {
  connectionId: string;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
};

async function requestNewToken(config: DigiDentisAuthConfig, fetchImpl: FetchLike): Promise<CachedToken> {
  const url = `${config.baseUrl}${DIGIDENTIS_PATHS.token}`;
  const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: 'grant_type=client_credentials',
    });
  } catch (err) {
    throw new ExternalCalendarTransientError('DigiDentiS', null, (err as Error).message);
  }

  if (response.status === 401 || response.status === 403) {
    throw new ExternalCalendarAuthError('DigiDentiS', `token endpoint returned HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new ExternalCalendarTransientError('DigiDentiS', response.status);
  }

  const json = (await response.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number }
    | null;

  if (!json?.access_token) {
    throw new ExternalCalendarAuthError('DigiDentiS', 'token endpoint returned no access_token');
  }

  const expiresInMs = (json.expires_in ?? 3600) * 1000;
  return { accessToken: json.access_token, expiresAt: Date.now() + expiresInMs };
}

/** Returns a valid (non-expired) access token, fetching/refreshing as needed. */
export async function getDigiDentisAccessToken(
  config: DigiDentisAuthConfig,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const cached = tokenCache.get(config.connectionId);
  if (cached && cached.expiresAt - DIGIDENTIS_TOKEN_SKEW_MS > Date.now()) {
    return cached.accessToken;
  }

  const token = await requestNewToken(config, fetchImpl);
  tokenCache.set(config.connectionId, token);
  return token.accessToken;
}

/** Drops the cached token for a connection so the next call re-authenticates. */
export function invalidateDigiDentisToken(connectionId: string): void {
  tokenCache.delete(connectionId);
}

/** Test-only: clears the entire in-process cache. */
export function clearDigiDentisTokenCacheForTests(): void {
  tokenCache.clear();
}
