/**
 * backfill-whatsapp-connections.ts
 *
 * One-time idempotent script: reads the legacy Evolution API env-var config
 * and creates a WhatsAppConnection record + ClinicWhatsAppConnection records
 * for every clinic in the organization.
 *
 * Run once after first deployment to make existing connections visible on
 * the /organization/whatsapp management page.
 *
 * Usage:
 *   cd server
 *   ORGANIZATION_ID=<uuid> npx ts-node --esm src/scripts/backfill-whatsapp-connections.ts
 *
 * Or set ORG_ID in your .env and omit the inline override.
 *
 * Safety:
 *   - Skips creation if a WhatsAppConnection with the same instance name already exists.
 *   - Running multiple times is safe (idempotent).
 *   - Does NOT delete old env-var config — existing flows continue working.
 *   - API key is encrypted with AES-256-GCM before being stored.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createCipheriv, randomBytes } from 'crypto';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

// ── Inline AES-256-GCM encryption (same logic as encryption.ts) ───────────────

function encryptSecret(plaintext: string): string {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY env var must be a 64-char hex string. ' +
        'Generate with: openssl rand -hex 32',
    );
  }
  const key = Buffer.from(hex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + tag.toString('hex') + encrypted.toString('hex');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const apiUrl = process.env.EVOLUTION_API_BASE_URL?.trim();
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME?.trim();

  if (!apiUrl || !apiKey || !instanceName) {
    console.error(
      '❌  Missing env vars. Required: EVOLUTION_API_BASE_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE_NAME',
    );
    process.exit(1);
  }

  // Resolve organization
  const orgIdEnv = process.env.ORGANIZATION_ID?.trim() || process.env.ORG_ID?.trim();
  let organizationId: string;

  if (orgIdEnv) {
    const org = await prisma.organization.findUnique({ where: { id: orgIdEnv } });
    if (!org) {
      console.error(`❌  Organization ${orgIdEnv} not found.`);
      process.exit(1);
    }
    organizationId = org.id;
    console.log(`✔  Using organization: ${org.name} (${org.id})`);
  } else {
    // Auto-detect: find single organization (common for single-tenant deployments)
    const orgs = await prisma.organization.findMany({ take: 2 });
    if (orgs.length === 0) {
      console.error('❌  No organizations found in database.');
      process.exit(1);
    }
    if (orgs.length > 1) {
      console.error(
        '❌  Multiple organizations found. Set ORGANIZATION_ID=<uuid> to specify which one.',
      );
      process.exit(1);
    }
    organizationId = orgs[0].id;
    console.log(`✔  Auto-detected organization: ${orgs[0].name} (${orgs[0].id})`);
  }

  // Idempotency check — skip if same instance name already exists
  const existing = await prisma.whatsAppConnection.findFirst({
    where: { organizationId, evolutionInstanceName: instanceName },
  });
  if (existing) {
    console.log(
      `ℹ️   WhatsAppConnection already exists for instance "${instanceName}" (id: ${existing.id}). Nothing to do.`,
    );
    await prisma.$disconnect();
    return;
  }

  // Get all clinics in organization
  const clinics = await prisma.clinic.findMany({
    where: { organizationId },
    select: { id: true, name: true },
  });
  console.log(`✔  Found ${clinics.length} clinic(s) in organization.`);

  // Get organization name for the connection label
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  const connectionName = `${org?.name ?? 'Ana'} WhatsApp Hattı`;

  // Encrypt the API key
  let encryptedKey: string;
  try {
    encryptedKey = encryptSecret(apiKey);
  } catch (err: any) {
    console.error(`❌  Encryption failed: ${err.message}`);
    process.exit(1);
  }

  // Create WhatsAppConnection record
  const connection = await prisma.whatsAppConnection.create({
    data: {
      organizationId,
      name: connectionName,
      provider: 'evolution_api',
      status: 'connected',
      evolutionApiUrl: apiUrl,
      evolutionInstanceName: instanceName,
      evolutionApiKeyEncrypted: encryptedKey,
      isActive: true,
      lastConnectedAt: new Date(),
    },
  });
  console.log(`✔  Created WhatsAppConnection: "${connection.name}" (id: ${connection.id})`);

  // Link to all clinics
  if (clinics.length > 0) {
    await prisma.clinicWhatsAppConnection.createMany({
      data: clinics.map((c) => ({
        organizationId,
        clinicId: c.id,
        whatsappConnectionId: connection.id,
        isDefault: true,
      })),
      skipDuplicates: true,
    });
    console.log(
      `✔  Linked connection to ${clinics.length} clinic(s): ${clinics.map((c) => c.name).join(', ')}`,
    );
  }

  console.log('\n✅  Backfill complete. The connection will now appear on /organization/whatsapp.\n');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('❌  Backfill failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
