// Fixture: phone/text routed through the codebase's existing redact*/summarize* helpers.
// Expected: zero findings.
function redactPhone(phone: string) {
  return `***${phone.slice(-4)}`;
}
function summarizeTextForLog(text: string) {
  return { length: text.length };
}

export function safeLogsRedactedForms(phone: string, body: string) {
  console.error('[sms] send failed', { phone: redactPhone(phone), body: summarizeTextForLog(body) });
}
