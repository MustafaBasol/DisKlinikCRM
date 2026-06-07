export function selectUniqueProviderConnection<T>(matches: readonly T[]): T | null {
  return matches.length === 1 ? matches[0] : null;
}

export function resolveSingleLinkedClinic(
  clinicLinks: readonly { clinicId: string }[],
): string | null {
  return clinicLinks.length === 1 ? clinicLinks[0].clinicId : null;
}
