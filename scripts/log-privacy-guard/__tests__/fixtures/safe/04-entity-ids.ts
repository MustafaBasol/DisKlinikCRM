// Fixture: accepted non-sensitive entity-id metadata.
// Expected: zero findings.
export function safeLogsEntityIds(patientId: string, clinicId: string) {
  console.info('[route] lookup', { patientId, clinicId });
}
