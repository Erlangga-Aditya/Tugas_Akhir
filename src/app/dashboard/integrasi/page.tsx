'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
 Cable, RefreshCw, Download, PlugZap, ShieldCheck, CircleAlert, KeyRound,
 Package, Undo2, Truck, Timer, AlertCircle, CheckCircle2, Zap,
} from 'lucide-react';
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
// Operation card component (reusable sync control)
// ─────────────────────────────────────────────────────────────────────────────

interface SyncCardProps {
 icon: React.ReactNode;
 title: string;
 description: string;
 buttonLabel: string;
 loadingLabel: string;
 disabled: boolean;
 lastRun?: SyncRun | null;
 onSync: () => Promise<void>;
}

function SyncCard({ icon, title, description, buttonLabel, loadingLabel, disabled, lastRun, onSync }: SyncCardProps) {
 const [loading, setLoading] = useState(false);

 async function handleClick() {
  setLoading(true);
  try { await onSync(); } finally { setLoading(false); }
 }

 return (
  <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
   <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
    <div style={{ flexShrink: 0, color: 'var(--primary)', marginTop: 2 }}>{icon}</div>
    <div style={{ flex: 1 }}>
     <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{title}</div>
     <p className="small muted" style={{ margin: 0, lineHeight: 1.5 }}>{description}</p>
    </div>
   </div>

   {lastRun && (
    <div className="small muted" style={{
     display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
     background: 'var(--surface-2)', borderRadius: 6,
    }}>
     {lastRun.status === 'COMPLETED'
      ? <CheckCircle2 size={13} style={{ color: 'var(--success)' }} aria-hidden />
      : <AlertCircle size={13} style={{ color: 'var(--danger)' }} aria-hidden />}
     <span>
      Terakhir: <strong>{formatDate(lastRun.startedAt)}</strong>
      {' · '}baca {lastRun.recordsRead}, tulis {lastRun.recordsWritten}
      {lastRun.errorMessage && ` · Error: ${lastRun.errorMessage.slice(0, 60)}`}
     </span>
    </div>
   )}

   <button
    type="button"
    className="btn btn-secondary btn-sm"
    onClick={handleClick}
    disabled={disabled || loading}
    style={{ alignSelf: 'flex-start' }}
   >
    {loading
     ? <><RefreshCw size={14} className="spin" aria-hidden /><span>{loadingLabel}</span></>
     : <><Download size={14} aria-hidden /><span>{buttonLabel}</span></>}
   </button>
  </div>
 );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function IntegrasiPage() {
 const [shop, setShop] = useState<Shop | null>(null);
 const [status, setStatus] = useState<ConnStatus | null>(null);
 const [allRuns, setAllRuns] = useState<SyncRun[]>([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState('');
 const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'info' | 'warning'; text: string } | null>(null);
 const [showForm, setShowForm] = useState(false);
 const [creds, setCreds] = useState({ externalShopId: '', accessToken: '', refreshToken: '' });
 const [syncingAll, setSyncingAll] = useState(false);
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

 const load = useCallback(async () => {
  try {
   const shops = await api<Shop[]>('/api/v1/shops');
   const s = shops.find((x) => x.provider === 'shopee') ?? shops[0] ?? null;
   setShop(s);
   shopRef.current = s;
   if (s) {
    const [st, runs] = await Promise.all([
     api<ConnStatus>(`/api/v1/integrations/shopee/status?shopId=${s.id}`),
     api<SyncRun[]>(`/api/v1/integrations/shopee/sync?shopId=${s.id}`).catch(() => [] as SyncRun[]),
    ]);
    setStatus(st);

    // Fetch all sync operations
    const [productRuns, returnRuns, trackingRuns] = await Promise.all([
     api<SyncRun[]>(`/api/v1/integrations/shopee/sync-products?shopId=${s.id}`).catch(() => [] as SyncRun[]),
     api<SyncRun[]>(`/api/v1/integrations/shopee/sync-returns?shopId=${s.id}`).catch(() => [] as SyncRun[]),
     api<SyncRun[]>(`/api/v1/integrations/shopee/sync-tracking?shopId=${s.id}`).catch(() => [] as SyncRun[]),
    ]);
    setAllRuns([...runs, ...productRuns, ...returnRuns, ...trackingRuns].sort(
     (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    ));
   } else {
    setStatus(null);
    setAllRuns([]);
   }
  } catch (e) {
   setError((e as Error).message);
  } finally {
   setLoading(false);
  }
 }, []);

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

 // ── Sync handlers ────────────────────────────────────────────────────────

 async function doSync(endpoint: string, label: string) {
  const s = shopRef.current;
  if (!s) return;
  setNotice(null);
  try {
   const res = await api<{ message: string; syncRun: { recordsRead: number; recordsWritten: number } }>(
    `/api/v1/integrations/shopee/${endpoint}`,
    { method: 'POST', body: { shopId: s.id } },
   );
   setNotice({
    tone: 'success',
    text: `${res.message} (${res.syncRun.recordsRead} dibaca, ${res.syncRun.recordsWritten} ditulis ke database).`,
   });
   await load();
  } catch (e) {
   setNotice({ tone: 'danger', text: `${label} gagal: ${(e as Error).message}` });
  }
 }

 async function doSyncAll() {
  const s = shopRef.current;
  if (!s) return;
  setNotice(null);
  setSyncingAll(true);
  try {
   type SyncResult = { status: string; error?: string; recordsWritten?: number };
   const res = await api<{ success: boolean; results: Record<string, SyncResult> }>(
    '/api/v1/integrations/shopee/sync-all',
    { method: 'POST', body: { shopId: s.id } },
   );
   const parts = Object.entries(res.results).map(([k, v]) =>
    `${k}: ${v.status}${v.recordsWritten != null ? ` (${v.recordsWritten} ditulis)` : ''}${v.error ? ` — ${v.error.slice(0, 80)}` : ''}`,
   );
   setNotice({
    tone: res.success ? 'success' : 'warning',
    text: `Sinkronisasi selesai! ${parts.join(' | ')}`,
   });
   await load();
  } catch (e) {
   setNotice({ tone: 'danger', text: `Sinkronisasi Semua gagal: ${(e as Error).message}` });
  } finally {
   setSyncingAll(false);
  }
 }

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

 async function submitCreds(e: React.FormEvent) {
  e.preventDefault();
  const s = shopRef.current;
  if (!s) return;
  setNotice(null);
  try {
   await api('/api/v1/integrations/shopee/connect', { method: 'POST', body: { shopId: s.id, ...creds } });
   setNotice({ tone: 'success', text: 'Kredensial Shopee berhasil disimpan dan terenkripsi AES-256-GCM.' });
   setShowForm(false);
   await load();
  } catch (err) {
   setNotice({ tone: 'danger', text: (err as Error).message });
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

 const lastOrderRun = allRuns.find((r) => r.operation === 'import_orders') ?? null;
 const lastProductRun = allRuns.find((r) => r.operation === 'sync_products') ?? null;
 const lastReturnRun = allRuns.find((r) => r.operation === 'sync_returns') ?? null;
 const lastTrackingRun = allRuns.find((r) => r.operation === 'sync_tracking') ?? null;

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
       <strong>Mode Environment:</strong> Jika app Anda sudah live di <code>open.shopee.com</code> (Production), setel <code className="mono">SHOPEE_SANDBOX=&quot;false&quot;</code> di <code className="mono">.env</code>. Jika masih di sandbox console, setel <code className="mono">SHOPEE_SANDBOX=&quot;true&quot;</code>.
      </li>
     </ol>
     <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#166534' }}>
      <strong>Alur Sinkronisasi Otomatis:</strong> Setelah otorisasi berhasil, webhook Shopee dan SSE otomatis aktif. Setiap ada pesanan checkout masuk di toko Shopee Anda, sistem akan langsung menampilkannya di dashboard tanpa perlu klik manual.
     </div>
    </div>
   </div>

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
     <button type="button" className="btn btn-secondary" onClick={doRefreshToken} disabled={!connected}>
      <Zap size={16} aria-hidden />
      <span>Refresh Token Sekarang</span>
     </button>
     <button type="button" className="btn btn-ghost" onClick={() => setShowForm((v) => !v)}>
      <KeyRound size={15} aria-hidden />
      <span>{showForm ? 'Sembunyikan Form' : 'Input Token Manual (Dev)'}</span>
     </button>
    </div>

    {!connected && (
     <div className="small muted mt12" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <CircleAlert size={14} style={{ color: 'var(--tertiary)' }} aria-hidden />
      <span>Semua fitur sinkronisasi aktif setelah toko berhasil dihubungkan.</span>
     </div>
    )}

    {showForm && (
     <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--divider)' }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Input Token Kredensial Manual (Development Only)</h3>
      <form onSubmit={submitCreds} style={{ maxWidth: 480 }}>
       <div className="field">
        <label>External Shop ID (Shopee numeric shop_id)</label>
        <input type="text" className="input" value={creds.externalShopId}
         onChange={(e) => setCreds({ ...creds, externalShopId: e.target.value })}
         required placeholder="Contoh: 227924374" />
       </div>
       <div className="field">
        <label>Access Token (valid 4 jam)</label>
        <input type="text" className="input mono" value={creds.accessToken}
         onChange={(e) => setCreds({ ...creds, accessToken: e.target.value })}
         required placeholder="access_token dari Shopee API" />
       </div>
       <div className="field">
        <label>Refresh Token (valid 30 hari, sekali pakai)</label>
        <input type="text" className="input mono" value={creds.refreshToken}
         onChange={(e) => setCreds({ ...creds, refreshToken: e.target.value })}
         required placeholder="refresh_token dari Shopee API" />
       </div>
       <button type="submit" className="btn btn-primary">Simpan &amp; Enkripsi (AES-256-GCM)</button>
      </form>
     </div>
    )}
   </div>

   {/* Sync Operations Grid */}
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

   {/* ── Sinkronkan Semua (Primary CTA) ───────────────────────────────────── */}
   {connected && (
    <div className="card mb20" style={{ background: 'var(--primary)', color: '#fff' }}>
     <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
      <div>
       <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>Sinkronkan Semua Data Sekaligus</div>
       <p style={{ margin: 0, fontSize: 13, opacity: 0.88, lineHeight: 1.5 }}>
        Tarik Produk → Pesanan → Update Tracking → Sinkronkan Return dalam satu klik.
        Idempoten: aman dijalankan berkali-kali.
       </p>
      </div>
      <button
       type="button"
       className="btn btn-sm"
       style={{ background: '#fff', color: 'var(--primary)', fontWeight: 700, minWidth: 180, border: 'none' }}
       onClick={doSyncAll}
       disabled={syncingAll}
      >
       {syncingAll
        ? <><RefreshCw size={14} className="spin" aria-hidden /><span>Menyinkronkan...</span></>
        : <><Package size={14} aria-hidden /><span>Sinkronkan Semua Data</span></>}
      </button>
     </div>
    </div>
   )}

   <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, marginBottom: 24 }}>
    <SyncCard
     icon={<Package size={22} />}
     title="Sinkronkan Produk dari Shopee"
     description="Tarik semua produk & varian dari Shopee Seller Center (wajib dilakukan pertama kali sebelum sinkronisasi pesanan agar mapping SKU terbentuk)."
     buttonLabel="Sinkronkan Produk"
     loadingLabel="Menarik Produk..."
     disabled={!connected}
     lastRun={lastProductRun}
     onSync={() => doSync('sync-products', 'Sinkronisasi Produk')}
    />
    <SyncCard
     icon={<Download size={22} />}
     title="Tarik Pesanan Terbaru"
     description="Sinkronkan pesanan baru dari Shopee (7 hari terakhir). Order baru langsung masuk antrian fulfillment jika status READY_TO_SHIP."
     buttonLabel="Tarik Pesanan"
     loadingLabel="Menarik Pesanan..."
     disabled={!connected}
     lastRun={lastOrderRun}
     onSync={() => doSync('sync', 'Sinkronisasi Pesanan')}
    />
    <SyncCard
     icon={<Truck size={22} />}
     title="Update Tracking Pengiriman"
     description="Perbarui nomor resi (AWB) dan status pengiriman dari kurir Shopee untuk semua paket yang sedang dalam perjalanan."
     buttonLabel="Update Tracking"
     loadingLabel="Memperbarui Tracking..."
     disabled={!connected}
     lastRun={lastTrackingRun}
     onSync={() => doSync('sync-tracking', 'Sinkronisasi Tracking')}
    />
    <SyncCard
     icon={<Undo2 size={22} />}
     title="Sinkronkan Return/Pengembalian"
     description="Tarik data pengembalian barang dari Shopee dan sinkronkan ke modul Pengembalian untuk proses inspeksi QC."
     buttonLabel="Sinkronkan Return"
     loadingLabel="Menarik Data Return..."
     disabled={!connected}
     lastRun={lastReturnRun}
     onSync={() => doSync('sync-returns', 'Sinkronisasi Return')}
    />
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
     </div>
    )}
   </div>
  </div>
 );
}
