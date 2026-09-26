'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Radio,
  RefreshCw,
  ShieldCheck,
  Wifi,
  Zap,
} from 'lucide-react';
import { api, formatDate } from '@/lib/api';

/**
 * Panel status sinkronisasi di kanan atas.
 *
 * Tugasnya dua:
 *  1. Menampilkan keadaan sebenarnya (toko mana, mode apa, kapan terakhir sinkron).
 *  2. Menjadi SATU-SATUNYA koneksi pembaruan langsung (SSE) untuk seluruh aplikasi —
 *     setiap event dari server diteruskan ke halaman lewat event browser
 *     `shopee:synced` (data pesanan/Stok) dan `fulfillment:updated` (proses kirim).
 */

interface StatusResponse {
  connected: boolean;
  status?: string;
  sandbox?: boolean;
  lastSyncAt?: string | null;
  partnerConfigured?: boolean;
  mode?: 'PRODUCTION' | 'SANDBOX';
  tokenExpiresInMinutes?: number | null;
  shop?: { id: string; name: string; externalShopId: string | null } | null;
  /** Sinkronisasi otomatis yang berjalan di sisi server (bukan di peramban). */
  autoSync?: {
    enabled: boolean;
    intervalMs: number;
    lastRunAt: string | null;
    lastImported: number | null;
    lastError: string | null;
  };
}

const FALLBACK_POLL_MS = 60_000;

export function AutoSyncStatus() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [checking, setChecking] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [realtime, setRealtime] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await api<StatusResponse>('/api/v1/integrations/shopee/status');
      setStatus(res);
      if (res.lastSyncAt) setLastSyncedAt(new Date(res.lastSyncAt));
      return res;
    } catch {
      setStatus({ connected: false });
      return null;
    } finally {
      setChecking(false);
    }
  }, []);

  /** Sinkronisasi ringan (pesanan + resi) — cadangan kalau webhook/stream terputus. */
  const runLightSync = useCallback(async (silent = true) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (!silent) setSyncing(true);
    try {
      const res = await api<{ synced: boolean }>('/api/v1/integrations/shopee/sync-light', {
        method: 'POST',
        body: {},
      });
      if (res.synced) {
        const now = new Date();
        setLastSyncedAt(now);
        setSecondsAgo(0);
      }
    } catch {
      // Diamkan: kegagalan sinkronisasi latar belakang tidak boleh mengganggu operator.
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, []);

  // 1) Pembaruan langsung dari server (SSE) → teruskan ke halaman lewat event browser.
  useEffect(() => {
    let source: EventSource | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      try {
        source = new EventSource('/api/v1/events/stream');

        source.onopen = () => setRealtime(true);

        source.onmessage = (event) => {
          let payload: { type?: string } = {};
          try {
            payload = JSON.parse(event.data) as { type?: string };
          } catch {
            return;
          }
          const now = new Date();
          setLastSyncedAt(now);
          setSecondsAgo(0);

          const type = payload.type ?? '';
          const orderEvents = ['orders:synced', 'order:new', 'order:updated', 'awb:updated', 'sync:complete'];
          const fulfillmentEvents = ['fulfillment:updated', 'inventory:updated'];

          if (orderEvents.includes(type)) {
            window.dispatchEvent(new CustomEvent('shopee:synced', { detail: { type, at: now.getTime() } }));
          }
          if (fulfillmentEvents.includes(type)) {
            window.dispatchEvent(new CustomEvent('fulfillment:updated', { detail: { type, at: now.getTime() } }));
          }
          if (orderEvents.includes(type) || fulfillmentEvents.includes(type)) {
            window.dispatchEvent(new CustomEvent('shopee:synced', { detail: { type, at: now.getTime() } }));
          }
        };

        source.onerror = () => {
          setRealtime(false);
          source?.close();
          reconnect = setTimeout(connect, 8000);
        };
      } catch {
        setRealtime(false);
      }
    };

    connect();

    return () => {
      stopped = true;
      source?.close();
      if (reconnect) clearTimeout(reconnect);
    };
  }, []);

  // 2) Cek status + sinkronisasi berkala (cadangan 60 detik).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const res = await loadStatus();
      if (cancelled || !res?.connected) return;
      await runLightSync(true);
    })();

    const poll = setInterval(() => void runLightSync(true), FALLBACK_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [loadStatus, runLightSync]);

  // Sinkron ulang saat tab dibuka kembali (kalau sudah lewat 1 menit).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (!lastSyncedAt || Date.now() - lastSyncedAt.getTime() > FALLBACK_POLL_MS)) {
        void runLightSync(true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [lastSyncedAt, runLightSync]);

  // Penghitung "berapa detik lalu".
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsAgo((prev) => (lastSyncedAt ? Math.floor((Date.now() - lastSyncedAt.getTime()) / 1000) : prev));
    }, 1000);
    return () => clearInterval(timer);
  }, [lastSyncedAt]);

  // Tutup panel kalau klik di luar.
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    if (isOpen) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [isOpen]);

  const timeAgoLabel = () => {
    if (!lastSyncedAt) return 'Menunggu sinkronisasi';
    if (secondsAgo < 10) return 'Baru saja';
    if (secondsAgo < 60) return `${secondsAgo} detik lalu`;
    const mins = Math.floor(secondsAgo / 60);
    return `${mins} menit lalu`;
  };

  if (checking) {
    return (
      <span className="badge badge-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <RefreshCw size={11} className="spin" aria-hidden />
        <span>Memeriksa Shopee...</span>
      </span>
    );
  }

  if (!status?.connected) {
    return (
      <a
        href="/dashboard/integrasi"
        className="badge badge-neutral"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, textDecoration: 'none' }}
        title="Toko Shopee belum terhubung. Klik untuk menghubungkan."
      >
        <Wifi size={11} aria-hidden />
        <span>Shopee belum terhubung</span>
      </a>
    );
  }

  const tokenMinutes = status.tokenExpiresInMinutes ?? null;
  const tokenSoon = tokenMinutes !== null && tokenMinutes <= 30;

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="badge badge-success"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          border: '1px solid currentColor',
          padding: '4px 10px',
          fontWeight: 600,
          fontSize: 12,
        }}
        title="Klik untuk melihat status sinkronisasi"
      >
        {syncing ? (
          <RefreshCw size={12} className="spin" aria-hidden />
        ) : (
          <Radio size={12} aria-hidden />
        )}
        {/*
         * Teks penuh "Tersambung (langsung) - baru saja" terlalu lebar untuk
         * layar sempit dan membuat topbar menabrak sidebar. Layar lebar tetap
         * mendapat teks lengkap; layar kecil hanya ikon + waktu, sementara
         * `title` di atas tetap menjelaskan statusnya saat hover/touch.
         */}
        <span className="auto-sync-label-full">
          {syncing
            ? 'Menyinkronkan...'
            : realtime
              ? `Tersambung (langsung) - ${timeAgoLabel()}`
              : `Tersambung - ${timeAgoLabel()}`}
        </span>
        <span className="auto-sync-label-short" aria-hidden>
          {syncing ? 'Sinkron' : timeAgoLabel()}
        </span>
        <ChevronDown size={11} style={{ opacity: 0.7 }} aria-hidden />
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 340,
            maxWidth: 'calc(100vw - 32px)',
            background: 'var(--surface-container, #ffffff)',
            border: '1px solid var(--outline-variant, #e5e7eb)',
            borderRadius: 12,
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.12)',
            padding: 16,
            zIndex: 1000,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>Status Sinkronisasi</div>
          <div className="small muted" style={{ marginBottom: 12 }}>
            {status.shop?.name ?? 'Toko Shopee'}
            {status.shop?.externalShopId ? ` (ID ${status.shop.externalShopId})` : ''}
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              background: 'var(--surface-low, #f9fafb)',
              padding: 10,
              borderRadius: 8,
              fontSize: 12,
              marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <ShieldCheck size={13} aria-hidden /> Kredensial aplikasi
              </span>
              <span style={{ fontWeight: 600, color: status.partnerConfigured ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)' }}>
                {status.partnerConfigured ? 'Lengkap' : 'Belum lengkap'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Radio size={13} aria-hidden /> Pembaruan langsung
              </span>
              <span style={{ fontWeight: 600, color: realtime ? 'var(--success, #10b981)' : 'var(--warning, #f59e0b)' }}>
                {realtime ? 'Aktif' : 'Menyambung ulang'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Clock size={13} aria-hidden /> Sinkron otomatis (server)
              </span>
              <span
                style={{
                  fontWeight: 600,
                  color: status.autoSync?.enabled ? 'var(--success, #10b981)' : 'var(--muted)',
                }}
              >
                {status.autoSync?.enabled
                  ? `Aktif tiap ${Math.round((status.autoSync.intervalMs || 60000) / 1000)} detik`
                  : 'Dimatikan'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Zap size={13} aria-hidden /> Sinkron server terakhir
              </span>
              <span style={{ fontWeight: 600 }}>
                {status.autoSync?.lastRunAt ? formatDate(status.autoSync.lastRunAt) : 'Belum jalan'}
                {status.autoSync?.lastImported ? ` (${status.autoSync.lastImported} data)` : ''}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <CheckCircle2 size={13} aria-hidden /> Terakhir sinkron
              </span>
              <span style={{ fontWeight: 600 }}>{lastSyncedAt ? formatDate(lastSyncedAt) : 'Belum ada'}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Wifi size={13} aria-hidden /> Mode aplikasi
              </span>
              <span style={{ fontWeight: 600 }}>
                {status.mode === 'SANDBOX' || status.sandbox ? 'Sandbox (uji)' : 'Produksi'}
              </span>
            </div>

            {tokenMinutes !== null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <AlertTriangle size={13} aria-hidden /> Masa berlaku token
                </span>
                <span style={{ fontWeight: 600, color: tokenSoon ? 'var(--danger, #ef4444)' : 'inherit' }}>
                  {tokenMinutes <= 0 ? 'Sudah kedaluwarsa' : `${tokenMinutes} menit lagi`}
                </span>
              </div>
            )}
          </div>

          {status.autoSync?.lastError && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                borderRadius: 8,
                padding: 10,
                fontSize: 12,
                marginBottom: 12,
              }}
            >
              <AlertTriangle size={14} aria-hidden style={{ color: 'var(--danger, #ef4444)', flexShrink: 0, marginTop: 1 }} />
              <span>
                Sinkronisasi otomatis terakhir gagal: {status.autoSync.lastError}. Sistem akan mencoba lagi
                otomatis; Anda juga bisa menekan tombol di bawah.
              </span>
            </div>
          )}

          <p className="small muted" style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
            Pesanan dan resi baru dari Shopee <strong>masuk sendiri</strong> ke halaman
            <strong> Pesanan &amp; Pengiriman</strong> setiap {Math.round((status.autoSync?.intervalMs || 60000) / 1000)} detik,
            tanpa perlu menekan tombol apa pun. Tombol di bawah hanya untuk mempercepat pembaruan saat itu juga.
          </p>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={syncing}
            onClick={() => void runLightSync(false)}
            style={{ width: '100%', justifyContent: 'center', gap: 6 }}
          >
            <Zap size={13} aria-hidden />
            <span>{syncing ? 'Sedang memperbarui...' : 'Sinkronkan Sekarang'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
