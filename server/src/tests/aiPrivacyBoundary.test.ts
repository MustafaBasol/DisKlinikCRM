/**
 * aiPrivacyBoundary.test.ts — Privacy boundary tests for every active Gemini/
 * Google AI Studio call path (AI-PROMPT-REDACTION-GAP-001).
 *
 * Run with:  tsx src/tests/aiPrivacyBoundary.test.ts
 * Also wired to:  npm run test:ai-prompt-privacy
 * No external test framework — uses node:assert/strict + manual counters.
 *
 * Verifies the shared boundary (server/src/services/privacy/redaction.ts):
 *   1.  maskPhone masks all but the last 4 digits.
 *   2.  maskEmail masks the local part while keeping the domain.
 *   3.  redactSensitiveText replaces phone-like strings with [PHONE].
 *   4.  redactSensitiveText replaces email-like strings with [EMAIL].
 *   5.  buildSafeAiPatientContext returns only firstName, never lastName/email/etc.
 *   6.  sanitizeAiMessageHistory caps message count to maxCount.
 *   7.  sanitizeAiMessageHistory truncates each message body to maxTextLength.
 *   8.  sanitizeAiMessageHistory redacts phone patterns embedded in messages.
 *   9.  sanitizeAiMessageHistory redacts email patterns embedded in messages.
 *  10.  buildWhatsAppAgentPrompt sends only the FIRST NAME, not the full name.
 *  11.  buildWhatsAppAgentPrompt does not include medical notes / insurance / payment.
 *  12.  buildWhatsAppAgentPrompt does not expose raw phone numbers in the context section.
 *  13.  sanitizeAiMessageHistory with redactPii:false skips redaction (opt-out works).
 *  14.  sanitizeAiMessageHistory handles an empty input array gracefully.
 *  15.  maskPhone returns *** for very short / invalid input.
 *  16.  redactSensitiveText redacts UUIDs.
 *  17.  redactSensitiveText redacts Bearer tokens.
 *  18.  redactSensitiveText redacts key=value credential-like strings.
 *  19.  redactSensitiveText redacts malformed-but-identifier-like values (catch-all).
 *  20.  redactSensitiveText preserves an 8-digit date (no phone false-positive).
 *  21.  redactSensitiveText handles combined Turkish/French multilingual text.
 *  22.  redactSensitiveText redacts formatted French phone numbers.
 *  23.  redactSensitiveText redacts formatted Turkish phone numbers (extra formats).
 *  24.  redactSensitiveText fails safe (never returns raw text) on non-string input.
 *  25.  getAiSafeFirstName returns only the first name, redacted defensively.
 *  26.  extractAssistantInputWithGoogleAi (googleAiStudio path) redacts the current
 *       message's phone number before it reaches the AI provider.
 *  27.  extractAssistantInputWithGoogleAi sends only the first name, never the full name.
 *  28.  extractAssistantInputWithGoogleAi redacts UUIDs from the current message.
 *  29.  extractAssistantInputWithGoogleAi redacts Bearer tokens from the current message.
 *  30.  normalizeDateWithGoogleAi redacts PII while preserving date-extraction intent.
 *  31.  extractAssistantInputWithGoogleAi provider-error path never surfaces the
 *       constructed prompt (in the thrown error or in any logged output).
 *  32.  buildWhatsAppAgentPrompt (shared WhatsApp / Meta WhatsApp / Instagram boundary)
 *       redacts phone, email, UUID and token from the latest message.
 *  33.  buildWhatsAppAgentPrompt redacts recentMessages even when the caller forgot to.
 *  34.  resolveWhatsAppConversationAgentDecision redacts PII end-to-end for the shared
 *       WhatsApp / Meta WhatsApp / Instagram conversation-agent call path.
 *  35.  resolveStepAwareWhatsAppIntent redacts a raw phone number the customer is
 *       actively providing (awaiting_phone step) before it reaches the AI provider.
 *  36.  Booking intent (service/date/time wording) survives redaction end-to-end.
 *  37.  redactSensitiveText preserves date+dot-time adjacency (no phone false-positive).
 *  38.  redactSensitiveText preserves date+colon-time adjacency (DD.MM.YYYY HH:MM).
 *  39.  redactSensitiveText preserves ISO date+colon-time adjacency (YYYY-MM-DD HH:MM).
 *  40.  Date+time exemption does not weaken redaction of a genuine adjacent phone number.
 *  41.  extractAssistantInputWithGoogleAi sanitizes a PII-bearing provider error body.
 *  42.  resolveWhatsAppConversationAgentDecision sanitizes a PII-bearing provider error body.
 *  43.  resolveStepAwareWhatsAppIntent sanitizes a PII-bearing provider error body.
 *  44.  redactSensitiveText fully redacts punctuation-bearing credentials (password=Sup3r!Secret,
 *       token=abc123+/==, api_key=sk-test_123!more, secret: value-with-$pecial#chars) — no suffix leak.
 *  45.  redactSensitiveText fully redacts a credential at the end of a line/string.
 *  46.  redactSensitiveText redacts a credential but leaves ordinary prose that follows it intact.
 *  47.  redactSensitiveText redacts multiple distinct credentials within one string.
 *  48.  getAiCustomerNamePlaceholder returns the fixed pseudonym for a known name and null otherwise.
 */

import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'e'.repeat(64);
// Fake key so every AI-path function below takes the "enabled" branch and
// calls fetch (which every AI-path test mocks) instead of short-circuiting.
process.env.GOOGLE_AI_STUDIO_API_KEY = 'test-fake-key-not-a-real-credential';

import {
  maskPhone,
  maskEmail,
  redactSensitiveText,
  buildSafeAiPatientContext,
  sanitizeAiMessageHistory,
  getAiSafeFirstName,
  getAiCustomerNamePlaceholder,
} from '../services/privacy/redaction.js';
import { buildWhatsAppAgentPrompt } from '../services/whatsappAgentPrompt.js';
import { extractAssistantInputWithGoogleAi, normalizeDateWithGoogleAi } from '../services/googleAiStudio.js';
import { resolveWhatsAppConversationAgentDecision } from '../services/whatsappConversationAgent.js';
import { resolveStepAwareWhatsAppIntent } from '../services/whatsappStepAwareNlu.js';

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

// ─── Fetch mocking helpers (matches convention in whatsappProvider.test.ts) ───

const mockGeminiFetch = (responseText: string) => {
  const originalFetch = globalThis.fetch;
  let capturedBody: string | null = null;
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = init?.body ? String(init.body) : null;
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: responseText }] } }],
    }), { status: 200 });
  }) as typeof fetch;
  return {
    getCapturedBody: () => capturedBody,
    restore: () => { globalThis.fetch = originalFetch; },
  };
};

const mockGeminiFetchError = (status: number, errorBodyText: string) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(errorBodyText, { status })) as typeof fetch;
  return { restore: () => { globalThis.fetch = originalFetch; } };
};

const baseClinicFacts = {
  clinicName: 'Test Klinik',
  timezone: 'Europe/Istanbul',
  hasAddress: false,
  hasPhone: false,
  hasEmail: false,
  hasWebsite: false,
  doctorCountKnown: false,
  workingHoursKnown: false,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nAI Privacy Boundary Tests (AI-PROMPT-REDACTION-GAP-001)\n');

  // 1. maskPhone
  await test('maskPhone masks all but the last 4 digits', () => {
    assert.equal(maskPhone('+905551234567'), '***4567');
    assert.equal(maskPhone('05551234567'), '***4567');
    assert.equal(maskPhone('905551234567'), '***4567');
  });

  // 2. maskEmail
  await test('maskEmail masks the local part, keeps the domain', () => {
    const masked = maskEmail('ahmet.yilmaz@example.com');
    assert.ok(masked.includes('@example.com'), `expected domain in "${masked}"`);
    assert.ok(!masked.includes('ahmet.yilmaz'), `full local part must be hidden in "${masked}"`);
  });

  // 3. redactSensitiveText — phone
  await test('redactSensitiveText replaces phone-like strings with [PHONE]', () => {
    const result = redactSensitiveText('Beni arayın: 0555 123 45 67 lütfen');
    assert.ok(result.includes('[PHONE]'), `expected [PHONE] token in "${result}"`);
    assert.ok(!result.includes('0555 123 45 67'), `raw phone must be absent in "${result}"`);
  });

  // 4. redactSensitiveText — email
  await test('redactSensitiveText replaces email-like strings with [EMAIL]', () => {
    const result = redactSensitiveText('Bana yaz: ahmet@ornek.com');
    assert.ok(result.includes('[EMAIL]'), `expected [EMAIL] token in "${result}"`);
    assert.ok(!result.includes('ahmet@ornek.com'), `raw email must be absent in "${result}"`);
  });

  // 5. buildSafeAiPatientContext
  await test('buildSafeAiPatientContext returns only firstName', () => {
    const ctx = buildSafeAiPatientContext({
      firstName: 'Ahmet',
    });
    assert.equal(ctx.firstName, 'Ahmet');
    const keys = Object.keys(ctx);
    assert.deepEqual(keys, ['firstName']);
  });

  // 6. sanitizeAiMessageHistory — message count cap
  await test('sanitizeAiMessageHistory caps message count to maxCount', () => {
    const msgs = Array.from({ length: 15 }, (_, i) => ({
      direction: 'incoming' as const,
      text: `Message ${i}`,
    }));
    const result = sanitizeAiMessageHistory(msgs, { maxCount: 5 });
    assert.equal(result.length, 5);
    assert.equal(result[0].text, 'Message 10'); // last 5 of 15
  });

  // 7. sanitizeAiMessageHistory — text length cap
  await test('sanitizeAiMessageHistory truncates message body to maxTextLength', () => {
    const long = 'a'.repeat(500);
    const result = sanitizeAiMessageHistory(
      [{ direction: 'incoming', text: long }],
      { maxTextLength: 100 },
    );
    assert.equal(result[0].text.length, 100);
  });

  // 8. sanitizeAiMessageHistory — redacts phone in message body
  await test('sanitizeAiMessageHistory redacts phone numbers embedded in messages', () => {
    const result = sanitizeAiMessageHistory(
      [{ direction: 'incoming', text: 'Telefon: 05551234567' }],
      { redactPii: true },
    );
    assert.ok(result[0].text.includes('[PHONE]'), `expected [PHONE] in "${result[0].text}"`);
    assert.ok(!result[0].text.includes('05551234567'), `raw phone must be absent in "${result[0].text}"`);
  });

  // 9. sanitizeAiMessageHistory — redacts email in message body
  await test('sanitizeAiMessageHistory redacts email addresses embedded in messages', () => {
    const result = sanitizeAiMessageHistory(
      [{ direction: 'incoming', text: 'Mail: test@ornek.com bekliyorum' }],
      { redactPii: true },
    );
    assert.ok(result[0].text.includes('[EMAIL]'), `expected [EMAIL] in "${result[0].text}"`);
    assert.ok(!result[0].text.includes('test@ornek.com'), `raw email must be absent in "${result[0].text}"`);
  });

  // 10. buildWhatsAppAgentPrompt — no real name, fixed pseudonym only
  await test('buildWhatsAppAgentPrompt sends the fixed [CUSTOMER] pseudonym, never any form of the real name', () => {
    const prompt = buildWhatsAppAgentPrompt({
      latestMessage: 'merhaba',
      customerName: 'Ahmet Yılmaz',
      currentIntent: null,
      currentStep: null,
      selectedAppointmentTypeName: null,
      selectedDate: null,
      services: [],
      recentMessages: [],
      clinicFacts: baseClinicFacts,
    });
    assert.ok(prompt.includes('Customer name: [CUSTOMER]'), `expected fixed pseudonym in prompt, got: ${prompt.slice(prompt.indexOf('Customer name'), prompt.indexOf('Customer name') + 40)}`);
    assert.ok(!prompt.includes('Ahmet'), `no form of the real name (not even first name) may appear in prompt, got: ${prompt.slice(prompt.indexOf('Customer name'), prompt.indexOf('Customer name') + 40)}`);
    assert.ok(!prompt.includes('Yılmaz'), `surname must not appear in prompt`);
  });

  // 11. buildWhatsAppAgentPrompt — no medical / insurance / payment data in context section
  await test('buildWhatsAppAgentPrompt context section does not include medical, insurance, or payment data', () => {
    const prompt = buildWhatsAppAgentPrompt({
      latestMessage: 'randevu almak istiyorum',
      customerName: 'Test Hasta',
      currentIntent: null,
      currentStep: null,
      selectedAppointmentTypeName: null,
      selectedDate: null,
      services: [{ id: '1', name: 'Muayene', durationMinutes: 30 }],
      recentMessages: [],
      clinicFacts: {
        ...baseClinicFacts,
        hasAddress: true,
        hasPhone: true,
        doctorCountKnown: true,
        doctorCount: 2,
        workingHoursKnown: true,
        workingHoursDetail: 'none',
      },
    });
    const contextSection = prompt.slice(prompt.indexOf('Known context:'));
    const forbidden = [
      'medicalNotes', 'medical_notes', 'tıbbi notlar',
      'insurance', 'sigorta',
      'payment', 'ödeme', 'borç',
      'dateOfBirth', 'doğum tarihi',
      'toothRecord', 'dental chart',
      'prescription', 'reçete',
      'attachments', 'ek dosya',
    ];
    for (const term of forbidden) {
      assert.ok(
        !contextSection.toLocaleLowerCase('tr-TR').includes(term.toLocaleLowerCase('tr-TR')),
        `context section must not contain sensitive field "${term}"`,
      );
    }
  });

  // 12. buildWhatsAppAgentPrompt — no raw phone in context section
  await test('buildWhatsAppAgentPrompt does not expose raw phone numbers in the context section', () => {
    const prompt = buildWhatsAppAgentPrompt({
      latestMessage: 'randevu',
      customerName: null,
      currentIntent: null,
      currentStep: null,
      selectedAppointmentTypeName: null,
      selectedDate: null,
      services: [],
      recentMessages: [],
      clinicFacts: baseClinicFacts,
    });
    assert.ok(
      !prompt.includes('05551234567'),
      'raw phone number must not appear in AI prompt context section',
    );
  });

  // 13. sanitizeAiMessageHistory — redactPii:false skips redaction
  await test('sanitizeAiMessageHistory with redactPii:false skips PII redaction', () => {
    const result = sanitizeAiMessageHistory(
      [{ direction: 'incoming', text: 'Telefon: 05551234567' }],
      { redactPii: false },
    );
    assert.ok(
      result[0].text.includes('05551234567'),
      'when redactPii is false, raw phone must be preserved',
    );
  });

  // 14. sanitizeAiMessageHistory — empty input
  await test('sanitizeAiMessageHistory handles an empty input array gracefully', () => {
    const result = sanitizeAiMessageHistory([]);
    assert.deepEqual(result, []);
  });

  // 15. maskPhone — invalid / short input
  await test('maskPhone returns *** for very short or empty input', () => {
    assert.equal(maskPhone(null), '***');
    assert.equal(maskPhone(undefined), '***');
    assert.equal(maskPhone(''), '***');
    assert.equal(maskPhone('123'), '***');
  });

  // 16. redactSensitiveText — UUID
  await test('redactSensitiveText redacts UUIDs', () => {
    const result = redactSensitiveText('appointment 550e8400-e29b-41d4-a716-446655440000 confirmed');
    assert.ok(result.includes('[ID]'), `expected [ID] in "${result}"`);
    assert.ok(!result.includes('550e8400-e29b-41d4-a716-446655440000'));
  });

  // 17. redactSensitiveText — Bearer token
  await test('redactSensitiveText redacts Bearer tokens', () => {
    const result = redactSensitiveText('Authorization: Bearer abcdef1234567890ghijklmno');
    assert.ok(result.includes('[TOKEN]'), `expected [TOKEN] in "${result}"`);
    assert.ok(!result.includes('abcdef1234567890ghijklmno'));
  });

  // 18. redactSensitiveText — key=value credential-like strings
  await test('redactSensitiveText redacts key=value credential-like strings', () => {
    const result = redactSensitiveText('password: SuperSecret123 api_key=sk_live_abcdefghijklmno');
    assert.ok(!result.includes('SuperSecret123'), `raw password must be absent in "${result}"`);
    assert.ok(!result.includes('sk_live_abcdefghijklmno'), `raw api key must be absent in "${result}"`);
    assert.ok(result.includes('[TOKEN]'));
  });

  // 19. redactSensitiveText — malformed but identifier-like values (catch-all)
  await test('redactSensitiveText redacts malformed-but-identifier-like values via the catch-all', () => {
    const malformedUuid = 'abcd1234-efgh-5678-ijkl-9999mnop'; // wrong hex shape, still identifier-like
    const result = redactSensitiveText(`ref: ${malformedUuid} lütfen kontrol edin`);
    assert.ok(!result.includes(malformedUuid), `malformed identifier must be redacted in "${result}"`);
    assert.ok(result.includes('[ID]'));

    const cuidLike = 'clh3n5g7x0000qzrmn831i7d5';
    const result2 = redactSensitiveText(`patientId ${cuidLike} eslesmedi`);
    assert.ok(!result2.includes(cuidLike));
    assert.ok(result2.includes('[ID]'));
  });

  // 20. redactSensitiveText — preserves 8-digit dates (no phone false-positive)
  await test('redactSensitiveText preserves an 8-digit date instead of misreading it as a phone number', () => {
    const result = redactSensitiveText('Randevu tarihi 27.07.2026 olarak uygun mu?');
    assert.ok(result.includes('27.07.2026'), `date must survive redaction in "${result}"`);
    assert.ok(!result.includes('[PHONE]'), `date must not be redacted as a phone number: "${result}"`);
  });

  // 21. redactSensitiveText — combined Turkish/French multilingual text
  await test('redactSensitiveText handles combined Turkish/French text with multiple PII types', () => {
    const text = "Bonjour, je m'appelle Ahmet, mon numéro est +33 6 12 34 56 78 ve mailim ahmet@ornek.com, randevu almak istiyorum, merci";
    const result = redactSensitiveText(text);
    assert.ok(!result.includes('+33 6 12 34 56 78'));
    assert.ok(!result.includes('ahmet@ornek.com'));
    assert.ok(result.includes('[PHONE]'));
    assert.ok(result.includes('[EMAIL]'));
    assert.ok(result.includes('randevu almak istiyorum'), 'operational intent (booking request) must survive redaction');
  });

  // 22. redactSensitiveText — formatted French phone numbers
  await test('redactSensitiveText redacts formatted French phone numbers', () => {
    assert.ok(redactSensitiveText('06 12 34 56 78').includes('[PHONE]'));
    assert.ok(redactSensitiveText('+33 6 12 34 56 78').includes('[PHONE]'));
    assert.ok(redactSensitiveText('01 23 45 67 89').includes('[PHONE]'));
  });

  // 23. redactSensitiveText — formatted Turkish phone numbers (extra formats)
  await test('redactSensitiveText redacts formatted Turkish phone numbers', () => {
    assert.ok(redactSensitiveText('+90 532 123 45 67').includes('[PHONE]'));
    assert.ok(redactSensitiveText('0(532) 123 45 67').includes('[PHONE]'));
    assert.ok(redactSensitiveText('05321234567').includes('[PHONE]'));
  });

  // 24. redactSensitiveText — fail-safe on non-string input
  await test('redactSensitiveText fails safe (never returns raw input) on non-string input', () => {
    const result = redactSensitiveText(null as unknown as string);
    assert.equal(result, '[REDACTED]');
  });

  // 25. getAiSafeFirstName
  await test('getAiSafeFirstName returns only the first name and redacts it defensively', () => {
    assert.equal(getAiSafeFirstName('Ahmet Yılmaz'), 'Ahmet');
    assert.equal(getAiSafeFirstName(null), null);
    assert.equal(getAiSafeFirstName(''), null);
    assert.equal(getAiSafeFirstName('   '), null);
    // A name field that accidentally contains a phone number must not leak it either.
    assert.equal(getAiSafeFirstName('0532123456 ikinciAd'), '[PHONE]');
  });

  // 26. extractAssistantInputWithGoogleAi — current message phone redaction
  await test('extractAssistantInputWithGoogleAi redacts the phone number in the current/latest message', async () => {
    const mock = mockGeminiFetch('{"intent":"greeting"}');
    try {
      await extractAssistantInputWithGoogleAi({
        text: 'Beni 0532 123 45 67 numaralı telefondan arayın',
        services: [],
        currentIntent: null,
        currentStep: null,
        customerName: null,
        selectedAppointmentTypeName: null,
        selectedDate: null,
      });
    } finally {
      mock.restore();
    }
    const body = mock.getCapturedBody();
    assert.ok(body, 'expected a captured request body');
    assert.ok(!body!.includes('0532 123 45 67'), 'raw phone number must not be sent to the AI provider');
    assert.ok(body!.includes('[PHONE]'), 'expected redacted [PHONE] token in outbound request body');
  });

  // 27. extractAssistantInputWithGoogleAi — no real name ever sent, fixed pseudonym only
  await test('extractAssistantInputWithGoogleAi sends the fixed [CUSTOMER] pseudonym, never any form of the real patient name', async () => {
    const mock = mockGeminiFetch('{"intent":"greeting"}');
    try {
      await extractAssistantInputWithGoogleAi({
        text: 'merhaba',
        services: [],
        currentIntent: null,
        currentStep: null,
        customerName: 'Ahmet Yılmaz',
        selectedAppointmentTypeName: null,
        selectedDate: null,
      });
    } finally {
      mock.restore();
    }
    const body = mock.getCapturedBody();
    assert.ok(body!.includes('[CUSTOMER]'), 'expected the fixed pseudonym to be present');
    assert.ok(!body!.includes('Ahmet'), 'no form of the real name (not even first name) may reach the AI provider');
    assert.ok(!body!.includes('Yılmaz'), 'surname must not reach the AI provider');
  });

  // 28. extractAssistantInputWithGoogleAi — UUID redaction
  await test('extractAssistantInputWithGoogleAi redacts UUID-shaped identifiers from the current message', async () => {
    const mock = mockGeminiFetch('{"intent":"unknown"}');
    try {
      await extractAssistantInputWithGoogleAi({
        text: 'Randevu id: 550e8400-e29b-41d4-a716-446655440000 hakkında bilgi almak istiyorum',
        services: [],
        currentIntent: null,
        currentStep: null,
        customerName: null,
        selectedAppointmentTypeName: null,
        selectedDate: null,
      });
    } finally {
      mock.restore();
    }
    const body = mock.getCapturedBody();
    assert.ok(!body!.includes('550e8400-e29b-41d4-a716-446655440000'));
    assert.ok(body!.includes('[ID]'));
  });

  // 29. extractAssistantInputWithGoogleAi — Bearer token redaction
  await test('extractAssistantInputWithGoogleAi redacts Bearer tokens from the current message', async () => {
    const mock = mockGeminiFetch('{"intent":"unknown"}');
    try {
      await extractAssistantInputWithGoogleAi({
        text: 'Sistem hatası aldım: Authorization: Bearer abcdef1234567890ghijklmno gönderiyorum',
        services: [],
        currentIntent: null,
        currentStep: null,
        customerName: null,
        selectedAppointmentTypeName: null,
        selectedDate: null,
      });
    } finally {
      mock.restore();
    }
    const body = mock.getCapturedBody();
    assert.ok(!body!.includes('Bearer abcdef1234567890ghijklmno'));
    assert.ok(body!.includes('[TOKEN]'));
  });

  // 30. normalizeDateWithGoogleAi — PII redacted, date-extraction intent preserved
  await test('normalizeDateWithGoogleAi redacts PII from the message while preserving date-extraction intent', async () => {
    const mock = mockGeminiFetch('{"isoDate":"2026-07-30"}');
    let result: string | null = null;
    try {
      result = await normalizeDateWithGoogleAi(
        '27.07.2026 tarihine denk gelen cuma günü, iletişim için 0532 123 45 67',
        '2026-07-28',
        'Europe/Istanbul',
      );
    } finally {
      mock.restore();
    }
    assert.equal(result, '2026-07-30');
    const body = mock.getCapturedBody();
    assert.ok(!body!.includes('0532 123 45 67'), 'raw phone must not reach the AI provider');
    assert.ok(body!.includes('27.07.2026'), 'the date phrase itself must survive redaction');
  });

  // 31. Provider error path — no raw prompt content anywhere
  await test('extractAssistantInputWithGoogleAi provider-error path never surfaces the constructed prompt', async () => {
    const originalConsoleError = console.error;
    const loggedArgs: unknown[][] = [];
    console.error = (...args: unknown[]) => { loggedArgs.push(args); };
    const mock = mockGeminiFetchError(500, 'upstream failure');
    let thrown: unknown = null;
    try {
      await extractAssistantInputWithGoogleAi({
        text: 'telefonum 0532 123 45 67, mailim ahmet@ornek.com',
        services: [],
        currentIntent: null,
        currentStep: null,
        customerName: 'Ahmet Yılmaz',
        selectedAppointmentTypeName: null,
        selectedDate: null,
      });
    } catch (err) {
      thrown = err;
    } finally {
      mock.restore();
      console.error = originalConsoleError;
    }
    assert.ok(thrown instanceof Error, 'expected the provider error to propagate');
    const thrownMessage = thrown instanceof Error ? thrown.message : String(thrown);
    assert.ok(!thrownMessage.includes('0532 123 45 67'), 'thrown error must not echo the raw phone number');
    assert.ok(!thrownMessage.includes('ahmet@ornek.com'), 'thrown error must not echo the raw email');
    for (const args of loggedArgs) {
      const serialized = JSON.stringify(args);
      assert.ok(!serialized.includes('0532 123 45 67'), 'console.error must never include the raw phone number');
      assert.ok(!serialized.includes('ahmet@ornek.com'), 'console.error must never include the raw email address');
    }
  });

  // 32. buildWhatsAppAgentPrompt — shared WhatsApp / Meta WhatsApp / Instagram boundary
  await test('buildWhatsAppAgentPrompt (shared WhatsApp / Meta WhatsApp / Instagram boundary) redacts phone, email, UUID and token from the latest message', () => {
    const prompt = buildWhatsAppAgentPrompt({
      latestMessage: 'Merhaba, numaram 0532 123 45 67, mailim ahmet@ornek.com, id 550e8400-e29b-41d4-a716-446655440000, Bearer abcdef1234567890ghijklmno',
      customerName: 'Ahmet Yılmaz',
      currentIntent: null,
      currentStep: null,
      selectedAppointmentTypeName: null,
      selectedDate: null,
      services: [],
      recentMessages: [],
      clinicFacts: baseClinicFacts,
    });
    const messageSection = prompt.slice(prompt.indexOf('<customer_message>'));
    assert.ok(!messageSection.includes('0532 123 45 67'));
    assert.ok(!messageSection.includes('ahmet@ornek.com'));
    assert.ok(!messageSection.includes('550e8400-e29b-41d4-a716-446655440000'));
    assert.ok(!messageSection.includes('abcdef1234567890ghijklmno'));
    assert.ok(messageSection.includes('[PHONE]'));
    assert.ok(messageSection.includes('[EMAIL]'));
    assert.ok(messageSection.includes('[ID]'));
    assert.ok(messageSection.includes('[TOKEN]'));
  });

  // 33. buildWhatsAppAgentPrompt — recentMessages re-sanitized regardless of caller
  await test('buildWhatsAppAgentPrompt redacts recentMessages even when the caller passes raw text', () => {
    const prompt = buildWhatsAppAgentPrompt({
      latestMessage: 'merhaba',
      customerName: null,
      currentIntent: null,
      currentStep: null,
      selectedAppointmentTypeName: null,
      selectedDate: null,
      services: [],
      recentMessages: [{ direction: 'incoming', text: 'ara beni 0532 123 45 67' }],
      clinicFacts: baseClinicFacts,
    });
    assert.ok(!prompt.includes('0532 123 45 67'));
    assert.ok(prompt.includes('[PHONE]'));
  });

  // 34. resolveWhatsAppConversationAgentDecision — full call path (WhatsApp / Meta / Instagram)
  await test('resolveWhatsAppConversationAgentDecision redacts PII end-to-end for the shared WhatsApp / Meta WhatsApp / Instagram conversation-agent path', async () => {
    const mock = mockGeminiFetch('{"intent":"greeting","confidence":0.9,"action":"reply_only"}');
    try {
      await resolveWhatsAppConversationAgentDecision({
        latestMessage: 'beni 0532 123 45 67 numaradan arayın, mailim ahmet@ornek.com',
        customerName: 'Ahmet Yılmaz',
        currentIntent: null,
        currentStep: null,
        selectedAppointmentTypeName: null,
        selectedDate: null,
        services: [],
        recentMessages: [],
        clinicFacts: baseClinicFacts,
      });
    } finally {
      mock.restore();
    }
    const body = mock.getCapturedBody();
    assert.ok(!body!.includes('0532 123 45 67'));
    assert.ok(!body!.includes('ahmet@ornek.com'));
    assert.ok(!body!.includes('Ahmet Yılmaz'));
    assert.ok(!body!.includes('Ahmet'), 'no form of the real name (not even first name) may reach the AI provider');
    assert.ok(body!.includes('[CUSTOMER]'), 'expected the fixed pseudonym in the outbound request body');
  });

  // 35. resolveStepAwareWhatsAppIntent — customer actively providing their phone number
  await test('resolveStepAwareWhatsAppIntent redacts a raw phone number the customer is providing (awaiting_phone step) before sending it to the AI provider', async () => {
    const mock = mockGeminiFetch('{"intent":"provide_phone","confidence":0.9,"extractedServiceId":null,"extractedDate":null,"extractedTime":null,"reply":null}');
    try {
      await resolveStepAwareWhatsAppIntent({
        clinicId: 'clinic-1',
        phone: '905551234567',
        currentStep: 'awaiting_phone',
        currentIntent: null,
        lastMessage: null,
        userText: '0532 123 45 67',
        availableServices: [],
        selectedService: null,
        selectedDate: null,
        selectedTime: null,
      });
    } finally {
      mock.restore();
    }
    const body = mock.getCapturedBody();
    assert.ok(!body!.includes('0532 123 45 67'));
    assert.ok(body!.includes('[PHONE]'));
  });

  // 36. Booking intent survives redaction end-to-end
  await test('booking-relevant wording (service/date/time) survives redaction in the outbound prompt', () => {
    const prompt = buildWhatsAppAgentPrompt({
      latestMessage: '0532 123 45 67 numaralı telefondan yarın saat 14:00 için randevu almak istiyorum',
      customerName: null,
      currentIntent: null,
      currentStep: null,
      selectedAppointmentTypeName: null,
      selectedDate: null,
      services: [],
      recentMessages: [],
      clinicFacts: baseClinicFacts,
    });
    const messageSection = prompt.slice(prompt.indexOf('<customer_message>'));
    assert.ok(!messageSection.includes('0532 123 45 67'));
    assert.ok(messageSection.includes('[PHONE]'));
    assert.ok(messageSection.includes('yarın saat 14:00'), 'the appointment date/time phrase must survive redaction');
    assert.ok(messageSection.includes('randevu almak istiyorum'), 'the booking intent phrase must survive redaction');
  });

  // 37. redactSensitiveText — date immediately followed by a dot-separated time
  await test('redactSensitiveText preserves a date immediately followed by a dot-separated time (no phone false-positive)', () => {
    const result = redactSensitiveText('27.07.2026 14.00 icin randevu almak istiyorum');
    assert.ok(result.includes('27.07.2026 14.00'), `date+time must survive redaction in "${result}"`);
    assert.ok(!result.includes('[PHONE]'), `date+time must not be misread as a phone number: "${result}"`);
  });

  // 38. redactSensitiveText — date immediately followed by a colon-separated time (the
  // single most common way a customer types a specific appointment request)
  await test('redactSensitiveText preserves a date immediately followed by a colon-separated time', () => {
    const result = redactSensitiveText('27.07.2026 14:00 icin randevu almak istiyorum');
    assert.ok(result.includes('27.07.2026 14:00'), `date+time must survive redaction in "${result}"`);
    assert.ok(!result.includes('[PHONE]'), `date+time must not be misread as a phone number: "${result}"`);
  });

  // 39. redactSensitiveText — ISO date immediately followed by a colon-separated time
  await test('redactSensitiveText preserves an ISO date immediately followed by a colon-separated time', () => {
    const result = redactSensitiveText('2026-07-27 14:00 gelebilirim');
    assert.ok(result.includes('2026-07-27 14:00'), `ISO date+time must survive redaction in "${result}"`);
    assert.ok(!result.includes('[PHONE]'), `ISO date+time must not be misread as a phone number: "${result}"`);
  });

  // 40. redactSensitiveText — the date+time exemption does not weaken genuine phone redaction
  await test('redactSensitiveText still redacts a real phone number appearing alongside a date+time phrase', () => {
    const result = redactSensitiveText(
      '27.07.2026 14:00 icin randevu almak istiyorum, telefonum 0532 123 45 67',
    );
    assert.ok(result.includes('27.07.2026 14:00'), `date+time must survive: "${result}"`);
    assert.ok(!result.includes('0532 123 45 67'), `raw phone must not survive: "${result}"`);
    assert.ok(result.includes('[PHONE]'), `phone must still be redacted: "${result}"`);
  });

  // 41. Provider error bodies must not reflect raw prompt-derived PII into thrown
  // errors or logs — across all three Gemini call paths (AI-PROMPT-REDACTION-GAP-001
  // follow-up: the original fix only verified this with a synthetic, non-PII error
  // body; a provider error response that itself echoes request-derived data was
  // previously forwarded to console.error unsanitized).
  await test('extractAssistantInputWithGoogleAi sanitizes a PII-bearing provider error body before it is thrown or logged', async () => {
    const originalConsoleError = console.error;
    const loggedArgs: unknown[][] = [];
    console.error = (...args: unknown[]) => { loggedArgs.push(args); };
    const mock = mockGeminiFetchError(400, 'Invalid request, echo: phone 0532 123 45 67 email ahmet@ornek.com');
    let thrown: unknown = null;
    try {
      await extractAssistantInputWithGoogleAi({
        text: 'merhaba',
        services: [],
        currentIntent: null,
        currentStep: null,
        customerName: null,
        selectedAppointmentTypeName: null,
        selectedDate: null,
      });
    } catch (err) {
      thrown = err;
    } finally {
      mock.restore();
      console.error = originalConsoleError;
    }
    const thrownMessage = thrown instanceof Error ? thrown.message : String(thrown);
    assert.ok(!thrownMessage.includes('0532 123 45 67'), 'thrown error must not echo a raw phone number from the provider error body');
    assert.ok(!thrownMessage.includes('ahmet@ornek.com'), 'thrown error must not echo a raw email from the provider error body');
    for (const args of loggedArgs) {
      const serialized = JSON.stringify(args);
      assert.ok(!serialized.includes('0532 123 45 67'), 'console.error must never include a raw phone number from a provider error body');
      assert.ok(!serialized.includes('ahmet@ornek.com'), 'console.error must never include a raw email from a provider error body');
    }
  });

  // 42. Same guarantee for the shared WhatsApp / Meta WhatsApp / Instagram conversation-agent path
  await test('resolveWhatsAppConversationAgentDecision sanitizes a PII-bearing provider error body before it is thrown or logged', async () => {
    const originalConsoleError = console.error;
    const loggedArgs: unknown[][] = [];
    console.error = (...args: unknown[]) => { loggedArgs.push(args); };
    const mock = mockGeminiFetchError(400, 'Invalid request, echo: phone 0532 123 45 67 email ahmet@ornek.com');
    try {
      await resolveWhatsAppConversationAgentDecision({
        latestMessage: 'merhaba',
        customerName: null,
        currentIntent: null,
        currentStep: null,
        selectedAppointmentTypeName: null,
        selectedDate: null,
        services: [],
        recentMessages: [],
        clinicFacts: baseClinicFacts,
      });
    } finally {
      mock.restore();
      console.error = originalConsoleError;
    }
    for (const args of loggedArgs) {
      const serialized = JSON.stringify(args);
      assert.ok(!serialized.includes('0532 123 45 67'), 'console.error must never include a raw phone number from a provider error body');
      assert.ok(!serialized.includes('ahmet@ornek.com'), 'console.error must never include a raw email from a provider error body');
    }
  });

  // 43. Same guarantee for the step-aware NLU path
  await test('resolveStepAwareWhatsAppIntent sanitizes a PII-bearing provider error body before it is thrown or logged', async () => {
    const originalConsoleError = console.error;
    const loggedArgs: unknown[][] = [];
    console.error = (...args: unknown[]) => { loggedArgs.push(args); };
    const mock = mockGeminiFetchError(400, 'Invalid request, echo: phone 0532 123 45 67 email ahmet@ornek.com');
    try {
      await resolveStepAwareWhatsAppIntent({
        clinicId: 'clinic-1',
        phone: '905551234567',
        currentStep: 'main_menu',
        currentIntent: null,
        lastMessage: null,
        userText: 'merhaba',
        availableServices: [],
        selectedService: null,
        selectedDate: null,
        selectedTime: null,
      });
    } finally {
      mock.restore();
      console.error = originalConsoleError;
    }
    for (const args of loggedArgs) {
      const serialized = JSON.stringify(args);
      assert.ok(!serialized.includes('0532 123 45 67'), 'console.error must never include a raw phone number from a provider error body');
      assert.ok(!serialized.includes('ahmet@ornek.com'), 'console.error must never include a raw email from a provider error body');
    }
  });

  // 44. redactSensitiveText — punctuation-bearing credentials fully redacted, no suffix leak
  await test('redactSensitiveText fully redacts credentials containing punctuation (no suffix leak)', () => {
    const cases: Array<{ input: string; mustNotContain: string[] }> = [
      { input: 'password=Sup3r!Secret', mustNotContain: ['Sup3r', 'Secret', '!Secret'] },
      { input: 'token=abc123+/==', mustNotContain: ['abc123', '+/=='] },
      { input: 'api_key=sk-test_123!more', mustNotContain: ['sk-test', '123', '!more'] },
      { input: 'secret: value-with-$pecial#chars', mustNotContain: ['value-with', '$pecial', '#chars'] },
    ];
    for (const { input, mustNotContain } of cases) {
      const result = redactSensitiveText(input);
      assert.ok(result.includes('[TOKEN]'), `expected [TOKEN] in "${result}" (from "${input}")`);
      for (const fragment of mustNotContain) {
        assert.ok(!result.includes(fragment), `credential fragment "${fragment}" leaked in "${result}" (from "${input}")`);
      }
    }
  });

  // 45. redactSensitiveText — credential at end of line/string
  await test('redactSensitiveText fully redacts a credential at the end of a line/string', () => {
    const singleLine = redactSensitiveText('password=Sup3r!Secret');
    assert.equal(singleLine, 'password: [TOKEN]');

    const multiLine = redactSensitiveText('Lütfen bu bilgiyi kullanın:\npassword=Sup3r!Secret');
    assert.ok(multiLine.endsWith('password: [TOKEN]'), `expected credential fully redacted at end of string in "${multiLine}"`);
    assert.ok(!multiLine.includes('Secret'), `raw credential value must not survive in "${multiLine}"`);
  });

  // 46. redactSensitiveText — ordinary prose following a credential must survive
  await test('redactSensitiveText redacts a credential but leaves ordinary prose that follows it intact', () => {
    const result = redactSensitiveText(
      'token=abc123 bu mesajın geri kalanı normal bir cümledir ve olduğu gibi kalmalıdır.',
    );
    assert.ok(!result.includes('abc123'), `raw credential must not survive in "${result}"`);
    assert.ok(result.includes('[TOKEN]'), `expected [TOKEN] in "${result}"`);
    assert.ok(
      result.includes('bu mesajın geri kalanı normal bir cümledir ve olduğu gibi kalmalıdır.'),
      `ordinary prose following the credential must survive unmodified in "${result}"`,
    );
  });

  // 47. redactSensitiveText — multiple credentials in one string
  await test('redactSensitiveText redacts multiple distinct credentials within one string', () => {
    const result = redactSensitiveText(
      'password=Sup3r!Secret ve ayrıca token=abc123+/== ve api_key=sk-test_123!more kullanıldı',
    );
    assert.ok(!result.includes('Sup3r'), `first credential must not survive in "${result}"`);
    assert.ok(!result.includes('abc123'), `second credential must not survive in "${result}"`);
    assert.ok(!result.includes('sk-test'), `third credential must not survive in "${result}"`);
    const tokenCount = (result.match(/\[TOKEN\]/g) ?? []).length;
    assert.equal(tokenCount, 3, `expected exactly 3 [TOKEN] placeholders in "${result}"`);
    assert.ok(result.includes('ve ayrıca'), `prose between credentials must survive in "${result}"`);
    assert.ok(result.includes('ve api_key'), `prose between credentials must survive in "${result}"`);
    assert.ok(result.includes('kullanıldı'), `trailing prose must survive in "${result}"`);
  });

  // 48. getAiCustomerNamePlaceholder — fixed pseudonym, never the real name
  await test('getAiCustomerNamePlaceholder returns the fixed pseudonym for a known name and null otherwise', () => {
    assert.equal(getAiCustomerNamePlaceholder('Ahmet Yılmaz'), '[CUSTOMER]');
    assert.equal(getAiCustomerNamePlaceholder('Ahmet'), '[CUSTOMER]');
    assert.equal(getAiCustomerNamePlaceholder(null), null);
    assert.equal(getAiCustomerNamePlaceholder(undefined), null);
    assert.equal(getAiCustomerNamePlaceholder(''), null);
    assert.equal(getAiCustomerNamePlaceholder('   '), null);
  });

  // ─── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
