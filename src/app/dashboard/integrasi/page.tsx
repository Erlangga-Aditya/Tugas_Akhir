'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Cable, RefreshCw, Download, PlugZap, ShieldCheck, CircleAlert, Timer, Zap } from 'lucide-react';
import { api, formatDate } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState, Alert } from '@/components/ui';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Shop {
 id: string;
 provider: string;
 name: string;
 externalShopId: string | null;
 status: string;
}

interface ConnStatus {
 connected: boolean;
 status: string;
 sandbox: boolean;
 lastSyncAt: string | null;
 partnerConfigured: boolean;
 /** Run terakhir per operasi - sumber kartu status, bukan dari halaman riwayat. */
 lastRuns?: Record<string, SyncRun>;
 externalShopId: string | null;
 tokenExpiresAt: string | null;
 tokenExpiresInMinutes: number | null;
}

interface SyncRun {
 id: string;
 operation: string;
 status: string;
 recordsRead: number;
 recordsWritten: number;
 startedAt: string;
 finishedAt: string | null;
 errorMessage: string | null;
 shop?: { name: string; provider: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Expiry Countdown
// ─────────────────────────────────────────────────────────────────────────────

function TokenExpiryBadge({ expiresAt }: { expiresAt: string | null }) {
 const [mins, setMins] = useState<number | null>(null);

 useEffect(() => {
  if (!expiresAt) return;
  const update = () => {
   const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 60000);
   setMins(diff);
  };
  update();
  const id = setInterval(update, 30_000);
  return () => clearInterval(id);
 }, [expiresAt]);

 if (mins === null) return <span className="small muted">—</span>;

 const isExpired = mins <= 0;
 const isCritical = mins <= 15;
 const isWarning = mins <= 60;

 const color = isExpired ? 'var(--danger)' : isCritical ? 'var(--danger)' : isWarning ? 'var(--warning)' : 'var(--success)';
 const label = isExpired
  ? 'Token Kedaluwarsa!'
  : isCritical
  ? `Habis ${mins} mnt lagi`
  : isWarning
  ? `Habis ${mins} mnt lagi`
  : `Aktif ${Math.floor(mins / 60)}j ${mins % 60}m`;

 return (
  <span style={{ color, fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
   <Timer size={14} aria-hidden />
   {label}
  </span>
 );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function IntegrasiPage() {
 const [shop, setShop] = useState<Shop | null>(null);
 const [status, setStatus] = useState<ConnStatus | null>(null);
 // Riwayat sinkronisasi: satu endpoint, dipaginasi, dengan cache ringan supaya
 // pindah halaman/men-trigger SSE tidak menembak API berulang.
 const [allRuns, setAllRuns] = useState<SyncRun[]>([]);
 const [runsPage, setRunsPage] = useState(1);
 const [runsTotal, setRunsTotal] = useState(0);
 const RUNS_PAGE_SIZE = 20;
 const runsCache = useRef<Map<string, { items: SyncRun[]; at: number }>>(new Map());
 const RUNS_CACHE_MS = 30_000;
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState('');
 const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'info' | 'warning'; text: string } | null>(null);
 const shopRef = useRef<Shop | null>(null);

 // ── Konfigurasi aplikasi Shopee (diisi dari UI, tanpa edit .env) ──
 const [appConfig, setAppConfig] = useState<{
  partnerId: string | null;
  hasPartnerKey: boolean;
  mode: 'PRODUCTION' | 'SANDBOX';
  redirectUrl: string | null;
  source: string;
  configured: boolean;
 } | null>(null);
 const [appForm, setAppForm] = useState({ partnerId: '', partnerKey: '', mode: 'PRODUCTION' as 'PRODUCTION' | 'SANDBOX', redirectUrl: '' });
 const [appSaving, setAppSaving] = useState(false);
 const [appTesting, setAppTesting] = useState(false);
 const [oauthStarting, setOauthStarting] = useState(false);
 const [appTestResult, setAppTestResult] = useState<{ ok: boolean; message: string } | null>(null);
 const [health, setHealth] = useState<{
  skippedOrders: number;
  unmappedSkus: string[];
  needsProductSync: boolean;
 } | null>(null);

 const loadAppConfig = useCallback(async () => {
  try {
   const cfg = await api<{
    partnerId: string | null;
    hasPartnerKey: boolean;
    mode: 'PRODUCTION' | 'SANDBOX';
    redirectUrl: string | null;
    source: string;
    configured: boolean;
   }>('/api/v1/integrations/shopee/app-config');
   setAppConfig(cfg);
   setAppForm((prev) => ({
    partnerId: cfg.partnerId ?? prev.partnerId,
    partnerKey: '',
    mode: cfg.mode,
    redirectUrl: cfg.redirectUrl ?? (typeof window !== 'undefined' ? `${window.location.origin}/api/v1/integrations/shopee/callback` : ''),
   }));
  } catch {
   // Belum bisa dibaca — biarkan form kosong.
  }
  try {
   setHealth(await api('/api/v1/integrations/shopee/health'));
  } catch {
   setHealth(null);
  }
 }, []);

 async function saveAppConfig(e: React.FormEvent) {
  e.preventDefault();
  setAppSaving(true);
  setNotice(null);
  try {
   await api('/api/v1/integrations/shopee/app-config', {
    method: 'PUT',
    body: {
     partnerId: appForm.partnerId.trim(),
     partnerKey: appForm.partnerKey.trim() || undefined,
     mode: appForm.mode,
     redirectUrl: appForm.redirectUrl.trim() || null,
    },
   });
   setNotice({ tone: 'success', text: 'Kredensial aplikasi Shopee tersimpan (Partner Key terenkripsi).' });
   setAppForm((prev) => ({ ...prev, partnerKey: '' }));
   await loadAppConfig();
  } catch (err) {
   setNotice({ tone: 'danger', text: (err as Error).message });
  } finally {
   setAppSaving(false);
  }
 }

 async function testAppConfig() {
  setAppTesting(true);
  setAppTestResult(null);
  try {
   const res = await api<{ ok: boolean; message: string }>('/api/v1/integrations/shopee/app-config/test', {
    method: 'POST',
    body: {},
   });
   setAppTestResult(res);
  } catch (err) {
   setAppTestResult({ ok: false, message: (err as Error).message });
  } finally {
   setAppTesting(false);
  }
 }

 /**
  * Ambil riwayat sinkronisasi dari SATU endpoint dengan paginasi + cache.
  *
  * Versi lama memanggil empat endpoint (satu per operasi) lalu menggabungkan
  * semuanya di browser —Rn hingga 200 baris untuk satu tampilan, di-refresh
  * setiap mount, setiap event SSE, dan setiap klik tombol.
  *
  * @param force true = abaikan cache (mis. setelah operator menjalankan sinkron)
  */
 const loadRuns = useCallback(async (page: number, force = false) => {
  const s = shopRef.current;
  if (!s) return;
  const key = `${s.id}:${page}`;
  if (!force) {
   const hit = runsCache.current.get(key);
   if (hit && Date.now() - hit.at < RUNS_CACHE_MS) {
    setAllRuns(hit.items);
    setRunsTotal(hit.items.length);
    return;
   }
  }
  try {
   const q = new URLSearchParams({ shopId: s.id, page: String(page), pageSize: String(RUNS_PAGE_SIZE) });
   const res = await api<{ items: SyncRun[]; pagination: { total: number } }>(
    `/api/v1/integrations/shopee/sync-runs?${q.toString()}`,
   );
   setAllRuns(res.items ?? []);
   setRunsTotal(res.pagination?.total ?? 0);
   runsCache.current.set(key, { items: res.items ?? [], at: Date.now() });
  } catch {
   setError('Riwayat sinkronisasi tidak bisa dimuat. Coba muat ulang.');
  }
 }, []);

 const load = useCallback(async () => {
  try {
   const shops = await api<Shop[]>('/api/v1/shops');
   const s = shops.find((x) => x.provider === 'shopee') ?? shops[0] ?? null;
   setShop(s);
   shopRef.current = s;
   if (s) {
    const [st] = await Promise.all([
     api<ConnStatus>(`/api/v1/integrations/shopee/status?shopId=${s.id}`),
    ]);
    setStatus(st);
    await loadRuns(1, true);
   } else {
    setStatus(null);
    setAllRuns([]);
   }
  } catch (e) {
   setError((e as Error).message);
  } finally {
   setLoading(false);
  }
 }, [loadRuns]);

 // Handle URL params (OAuth redirect result)
 useEffect(() => {
  let cancelled = false;
  void (async () => {
   // Dipisah ke microtask supaya pembacaan URL tidak memicu render berantai di dalam effect.
   await Promise.resolve();
   if (cancelled || typeof window === 'undefined') return;
   const params = new URLSearchParams(window.location.search);
   const err = params.get('error');
   const succ = params.get('success');
   if (err) {
    setNotice({ tone: 'danger', text: `Otorisasi Shopee gagal: ${err}` });
   } else if (succ === 'connected') {
    setNotice({ tone: 'success', text: 'Toko Shopee berhasil diotorisasi. Sinkronisasi otomatis sedang berjalan di background. Muat ulang halaman setelah beberapa saat untuk melihat data terbaru.' });
   }
  })();
  return () => {
   cancelled = true;
  };
 }, []);

 useEffect(() => {
  // Ditunda satu task: pemuatan data berjalan setelah render selesai, bukan di tengah effect.
  const timer = setTimeout(() => {
   load();
   void loadAppConfig();
  }, 0);
  return () => clearTimeout(timer);
 }, [load, loadAppConfig]);

 // Realtime auto-update whenever background auto-sync completes
 useEffect(() => {
  const handleSync = () => load();
  window.addEventListener('shopee:synced', handleSync);
  return () => window.removeEventListener('shopee:synced', handleSync);
 }, [load]);

 async function startOAuth() {
  const s = shopRef.current;
  if (!s) {
   setNotice({ tone: 'danger', text: 'Data toko belum siap dimuat. Tunggu sebentar lalu muat ulang halaman.' });
   return;
  }
  setOauthStarting(true);
  setNotice(null);
  try {
   const { url } = await api<{ url: string }>(`/api/v1/integrations/shopee/auth-url?shopId=${s.id}`);
   // Beri umpan balik dulu sebelum pindah ke Shopee, supaya tombol tidak pernah
   // terasa "tidak merespons" walau koneksi ke Shopee lambat.
   setNotice({ tone: 'info', text: 'Membuka halaman otorisasi Shopee di tab/halaman berikutnya…' });
   window.location.assign(url);
  } catch (e) {
   setOauthStarting(false);
   setNotice({ tone: 'danger', text: (e as Error).message });
  }
 }

 async function doRefreshToken() {
  const s = shopRef.current;
  if (!s) return;
  setNotice(null);
  try {
   const res = await api<{ tokenExpiresAt: string; expiresInMinutes: number }>(
    `/api/v1/integrations/shopee/refresh-token`,
    { method: 'POST', body: { shopId: s.id } },
   );
   setNotice({
    tone: 'success',
    text: `Token berhasil diperbarui. Kadaluarsa dalam ${res.expiresInMinutes} menit (${new Date(res.tokenExpiresAt).toLocaleString('id-ID')}).`,
   });
   await load();
  } catch (e) {
   setNotice({ tone: 'danger', text: (e as Error).message });
  }
 }

 // ── Derived state ────────────────────────────────────────────────────────

 const connected = status?.connected ?? false;
 // Kredensial sah bila berasal dari database (diisi lewat formulir di halaman ini)
 // ATAU dari file .env di server. Sebelumnya hanya .env yang diakui, sehingga
 // pemilik yang sudah mengisi lewat formulir tetap melihat peringatan "belum dikonfigurasi".
 const partnerReady = Boolean(status?.partnerConfigured || appConfig?.configured);
 // Jangan menampilkan peringatan sebelum data benar-benar selesai dimuat.
 const dataMasihDimuat = status === null && appConfig === null;
 const isNearExpiry = (status?.tokenExpiresInMinutes ?? 999) < 60;
 const isExpired = (status?.tokenExpiresInMinutes ?? 999) <= 0;

 if (loading) return <LoadingState message="Memeriksa status koneksi Shopee Open Platform..." />;
 if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); load(); }} />;

 return (
  <div>
   <PageHeader
    title="Integrasi Shopee Open Platform"
    subtitle="Hubungkan toko Shopee via OAuth 2.0 dan sinkronkan produk, pesanan, pengiriman, dan return secara real-time"
    actions={
     <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setLoading(true); setError(''); load(); }}>
      <RefreshCw size={14} aria-hidden />
      <span>Muat Ulang</span>
     </button>
    }
   />

   {/* Notices */}
   {notice && (
    <div className="mb16">
     <Alert tone={notice.tone}>{notice.text}</Alert>
    </div>
   )}

   {/* Token expiry alert */}
   {connected && (isExpired || isNearExpiry) && (
    <div className="mb16">
     <Alert tone={isExpired ? 'danger' : 'warning'}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
       <span>
        <strong>{isExpired ? ' Access Token Kedaluwarsa!' : ' Access Token Hampir Habis.'}</strong>
        {' '}Sinkronisasi tidak akan berfungsi. Klik tombol refresh token.
       </span>
       <button type="button" className="btn btn-sm btn-primary" onClick={doRefreshToken}>
        <Zap size={13} aria-hidden />
        <span>Refresh Token Sekarang</span>
       </button>
      </div>
     </Alert>
    </div>
   )}

   {!partnerReady && !dataMasihDimuat && (
    <div className="mb24">
     <Alert tone="warning">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
       <strong>Partner ID &amp; Partner Key belum diisi</strong>
       <span>
        Isi keduanya pada formulir <strong>Kredensial Aplikasi Shopee</strong> di bawah halaman ini,
        lalu klik Simpan. Bisa juga lewat file <code className="mono">.env</code> di server dengan
        nama variabel <code className="mono">SHOPEE_PARTNER_ID</code> dan{' '}
        <code className="mono">SHOPEE_PARTNER_KEY</code>. Nilainya diambil dari Shopee Open Platform
        Console → App Management → App Key.
       </span>
      </div>
     </Alert>
    </div>
   )}

   {/* Connection Status */}
   <div className="stat-grid mb24">
    <div className="card">
     <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
       <Cable size={18} style={{ color: 'var(--primary)' }} aria-hidden />
       <span>Shopee Marketplace</span>
      </div>
      <StatusBadge status={connected ? 'ACTIVE' : 'INACTIVE'} />
     </div>
     <div className="small muted mb8">
      {connected
       ? `Terhubung (${status?.sandbox ? 'Mode Sandbox' : 'Mode Produksi'}) · ${shop?.name ?? 'Toko Shopee'}`
       : 'Belum terhubung. Klik tombol otorisasi di bawah.'}
     </div>
     <div style={{ borderTop: '1px solid var(--divider)', paddingTop: 8 }}>
      <div className="small muted">Sync Terakhir: <strong>{formatDate(status?.lastSyncAt)}</strong></div>
      {connected && (
       <div style={{ marginTop: 4 }}>
        <TokenExpiryBadge expiresAt={status?.tokenExpiresAt ?? null} />
       </div>
      )}
     </div>
    </div>

    <div className="card">
     <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
       <PlugZap size={18} style={{ color: 'var(--secondary)' }} aria-hidden />
       <span>Status Kredensial</span>
      </div>
      <StatusBadge status={partnerReady ? 'ACTIVE' : 'INACTIVE'} />
     </div>
     <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 8 }}>
      <ShieldCheck size={16} style={{ color: partnerReady ? 'var(--success)' : 'var(--on-surface-muted)' }} aria-hidden />
      <span>{partnerReady ? 'HMAC-SHA256 Signature Siap' : 'Partner Key belum diisi'}</span>
     </div>
     <div className="small muted" style={{ borderTop: '1px solid var(--divider)', paddingTop: 8 }}>
      Webhook URL: <code className="mono" style={{ fontSize: 11 }}>/api/v1/integrations/shopee/webhook</code>
     </div>
    </div>
   </div>

   {/* OAuth & Token Actions */}
   <div className="card mb24">
    <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}> Otorisasi & Token Management</h2>
    <p className="small muted mb16">
     Gunakan OAuth 2.0 resmi Shopee untuk otorisasi toko. Token access (4 jam) diperbarui otomatis.
    </p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
    <button
      type="button"
      className="btn btn-primary"
      onClick={startOAuth}
      disabled={!partnerReady || oauthStarting}
      title={partnerReady ? undefined : 'Isi Partner ID & Partner Key dulu pada formulir di bawah.'}
    >
      <Cable size={16} aria-hidden />
      <span>{oauthStarting ? 'Membuka Shopee…' : 'Otorisasi Toko via Shopee OAuth'}</span>
    </button>
    </div>

    {!connected && (
     <div className="small muted mt12" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <CircleAlert size={14} style={{ color: 'var(--tertiary)' }} aria-hidden />
      <span>Semua fitur sinkronisasi aktif setelah toko berhasil dihubungkan.</span>
     </div>
    )}

   </div>

   <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Sinkronisasi Data</h2>
   {!connected && (
    <div className="mb16">
     <Alert tone="info">Semua operasi sinkronisasi akan aktif setelah toko berhasil diotorisasi.</Alert>
    </div>
   )}

   {connected && (
    <div className="card mb20" style={{ borderLeft: '4px solid var(--success, #10b981)', background: 'var(--surface-low)' }}>
     <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ color: 'var(--success, #10b981)', marginTop: 2, flexShrink: 0 }}>
       <Zap size={20} />
      </div>
      <div>
       <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--on-surface)', marginBottom: 4 }}>
        Sinkronisasi Otomatis Aktif
       </div>
       <p className="small muted" style={{ margin: 0, lineHeight: 1.5 }}>
        Sistem E-Fulfill Hub menyinkronkan data toko secara otomatis tanpa perlu mengklik tombol manual:
        <strong> Push Webhook Shopee</strong> menerima pesanan baru &amp; resi seketika, serta <strong>Auto-Sync Heartbeat</strong> memeriksa pembaruan di latar belakang setiap 60 detik. Tombol manual di bawah ini hanya opsi percepatan jika Anda ingin sinkronisasi instan.
       </p>
      </div>
     </div>
    </div>
   )}

   {/* Petunjuk singkat: tidak ada tombol tarik data, semuanya otomatis. */}
   <div className="card mb20">
    <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Yang perlu Anda lakukan</h2>
    <p className="small muted" style={{ margin: 0, lineHeight: 1.6 }}>
     Tidak ada yang perlu diklik untuk mengambil data. Pesanan baru, nomor resi, dan status
     pengiriman masuk sendiri ke sistem. Halaman ini hanya untuk menghubungkan toko dan
     memeriksa keadaannya.
    </p>
   </div>

   {/* Sync Log History */}
   <div className="card">
    <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Riwayat Sinkronisasi</h2>
    {allRuns.length === 0 ? (
     <p className="muted small">Belum ada riwayat sinkronisasi. Lakukan sinkronisasi produk terlebih dahulu.</p>
    ) : (
     <div className="table-wrap">
      <table className="table">
       <thead>
        <tr>
         <th>Waktu</th>
         <th>Operasi</th>
         <th className="num">Dibaca</th>
         <th className="num">Ditulis</th>
         <th>Status</th>
         <th>Catatan</th>
        </tr>
       </thead>
       <tbody>
        {allRuns.map((r) => (
         <tr key={r.id}>
          <td className="small">{formatDate(r.startedAt)}</td>
          <td>
           <span className="mono" style={{ fontWeight: 600 }}>{r.operation}</span>
          </td>
          <td className="num">{r.recordsRead}</td>
          <td className="num">
           <span style={{ fontWeight: 600, color: r.recordsWritten > 0 ? 'var(--success)' : 'inherit' }}>
            {r.recordsWritten}
           </span>
          </td>
          <td><StatusBadge status={r.status} /></td>
          <td className="small muted">{r.errorMessage ?? 'Sukses'}</td>
         </tr>
        ))}
       </tbody>
      </table>

      {runsTotal > RUNS_PAGE_SIZE && (
       <div
        style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}
       >
        <button
         type="button"
         className="btn btn-secondary btn-sm"
         disabled={runsPage <= 1}
         onClick={() => { const p = runsPage - 1; setRunsPage(p); void loadRuns(p); }}
        >
         <span>Sebelumnya</span>
        </button>
        <span className="small muted">
         Halaman {runsPage} dari {Math.max(1, Math.ceil(runsTotal / RUNS_PAGE_SIZE))} ({runsTotal} riwayat)
        </span>
        <button
         type="button"
         className="btn btn-secondary btn-sm"
         disabled={runsPage >= Math.ceil(runsTotal / RUNS_PAGE_SIZE)}
         onClick={() => { const p = runsPage + 1; setRunsPage(p); void loadRuns(p); }}
        >
         <span>Berikutnya</span>
        </button>
       </div>
      )}
     </div>
    )}
   </div>
   {/* Pengaturan pemasangan awal: dilipat supaya klien tidak berhadapan
       dengan urusan teknis. Setelah toko terhubung, bagian ini tidak perlu
       dibuka lagi. */}
   <details className="card" style={{ marginTop: 4 }}>
    <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
     Pengaturan Lanjutan (hanya untuk pemasangan awal)
    </summary>
    <p className="small muted" style={{ marginTop: 8 }}>
     Bagian ini sudah terisi saat toko dihubungkan. Buka hanya bila mengganti
     aplikasi Shopee atau menghubungkan ulang toko.
    </p>
   {/* Step-by-step guide and Shopee Console Location */}
   <div className="card mb24" style={{ borderLeft: '4px solid var(--primary, #0284c7)' }}>
    <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
     <span>Panduan Shopee Open Platform (Individual Seller)</span>
    </h2>
    <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--on-surface)' }}>
     <p style={{ marginBottom: 8 }}>
      Jika Anda sudah mendaftar sebagai <strong>Individual Seller</strong> dan sudah di-ACC/Approved oleh Shopee, berikut cara memeriksa kredensialnya di Console Shopee:
     </p>
     <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
      <li>
       Buka dan login ke <strong><a href="https://open.shopee.com" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: 'var(--primary)' }}>Shopee Open Platform Console</a></strong>.
      </li>
      <li>
       Di menu kiri, klik <strong>App Management</strong> (Manajemen Aplikasi) → klik nama aplikasi Anda.
      </li>
      <li>
       Anda akan melihat <strong>Partner ID</strong> (angka) dan <strong>Partner Key</strong> (klik ikon mata untuk menyalin). Masukkan keduanya pada formulir <strong>Kredensial Aplikasi Shopee</strong> di halaman ini, lalu klik Simpan.
      </li>
      <li>
       Di bagian <strong>Redirect URL</strong> pada App Management, daftarkan URL berikut:
       <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        <code className="mono" style={{ background: 'var(--surface-low, #f1f5f9)', padding: '6px 10px', borderRadius: 6, fontSize: 12, border: '1px solid var(--outline-variant, #cbd5e1)' }}>
         {typeof window !== 'undefined' ? `${window.location.origin}/api/v1/integrations/shopee/callback` : 'http://localhost:3000/api/v1/integrations/shopee/callback'}
        </code>
        <button
         type="button"
         className="btn btn-secondary btn-sm"
         onClick={() => {
          const url = `${window.location.origin}/api/v1/integrations/shopee/callback`;
          navigator.clipboard.writeText(url);
          alert('Redirect URL berhasil disalin ke clipboard!');
         }}
        >
         Salin URL
        </button>
       </div>
      </li>
      <li>
       <strong>Cara pindah Sandbox ke Live:</strong> buka bagian{' '}
       <strong>Pengaturan Lanjutan</strong> di halaman ini, lalu pilih{' '}
       <strong>Mode Produksi</strong> pada kolom Kredensial Aplikasi Shopee —
       sekaligus ganti <strong>Partner ID</strong> dan <strong>Partner Key</strong> dengan
       milik aplikasi live Anda. Mode tersimpan di database dan berlaku seketika.
       <br />
       <span className="small muted">
        Mengubah <code className="mono">.env</code> TIDAK berpengaruh selama kredensial
        sudah pernah disimpan di halaman ini — pengaturan database selalu diutamakan.
        Petunjuk lama menyuruh mengubah <code className="mono">.env</code>, dan itu
        membuat aplikasi tetap berjalan di sandbox walaupun dikira sudah live.
        <code className="mono"> .env</code> hanya dipakai sebagai cadangan bila belum
        ada kredensial tersimpan sama sekali.
       </span>
      </li>
     </ol>
     <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#166534' }}>
      <strong>Alur Sinkronisasi Otomatis:</strong> Setelah otorisasi berhasil, webhook Shopee dan SSE otomatis aktif. Setiap ada pesanan checkout masuk di toko Shopee Anda, sistem akan langsung menampilkannya di dashboard tanpa perlu klik manual.
     </div>
    </div>
   </div>
   {/* Kredensial aplikasi Shopee — diisi di sini, tidak perlu edit .env */}
   <div className="card mb24">
    <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
     Kredensial Aplikasi Shopee (Partner ID &amp; Partner Key)
    </h2>
    <p className="small muted mb16">
     Ambil dari Shopee Open Platform Console → App Management. Cukup diisi sekali di sini; Partner Key
     disimpan terenkripsi dan tidak pernah ditampilkan lagi.
     {appConfig?.source === 'env' && !appConfig.configured
      ? ' Saat ini sistem masih memakai nilai dari file .env.'
      : ''}
    </p>

    <form onSubmit={saveAppConfig} style={{ maxWidth: 640 }}>
     <div className="field">
      <label>Partner ID (hanya angka)</label>
      <input
       className="input mono"
       value={appForm.partnerId}
       onChange={(e) => setAppForm({ ...appForm, partnerId: e.target.value })}
       placeholder="Contoh: 1245182"
       required
      />
     </div>
     <div className="field">
      <label>Partner Key {appConfig?.hasPartnerKey ? '(sudah tersimpan — isi hanya jika ingin mengganti)' : ''}</label>
      <input
       className="input mono"
       type="password"
       value={appForm.partnerKey}
       onChange={(e) => setAppForm({ ...appForm, partnerKey: e.target.value })}
       placeholder={appConfig?.hasPartnerKey ? '•••••••••••' : 'Tempel Partner Key dari Shopee Console'}
      />
     </div>
     <div className="field">
      <label>Mode Aplikasi</label>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
       <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <input
         type="radio"
         name="mode"
         checked={appForm.mode === 'PRODUCTION'}
         onChange={() => setAppForm({ ...appForm, mode: 'PRODUCTION' })}
        />
        <span>Produksi (untuk toko asli / test shop)</span>
       </label>
       <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <input
         type="radio"
         name="mode"
         checked={appForm.mode === 'SANDBOX'}
         onChange={() => setAppForm({ ...appForm, mode: 'SANDBOX' })}
        />
        <span>Sandbox (uji internal Shopee)</span>
       </label>
      </div>
     </div>
     <div className="field">
      <label>Redirect URL (didaftarkan di App Management Shopee)</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
       <input
        className="input mono"
        style={{ flex: '1 1 320px' }}
        value={appForm.redirectUrl}
        onChange={(e) => setAppForm({ ...appForm, redirectUrl: e.target.value })}
       />
       <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => {
         void navigator.clipboard.writeText(appForm.redirectUrl);
         setNotice({ tone: 'info', text: 'Redirect URL disalin ke clipboard.' });
        }}
       >
        Salin
       </button>
      </div>
     </div>

     <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <button type="submit" className="btn btn-primary" disabled={appSaving}>
       <Download size={15} aria-hidden />
       <span>{appSaving ? 'Menyimpan...' : 'Simpan Kredensial'}</span>
      </button>
      <button
       type="button"
       className="btn btn-secondary"
       disabled={appTesting || !appConfig?.configured}
       onClick={testAppConfig}
      >
       <Zap size={15} aria-hidden />
       <span>{appTesting ? 'Menghubungi Shopee...' : 'Uji Koneksi ke Shopee'}</span>
      </button>
     </div>
    </form>

    {appTestResult && (
     <div className="mt12">
      <Alert tone={appTestResult.ok ? 'success' : 'danger'}>
       {appTestResult.ok ? 'Berhasil: ' : 'Gagal: '}
       {appTestResult.message}
      </Alert>
     </div>
    )}

    {health?.needsProductSync && (
     <div className="mt12">
      <Alert tone="warning">
       <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <strong>{health.skippedOrders} pesanan Shopee dilewati karena produknya belum ada di sistem.</strong>
        {health.unmappedSkus.length > 0 && (
         <span>
          Kode produk yang belum terdaftar:{' '}
          <code className="mono">{health.unmappedSkus.slice(0, 8).join(', ')}</code>
          {health.unmappedSkus.length > 8 ? ` (+${health.unmappedSkus.length - 8} lagi)` : ''}
         </span>
        )}
        <span>Klik tombol &quot;Sinkronkan Produk&quot; di bawah supaya pesanan itu bisa masuk.</span>
       </div>
      </Alert>
     </div>
    )}
   </div>
   </details>

  </div>
 );
}
