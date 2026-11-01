#!/usr/bin/env bash
# Verifikasi akhir: kartu Pesanan vs Shopee, dengan semantik classifyWorkQueue
# yang baru (keluar antrean hanya bila KURIR sudah memindai). READ-ONLY.
set -u
cd /opt/efulfill/app || exit 1
set -a; . ./.env; set +a

cat > /tmp/final-kartu.js <<'JS'
const crypto = require('crypto');
const { PrismaClient } = require('/opt/efulfill/app/node_modules/@prisma/client');
const p = new PrismaClient();

const dec = (payload) => {
  const [ivHex, tagHex, dataHex] = String(payload).split(':');
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  d.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([d.update(Buffer.from(dataHex, 'hex')), d.final()]).toString('utf8');
};
const sign = (pid, pkey, path, ts, at, sid) =>
  crypto.createHmac('sha256', pkey).update(`${pid}${path}${ts}${at}${sid}`).digest('hex');

const AWAITING = new Set(['READY_TO_SHIP']);
const PROCESSED = new Set(['PROCESSED', 'RETRY_SHIP']);
const NOT_IN_QUEUE = new Set(['UNPAID','PENDING','IN_CANCEL','TO_RETURN','SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED','CANCELLED']);

(async () => {
  console.log('=== 1. KODE AKTIF ===');
  const fs = require('fs');
  const src = fs.readFileSync('src/modules/fulfillment/domain/work-queue.ts', 'utf8');
  console.log('paketSudahJalan hanya dari status kurir:', /const paketSudahJalan =[\s\S]{0,200}?shipmentStatus === 'DELIVERED';/.test(src) ? 'YA ✅' : 'TIDAK ❌');

  console.log('\n=== 2. KARTU (semantik baru) ===');
  const orders = await p.order.findMany({
    where: { shop: { name: 'Toko Shopee' } },
    select: {
      externalOrderId: true, status: true, externalStatus: true,
      shipments: { select: { awb: true, status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      fulfillmentOrders: { select: { status: true }, where: { status: { notIn: ['COMPLETED'] } }, take: 1 },
    },
  });
  const has = (o) => Boolean((o.shipments[0]?.awb ?? '').trim());
  const jalan = (o) => ['PICKED_UP','IN_TRANSIT','DELIVERED'].includes(o.shipments[0]?.status ?? '');
  let baru = 0, sudah = 0;
  const sudahList = [], baruList = [];
  for (const o of orders) {
    if (jalan(o)) continue;
    const ext = (o.externalStatus ?? '').trim().toUpperCase();
    if (ext) {
      if (NOT_IN_QUEUE.has(ext)) continue;
      if (AWAITING.has(ext)) { baru += 1; baruList.push(o.externalOrderId); continue; }
      if (PROCESSED.has(ext)) {
        if (has(o)) { sudah += 1; sudahList.push(o.externalOrderId); }
        else { baru += 1; baruList.push(o.externalOrderId); }
      }
      continue;
    }
    if (o.status === 'CONFIRMED') { if (has(o)) { sudah += 1; sudahList.push(o.externalOrderId); } else { baru += 1; baruList.push(o.externalOrderId); } }
  }
  console.log(`Pesanan Baru   : ${baru}`);
  console.log(`Sudah Ada Resi : ${sudah}`);
  console.log('Isi Sudah Ada Resi:', sudahList.join(', ') || '(kosong)');

  console.log('\n=== 3. PESANAN YANG DILAPORKAN OWNER ===');
  for (const sn of ['261027QD9X6AAU', '2610301FP9NBWQ']) {
    const o = orders.find((x) => x.externalOrderId === sn);
    if (!o) { console.log(`${sn}: TIDAK ADA`); continue; }
    const bucket = !jalan(o) && PROCESSED.has((o.externalStatus ?? '').toUpperCase())
      ? (has(o) ? 'sudahResi' : 'baru') : (jalan(o) ? 'DI LUAR antrean (kurir sudah memindai)' : '-');
    console.log(`${sn} | shopee=${o.externalStatus} | awb=${o.shipments[0]?.awb ?? '-'} | paket=${o.shipments[0]?.status ?? '-'} | fo=${o.fulfillmentOrders[0]?.status ?? '-'} -> ${bucket}`);
  }

  console.log('\n=== 4. SHOPEE (14 hari, pembanding) ===');
  const app = await p.marketplaceAppConfig.findUnique({ where: { provider: 'shopee' } });
  const mode = app?.mode ?? 'PRODUCTION';
  const partnerId = app?.partnerId ?? process.env.SHOPEE_PARTNER_ID;
  const partnerKey = app ? dec(app.partnerKeyEncrypted) : process.env.SHOPEE_PARTNER_KEY;
  const host = mode === 'SANDBOX' ? (process.env.SHOPEE_SANDBOX_HOST || '') : (process.env.SHOPEE_API_HOST || 'https://partner.shopeemobile.com');
  const conn = await p.integrationConnection.findFirst({ where: { provider: 'shopee', status: 'ACTIVE' }, select: { encryptedCredentials: true } });
  const creds = JSON.parse(dec(conn.encryptedCredentials));
  const call = async (path, params) => {
    const ts = Math.floor(Date.now() / 1000);
    const url = new URL(path, host);
    url.searchParams.set('partner_id', partnerId);
    url.searchParams.set('timestamp', String(ts));
    url.searchParams.set('sign', sign(partnerId, partnerKey, path, ts, creds.accessToken, creds.shopId));
    url.searchParams.set('access_token', creds.accessToken);
    url.searchParams.set('shop_id', creds.shopId);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return JSON.parse(await (await fetch(url)).text());
  };
  const to = Math.floor(Date.now() / 1000), from = to - 14 * 86400;
  const map = new Map();
  let cursor = '';
  for (let i = 0; i < 20; i += 1) {
    const res = await call('/api/v2/order/get_order_list', { time_range_field: 'update_time', time_from: String(from), time_to: String(to), page_size: '100', response_optional_fields: 'order_status', ...(cursor ? { cursor } : {}) });
    if (res.error) { console.log('error', res.error, res.message); break; }
    for (const o of res.response?.order_list ?? []) map.set(o.order_sn, o.order_status);
    cursor = res.response?.next_cursor ?? '';
    if (!res.response?.more) break;
  }
  const st = {};
  for (const v of map.values()) st[v] = (st[v] ?? 0) + 1;
  console.log('Shopee 14 hari:', JSON.stringify(st));

  await p.$disconnect();
})().catch(async (e) => { console.error('GAGAL:', e.message); await p.$disconnect().catch(() => {}); process.exit(1); });
JS

node /tmp/final-kartu.js
rm -f /tmp/final-kartu.js

echo
echo "=== 5. HEALTH ==="
echo -n "login: "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/login
