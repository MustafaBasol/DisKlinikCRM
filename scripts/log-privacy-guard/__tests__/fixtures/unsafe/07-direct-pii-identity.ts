// Fixture: raw national identity number logged directly (F3-DATA-MIG-003 / G-E4).
// Expected: exactly one DIRECT_PII_FIELD finding.
export function unsafeDirectPiiIdentity(tckn: string) {
  console.error('[patientIdentity] identity lookup failed', tckn);
}
