#!/usr/bin/env bash
# Cocokkan data pesanan: Shopee (asli) vs database produksi. READ-ONLY.
set -u
APP=/opt/efulfill/app
cd "$APP" || exit 1
set -a; . ./.env; set +a

cat > /tmp/cocok.js <<'JS'
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

(async () => {
  const app = await p.marketplaceAppConfig.findUnique({ where: { provider: 'shopee' } });
  const mode = app?.mode ?? (process.env.SHOPEE_SANDBOX === 'true' ? 'SANDBOX' : 'PRODUCTION');
  const partnerId = app?.partnerId ?? process.env.SHOPEE_PARTNER_ID;
  const partnerKey = app ? dec(app.partnerKeyEncrypted) : process.env.SHOPEE_PARTNER_KEY;
  const host = mode === 'SANDBOX'
    ? (process.env.SHOPEE_SANDBOX_HOST || 'https://openplatform.sandbox.test-stable.shopee.sg')
    : (process.env.SHOPEE_API_HOST || 'https://partner.shopeemobile.com');

  const conns = await p.integrationConnection.findMany({
    where: { provider: 'shopee', status: 'ACTIVE' },
    select: { shopId: true, encryptedCredentials: true, shop: { select: { id: true, name: true } } },
  });

  const call = async (creds, path, params, method = 'GET') => {
    const ts = Math.floor(Date.now() / 1000);
    const url = new URL(path, host);
    url.searchParams.set('partner_id', partnerId);
    url.searchParams.set('timestamp', String(ts));
    url.searchParams.set('sign', sign(partnerId, partnerKey, path, ts, creds.accessToken, creds.shopId));
    url.searchParams.set('access_token', creds.accessToken);
    url.searchParams.set('shop_id', creds.shopId);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const r = await fetch(url);
    const j = JSON.parse(await r.text());
    return j;
  };

  const to = Math.floor(Date.now() / 1000);
  const from = to - 14 * 86400;

  for (const conn of conns) {
    const creds = JSON.parse(dec(conn.encryptedCredentials));
    console.log(`\n===== TOKO: ${conn.shop.name} (shop ${creds.shopId}) =====`);

    // 1) Semua pesanan 14 hari terakhir dari Shopee (create_time).
    const snMap = new Map();
    let cursor = '';
    for (let i = 0; i < 20; i += 1) {
      const res = await call(creds, '/api/v2/order/get_order_list', {
        time_range_field: 'create_time', time_from: String(from), time_to: String(to),
        page_size: '100', response_optional_fields: 'order_status', ...(cursor ? { cursor } : {}),
      });
      if (res.error) { console.log('get_order_list error:', res.error, res.message); break; }
      const list = res.response?.order_list ?? [];
      for (const o of list) snMap.set(o.order_sn, o.order_status);
      cursor = res.response?.next_cursor ?? '';
      if (!res.response?.more) break;
    }

    // 2) Status terbaru tiap pesanan (update_time) — menangkap perubahan status.
    let cursor2 = '';
    for (let i = 0; i < 20; i += 1) {
      const res = await call(creds, '/api/v2/order/get_order_list', {
        time_range_field: 'update_time', time_from: String(from), time_to: String(to),
        page_size: '100', response_optional_fields: 'order_status', ...(cursor2 ? { cursor: cursor2 } : {}),
      });
      if (res.error) break;
      for (const o of res.response?.order_list ?? []) snMap.set(o.order_sn, o.order_status);
      cursor2 = res.response?.next_cursor ?? '';
      if (!res.response?.more) break;
    }

    const shopeeOrders = [...snMap.entries()].map(([sn, st]) => ({ sn, st }));
    const byStatus = {};
    for (const o of shopeeOrders) byStatus[o.st] = (byStatus[o.st] ?? 0) + 1;
    console.log('Shopee (14 hari):', shopeeOrders.length, JSON.stringify(byStatus));

    // 3) Detail batch untuk tracking_number + package_list.
    const detail = new Map();
    for (let i = 0; i < shopeeOrders.length; i += 50) {
      const chunk = shopeeOrders.slice(i, i + 50).map((o) => o.sn);
      const res = await call(creds, '/api/v2/order/get_order_detail', {
        order_sn_list: JSON.stringify(chunk),
        response_optional_fields: 'order_status,tracking_number,package_list',
      });
      for (const d of res.response ?? []) {
        const pkg = (d.package_list ?? [])[0];
        detail.set(d.order_sn, {
          status: d.order_status,
          tracking: d.tracking_number || pkg?.tracking_number || '',
          pkgStatus: pkg?.fulfillment_status ?? '',
        });
      }
    }

    // 4) Bandingkan dengan DB.
    const dbOrders = await p.order.findMany({
      where: { shopId: conn.shop.id },
      select: {
        externalOrderId: true, status: true, externalStatus: true,
        shipments: { select: { awb: true, status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        fulfillmentOrders: { select: { status: true }, where: { status: { notIn: ['COMPLETED'] } }, take: 1 },
      },
    });
    const dbMap = new Map(dbOrders.map((o) => [o.externalOrderId, o]));

    const missing = shopeeOrders.filter((o) => !dbMap.has(o.sn)).map((o) => `${o.sn}(${o.st})`);
    const extraDb = dbOrders.filter((o) => !snMap.has(o.externalOrderId))
      .map((o) => `${o.externalOrderId}(${o.externalStatus ?? o.status})`);

    const shopeeNoResi = shopeeOrders.filter((o) => o.st === 'READY_TO_SHIP').map((o) => o.sn);
    const shopeeWithResi = shopeeOrders.filter((o) => o.st === 'PROCESSED' || o.st === 'RETRY_SHIP').map((o) => o.sn);

    const dbNoAwb = dbOrders.filter((o) => !(o.shipments[0]?.awb ?? '').trim());
    const dbWithAwb = dbOrders.filter((o) => (o.shipments[0]?.awb ?? '').trim());

    console.log(`\n-- ANGKA --`);
    console.log(`Shopee READY_TO_SHIP (belum resi) : ${shopeeNoResi.length}`);
    console.log(`Shopee PROCESSED   (sudah resi)    : ${shopeeWithResi.length}`);
    console.log(`DB tanpa AWB                       : ${dbNoAwb.length}`);
    console.log(`DB dengan AWB                      : ${dbWithAwb.length}`);
    console.log(`Cancel diajukan (IN_CANCEL) Shopee : ${shopeeOrders.filter((o) => o.st === 'IN_CANCEL').length}`);
    console.log(`Cancel diajukan di DB              : ${dbOrders.filter((o) => o.externalStatus === 'IN_CANCEL').length}`);

    console.log(`\n-- HILANG DI DB (ada di Shopee) : ${missing.length} --`);
    console.log(missing.join(', ') || '(tidak ada)');
    console.log(`\n-- ADA DI DB TAPI TIDAK DI SHOPEE 14 HARI : ${extraDb.length} --`);
    console.log(extraDb.slice(0, 20).join(', ') || '(tidak ada)');

    console.log(`\n-- PROCESSED TAPI AWB KOSONG DI DB (kartu salah tempat) --`);
    const salah = dbOrders.filter((o) => ['PROCESSED', 'RETRY_SHIP'].includes(o.externalStatus ?? '')
      && !(o.shipments[0]?.awb ?? '').trim());
    console.log(salah.length ? salah.map((o) => o.externalOrderId).join(', ') : '(tidak ada)');

    console.log(`\n-- AWB ADA TAPI SEHARUSNYA BELUM (READY_TO_SHIP di Shopee) --`);
    const aneh = dbOrders.filter((o) => (o.externalStatus ?? '') === 'READY_TO_SHIP'
      && (o.shipments[0]?.awb ?? '').trim());
    console.log(aneh.length ? aneh.map((o) => o.externalOrderId).join(', ') : '(tidak ada)');

    console.log(`\n-- SAMPEL DETAIL SHOPEE (10) --`);
    for (const o of shopeeOrders.slice(0, 10)) {
      const d = detail.get(o.sn) ?? {};
      console.log(`${o.sn} | ${o.st} | tracking=${d.tracking || '-'} | pkg=${d.pkgStatus || '-'}`);
    }
  }

  await p.$disconnect();
})().catch(async (e) => { console.error('GAGAL:', e.message); await p.$disconnect().catch(() => {}); process.exit(1); });
JS

node /tmp/cocok.js
rm -f /tmp/cocok.js
