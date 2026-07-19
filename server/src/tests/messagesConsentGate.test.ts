/**
 * messagesConsentGate.test.ts — KVKK-HIGH-007 consent-context test for the
 * generic WhatsApp dispatch path, POST /api/messages/:id/send.
 *
 * Discovery found this was the one wired-in gap among the app's WhatsApp
 * senders: this shared dispatch endpoint (manual composer + recall-drafted
 * messages) called sendWhatsAppMessage with zero consent context of any
 * generation. This file proves the fix: the central decision service is
 * consulted before dispatch, template purpose is mapped correctly, and
 * enforcementMode governs blocking exactly like every other WhatsApp sender.
 *
 * Uses the same router-stack-extraction pattern as
 * communicationPreferencesRoute.test.ts (no supertest in this repo).
 *
 * Run with: tsx src/tests/messagesConsentGate.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../db.js';
import messagesRouter from '../routes/messages.js';
import { setCommunicationPreference } from '../services/communicationConsent/communicationConsentAdmin.js';
import { EvolutionWhatsAppProvider } from '../services/whatsapp/EvolutionWhatsAppProvider.js';
import type { SendMessageResult } from '../services/whatsapp/WhatsAppProvider.js';
import type { AuthRequest } from '../middleware/auth.js';
import type { Response } from 'express';

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

function section(title: string) { console.log(`\n${title}`); }

type RouterLike = { stack: Array<any> };
function getRouteHandler(router: RouterLike, method: 'get' | 'put' | 'post', path: string): (req: AuthRequest, res: Response) => Promise<void> {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods?.[method]) {
      const stack = layer.route.stack;
      return stack[stack.length - 1].handle;
    }
  }
  throw new Error(`No route handler found for ${method.toUpperCase()} ${path}`);
}

function mockResponse(): Response & { statusCode: number; body: any } {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

function authRequest(overrides: Partial<NonNullable<AuthRequest['user']>>, params: Record<string, string>): AuthRequest {
  return {
    params, query: {}, body: {},
    user: {
      id: randomUUID(), clinicId: overrides.clinicId ?? '', role: 'OWNER', normalizedRole: 'OWNER',
      organizationId: '', allowedClinicIds: [], canAccessAllClinics: true, ...overrides,
    },
  } as unknown as AuthRequest;
}

function spyOnEvolutionSendMessage(impl: () => Promise<SendMessageResult>) {
  const original = EvolutionWhatsAppProvider.prototype.sendMessage;
  let callCount = 0;
  EvolutionWhatsAppProvider.prototype.sendMessage = (async () => { callCount++; return impl(); }) as typeof EvolutionWhatsAppProvider.prototype.sendMessage;
  return { calls: () => callCount, restore: () => { EvolutionWhatsAppProvider.prototype.sendMessage = original; } };
}

type Fixture = { organizationId: string; clinicId: string; patientId: string; userId: string };
const createdOrgIds: string[] = [];

async function createFixture(withConnection = false): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: `Messages Consent Test Org ${suffix}`, slug: `msg-consent-${suffix}` } });
  const clinic = await prisma.clinic.create({ data: { name: 'Test Clinic', slug: `msg-consent-clinic-${suffix}`, organizationId: org.id } });
  const patient = await prisma.patient.create({
    data: { firstName: 'Test', lastName: 'Patient', clinicId: clinic.id, organizationId: org.id, phone: '+905559990000' },
  });
  const user = await prisma.user.create({
    data: {
      clinicId: clinic.id, organizationId: org.id, firstName: 'Test', lastName: 'Staff',
      email: `staff-${suffix}@test.invalid`, role: 'OWNER', passwordHash: 'x', canAccessAllClinics: true,
    },
  });
  createdOrgIds.push(org.id);
  if (withConnection) {
    const connection = await prisma.whatsAppConnection.create({
      data: {
        organizationId: org.id, name: `Conn ${suffix}`, provider: 'evolution_api', status: 'connected',
        evolutionApiUrl: 'http://evo.invalid', evolutionInstanceName: `inst-${suffix}`,
        evolutionApiKeyEncrypted: 'raw-key', isActive: true,
      },
    });
    await prisma.clinicWhatsAppConnection.create({
      data: { organizationId: org.id, clinicId: clinic.id, whatsappConnectionId: connection.id, isDefault: true },
    });
  }
  return { organizationId: org.id, clinicId: clinic.id, patientId: patient.id, userId: user.id };
}

async function createSentMessage(fx: Fixture, opts: { channel: string; templateId?: string | null }) {
  return prisma.sentMessage.create({
    data: {
      clinicId: fx.clinicId, patientId: fx.patientId, channel: opts.channel, recipient: '+905559990000',
      body: 'Test message body', status: 'prepared', templateId: opts.templateId ?? null,
    },
  });
}

async function createTemplate(fx: Fixture, purpose: string) {
  return prisma.messageTemplate.create({
    data: {
      clinicId: fx.clinicId, name: `Template ${purpose}`, channel: 'whatsapp', body: 'Hello {{patient_name}}',
      language: 'tr', purpose, isActive: true,
    },
  });
}

async function cleanup() {
  if (createdOrgIds.length === 0) return;
  await prisma.activityLog.deleteMany({ where: { clinic: { organizationId: { in: createdOrgIds } } } });
  await prisma.sentMessage.deleteMany({ where: { clinic: { organizationId: { in: createdOrgIds } } } });
  await prisma.messageTemplate.deleteMany({ where: { clinic: { organizationId: { in: createdOrgIds } } } });
  await prisma.patientCommunicationConsentEvent.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patientCommunicationPreference.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.clinicWhatsAppConnection.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.whatsAppConnection.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patient.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.clinic.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
}

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) prev[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const ENFORCE = { COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: 'true', COMMUNICATION_CONSENT_ENFORCEMENT_MODE: 'enforce' };
const DISABLED = { COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: undefined, COMMUNICATION_CONSENT_ENFORCEMENT_MODE: undefined };

async function main() {
  section('POST /messages/:id/send — WhatsApp consent gate (the fixed gap)');

  await test('enforce mode + no template + no central row → blocked_by_consent, provider never called', async () => {
    const fx = await createFixture(true);
    const message = await createSentMessage(fx, { channel: 'whatsapp' });
    const spy = spyOnEvolutionSendMessage(async () => ({ success: true, externalMessageId: 'x' }));
    try {
      await withEnv(ENFORCE, async () => {
        const handler = getRouteHandler(messagesRouter, 'post', '/messages/:id/send');
        const req = authRequest({ id: fx.userId, organizationId: fx.organizationId, clinicId: fx.clinicId, allowedClinicIds: [fx.clinicId] }, { id: message.id });
        const res = mockResponse();
        await handler(req, res);
        assert.equal(res.statusCode, 403);
        assert.equal(res.body.code, 'consent_blocked');
      });
      assert.equal(spy.calls(), 0, 'provider must never be called once consent blocks the send');
      const updated = await prisma.sentMessage.findUniqueOrThrow({ where: { id: message.id } });
      assert.equal(updated.status, 'blocked_by_consent');
    } finally {
      spy.restore();
    }
  });

  await test('enforce mode + marketing template + no central grant → blocked (mapped to marketing purpose, not operational)', async () => {
    const fx = await createFixture(true);
    const template = await createTemplate(fx, 'marketing');
    const message = await createSentMessage(fx, { channel: 'whatsapp', templateId: template.id });
    const spy = spyOnEvolutionSendMessage(async () => ({ success: true, externalMessageId: 'x' }));
    try {
      // Grant only 'operational' — a marketing-mapped template must NOT be
      // let through by an unrelated operational grant, proving the purpose
      // map actually distinguishes them.
      await setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'whatsapp', purpose: 'operational', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record', notes: 'x',
      });
      await withEnv(ENFORCE, async () => {
        const handler = getRouteHandler(messagesRouter, 'post', '/messages/:id/send');
        const req = authRequest({ id: fx.userId, organizationId: fx.organizationId, clinicId: fx.clinicId, allowedClinicIds: [fx.clinicId] }, { id: message.id });
        const res = mockResponse();
        await handler(req, res);
        assert.equal(res.statusCode, 403);
      });
      assert.equal(spy.calls(), 0);
    } finally {
      spy.restore();
    }
  });

  await test('enforce mode + marketing template + explicit marketing grant → allowed, provider called', async () => {
    const fx = await createFixture(true);
    const template = await createTemplate(fx, 'marketing');
    const message = await createSentMessage(fx, { channel: 'whatsapp', templateId: template.id });
    const spy = spyOnEvolutionSendMessage(async () => ({ success: true, externalMessageId: 'ext-1' }));
    try {
      await setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'whatsapp', purpose: 'marketing', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record', notes: 'x',
      });
      await withEnv(ENFORCE, async () => {
        const handler = getRouteHandler(messagesRouter, 'post', '/messages/:id/send');
        const req = authRequest({ id: fx.userId, organizationId: fx.organizationId, clinicId: fx.clinicId, allowedClinicIds: [fx.clinicId] }, { id: message.id });
        const res = mockResponse();
        await handler(req, res);
        assert.equal(res.statusCode, 200);
      });
      assert.equal(spy.calls(), 1);
      const updated = await prisma.sentMessage.findUniqueOrThrow({ where: { id: message.id } });
      assert.equal(updated.status, 'sent');
    } finally {
      spy.restore();
    }
  });

  await test('disabled mode (production default) → never blocks, provider called (zero behavior change)', async () => {
    const fx = await createFixture(true);
    const message = await createSentMessage(fx, { channel: 'whatsapp' });
    const spy = spyOnEvolutionSendMessage(async () => ({ success: true, externalMessageId: 'ext-2' }));
    try {
      await withEnv(DISABLED, async () => {
        const handler = getRouteHandler(messagesRouter, 'post', '/messages/:id/send');
        const req = authRequest({ id: fx.userId, organizationId: fx.organizationId, clinicId: fx.clinicId, allowedClinicIds: [fx.clinicId] }, { id: message.id });
        const res = mockResponse();
        await handler(req, res);
        assert.equal(res.statusCode, 200);
      });
      assert.equal(spy.calls(), 1);
    } finally {
      spy.restore();
    }
  });

  await cleanup();
  await prisma.$disconnect();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exitCode = 1;
});
