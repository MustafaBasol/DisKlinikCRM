/**
 * routeErrorLogPrivacy.test.ts — regression tests for F3-IMPL-004 (PII/PHI
 * Runtime Log Hygiene Wave 1).
 *
 * Root cause covered by all 7 sections below: `console.error(label, err?.message
 * ?? err)` (or similar) logs the raw error `.message` from a Prisma write whose
 * input arguments embed PII/PHI. Node/Prisma's `PrismaClientValidationError.message`
 * pretty-prints the full attempted call arguments, so a validation failure on any
 * of these writes would have echoed the sensitive field(s) straight into the log.
 *
 * Each section below is a static source scan (mirrors the pattern in
 * whatsappBookingFlowLogRedaction.test.ts) that:
 *   1. Locates the specific console.error/warn call by its distinguishing label.
 *   2. Asserts the block now reports only stable error metadata (safeErrorFields(...)
 *      or an inline `instanceof Error ? err.name : '...'` fallback) instead of the
 *      raw `.message` / raw error object.
 *   3. Asserts the raw-leaking shape (`.message`, bare `?? err`) is no longer present.
 *
 * A source scan (rather than a full route-level runtime capture) is used
 * throughout per the task's stated time budget; each site is a one-line
 * console.error/warn call in an Express route handler that isn't easily
 * unit-testable in isolation without heavy req/res/Prisma mocking.
 *
 * Run with: cd server && npx tsx src/tests/routeErrorLogPrivacy.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

function readSource(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

/** Extracts the source text of a console.error/warn(...) call by its
 * distinguishing literal (e.g. the log label string), from the console.
 * token through a generous window past the closing paren. */
function extractLogCallBlock(source: string, distinguishingLiteral: string): string {
  const literalIndex = source.indexOf(distinguishingLiteral);
  assert.ok(literalIndex >= 0, `expected to find "${distinguishingLiteral}" in source`);
  const callStart = source.lastIndexOf('console.', literalIndex);
  assert.ok(callStart >= 0, `expected a console.* call before "${distinguishingLiteral}"`);
  return source.slice(callStart, callStart + 300);
}

async function main() {
  // ── Fix 1 — server/src/routes/users.ts ────────────────────────────────
  section('Fix 1 — users.ts onboarding email failure (recipient address in SMTP bounce text)');

  const usersSource = readSource('../routes/users.ts');

  await test('[users.create] onboarding email failure log no longer includes raw err.message', () => {
    const block = extractLogCallBlock(usersSource, '[users.create] onboarding email failed');
    assert.ok(
      /err instanceof Error \? err\.name : 'MailError'/.test(block),
      'expected inline instanceof-Error name fallback',
    );
    assert.ok(!/\$\{err\?\.message\}/.test(block), 'found raw ${err?.message} template interpolation');
    assert.ok(!/err\.message/.test(block), 'found raw err.message reference');
  });

  // ── Fix 2 — server/src/routes/usersImport.ts ──────────────────────────
  section('Fix 2 — usersImport.ts invitation email failure (recipient address in SMTP bounce text)');

  const usersImportSource = readSource('../routes/usersImport.ts');

  await test('[users/import-confirm] invitation email failure log no longer includes raw mailErr.message', () => {
    const block = extractLogCallBlock(usersImportSource, '[users/import-confirm] invitation email failed');
    assert.ok(
      /mailErr instanceof Error \? mailErr\.name : 'MailError'/.test(block),
      'expected inline instanceof-Error name fallback',
    );
    assert.ok(!/\$\{mailErr\?\.message\}/.test(block), 'found raw ${mailErr?.message} template interpolation');
    assert.ok(!/mailErr\.message/.test(block), 'found raw mailErr.message reference');
  });

  // ── Fix 3 — server/src/routes/patientMedicalHistory.ts ────────────────
  section('Fix 3 — patientMedicalHistory.ts create error (allergies/medications/pregnancy PHI)');

  const patientMedicalHistorySource = readSource('../routes/patientMedicalHistory.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(patientMedicalHistorySource),
      'expected safeErrorFields import',
    );
  });

  await test('[patientMedicalHistory] create error log uses safeErrorFields, not raw err.message', () => {
    const block = extractLogCallBlock(patientMedicalHistorySource, '[patientMedicalHistory] create error');
    assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
    assert.ok(!/err\?\.message/.test(block), 'found raw err?.message reference');
    assert.ok(!/\?\?\s*err\)/.test(block), 'found raw bare-error fallback (?? err)');
  });

  // ── Fix 4 — server/src/routes/dentalChart.ts ───────────────────────────
  section('Fix 4 — dentalChart.ts save error (tooth free-text clinical note)');

  const dentalChartSource = readSource('../routes/dentalChart.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(dentalChartSource),
      'expected safeErrorFields import',
    );
  });

  await test('[dental-chart] save error log uses safeErrorFields, not raw err.message', () => {
    const block = extractLogCallBlock(dentalChartSource, '[dental-chart] save error');
    assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
    assert.ok(!/err\?\.message/.test(block), 'found raw err?.message reference');
    assert.ok(!/\?\?\s*err\)/.test(block), 'found raw bare-error fallback (?? err)');
  });

  // ── Fix 5 — server/src/routes/imaging.ts ───────────────────────────────
  section('Fix 5 — imaging.ts upload error (originalName/description PHI, filenames must never log)');

  const imagingSource = readSource('../routes/imaging.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(imagingSource),
      'expected safeErrorFields import',
    );
  });

  await test('[imaging] upload error log uses safeErrorFields, not raw err.message', () => {
    const block = extractLogCallBlock(imagingSource, '[imaging] upload error');
    assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
    assert.ok(!/err\?\.message/.test(block), 'found raw err?.message reference');
    assert.ok(!/\?\?\s*err\)/.test(block), 'found raw bare-error fallback (?? err)');
  });

  // ── Fix 6 — server/src/routes/imagingBridgePublic.ts ───────────────────
  section('Fix 6 — imagingBridgePublic.ts upload error (originalName PHI, header bans PHI/PII in logs)');

  const imagingBridgePublicSource = readSource('../routes/imagingBridgePublic.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(imagingBridgePublicSource),
      'expected safeErrorFields import',
    );
  });

  await test('[imaging-bridge] upload error log uses safeErrorFields, not raw err.message', () => {
    const block = extractLogCallBlock(imagingBridgePublicSource, '[imaging-bridge] upload error');
    assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
    assert.ok(!/err\?\.message/.test(block), 'found raw err?.message reference');
    assert.ok(!/\?\?\s*err\)/.test(block), 'found raw bare-error fallback (?? err)');
  });

  // ── Fix 7 — server/src/routes/treatmentCases.ts ────────────────────────
  section('Fix 7 — treatmentCases.ts material create error (inventory transaction free-text notes)');

  const treatmentCasesSource = readSource('../routes/treatmentCases.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(treatmentCasesSource),
      'expected safeErrorFields import',
    );
  });

  await test('Treatment material create error log uses safeErrorFields, not raw err.message', () => {
    const block = extractLogCallBlock(treatmentCasesSource, 'Treatment material create error');
    assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
    assert.ok(!/err\?\.message/.test(block), 'found raw err?.message reference');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // F3-IMPL-006 (Wave 2) — remaining RAW_ERROR_REQUIRES_SAFE_ERROR_FIELDS
  // sites across simple (single try/catch per handler) route files. Each
  // site previously logged a raw `err`/`error` (or its `.message`) from a
  // Prisma write/provider call whose arguments carried PII/PHI/message
  // content/secrets (patient name/phone/email, free-text notes, message
  // body, OAuth/webhook secrets) — see F3-IMPL-006 classification table.
  // ═══════════════════════════════════════════════════════════════════════

  // ── Fix 8 — server/src/routes/appointmentRequests.ts ───────────────────
  section('Fix 8 — appointmentRequests.ts post-conversion sync/notify failure (phone/patientName in notification payload)');

  const appointmentRequestsSource = readSource('../routes/appointmentRequests.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(appointmentRequestsSource),
      'expected safeErrorFields import',
    );
  });

  await test('post-conversion sync/notify failure logger call uses ...safeErrorFields(err), not a raw err key', () => {
    const literal = 'post-conversion sync/notify failed';
    const literalIndex = appointmentRequestsSource.indexOf(literal);
    assert.ok(literalIndex >= 0, `expected to find "${literal}"`);
    const callStart = appointmentRequestsSource.lastIndexOf('logger.error', literalIndex);
    assert.ok(callStart >= 0, 'expected a logger.error call before the literal');
    const block = appointmentRequestsSource.slice(callStart, callStart + 300);
    assert.ok(/\.\.\.safeErrorFields\(err\)/.test(block), 'expected ...safeErrorFields(err) spread');
    assert.ok(!/,\s*err\s*\}/.test(block), 'found a raw bare `err` key still present in the logged object');
  });

  // ── Fix 9 — server/src/routes/attachments.ts (3 sites) ──────────────────
  section('Fix 9 — attachments.ts upload/legal-hold/delete errors (originalName filename PII, free-text legalHoldReason)');

  const attachmentsSource = readSource('../routes/attachments.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(attachmentsSource),
      'expected safeErrorFields import',
    );
  });

  for (const label of ['[attachments] upload error', '[attachments] legal-hold error', '[attachments] delete error']) {
    await test(`${label} log uses safeErrorFields, not raw err.message`, () => {
      const block = extractLogCallBlock(attachmentsSource, label);
      assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
      assert.ok(!/err\?\.message/.test(block), 'found raw err?.message reference');
      assert.ok(!/\?\?\s*err\)/.test(block), 'found raw bare-error fallback (?? err)');
    });
  }

  // ── Fix 10 — server/src/routes/auth.ts (2 sites, mail-catch convention) ─
  section('Fix 10 — auth.ts forgot-password/resend-verification mail-catch (recipient email in SMTP bounce text)');

  const authSource = readSource('../routes/auth.ts');

  for (const label of ['[forgot-password] Error:', '[resend-verification] Error:']) {
    await test(`${label} log uses err.name, not raw err.message`, () => {
      const block = extractLogCallBlock(authSource, label);
      assert.ok(
        /err instanceof Error \? err\.name : 'UnknownError'/.test(block),
        'expected inline instanceof-Error name fallback',
      );
      assert.ok(!/\(err as Error\)\.message/.test(block), 'found raw (err as Error).message reference');
    });
  }

  // ── Fix 11 — server/src/routes/clinicRegistration.ts (mail-catch) ───────
  section('Fix 11 — clinicRegistration.ts verification-email send failure (recipient email in SMTP bounce text)');

  const clinicRegistrationSource = readSource('../routes/clinicRegistration.ts');

  await test('[clinic-register] Failed to send verification email log uses emailErr.name, not raw .message', () => {
    const block = extractLogCallBlock(clinicRegistrationSource, '[clinic-register] Failed to send verification email');
    assert.ok(
      /emailErr instanceof Error \? emailErr\.name : 'MailError'/.test(block),
      'expected inline instanceof-Error name fallback',
    );
    assert.ok(!/\(emailErr as Error\)\.message/.test(block), 'found raw (emailErr as Error).message reference');
  });

  // ── Fix 12 — server/src/routes/contactRequests.ts ───────────────────────
  section('Fix 12 — contactRequests.ts list error (user-typed search term embedded in name/phone/note filters)');

  const contactRequestsSource = readSource('../routes/contactRequests.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(contactRequestsSource),
      'expected safeErrorFields import',
    );
  });

  await test('[contact-requests] list error log uses safeErrorFields, not raw err', () => {
    const block = extractLogCallBlock(contactRequestsSource, '[contact-requests] list error');
    assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
    assert.ok(!/list error',\s*err\)/.test(block), 'found raw err argument');
  });

  // ── Fix 13 — server/src/routes/imaging.ts legal-hold (2nd site) ─────────
  section('Fix 13 — imaging.ts legal-hold error (free-text legalHoldReason)');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(imagingSource),
      'expected safeErrorFields import',
    );
  });

  await test('[imaging] legal-hold error log uses safeErrorFields, not raw err.message', () => {
    const block = extractLogCallBlock(imagingSource, '[imaging] legal-hold error');
    assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
    assert.ok(!/err\?\.message/.test(block), 'found raw err?.message reference');
  });

  // ── Fix 14 — server/src/routes/messages.ts ──────────────────────────────
  section('Fix 14 — messages.ts prepare error (rendered message body/subject + recipient phone/email)');

  const messagesSource = readSource('../routes/messages.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(messagesSource),
      'expected safeErrorFields import',
    );
  });

  await test('[messages] prepare error log uses safeErrorFields, not raw error.message', () => {
    const block = extractLogCallBlock(messagesSource, '[messages] prepare error');
    assert.ok(/safeErrorFields\(error\)/.test(block), 'expected safeErrorFields(error) call');
    assert.ok(!/error\?\.message/.test(block), 'found raw error?.message reference');
  });

  // ── Fix 15 — server/src/routes/noShows.ts ───────────────────────────────
  section('Fix 15 — noShows.ts send-message error (recovery WhatsApp message text + patient phone)');

  const noShowsSource = readSource('../routes/noShows.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(noShowsSource),
      'expected safeErrorFields import',
    );
  });

  await test('[NoShows] Send message error log uses safeErrorFields, not raw err', () => {
    const block = extractLogCallBlock(noShowsSource, '[NoShows] Send message error');
    assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
    assert.ok(!/Send message error',\s*err\)/.test(block), 'found raw err argument');
  });

  // ── Fix 16 — server/src/routes/patientEmergencyContacts.ts (2 sites) ────
  section('Fix 16 — patientEmergencyContacts.ts create/update errors (fullName/phone/email/occupation PII)');

  const patientEmergencyContactsSource = readSource('../routes/patientEmergencyContacts.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(patientEmergencyContactsSource),
      'expected safeErrorFields import',
    );
  });

  for (const label of ['[patientEmergencyContacts] create error', '[patientEmergencyContacts] update error']) {
    await test(`${label} log uses safeErrorFields, not raw err.message`, () => {
      const block = extractLogCallBlock(patientEmergencyContactsSource, label);
      assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
      assert.ok(!/err\?\.message/.test(block), 'found raw err?.message reference');
    });
  }

  // ── Fix 17 — server/src/routes/patientPrivacy.ts (4 sites) ──────────────
  section('Fix 17 — patientPrivacy.ts export/anonymize/requests create+status (full patient PII/PHI export, free-text notes/reason)');

  const patientPrivacySource = readSource('../routes/patientPrivacy.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(patientPrivacySource),
      'expected safeErrorFields import',
    );
  });

  for (const label of [
    '[patientPrivacy/export]',
    '[patientPrivacy/anonymize]',
    '[patientPrivacy/requests/create]',
    '[patientPrivacy/requests/status]',
  ]) {
    await test(`${label} log uses safeErrorFields, not raw err.message`, () => {
      const block = extractLogCallBlock(patientPrivacySource, label);
      assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
      assert.ok(!/err\?\.message/.test(block), 'found raw err?.message reference');
    });
  }

  // ── Fix 18 — server/src/routes/patients.ts (4 sites) ────────────────────
  section('Fix 18 — patients.ts check-phone-duplicate/list/create/update (raw phone query arg, search term, full patient PII create/update)');

  const patientsSource = readSource('../routes/patients.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(patientsSource),
      'expected safeErrorFields import',
    );
  });

  for (const label of [
    '[patients] check-phone-duplicate error',
    '[patients] list error',
    '[patients] create error',
    '[patients] update error',
  ]) {
    await test(`${label} log uses safeErrorFields, not raw err.message`, () => {
      const block = extractLogCallBlock(patientsSource, label);
      assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
      assert.ok(!/err\?\.message/.test(block), 'found raw err?.message reference');
    });
  }

  await test('sibling patients.ts sites left untouched (archive/unarchive/get-by-id still use raw err?.message)', () => {
    for (const label of ['[patients] archive error', '[patients] unarchive error', '[patients/:id] error']) {
      const block = extractLogCallBlock(patientsSource, label);
      assert.ok(/err\?\.message\s*\?\?\s*err/.test(block), `${label}: expected the untouched sibling to still use err?.message ?? err`);
    }
  });

  // ── Fix 19 — server/src/routes/patientsImport.ts (2 sites) ──────────────
  section('Fix 19 — patientsImport.ts import-preview/import-confirm errors (bulk patient PII in Excel-import pipeline)');

  const patientsImportSource = readSource('../routes/patientsImport.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(patientsImportSource),
      'expected safeErrorFields import',
    );
  });

  for (const [label, distinguishingLiteral] of [
    ['[patients/import-preview]', '[patients/import-preview]'],
    // '[patients/import-confirm]' alone matches the earlier per-row
    // `rowErr?.code, rowErr?.meta` log first (untouched — Prisma .meta carries only
    // field names, POTENTIAL_PII_SAFE_AFTER_REVIEW) — anchor on the actual catch-all
    // call text to hit the fixed site instead.
    ['[patients/import-confirm]', "'[patients/import-confirm]', safeErrorFields"],
  ] as const) {
    await test(`${label} log uses safeErrorFields, not raw err.message`, () => {
      const block = extractLogCallBlock(patientsImportSource, distinguishingLiteral);
      assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
      assert.ok(!/err\?\.message\)/.test(block), 'found raw err?.message reference');
    });
  }

  // ── Fix 20 — server/src/routes/paymentPlans.ts (2 sites) ────────────────
  section('Fix 20 — paymentPlans.ts create/pay-installment errors (free-text plan description/payment notes)');

  const paymentPlansSource = readSource('../routes/paymentPlans.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(paymentPlansSource),
      'expected safeErrorFields import',
    );
  });

  for (const label of ['Create payment plan error:', 'Pay installment error:']) {
    await test(`${label} log uses safeErrorFields, not raw err`, () => {
      const block = extractLogCallBlock(paymentPlansSource, label);
      assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
      assert.ok(!block.includes(`${label}', err)`), 'found raw err argument (old un-fixed call shape)');
    });
  }

  // ── Fix 21 — server/src/routes/platformExternalCalendar.ts (2 sites) ────
  section('Fix 21 — platformExternalCalendar.ts upsert-config/remote-options errors (raw OAuth client secret / provider HTTP client error.config)');

  const platformExternalCalendarSource = readSource('../routes/platformExternalCalendar.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(platformExternalCalendarSource),
      'expected safeErrorFields import',
    );
  });

  for (const label of [
    '[platform-external-calendar] upsert config failed:',
    '[platform-external-calendar] remote-options failed:',
  ]) {
    await test(`${label} log uses safeErrorFields, not raw err`, () => {
      const block = extractLogCallBlock(platformExternalCalendarSource, label);
      assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
      assert.ok(!/failed:',\s*err\)/.test(block), 'found raw err argument');
    });
  }

  await test('sibling platformExternalCalendar.ts sites left untouched (rotate-webhook-key/upsert-mapping still use raw err)', () => {
    for (const label of ['[platform-external-calendar] rotate webhook key failed:', '[platform-external-calendar] upsert mapping failed:']) {
      const block = extractLogCallBlock(platformExternalCalendarSource, label);
      assert.ok(/failed:',\s*err\)/.test(block), `${label}: expected the untouched sibling to still log raw err`);
    }
  });

  // ── Fix 22 — server/src/routes/recall.ts ────────────────────────────────
  section('Fix 22 — recall.ts candidates error (user-typed search term embedded in patient firstName/lastName/phone filters)');

  const recallSource = readSource('../routes/recall.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(recallSource),
      'expected safeErrorFields import',
    );
  });

  await test('[recall] candidates error log uses safeErrorFields, not raw error.message', () => {
    const block = extractLogCallBlock(recallSource, '[recall] candidates error');
    assert.ok(/safeErrorFields\(error\)/.test(block), 'expected safeErrorFields(error) call');
    assert.ok(!/error\?\.message/.test(block), 'found raw error?.message reference');
  });

  // ── Fix 23 — server/src/routes/sms.ts ───────────────────────────────────
  section('Fix 23 — sms.ts send error (raw SMS message body + patient phone forwarded to provider)');

  const smsSource = readSource('../routes/sms.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(smsSource),
      'expected safeErrorFields import',
    );
  });

  await test('[sms] send error log uses safeErrorFields, not raw error.message', () => {
    const block = extractLogCallBlock(smsSource, '[sms] send error');
    assert.ok(/safeErrorFields\(error\)/.test(block), 'expected safeErrorFields(error) call');
    assert.ok(!/error instanceof Error \? error\.message/.test(block), 'found raw error.message reference');
  });

  // ── Fix 24 — server/src/routes/usersImport.ts (2 sites) ─────────────────
  section('Fix 24 — usersImport.ts import-preview/import-confirm errors (bulk user PII — name/email/phone — in Excel-import pipeline)');

  const usersImportSourceWave2 = readSource('../routes/usersImport.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(usersImportSourceWave2),
      'expected safeErrorFields import',
    );
  });

  for (const [label, distinguishingLiteral] of [
    ['[users/import-preview]', '[users/import-preview]'],
    // '[users/import-confirm]' alone matches the earlier, unrelated invitation-email
    // warn log first (same literal prefix) — anchor on the actual catch-all call text
    // (single-quoted string arg, not the template-literal warn) to hit the right site.
    ['[users/import-confirm]', "'[users/import-confirm]', safeErrorFields"],
  ] as const) {
    await test(`${label} log uses safeErrorFields, not raw err.message`, () => {
      const block = extractLogCallBlock(usersImportSourceWave2, distinguishingLiteral);
      assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
      assert.ok(!/err\?\.message\)/.test(block), 'found raw err?.message reference');
    });
  }

  // ── safeErrorFields behavior sanity check ──────────────────────────────
  section('safeErrorFields — shared helper behavior');

  const { safeErrorFields } = await import('../utils/safeError.js');

  await test('extracts stable name/code and drops raw message content', () => {
    const phiFixture = 'Argument `notes` must not be null. Attempted data: { notes: "Hasta Ayşe Yılmaz - alerji notu" }';
    const err = Object.assign(new Error(phiFixture), { name: 'PrismaClientValidationError', code: 'P2009' });
    const fields = safeErrorFields(err);
    const serialized = JSON.stringify(fields);
    assert.equal(fields.errorName, 'PrismaClientValidationError');
    assert.equal(fields.errorCode, 'P2009');
    assert.ok(!serialized.includes('Ayşe Yılmaz'), 'PHI fixture leaked through safeErrorFields output');
    assert.ok(!serialized.includes(phiFixture), 'raw message leaked through safeErrorFields output');
  });

  await test('F3-IMPL-006: strips a raw patient phone number embedded in a Prisma validation message', () => {
    const phoneFixture = '905551234567';
    const err = Object.assign(
      new Error(`Argument \`phone\` must not be null. Attempted data: { phone: "${phoneFixture}" }`),
      { name: 'PrismaClientValidationError', code: 'P2009' },
    );
    const fields = safeErrorFields(err);
    const serialized = JSON.stringify(fields);
    assert.deepEqual(fields, { errorName: 'PrismaClientValidationError', errorCode: 'P2009' });
    assert.ok(!serialized.includes(phoneFixture), 'raw phone number leaked through safeErrorFields output');
  });

  await test('F3-IMPL-006: strips a raw SMTP bounce message embedding a recipient email address', () => {
    const emailFixture = 'ayse.yilmaz@example.com';
    const err = Object.assign(
      new Error(`Recipient address rejected: User unknown <${emailFixture}>`),
      { name: 'Error', code: 'EENVELOPE' },
    );
    const fields = safeErrorFields(err);
    const serialized = JSON.stringify(fields);
    assert.deepEqual(fields, { errorName: 'Error', errorCode: 'EENVELOPE' });
    assert.ok(!serialized.includes(emailFixture), 'raw recipient email leaked through safeErrorFields output');
  });

  await test('F3-IMPL-006: strips a raw WhatsApp/SMS message body embedded in a provider send-failure message', () => {
    const messageBodyFixture = 'Merhaba Ayşe Hanım, yarın saat 14:00 randevunuz onaylanmıştır.';
    const err = Object.assign(
      new Error(`Provider send failed for body: "${messageBodyFixture}"`),
      { name: 'ProviderSendError', code: 'SEND_FAILED' },
    );
    const fields = safeErrorFields(err);
    const serialized = JSON.stringify(fields);
    assert.deepEqual(fields, { errorName: 'ProviderSendError', errorCode: 'SEND_FAILED' });
    assert.ok(!serialized.includes(messageBodyFixture), 'raw message body leaked through safeErrorFields output');
  });

  await test('F3-IMPL-006: strips a raw OAuth/webhook client secret embedded in a config-validation message', () => {
    const secretFixture = 'sk_live_9f8a7d6c5b4a3210';
    const err = Object.assign(
      new Error(`Argument \`clientSecret\` invalid. Attempted data: { clientSecret: "${secretFixture}" }`),
      { name: 'PrismaClientValidationError', code: 'P2009' },
    );
    const fields = safeErrorFields(err);
    const serialized = JSON.stringify(fields);
    assert.deepEqual(fields, { errorName: 'PrismaClientValidationError', errorCode: 'P2009' });
    assert.ok(!serialized.includes(secretFixture), 'raw client secret leaked through safeErrorFields output');
  });

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
