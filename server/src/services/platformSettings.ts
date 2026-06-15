import prisma from '../db.js';

export async function getPlatformSetting(key: string): Promise<string | null> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setPlatformSetting(key: string, value: string): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key },
    update: { value, updatedAt: new Date() },
    create: { key, value },
  });
}
