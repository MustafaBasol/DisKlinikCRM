import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});
async function main() {
  const patients = await prisma.patient.count();
  const users = await prisma.user.count();
  const appointments = await prisma.appointment.count();
  console.log({ patients, users, appointments });
}
main().finally(() => prisma.$disconnect());
