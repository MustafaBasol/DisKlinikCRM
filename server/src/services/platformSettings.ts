import prisma from '../db.js';
import type { Prisma, PrismaClient } from '@prisma/client';

export async function getPlatformSetting(key: string): Promise<string | null> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
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
