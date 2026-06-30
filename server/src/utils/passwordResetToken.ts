import crypto from 'crypto';
import prisma from '../db.js';

export const RESET_TOKEN_EXPIRY_MINUTES = 60;

export function generateResetToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, tokenHash };
}

export async function createPasswordResetToken(userId: string): Promise<{ rawToken: string; expiresAt: Date }> {
  await prisma.passwordResetToken.deleteMany({
    where: { userId, usedAt: null },
  });

  const { rawToken, tokenHash } = generateResetToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);

  await prisma.passwordResetToken.create({
    data: { userId, tokenHash, expiresAt },
  });

  return { rawToken, expiresAt };
}
