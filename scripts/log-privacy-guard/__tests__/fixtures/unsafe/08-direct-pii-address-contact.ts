// Fixture: raw address district + normalized contact-point digits logged
// directly (F3-DATA-MIG-TODAY-001-R10).
// Expected: exactly two DIRECT_PII_FIELD findings.
export function unsafeDirectPiiAddressContact(district: string, normalizedValue: string) {
  console.error('[patients] district lookup failed', district);
  console.warn('[patientContactPoints] duplicate contact point', normalizedValue);
}
