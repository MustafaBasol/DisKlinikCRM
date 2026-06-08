import prisma from '../db.js';

type PrismaLike = {
  inventoryItem: typeof prisma.inventoryItem;
  notification?: typeof prisma.notification;
};

// Creates or refreshes the low-stock notification after any stock deduction.
export async function checkAndNotifyLowStock(
  clinicId: string,
  itemId: string,
  client: PrismaLike = prisma,
) {
  try {
    const item = await client.inventoryItem.findFirst({ where: { id: itemId, clinicId } });
    if (!item || item.minimumStock <= 0 || item.currentStock > item.minimumStock) return;

    const notificationClient = client.notification ?? prisma.notification;
    await notificationClient.upsert({
      where: { clinicId_externalId: { clinicId, externalId: `lowstock-${itemId}` } },
      create: {
        clinicId,
        externalId: `lowstock-${itemId}`,
        type: 'low_stock',
        title: `Dusuk stok: ${item.name}`,
        subtitle: `Mevcut: ${item.currentStock} ${item.unit} (Min: ${item.minimumStock})`,
        link: '/inventory',
        isRead: false,
      },
      update: {
        isRead: false,
        subtitle: `Mevcut: ${item.currentStock} ${item.unit} (Min: ${item.minimumStock})`,
      },
    });
  } catch {
    // Stock deduction must not fail because notification storage is unavailable.
  }
}
