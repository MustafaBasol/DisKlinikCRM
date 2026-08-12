// Fixture: count/status/boolean operational metadata.
// Expected: zero findings.
export function safeLogsMetadata(count: number, status: string, isRetry: boolean) {
  console.info('[job] run summary', { count, status, isRetry });
}
