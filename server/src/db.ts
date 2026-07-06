import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Havuz boyutu ortamdan ayarlanabilir; pg varsayılanı 10 bağlantıdır ve
// eşzamanlı yük altında (çok klinik online) havuz tükenmesine yol açar.
// connectionTimeoutMillis: havuzdan bağlantı bekleyen istek bu süre sonunda
// sonsuza kadar askıda kalmak yerine hata alır.
const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
    max: parsePositiveInt(process.env.DB_POOL_MAX, 10),
    connectionTimeoutMillis: parsePositiveInt(process.env.DB_POOL_CONNECT_TIMEOUT_MS, 10_000),
    idleTimeoutMillis: parsePositiveInt(process.env.DB_POOL_IDLE_TIMEOUT_MS, 30_000),
  }),
});

export default prisma;
