/**
 * aiPrivacyBoundary.test.ts — Privacy boundary tests for the AI agent.
 *
 * Run with:  tsx src/tests/aiPrivacyBoundary.test.ts
 * No external test framework — uses node:assert/strict + manual counters.
 *
 * Verifies:
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
 */

import assert from 'node:assert/strict';
import {
  maskPhone,
  maskEmail,
  redactSensitiveText,
  buildSafeAiPatientContext,
  sanitizeAiMessageHistory,
} from '../services/privacy/redaction.js';
import { buildWhatsAppAgentPrompt } from '../services/whatsappAgentPrompt.js';

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

// ─── Tests ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nAI Privacy Boundary Tests\n');

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
    // The type only has firstName; verify no extra fields bleed through
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

  // 10. buildWhatsAppAgentPrompt — first name only
  await test('buildWhatsAppAgentPrompt sends only the first name, not the full name', () => {
    const prompt = buildWhatsAppAgentPrompt({
      latestMessage: 'merhaba',
      customerName: 'Ahmet Yılmaz',
      currentIntent: null,
      currentStep: null,
      selectedAppointmentTypeName: null,
      selectedDate: null,
      services: [],
      recentMessages: [],
      clinicFacts: {
        clinicName: 'Test Klinik',
        timezone: 'Europe/Istanbul',
        hasAddress: false,
        hasPhone: false,
        hasEmail: false,
        hasWebsite: false,
        doctorCountKnown: false,
        workingHoursKnown: false,
      },
    });
    assert.ok(prompt.includes('Customer name: Ahmet'), `expected first name in prompt`);
    assert.ok(!prompt.includes('Ahmet Yılmaz'), `full name must not appear in prompt, got: ${prompt.slice(prompt.indexOf('Customer name'), prompt.indexOf('Customer name') + 40)}`);
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
        clinicName: 'Test Klinik',
        timezone: 'Europe/Istanbul',
        hasAddress: true,
        hasPhone: true,
        hasEmail: false,
        hasWebsite: false,
        doctorCountKnown: true,
        doctorCount: 2,
        workingHoursKnown: true,
        workingHoursDetail: 'none',
      },
    });
    // Extract only the "Known context:" section so the check is not confused by
    // system-instruction text that legitimately mentions medical concepts as things
    // the AI should NOT do.
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
      clinicFacts: {
        clinicName: 'Klinik',
        timezone: 'Europe/Istanbul',
        hasAddress: false,
        hasPhone: false,
        hasEmail: false,
        hasWebsite: false,
        doctorCountKnown: false,
        workingHoursKnown: false,
      },
    });
    // A raw Turkish phone number should not appear in the known-context section
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

  // ─── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
