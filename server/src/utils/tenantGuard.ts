import { PrismaClient } from '@prisma/client';

/**
 * Belirtilen entity'nin kliniğe ait olduğunu doğrular.
 * Eşleşmiyorsa null döner (404 olarak handle edilmeli).
 */
export async function findOwnedOrNull<T>(
  model: { findFirst: (args: any) => Promise<T | null> },
  id: string,
  clinicId: string,
  include?: object,
): Promise<T | null> {
  return model.findFirst({ where: { id, clinicId }, include });
}

/**
 * İlişkili entity'nin klinik sahipliğini doğrular.
 * Örneğin: appointmentId ile patient'ın aynı kliniğe ait olduğunu kontrol et.
 */
export async function verifyClinicOwnership(
  prisma: PrismaClient,
  entityType: 'patient' | 'appointment' | 'treatmentCase' | 'user',
  id: string,
  clinicId: string,
): Promise<boolean> {
  const modelMap = {
    patient: (prisma as any).patient,
    appointment: (prisma as any).appointment,
    treatmentCase: (prisma as any).treatmentCase,
    user: (prisma as any).user,
  };

  const model = modelMap[entityType];
  if (!model) return false;

  const record = await model.findFirst({ where: { id, clinicId } });
  return !!record;
}
