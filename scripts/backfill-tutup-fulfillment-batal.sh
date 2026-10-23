#!/usr/bin/env bash
# Backfill sekali jalan (crash-safe per pesanan): tutup fulfillmentOrder yang
# masih "menunggu stok" padahal pesanannya sudah batal di Shopee, + lepas
# reservasi stok yang tersisa. Anomali produksi 2026-10-22.
set -uo pipefail
cd /opt/efulfill/app
node -e "
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const orders = await p.order.findMany({
    where: { status: 'CANCELLED' },
    select: { id: true, tenantId: true, externalOrderId: true },
  });
  let marked = 0, released = 0, gagal = 0;
  for (const o of orders) {
    try {
      const res = await p.fulfillmentOrder.updateMany({
        where: { orderId: o.id, status: { notIn: ['COMPLETED', 'EXCEPTION'] } },
        data: { status: 'EXCEPTION' },
      });
      if (res.count > 0) {
        marked += res.count;
        console.log('FO->EXCEPTION', o.externalOrderId, res.count);
      }
      const aktif = await p.stockReservation.findMany({
        where: { orderItem: { orderId: o.id }, status: 'ACTIVE' },
        select: { id: true, warehouseId: true, variantId: true, quantity: true },
      });
      for (const r of aktif) {
        try {
          await p.stockReservation.update({ where: { id: r.id }, data: { status: 'RELEASED', releasedAt: new Date() } });
          await p.inventoryBalance.update({
            where: { warehouseId_variantId: { warehouseId: r.warehouseId, variantId: r.variantId } },
            data: { reserved: { decrement: r.quantity }, version: { increment: 1 } },
          });
        } catch (e2) { /* saldo tidak ada: reservasi tetap dilepas */ }
        await p.inventoryMovement.create({
          data: {
            tenantId: o.tenantId, warehouseId: r.warehouseId, variantId: r.variantId,
            movementType: 'RESERVE_RELEASE', quantityDelta: r.quantity,
            referenceType: 'order', referenceId: o.id,
            reason: 'Backfill: pesanan dibatalkan di Shopee', actorId: null,
          },
        }).catch(() => {});
        released++;
      }
    } catch (e) {
      gagal++;
      console.log('GAGAL', o.externalOrderId, e.message);
    }
  }
  console.log('=== HASIL ===');
  console.log('fulfillment ditutup:', marked, '| reservasi dilepas:', released, '| gagal:', gagal);
  const total = await p.fulfillmentOrder.count({ where: { status: 'WAITING_STOCK' } });
  const yatim = await p.fulfillmentOrder.count({
    where: { status: 'WAITING_STOCK', order: { status: 'CANCELLED' } },
  });
  console.log('WAITING_STOCK tersisa:', total, '| masih yatim:', yatim);
  await p.\$disconnect();
})().catch(async (e) => { console.error('ERR', e.message); await p.\$disconnect(); process.exit(1); });
" 2>&1 | tail -14