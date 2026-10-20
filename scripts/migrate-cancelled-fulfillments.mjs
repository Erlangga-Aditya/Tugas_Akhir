/**
 * Migrasi satu kali (15 Okt 2026): menandai baris fulfillment order yang
 * nyangkut di WAITING_STOCK padahal pesanannya sudah dibatalkan.
 *
 * Sebelumnya, saat pesanan dibatalkan di Shopee, hanya reservasi stoknya yang
 * dilepas — baris fulfillment-nya dibiarkan diam. Akibatnya dashboard
 * melaporkan 106 pesanan "menunggu stok" padahal yang relevan hanya 41
 * (65 sisanya milik pesanan yang sudah batal dan tidak akan pernah dipenuhi).
 *
 * Setelah migrasi ini, kode aplikasi menangani kasus ini sendiri lewat
 * `markFulfillmentOrdersException` di importOrder, jadi script ini hanya
 * untuk membersihkan data lama. Aman dijalankan berulang (idempoten).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.fulfillmentOrder.findMany({
    where: { status: 'WAITING_STOCK', order: { status: 'CANCELLED' } },
    select: { id: true, status: true, orderId: true },
  });
  console.log('baris WAITING_STOCK milik pesanan dibatalkan:', rows.length);
  if (rows.length === 0) return;

  let updated = 0;
  for (const fo of rows) {
    const r = await prisma.fulfillmentOrder.updateMany({
      where: { id: fo.id, status: 'WAITING_STOCK' },
      data: { status: 'EXCEPTION' },
    });
    updated += r.count;
  }
  console.log('ditandai EXCEPTION:', updated);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
