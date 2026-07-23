import prisma from '../db.js';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * `client` defaults to the global `prisma` singleton; pass a
 * Prisma.TransactionClient to read the CURRENT value from inside a caller's
 * larger transaction (e.g. to make a "read previous value, then write new
 * value" sequence part of one atomic, lock-ordered operation instead of a
 * separate pre-transaction snapshot).
 */
export async function getPlatformSetting(
  key: string,
  client: Pick<PrismaClient, 'platformSetting'> | Prisma.TransactionClient = prisma,
): Promise<string | null> {
  const row = await client.platformSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

/**
 * `client` defaults to the global `prisma` singleton; pass a
 * Prisma.TransactionClient to make this upsert part of a caller's larger
 * transaction (e.g. so a durable audit insert next to it is atomic with it).
 */
export async function setPlatformSetting(
  key: string,
  value: string,
  client: Pick<PrismaClient, 'platformSetting'> | Prisma.TransactionClient = prisma,
): Promise<void> {
  await client.platformSetting.upsert({
    where: { key },
    update: { value, updatedAt: new Date() },
    create: { key, value },
  });
}

/**
 * Remove a platform setting so callers can restore its true default/absent
 * state. Pass a Prisma.TransactionClient when the deletion must be atomic
 * with a durable audit insert.
 */
export async function unsetPlatformSetting(
  key: string,
  client: Pick<PrismaClient, 'platformSetting'> | Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const result = await client.platformSetting.deleteMany({
    where: { key },
  });

  return result.count > 0;
}
