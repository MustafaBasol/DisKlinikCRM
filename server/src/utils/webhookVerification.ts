export type WebhookVerificationFailureReason =
  | 'invalid_mode'
  | 'missing_expected_token'
  | 'missing_token'
  | 'token_mismatch';

export type WebhookVerificationResult =
  | { ok: true; challenge: string }
  | { ok: false; reason: WebhookVerificationFailureReason };

export function readQueryString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

export function verifyMetaWebhookChallenge(params: {
  mode: unknown;
  token: unknown;
  challenge: unknown;
  expectedToken: string | undefined | null;
}): WebhookVerificationResult {
  const mode = readQueryString(params.mode);
  const token = readQueryString(params.token)?.trim();
  const expectedToken = params.expectedToken?.trim();

  if (mode !== 'subscribe') {
    return { ok: false, reason: 'invalid_mode' };
  }
  if (!expectedToken) {
    return { ok: false, reason: 'missing_expected_token' };
  }
  if (!token) {
    return { ok: false, reason: 'missing_token' };
  }
  if (token !== expectedToken) {
    return { ok: false, reason: 'token_mismatch' };
  }

  return { ok: true, challenge: readQueryString(params.challenge) ?? '' };
}
