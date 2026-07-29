/** Credential/URL redaction helpers — never print a secret or password in full. */

export function redactConnectionUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '[redacted:invalid-url]';
  }
  const userInfo = parsed.username ? `${parsed.username}:***@` : '';
  return `${parsed.protocol}//${userInfo}${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname}`;
}

/** Full redaction — no characters of the secret are ever revealed. */
export function redactSecret(secret: string | undefined | null): string {
  if (!secret) return '(unset)';
  return '***redacted***';
}

/** Redacts every known secret-shaped env var name's value in a shallow copy for logging. */
const SECRET_ENV_NAME_PATTERN = /(PASSWORD|SECRET|ACCESS_KEY|TOKEN|_KEY$)/i;

export function redactEnvForLogging(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (/^DATABASE_URL$/i.test(key)) {
      out[key] = redactConnectionUrl(value);
    } else if (SECRET_ENV_NAME_PATTERN.test(key)) {
      out[key] = redactSecret(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
