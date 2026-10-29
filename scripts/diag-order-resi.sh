#!/usr/bin/env bash
# Diagnosa READ-ONLY: kenapa "Ambil Resi" gagal untuk satu pesanan.
#
# Memanggil Shopee langsung (tanda tangan partner) memakai kredensial yang
# tersimpan di DB produksi, lalu mencetak respons mentahnya. TIDAK mengubah
# data apa pun: hanya GET get_order_detail + get_shipping_parameter.
set -u
APP=/opt/efulfill/app
ORDER_SN="${ORDER_SN:-261027QHEBBY8Q}"
cd "$APP" || exit 1
set -a; . ./.env; set +a

cat > /tmp/diag-resi.js <<'JS'
const crypto = require('crypto');
const { PrismaClient } = require('/opt/efulfill/app/node_modules/@prisma/client');
const p = new PrismaClient();
const ORDER_SN = process.env.ORDER_SN || '261027QHEBBY8Q';

function dec(payload) {
  const [ivHex, tagHex, dataHex] = String(payload).split(':');
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  d.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([d.update(Buffer.from(dataHex, 'hex')), d.final()]).toString('utf8');
}
const sign = (pid, pkey, path, ts, at, sid) =>
  crypto.createHmac('sha256', pkey).update(`${pid}${path}${ts}${at}${sid}`).digest('hex');

(async () => {
  const order = await p.order.findFirst({
    where: { externalOrderId: ORDER_SN },
    select: { id: true, externalOrderId: true, status: true, externalStatus: true, packageNumber: true, packageCount: true, shopId: true, shop: { select: { name: true } } },
  });
  if (!order) { console.log('PESANAN TIDAK ADA di DB:', ORDER_SN); return; }
  console.log('pesanan :', JSON.stringify(order));

  const conn = await p.integrationConnection.findFirst({
    where: { shopId: order.shopId, provider: 'shopee' },
    select: { encryptedCredentials: true, sandbox: true, status: true },
  });
  if (!conn?.encryptedCredentials) { console.log('koneksi shopee tidak ada'); return; }
  const creds = JSON.parse(dec(conn.encryptedCredentials));
  console.log('koneksi :', JSON.stringify({ shopId: creds.shopId, sandbox: conn.sandbox, status: conn.status, expiresInMin: Math.round((creds.tokenExpiresAt - Date.now()) / 60000) }));

  const app = await p.marketplaceAppConfig.findUnique({ where: { provider: 'shopee' } });
  const mode = app?.mode ?? (process.env.SHOPEE_SANDBOX === 'true' ? 'SANDBOX' : 'PRODUCTION');
  const partnerId = app?.partnerId ?? process.env.SHOPEE_PARTNER_ID;
  const partnerKey = app ? dec(app.partnerKeyEncrypted) : process.env.SHOPEE_PARTNER_KEY;
  const host = mode === 'SANDBOX'
    ? (process.env.SHOPEE_SANDBOX_HOST || 'https://openplatform.sandbox.test-stable.shopee.sg')
    : (process.env.SHOPEE_API_HOST || 'https://partner.shopeemobile.com');
  console.log('mode    :', mode, '| host:', host);

  const call = async (path, params) => {
    const ts = Math.floor(Date.now() / 1000);
    const url = new URL(path, host);
    url.searchParams.set('partner_id', partnerId);
    url.searchParams.set('timestamp', String(ts));
    url.searchParams.set('sign', sign(partnerId, partnerKey, path, ts, creds.accessToken, creds.shopId));
    url.searchParams.set('access_token', creds.accessToken);
    url.searchParams.set('shop_id', creds.shopId);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const r = await fetch(url);
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 300) }; }
    return { http: r.status, ...j };
  };

  const detail = await call('/api/v2/order/get_order_detail', { order_sn_list: JSON.stringify([ORDER_SN]), response_optional_fields: 'order_status,logistics_channel,package_list,ship_by_date,tracking_number' });
  const d = detail.response?.[0];
  console.log('\n=== ORDER DETAIL ===');
  console.log(JSON.stringify({
    error: detail.error, message: detail.message,
    order_status: d?.order_status,
    logistics_channel: d?.logistics_channel,
    package_list: d?.package_list,
    tracking_number: d?.tracking_number,
    ship_by_date: d?.ship_by_date,
  }, null, 1));

  console.log('\n=== GET_SHIPPING_PARAMETER (tanpa package_number) ===');
  console.log(JSON.stringify(await call('/api/v2/logistics/get_shipping_parameter', { order_sn: ORDER_SN }), null, 1));

  const pkg = d?.package_list?.[0]?.package_number ?? order.packageNumber;
  if (pkg) {
    console.log('\n=== GET_SHIPPING_PARAMETER (dengan package_number ' + pkg + ') ===');
    console.log(JSON.stringify(await call('/api/v2/logistics/get_shipping_parameter', { order_sn: ORDER_SN, package_number: pkg }), null, 1));
  } else {
    console.log('\n(tidak ada package_number untuk dicoba)');
  }

  await p.$disconnect();
})().catch(async (e) => { console.error('GAGAL:', e.message); await p.$disconnect().catch(() => {}); process.exit(1); });
JS

ORDER_SN="$ORDER_SN" node /tmp/diag-resi.js
rm -f /tmp/diag-resi.js
