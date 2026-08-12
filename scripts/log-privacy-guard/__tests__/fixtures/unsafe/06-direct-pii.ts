// Fixture: raw phone value logged directly.
// Expected: exactly one DIRECT_PII_FIELD finding.
export function unsafeDirectPii(phone: string) {
  console.error('[patients] duplicate phone lookup failed', phone);
}
