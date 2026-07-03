/**
 * smsModule.test.ts — Tests for the SMS add-on module foundation.
 *
 * Covers:
 *  1. Phone normalization + Turkey/Europe region routing (pure functions)
 *  2. Consent rules — opt-out, marketing consent, communication consent
 *  3. Template variable validation + rendering
 *  4. Opt-out keyword parsing (STOP / RET / IPTAL / UNSUBSCRIBE)
 *  5. Provider registry + mock provider flow (success/failure/unknown)
 *  6. Schema validation for the SMS zod schemas
 *  7. Source regression checks — entitlement is explicit-true, quota is
 *     atomic, routes are role-protected, messages.ts routes SMS through the
 *     pipeline, index.ts registers the routes, Prisma models exist
 *
 * Run with: tsx src/tests/smsModule.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
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

function src(relPath: string) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

// ─── Imports ──────────────────────────────────────────────────────────────────

import { normalizeSmsPhone, resolveSmsRegion } from '../services/sms/smsRouting.js';
import {
  evaluateSmsConsent,
  findUnresolvedVariables,
  renderSmsBody,
  isSmsOptOutKeyword,
  SMS_PURPOSES,
} from '../services/sms/smsTemplating.js';
import { getSmsProvider, AVAILABLE_SMS_PROVIDERS } from '../services/sms/smsProviders.js';
import { smsSendSchema, platformSmsProviderSchema, MESSAGE_TEMPLATE_PURPOSES } from '../schemas/index.js';
import {
  sanitizePlatformSmsProvider,
  encryptProviderCredentials,
  runPlatformSmsProviderTest,
} from '../services/sms/platformSmsProviders.js';

// ─── Run tests ────────────────────────────────────────────────────────────────

async function main() {

  // ── Phone normalization + routing ──────────────────────────────────────────
  section('Phone normalization and region routing');

  await test('normalizes +90 international format', () => {
    assert.equal(normalizeSmsPhone('+90 532 123 45 67'), '+905321234567');
  });

  await test('normalizes 00-prefixed international format', () => {
    assert.equal(normalizeSmsPhone('0049 171 1234567'), '+491711234567');
  });

  await test('normalizes Turkish local mobile format 05XX', () => {
    assert.equal(normalizeSmsPhone('0532 123 45 67'), '+905321234567');
  });

  await test('rejects empty/too-short numbers', () => {
    assert.equal(normalizeSmsPhone(''), null);
    assert.equal(normalizeSmsPhone(null), null);
    assert.equal(normalizeSmsPhone('12345'), null);
  });

  await test('Turkish number routes to tr region', () => {
    assert.equal(resolveSmsRegion('+905321234567'), 'tr');
  });

  await test('German number routes to eu region', () => {
    assert.equal(resolveSmsRegion('+491711234567'), 'eu');
  });

  await test('French number routes to eu region', () => {
    assert.equal(resolveSmsRegion('+33612345678'), 'eu');
  });

  await test('longest dial code wins (+354 Iceland is eu, not misparsed)', () => {
    assert.equal(resolveSmsRegion('+3546901234'), 'eu');
  });

  await test('US number is unsupported', () => {
    assert.equal(resolveSmsRegion('+15551234567'), 'unsupported');
  });

  await test('UAE number is unsupported', () => {
    assert.equal(resolveSmsRegion('+971501234567'), 'unsupported');
  });

  // ── Consent rules ───────────────────────────────────────────────────────────
  section('Consent rules');

  const consented = { smsOptOut: false, communicationConsent: true, marketingConsent: false };

  await test('opt-out blocks every purpose', () => {
    for (const purpose of SMS_PURPOSES) {
      const result = evaluateSmsConsent({
        purpose,
        patient: { ...consented, smsOptOut: true, marketingConsent: true },
      });
      assert.equal(result.allowed, false, `purpose ${purpose} must be blocked by opt-out`);
      assert.equal((result as { reason: string }).reason, 'sms_opt_out');
    }
  });

  await test('marketing requires explicit marketing consent', () => {
    const blocked = evaluateSmsConsent({ purpose: 'marketing', patient: consented });
    assert.equal(blocked.allowed, false);
    assert.equal((blocked as { reason: string }).reason, 'missing_marketing_consent');

    const allowed = evaluateSmsConsent({
      purpose: 'marketing',
      patient: { ...consented, marketingConsent: true },
    });
    assert.equal(allowed.allowed, true);
  });

  await test('transactional purposes require communication consent', () => {
    const blocked = evaluateSmsConsent({
      purpose: 'appointment_reminder',
      patient: { ...consented, communicationConsent: false },
    });
    assert.equal(blocked.allowed, false);
    assert.equal((blocked as { reason: string }).reason, 'missing_communication_consent');

    const allowed = evaluateSmsConsent({ purpose: 'appointment_reminder', patient: consented });
    assert.equal(allowed.allowed, true);
  });

  // ── Template variables ──────────────────────────────────────────────────────
  section('Template variable validation');

  await test('findUnresolvedVariables detects leftover placeholders', () => {
    assert.deepEqual(
      findUnresolvedVariables('Hello {{patient_name}}, see you at {{ appointment_time }}'),
      ['patient_name', 'appointment_time'],
    );
    assert.deepEqual(findUnresolvedVariables('Plain text, no variables'), []);
  });

  await test('renderSmsBody fills known variables and leaves missing ones unresolved', async () => {
    const rendered = await renderSmsBody(
      'Hi {{patient_name}}, your visit at {{clinic_name}} on {{appointment_date}}',
      { patient: { firstName: 'Ali', lastName: 'Veli' }, clinic: null, appointment: null },
    );
    assert.ok(rendered.includes('Ali Veli'));
    const unresolved = findUnresolvedVariables(rendered);
    assert.deepEqual(unresolved.sort(), ['appointment_date', 'clinic_name']);
  });

  // ── Opt-out keywords ────────────────────────────────────────────────────────
  section('Opt-out keywords');

  await test('recognizes STOP / RET / IPTAL / UNSUBSCRIBE in any case', () => {
    for (const kw of ['STOP', 'stop', ' Ret ', 'iptal', 'İPTAL', 'Unsubscribe']) {
      assert.equal(isSmsOptOutKeyword(kw), true, `expected '${kw}' to be an opt-out keyword`);
    }
  });

  await test('normal replies are not treated as opt-out', () => {
    for (const text of ['Merhaba', 'stop it please', 'randevu iptal etmek istiyorum', '', null]) {
      assert.equal(isSmsOptOutKeyword(text), false, `'${text}' must not opt out`);
    }
  });

  // ── Provider registry ───────────────────────────────────────────────────────
  section('Provider registry and mock flow');

  await test('Turkey and Europe mock providers are registered', () => {
    assert.ok(getSmsProvider('mock_turkey'));
    assert.ok(getSmsProvider('mock_europe'));
    assert.ok(AVAILABLE_SMS_PROVIDERS.tr.includes('mock_turkey'));
    assert.ok(AVAILABLE_SMS_PROVIDERS.eu.includes('mock_europe'));
  });

  await test('unknown provider key fails safely (null, no throw)', () => {
    assert.equal(getSmsProvider('nonexistent_provider'), null);
    assert.equal(getSmsProvider(null), null);
    assert.equal(getSmsProvider(undefined), null);
  });

  await test('mock provider sends successfully with external id', async () => {
    const provider = getSmsProvider('mock_turkey')!;
    const result = await provider.sendSms({ phone: '+905321234567', text: 'Test' }, null);
    assert.equal(result.success, true);
    assert.ok(result.externalMessageId?.startsWith('mock_turkey-'));
  });

  await test('mock provider failure path via simulateFailure config', async () => {
    const provider = getSmsProvider('mock_europe')!;
    const result = await provider.sendSms(
      { phone: '+491711234567', text: 'Test' },
      { simulateFailure: true },
    );
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  await test('mock provider rejects empty text', async () => {
    const provider = getSmsProvider('mock_turkey')!;
    const result = await provider.sendSms({ phone: '+905321234567', text: '   ' }, null);
    assert.equal(result.success, false);
  });

  // ── Zod schemas ─────────────────────────────────────────────────────────────
  section('Schema validation');

  await test('smsSendSchema requires body or templateId', () => {
    assert.equal(smsSendSchema.safeParse({ patientId: 'p1' }).success, false);
    assert.equal(smsSendSchema.safeParse({ patientId: 'p1', body: 'Hello' }).success, true);
    assert.equal(smsSendSchema.safeParse({ patientId: 'p1', templateId: 't1' }).success, true);
  });

  await test('smsSendSchema accepts non-UUID ids (demo/prod ids are not UUIDs)', () => {
    const result = smsSendSchema.safeParse({ patientId: 'demo-patient-1', body: 'Hi' });
    assert.equal(result.success, true);
  });

  await test('smsSendSchema rejects unknown purpose', () => {
    const result = smsSendSchema.safeParse({ patientId: 'p1', body: 'Hi', purpose: 'spam' });
    assert.equal(result.success, false);
  });

  await test('message template purposes include cancellation/reschedule/marketing', () => {
    for (const p of ['appointment_cancellation', 'appointment_reschedule', 'marketing']) {
      assert.ok((MESSAGE_TEMPLATE_PURPOSES as readonly string[]).includes(p), `missing purpose ${p}`);
    }
  });

  // ── Source regression checks ────────────────────────────────────────────────
  section('Source regression checks');

  const entitlementSrc = src('../services/sms/smsEntitlement.ts');
  const routesSrc = src('../routes/sms.ts');
  const messagesSrc = src('../routes/messages.ts');
  const indexSrc = src('../index.ts');
  const schemaSrc = readFileSync(fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)), 'utf8');
  const serviceSrc = src('../services/sms/smsService.ts');

  await test('entitlement requires features.sms === true (add-on off by default)', () => {
    assert.ok(entitlementSrc.includes('.sms === true'),
      'plan feature check must require explicit true, not treat missing key as enabled');
  });

  await test('quota reservation uses a guarded atomic increment', () => {
    assert.ok(entitlementSrc.includes('sentCount: { lt: monthlyQuota }'),
      'reserveSmsQuotaSlot must guard the increment with sentCount < quota');
  });

  await test('SMS settings routes exclude DENTIST/ASSISTANT/RECEPTIONIST from management', () => {
    assert.ok(routesSrc.includes("const SETTINGS_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER']"));
    assert.ok(!/SETTINGS_ROLES = \[[^\]]*DENTIST/.test(routesSrc));
  });

  await test('BILLING can read usage but is not in send/settings roles', () => {
    assert.ok(routesSrc.includes("USAGE_ROLES = [...SETTINGS_ROLES, 'BILLING']"));
    assert.ok(!routesSrc.includes("SEND_ROLES = [...SETTINGS_ROLES, 'BILLING'"));
  });

  await test('all SMS routes are wrapped with authorize()', () => {
    const routeDefs = routesSrc.match(/router\.(get|put|post)\('\/sms\/[^']+',\s*([^,]+),/g) ?? [];
    assert.ok(routeDefs.length >= 4, `expected at least 4 sms routes, found ${routeDefs.length}`);
    for (const def of routeDefs) {
      assert.ok(def.includes('authorize('), `route missing authorize(): ${def}`);
    }
  });

  await test('clinics cannot write provider/sender settings — no PUT /sms/settings route', () => {
    assert.ok(!routesSrc.includes("router.put('/sms/settings'"),
      'clinic-facing SMS routes must not expose a provider/sender settings write endpoint');
    assert.ok(!routesSrc.includes('senderName') && !routesSrc.includes('turkeyProviderConfig'),
      'clinic-facing sms.ts must not read/write provider credential fields');
  });

  await test('clinic SMS status payload exposes read-only region availability, not provider identity', () => {
    assert.ok(routesSrc.includes('regions:'), 'buildStatusPayload must expose read-only region availability');
    assert.ok(!routesSrc.includes('availableProviders'), 'clinic status payload must not list provider keys');
  });

  await test('messages/:id/send routes SMS through sendClinicSms (no silent fake-send)', () => {
    assert.ok(messagesSrc.includes("message.channel === 'sms'"));
    assert.ok(messagesSrc.includes('sendClinicSms('));
  });

  await test('sms routes are registered in index.ts behind authenticate', () => {
    assert.ok(indexSrc.includes("import smsRoutes from './routes/sms.js'"));
    const authIdx = indexSrc.indexOf("app.use('/api', authenticate");
    const smsIdx = indexSrc.indexOf("app.use('/api', smsRoutes)");
    assert.ok(authIdx > -1 && smsIdx > authIdx, 'smsRoutes must be mounted after the authenticate middleware');
  });

  await test('Prisma schema contains the SMS module models and opt-out fields', () => {
    for (const needle of ['model ClinicSmsSettings', 'model SmsMessage', 'model SmsUsageCounter', 'smsOptOut']) {
      assert.ok(schemaSrc.includes(needle), `schema missing: ${needle}`);
    }
  });

  await test('send pipeline records blocked attempts (quota/consent/region/template)', () => {
    for (const status of ['blocked_quota', 'blocked_consent', 'blocked_region', 'blocked_template']) {
      assert.ok(serviceSrc.includes(`'${status}'`), `smsService missing history status ${status}`);
    }
  });

  await test('quota slot is released when the provider send fails', () => {
    assert.ok(serviceSrc.includes('releaseQuota'), 'failed sends must not consume quota');
  });

  // ── Platform SMS providers (central provider config) ───────────────────────
  section('Platform SMS provider management');

  process.env.ENCRYPTION_KEY = 'e'.repeat(64);

  await test('platformSmsProviderSchema accepts a valid payload', () => {
    const parsed = platformSmsProviderSchema.safeParse({
      region: 'tr', providerCode: 'netgsm', displayName: 'NetGSM',
      isActive: true, isDefault: true, senderName: 'NORAMEDI',
      credentials: { username: 'u', password: 'p' },
    });
    assert.ok(parsed.success);
  });

  await test('platformSmsProviderSchema rejects unknown region and bad provider code', () => {
    assert.equal(platformSmsProviderSchema.safeParse({ region: 'us', providerCode: 'x', displayName: 'X' }).success, false);
    assert.equal(platformSmsProviderSchema.safeParse({ region: 'tr', providerCode: 'Bad Code!', displayName: 'X' }).success, false);
  });

  await test('sanitizePlatformSmsProvider never exposes stored credentials', () => {
    const row = {
      id: '1', region: 'tr', providerCode: 'netgsm', displayName: 'NetGSM',
      isActive: true, isDefault: true, senderName: null,
      credentials: { __encrypted: 'deadbeef' },
      lastTestedAt: null, lastTestOk: null, lastTestError: null, updatedAt: new Date(),
    };
    const sanitized = sanitizePlatformSmsProvider(row);
    assert.equal((sanitized as Record<string, unknown>).credentials, undefined);
    assert.equal(sanitized.credentialsConfigured, true);
    assert.ok(!JSON.stringify(sanitized).includes('deadbeef'));
    assert.equal(sanitizePlatformSmsProvider({ ...row, credentials: null }).credentialsConfigured, false);
  });

  await test('encryptProviderCredentials encrypts values and drops empty objects', () => {
    assert.equal(encryptProviderCredentials(null), null);
    assert.equal(encryptProviderCredentials({}), null);
    const encrypted = encryptProviderCredentials({ apiKey: 'super-secret-key' });
    assert.ok(encrypted && typeof encrypted.__encrypted === 'string');
    assert.ok(!JSON.stringify(encrypted).includes('super-secret-key'));
  });

  await test('provider test succeeds in mock mode with encrypted credentials', async () => {
    const result = await runPlatformSmsProviderTest({
      providerCode: 'mock_turkey',
      credentials: encryptProviderCredentials({ apiKey: 'k' }),
    });
    assert.deepEqual(result, { ok: true, error: null });
  });

  await test('provider test fails safely for an unregistered adapter', async () => {
    const result = await runPlatformSmsProviderTest({ providerCode: 'netgsm', credentials: null });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes('netgsm'));
  });

  await test('provider test surfaces simulated failures (mock failure hook)', async () => {
    const result = await runPlatformSmsProviderTest({
      providerCode: 'mock_europe',
      credentials: encryptProviderCredentials({ simulateFailure: true }),
    });
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  await test('platform admin routes manage sms providers and sanitize responses', () => {
    const platformAdminSrc = src('../routes/platformAdmin.ts');
    for (const needle of [
      "router.get('/sms-providers'",
      "router.put('/sms-providers'",
      "router.post('/sms-providers/:id/test'",
      "router.delete('/sms-providers/:id'",
      'sanitizePlatformSmsProvider',
      'platformSmsProviderSchema',
    ]) {
      assert.ok(platformAdminSrc.includes(needle), `platformAdmin.ts missing: ${needle}`);
    }
  });

  await test('send pipeline falls back to the platform provider for the region', () => {
    assert.ok(serviceSrc.includes('getPlatformProvider'), 'smsService must consult platform providers');
  });

  await test('Prisma schema contains the PlatformSmsProvider model', () => {
    assert.ok(schemaSrc.includes('model PlatformSmsProvider'));
  });

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
