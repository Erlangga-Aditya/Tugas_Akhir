/**
 * Pemeriksaan READ-ONLY: berapa pesanan yang resinya sudah diterbitkan Shopee
 * tetapi TIDAK punya baris `shipments` di database kita.
 *
 * Inilah bentuk nyata dari bug "Ambil Resi berhasil tetapi resi tidak muncul":
 * `arrangeShipmentForOrder` dulu memanggil `upsertShipment(..., 'LOGISTICS_REQUEST_CREATED')`,
 * yang memetakan status PESANAN — string logistik itu tidak dikenal sehingga
 * fungsi mengembalikan `null` dan TIDAK menulis apa pun.
 *
 * Jalankan: npx tsx scripts/check-resi-persistence.ts
 */
import { prisma } from '../src/shared/infrastructure/prisma';

async function main() {
  const total = await prisma.order.count();
  const withShipment = await prisma.order.count({ where: { shipments: { some: {} } } });
  const awbKosong = await prisma.shipment.count({
    where: { OR: [{ awb: null }, { awb: '' }] },
  });

  const kandidat = await prisma.order.findMany({
    where: {
      status: 'CONFIRMED',
      shipments: { none: {} },
    },
    select: {
      id: true,
      externalOrderId: true,
      externalStatus: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  console.log('=== RINGKASAN ===');
  console.log(`Total pesanan            : ${total}`);
  console.log(`Punya baris shipments    : ${withShipment}`);
  console.log(`Shipment tanpa AWB       : ${awbKosong}`);
  console.log('');
  console.log('=== CONFIRMED TANPA BARIS SHIPMENT (maks 10, terbaru) ===');
  if (kandidat.length === 0) {
    console.log('(tidak ada)');
  }
  for (const o of kandidat) {
    console.log(
      `${o.externalOrderId} | status=${o.status} | shopee=${o.externalStatus ?? '-'} | dibuat ${o.createdAt.toISOString()}`,
    );
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('GAGAL:', err);
  await prisma.$disconnect();
  process.exit(1);
});
