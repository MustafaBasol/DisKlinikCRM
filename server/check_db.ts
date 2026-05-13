import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const patients = await prisma.patient.count();
  const users = await prisma.user.count();
  const appointments = await prisma.appointment.count();
  console.log({ patients, users, appointments });
}
main().finally(() => prisma.$disconnect());
