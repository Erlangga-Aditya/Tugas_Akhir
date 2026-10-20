/**
 * Audit layout di HP sungguhan (Chrome Android via ADB + Chrome DevTools Protocol).
 *
 * Kenapa begini: browser otomatis di mesin ini lebarnya tetap 1264px sehingga
 * media query `max-width: 639px` TIDAK PERNAH aktif — hasil "tidak ada overflow"
 * di sana tidak membuktikan apa pun untuk HP. Skrip ini mengukur di perangkat
 * asli dan bisa MEMAKSA lebar viewport (360/393/414/480) lewat CDP, supaya
 * semua breakpoint ponsel benar-benar diuji.
 *
 * Prasyarat (sekali):
 *   adb forward tcp:9222 localabstract:chrome_devtools_remote
 *   Chrome di HP sudah membuka aplikasi (sudah login).
 *
 * Jalankan: node scripts/hp-layout-audit.mjs            (360, 393, 480)
 *           node scripts/hp-layout-audit.mjs 360 320    (lebar tertentu)
 */
const CDP = 'http://127.0.0.1:9222';

const HALAMAN = [
  '/dashboard',
  '/dashboard/pesanan',
  '/dashboard/inventori',
  '/dashboard/produk',
  '/dashboard/pengiriman',
  '/dashboard/pengembalian',
  '/dashboard/laporan',
  '/dashboard/laporan-keuangan',
  '/dashboard/integrasi',
  '/dashboard/kelola-tim',
  '/dashboard/pengaturan',
];

const LEBAR = process.argv.slice(2).map(Number).filter((n) => n >= 280);
const DAFTAR_LEBAR = LEBAR.length ? LEBAR : [360, 393, 480];

const EKSPRESI = `(() => {
  const d = document;
  const cw = d.documentElement.clientWidth;
  const diDalamScroll = (el) => {
    let n = el.parentElement;
    while (n && n !== d.body) {
      const s = getComputedStyle(n);
      if (['auto', 'scroll', 'hidden'].includes(s.overflowX)) return true;
      n = n.parentElement;
    }
    return false;
  };
  const meluber = [];
  d.querySelectorAll('body *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > cw + 1 && !diDalamScroll(el)) {
      meluber.push(
        el.tagName.toLowerCase() +
          (el.className ? '.' + String(el.className).trim().split(/\\s+/)[0] : '') +
          ' kanan=' + Math.round(r.right) + ' lebar=' + Math.round(r.width) +
          ' "' + (el.textContent || '').trim().slice(0, 24) + '"'
      );
    }
  });
  return {
    cw,
    sw: d.documentElement.scrollWidth,
    selisih: d.documentElement.scrollWidth - cw,
    bisaGeser: d.documentElement.scrollWidth > cw + 1,
    jumlahMeluber: meluber.length,
    contoh: meluber.slice(0, 4),
  };
})()`;

const EKSPRESI_SIDEBAR = `(() => {
  const d = document;
  const b = d.querySelector('.hamburger-btn');
  if (!b) return { adaTombol: false };
  b.click();
  return new Promise((resolve) => setTimeout(() => {
    const sb = d.querySelector('.sidebar');
    const r = sb ? sb.getBoundingClientRect() : null;
    const ov = d.querySelector('.sidebar-overlay');
    resolve({
      adaTombol: true,
      x: r ? Math.round(r.x) : null,
      lebar: r ? Math.round(r.width) : null,
      tinggi: r ? Math.round(r.height) : null,
      tinggiLayar: window.innerHeight,
      muatLayar: r ? r.height <= window.innerHeight + 1 : null,
      overlayPenuh: ov ? Math.round(ov.getBoundingClientRect().width) >= d.documentElement.clientWidth : null,
      geserSetelahBuka: d.documentElement.scrollWidth > d.documentElement.clientWidth + 1,
    });
  }, 500));
})()`;

const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const daftar = await (await fetch(`${CDP}/json`)).json();
  const target = daftar.find((t) => t.type === 'page' && t.url.includes('sslip.io'));
  if (!target) throw new Error('Tab aplikasi tidak ditemukan di HP. Buka aplikasinya dulu di Chrome.');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const menunggu = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && menunggu.has(m.id)) {
      menunggu.get(m.id)(m);
      menunggu.delete(m.id);
    }
  };
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('Gagal menyambung ke CDP'));
  });

  const kirim = (method, params = {}) =>
    new Promise((res) => {
      const id = ++seq;
      menunggu.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });

  const nilai = async (expression) => {
    const r = await kirim('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };

  const asal = new URL(target.url).origin;
  const masalah = [];

  for (const lebar of DAFTAR_LEBAR) {
    await kirim('Emulation.setDeviceMetricsOverride', {
      width: lebar,
      height: 780,
      deviceScaleFactor: 2,
      mobile: true,
    });
    console.log(`\n=== VIEWPORT ${lebar}px ===`);
    for (const jalur of HALAMAN) {
      await kirim('Page.navigate', { url: asal + jalur });
      await tunggu(2400);
      const ukur = await nilai(EKSPRESI);
      const tanda = ukur.bisaGeser ? 'GESER' : 'OK   ';
      if (ukur.bisaGeser) masalah.push({ lebar, jalur, ...ukur });
      console.log(
        `${tanda} ${jalur.padEnd(29)} cw=${ukur.cw} sw=${ukur.sw} selisih=${ukur.selisih} meluber=${ukur.jumlahMeluber}` +
          (ukur.jumlahMeluber ? `\n        ${ukur.contoh.join('\n        ')}` : ''),
      );

      // Laci sidebar diuji pada lebar tersempit saja (paling menantang).
      if (lebar === DAFTAR_LEBAR[0]) {
        const sidebar = await nilai(EKSPRESI_SIDEBAR);
        console.log(
          `        sidebar: x=${sidebar.x} lebar=${sidebar.lebar} tinggi=${sidebar.tinggi}/${sidebar.tinggiLayar} ` +
            `muat=${sidebar.muatLayar} overlayPenuh=${sidebar.overlayPenuh} geserSetelahBuka=${sidebar.geserSetelahBuka}`,
        );
        if (sidebar.geserSetelahBuka || !sidebar.muatLayar || !sidebar.overlayPenuh) {
          masalah.push({ lebar, jalur, masalahSidebar: sidebar });
        }
        await nilai(`(() => { const o = document.querySelector('.sidebar-overlay'); if (o) o.click(); return true; })()`);
        await tunggu(250);
      }
    }
  }

  await kirim('Emulation.clearDeviceMetricsOverride');

  console.log('\n=== RINGKASAN ===');
  if (masalah.length === 0) {
    console.log(`Bersih: ${HALAMAN.length} halaman x ${DAFTAR_LEBAR.length} lebar, tidak ada geser mendatar & sidebar muat.`);
  } else {
    for (const m of masalah) {
      console.log(
        `- ${m.lebar}px ${m.jalur}: ${m.masalahSidebar ? 'sidebar bermasalah' : `selisih ${m.selisih}px (${m.jumlahMeluber} elemen)`}`,
      );
    }
  }
  ws.close();
  process.exitCode = masalah.length === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('GAGAL:', e.message);
  process.exitCode = 1;
});
