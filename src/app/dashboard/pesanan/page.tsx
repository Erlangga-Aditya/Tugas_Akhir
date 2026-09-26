'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  Boxes,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Handshake,
  Info,
  Plus,
  PackageCheck,
  Printer,
  RefreshCw,
  ScanLine,
  Truck,
  XCircle,
} from 'lucide-react';
import { api, formatDate, openOfficialLabel } from '@/lib/api';
import { deriveOperatorWorkflow } from '@/modules/fulfillment/domain/operator-workflow';
import { Alert, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { BarcodeScanner, playScanFeedback } from '@/components/barcode-scanner';
import { StockPanel } from '@/components/stock-panel';

// ─────────────────────────────────────────────────────────────────────────────
// Tipe data (mengikuti /api/v1/fulfillment/station)
// ─────────────────────────────────────────────────────────────────────────────

// type Stage = 'BARU' | 'MENUNGGU_STOK' | 'SIAP_DIKEMAS' | 'SIAP_KIRIM' | 'DIKIRIM';

interface OrderItemRow {
  id: string;
  variantId: string;
  sku: string;
  variantName: string;
  productName: string;
  quantity: number;
  fulfilledQuantity: number;
  available: number;
  shortfall: number;
}

interface StationOrder {
  orderId: string;
  externalOrderId: string;
  buyerName: string | null;
  buyerPhone: string | null;
  shopName: string;
  provider: string;
  placedAt: string;
  shipByAt: string | null;
  priorityLevel: string | null;
  orderStatus: string;
  fulfillmentId: string | null;
  fulfillmentStatus: string | null;
  awb: string | null;
  carrier: string | null;
  canArrangeShipment: boolean;
  /** Barang hanya boleh dinyatakan siap kirim setelah nomor resi terbit. */
  canPack: boolean;
  stage: Stage;
  items: OrderItemRow[];
  totalUnits: number;
  shortfallUnits: number;
}

interface StationResponse {
  warehouse: { id: string; name: string; code: string } | null;
  sort: 'oldest' | 'newest';
  stages: {
    baru: number;
    menungguStok: number;
    siapDikemas: number;
    siapKirim: number;
    dikirim: number;
    dibatalkan: number;
  };
  orders: StationOrder[];
  generatedAt: string;
}

interface ScanOutcome {
  code:
    | 'PACKED'
    | 'ALREADY_PACKED'
    | 'ALREADY_HANDED_OVER'
    | 'NEEDS_SHIPMENT'
    | 'NEEDS_PICKING'
    | 'WAITING_STOCK'
    | 'NOT_QUEUED'
    | 'EXCEPTION'
    | 'NOT_FOUND';
  message: string;
  stockDeducted: boolean;
  deductedUnits: number;
  needsConfirmation: 'PICKING' | 'NEGATIVE_STOCK' | null;
  shortfalls: Array<{ sku: string; productName: string; required: number; available: number; missing: number }>;
  order: { id: string; externalOrderId: string; canPrintOfficialLabel: boolean } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Halaman
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Bagian tampilan yang dipakai berulang
// ─────────────────────────────────────────────────────────────────────────────

type Stage = 'BARU' | 'MENUNGGU_STOK' | 'SIAP_DIKEMAS' | 'SIAP_KIRIM' | 'DIKIRIM' | 'DIBATALKAN';

const STAGE_LABEL: Record<Stage, string> = {
  BARU: 'Perlu Diproses',
  MENUNGGU_STOK: 'Menunggu Stok',
  SIAP_DIKEMAS: 'Siap Dikemas',
  SIAP_KIRIM: 'Siap Kirim',
  DIKIRIM: 'Sudah Dikirim',
  DIBATALKAN: 'Dibatalkan',
};

const STAGE_TONE: Record<Stage, string> = {
  BARU: 'var(--warning, #f59e0b)',
  MENUNGGU_STOK: 'var(--danger, #ef4444)',
  SIAP_DIKEMAS: 'var(--secondary, #7c3aed)',
  SIAP_KIRIM: 'var(--success, #10b981)',
  DIKIRIM: 'var(--muted)',
  DIBATALKAN: 'var(--danger, #ef4444)',
};

/** Panduan 4 langkah supaya operator baru langsung paham alurnya. */
function StepGuide() {
  const steps = [
    { no: 1, title: 'Pesanan masuk', desc: 'Otomatis dari Shopee' },
    { no: 2, title: 'Ambil resi', desc: 'Klik "Ambil Resi dari Shopee"' },
    { no: 3, title: 'Scan resi', desc: 'Stok gudang otomatis berkurang' },
    { no: 4, title: 'Serahkan ke kurir', desc: 'Paket selesai diproses' },
  ];
  return (
    <div className="card mb20">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {steps.map((s) => (
          <div key={s.no} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 220px' }}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'var(--primary-container, #e0f2fe)',
                color: 'var(--primary, #0284c7)',
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {s.no}
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{s.title}</div>
              <div className="small muted">{s.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ItemTable({
  items,
  onAddStock,
}: {
  items: OrderItemRow[];
  onAddStock?: (item: OrderItemRow) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Produk</th>
            <th>Kode (SKU)</th>
            <th className="num">Jumlah</th>
            <th className="num">Stok gudang</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td>
                <div style={{ fontWeight: 600 }}>{it.productName}</div>
                {it.variantName && it.variantName !== it.productName ? (
                  <div className="small muted">Varian: {it.variantName}</div>
                ) : null}
              </td>
              <td>
                <code className="mono">{it.sku}</code>
              </td>
              <td className="num">{it.quantity}</td>
              <td className="num">
                {it.shortfall > 0 ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--danger)', fontWeight: 700 }}>
                      {it.available} (kurang {it.shortfall})
                    </span>
                    {onAddStock && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAddStock(it)}>
                        <Plus size={12} aria-hidden />
                        <span>Tambah stok</span>
                      </button>
                    )}
                  </span>
                ) : (
                  <span style={{ color: 'var(--success)', fontWeight: 600 }}>{it.available}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PesananPengirimanPage() {
  const [data, setData] = useState<StationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'info' | 'warning'; text: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [printingLabelId, setPrintingLabelId] = useState<string | null>(null);
  const [sort, setSort] = useState<'oldest' | 'newest'>('oldest');
  const [stageFilter, setStageFilter] = useState<'SEMUA' | Stage>('SEMUA');
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [stockOpen, setStockOpen] = useState(false);
  const [stockVariantId, setStockVariantId] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [scannerFocusRequest, setScannerFocusRequest] = useState(0);
  /**
   * Izin "stok minus" untuk SATU pemindaian berikutnya. Harus one-shot: begitu
   * dipakai langsung dibuang, supaya tidak pernah ikut terpakai untuk barcode
   * pesanan lain yang kebetulan dipindai setelahnya.
   */
  const [negativeStockApproved, setNegativeStockApproved] = useState(false);
  const scannerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (sortMode: 'oldest' | 'newest' = sort) => {
    try {
      const res = await api<StationResponse>(`/api/v1/fulfillment/station?sort=${sortMode}`);
      setData(res);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sort]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      await load(sort);
    })();
    const onRealtime = () => void load(sort);
    window.addEventListener('shopee:synced', onRealtime);
    window.addEventListener('fulfillment:updated', onRealtime);
    const refresh = setInterval(() => void load(sort), 30000);
    const clock = setInterval(() => setNow(new Date()), 60000);
    return () => {
      cancelled = true;
      window.removeEventListener('shopee:synced', onRealtime);
      window.removeEventListener('fulfillment:updated', onRealtime);
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, [load, sort]);

  const filtered = useMemo(() => {
    const list = data?.orders ?? [];
    return stageFilter === 'SEMUA' ? list : list.filter((o) => o.stage === stageFilter);
  }, [data, stageFilter]);

  // Cetak label RESMI Shopee: unduh file dari Shopee, lalu buka di tab baru.
 // Tidak pernah memakai label buatan — kalau Shopee menolak, tampilkan pesan errornya.
 async function handlePrintOfficialLabel(orderId: string, orderSn: string) {
   setPrintingLabelId(orderId);
   setNotice(null);
   try {
     await openOfficialLabel(orderId);
   } catch (err) {
     setNotice({
       tone: 'danger',
       text: `Label resmi pesanan ${orderSn} belum bisa dicetak: ${(err as Error).message}`,
     });
   } finally {
     setPrintingLabelId(null);
   }
 }

  async function run(key: string, fn: () => Promise<unknown>, successMsg?: string) {
    setBusyKey(key);
    setNotice(null);
    try {
      const result = await fn();
      if (successMsg) setNotice({ tone: 'success', text: successMsg });
      await load(sort);
      return result;
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
      return null;
    } finally {
      setBusyKey(null);
    }
  }

  const scanResi = useCallback(
    async (code: string) => {
      setBusyKey('scan');
      setNotice(null);
      try {
        // Izin stok minus hanya berlaku untuk SATU pemindaian berikutnya (one-shot):
        // langsung dibuang setelah dipakai supaya tidak pernah "bocor" ke barcode
        // pesanan lain yang dipindai berikutnya.
        const allowNegativeStock = negativeStockApproved;
        if (negativeStockApproved) setNegativeStockApproved(false);

        const res = await api<ScanOutcome>('/api/v1/fulfillment/scan-awb', {
          method: 'POST',
          body: {
            scannedCode: code,
            confirmPicking: true,
            allowNegativeStock,
          },
        });
        setOutcome(res);
        playScanFeedback(res.stockDeducted || res.code !== 'NOT_FOUND');
        await load(sort);
      } catch (e) {
        setOutcome(null);
        setNotice({ tone: 'danger', text: (e as Error).message });
        playScanFeedback(false);
      } finally {
        setBusyKey(null);
      }
    },
    [load, negativeStockApproved, sort],
  );

  async function ambilResi(orderId: string) {
    return run(
      `resi-${orderId}`,
      async () => {
        const res = await api<{ message: string }>(`/api/v1/orders/${orderId}/prepare-shipment`, {
          method: 'POST',
          body: {},
        });
        setNotice({ tone: 'success', text: res.message });
        return res;
      },
      undefined,
    );
  }

  async function siapkanTanpaResi(order: StationOrder) {
    if (!data?.warehouse) {
      setNotice({ tone: 'danger', text: 'Belum ada gudang aktif. Tambahkan gudang di menu Pengaturan.' });
      return;
    }
    return run(
      `siap-${order.orderId}`,
      () => api(`/api/v1/orders/${order.orderId}/reserve`, { method: 'POST', body: { warehouseId: data.warehouse!.id } }),
      'Pesanan siap dikemas. Scan resinya untuk menyelesaikan.',
    );
  }

  function focusScanner() {
    setScannerFocusRequest((value) => value + 1);
    scannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function focusScannerForOrder(order: StationOrder) {
    setStageFilter('SEMUA');
    setScannerFocusRequest((value) => value + 1);
    setNotice({
      tone: 'info',
      text: `Pindai barcode resi untuk pesanan ${order.externalOrderId}. Jangan ketik nomor pesanan sebagai pengganti resi.`,
    });
    scannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function changeSort(next: 'oldest' | 'newest') {
    setSort(next);
    setLoading(true);
    void load(next);
  }

  if (loading) return <LoadingState message="Memuat daftar pesanan..." />;
  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); void load(sort); }} />;

  const stages = data?.stages;
  const filters: Array<{ key: 'SEMUA' | Stage; label: string; count: number }> = [
    { key: 'SEMUA', label: 'Semua', count: data?.orders.length ?? 0 },
    { key: 'BARU', label: 'Perlu Diproses', count: stages?.baru ?? 0 },
    { key: 'MENUNGGU_STOK', label: 'Menunggu Stok', count: stages?.menungguStok ?? 0 },
    { key: 'SIAP_DIKEMAS', label: 'Siap Dikemas', count: stages?.siapDikemas ?? 0 },
    { key: 'SIAP_KIRIM', label: 'Siap Kirim', count: stages?.siapKirim ?? 0 },
    { key: 'DIBATALKAN', label: 'Dibatalkan', count: stages?.dibatalkan ?? 0 },
  ];

  return (
    <div style={{ paddingBottom: 60 }}>
      <PageHeader
        title="Pesanan & Pengiriman"
        subtitle="Pesanan masuk sampai diserahkan ke kurir — semua dikerjakan di halaman ini"
        actions={
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setLoading(true); void load(sort); }}>
            <RefreshCw size={14} aria-hidden />
            <span>Muat Ulang</span>
          </button>
        }
      />

      {notice && (
        <div className="mb16">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      {!data?.warehouse && (
        <div className="mb16">
          <Alert tone="warning">
            Belum ada gudang aktif. Tambahkan gudang di menu <strong>Pengaturan</strong> supaya pesanan bisa diproses.
          </Alert>
        </div>
      )}

      <StepGuide />

      {/* Ringkasan tahapan */}
      <div className="stat-grid mb20">
        {[
          { label: 'Perlu Diproses', value: stages?.baru ?? 0, tone: STAGE_TONE.BARU },
          { label: 'Menunggu Stok', value: stages?.menungguStok ?? 0, tone: STAGE_TONE.MENUNGGU_STOK },
          { label: 'Siap Dikemas', value: stages?.siapDikemas ?? 0, tone: STAGE_TONE.SIAP_DIKEMAS },
          { label: 'Siap Kirim', value: stages?.siapKirim ?? 0, tone: STAGE_TONE.SIAP_KIRIM },
          { label: 'Sudah Dikirim', value: stages?.dikirim ?? 0, tone: STAGE_TONE.DIKIRIM },
          { label: 'Dibatalkan', value: stages?.dibatalkan ?? 0, tone: STAGE_TONE.DIBATALKAN },
        ].map((c) => (
          <div className="card" key={c.label}>
            <div className="small muted">{c.label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: c.tone }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="card mb20" ref={scannerRef}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ScanLine size={18} aria-hidden />
          <span>Scan Resi</span>
        </h2>
        <p className="small muted" style={{ marginTop: 0, marginBottom: 12 }}>
          Scan hanya dipakai saat pesanan sudah berstatus <strong>Siap Dikemas</strong>. Pastikan nomor resi sudah muncul
          dan stok gudang cukup. Setelah discan, stok berkurang dan pesanan otomatis berpindah ke <strong>Siap Kirim</strong>;
          setelah itu baru tekan <strong>Serahkan ke Kurir</strong>.
        </p>

        <BarcodeScanner
          label=""
          submitLabel="Selesaikan"
          placeholder="Scan barcode resi (bukan nomor pesanan)"
          focusRequest={scannerFocusRequest}
          onScan={(code) => {
            void scanResi(code);
          }}
          hint="Pindai barcode resi dengan kamera atau alat scan USB. Nomor resi harus sama dengan yang tertera di paket."
        />

        {outcome && (
          <div
            style={{
              marginTop: 14,
              border: `1px solid ${
                outcome.code === 'PACKED' || outcome.code === 'ALREADY_PACKED' || outcome.code === 'ALREADY_HANDED_OVER'
                  ? 'var(--success, #10b981)'
                  : outcome.code === 'NOT_FOUND'
                    ? 'var(--danger, #ef4444)'
                    : 'var(--warning, #f59e0b)'
              }`,
              borderRadius: 12,
              padding: 16,
              background: 'var(--surface-container, #fff)',
            }}
          >
            <div style={{ display: 'flex', gap: 10 }}>
              {outcome.code === 'PACKED' || outcome.code === 'ALREADY_PACKED' || outcome.code === 'ALREADY_HANDED_OVER' ? (
                <CheckCircle2 size={20} aria-hidden style={{ color: 'var(--success, #10b981)', flexShrink: 0 }} />
              ) : outcome.code === 'NOT_FOUND' || outcome.code === 'EXCEPTION' ? (
                <XCircle size={20} aria-hidden style={{ color: 'var(--danger, #ef4444)', flexShrink: 0 }} />
              ) : (
                <AlertTriangle size={20} aria-hidden style={{ color: 'var(--warning, #f59e0b)', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {outcome.code === 'PACKED'
                    ? 'Pesanan selesai diproses — stok gudang sudah berkurang'
                    : outcome.code === 'NEEDS_SHIPMENT'
                      ? 'Resi belum ada — atur pengiriman dulu'
                    : outcome.code === 'ALREADY_PACKED'
                      ? 'Pesanan ini sudah pernah diselesaikan'
                      : outcome.code === 'ALREADY_HANDED_OVER'
                        ? 'Pesanan sudah diserahkan ke kurir'
                        : outcome.code === 'NOT_FOUND'
                          ? 'Resi / nomor pesanan tidak dikenali'
                          : 'Belum bisa diselesaikan'}
                </div>
                <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.5 }}>{outcome.message}</p>

                {outcome.shortfalls.length > 0 && (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                    {outcome.shortfalls.map((s) => (
                      <li key={s.sku}>
                        <code className="mono">{s.sku}</code> — {s.productName}: butuh {s.required}, ada {s.available},
                        kurang <strong>{s.missing}</strong>
                      </li>
                    ))}
                  </ul>
                )}

                <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {outcome.order && (
                    <>
                      {outcome.order.canPrintOfficialLabel ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={printingLabelId === outcome.order.id}
                          onClick={() => void handlePrintOfficialLabel(outcome.order!.id, outcome.order!.externalOrderId)}
                        >
                          <Printer size={13} aria-hidden />
                          <span>
                            {printingLabelId === outcome.order.id ? 'Menyiapkan label…' : 'Cetak Label Resi'}
                          </span>
                        </button>
                      ) : (
                        <span className="small muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Printer size={13} aria-hidden />
                          <span>Label resmi muncul setelah nomor resi dari Shopee ada</span>
                        </span>
                      )}
                      <Link className="btn btn-ghost btn-sm" href={`/dashboard/pesanan/${outcome.order.id}`}>
                        <ExternalLink size={13} aria-hidden />
                        <span>Lihat Detail Pesanan</span>
                      </Link>
                    </>
                  )}
                  {outcome.code === 'NEEDS_SHIPMENT' && outcome.order && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busyKey === `resi-${outcome.order.id}`}
                      onClick={() => void ambilResi(outcome.order!.id)}
                    >
                      <Truck size={13} aria-hidden />
                      <span>Ambil Resi dari Shopee</span>
                    </button>
                  )}
                  {outcome.needsConfirmation === 'NEGATIVE_STOCK' && outcome.order && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busyKey === 'scan'}
                      onClick={() => {
                        setOutcome(null);
                        setNegativeStockApproved(true);
                        setNotice({ tone: 'info', text: 'Pindai ulang barcode resi paket ini untuk melanjutkan dengan stok minus.' });
                        focusScanner();
                      }}
                    >
                      <PackageCheck size={13} aria-hidden />
                      <span>Tetap kirim (stok jadi minus)</span>
                    </button>
                  )}
                  {(outcome.needsConfirmation === 'NEGATIVE_STOCK' || outcome.code === 'NOT_FOUND') && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setStockVariantId(null);
                        setStockOpen(true);
                      }}
                    >
                      <Boxes size={13} aria-hidden />
                      <span>Buka Stok Gudang</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stok gudang */}
      <StockPanel
        open={stockOpen}
        onClose={() => {
          setStockOpen(false);
          setStockVariantId(null);
        }}
        warehouseId={data?.warehouse?.id ?? null}
        prefillVariantId={stockVariantId}
        onDone={(message) => {
          setNotice({ tone: 'success', text: message });
          void load(sort);
        }}
      />

      {!stockOpen && (
        <div className="mb20">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setStockVariantId(null);
              setStockOpen(true);
            }}
          >
            <Boxes size={15} aria-hidden />
            <span>Buka Stok Gudang</span>
          </button>
        </div>
      )}

      {/* Daftar pesanan */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Daftar Pesanan ({filtered.length})</h2>
        <div className="filter-chips">
          <button
            type="button"
            className={`btn btn-sm ${sort === 'oldest' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => changeSort('oldest')}
            title="Pesanan yang paling lama menunggu ditampilkan lebih dulu"
          >
            <ArrowUpWideNarrow size={13} aria-hidden />
            <span>Terlama dulu</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm ${sort === 'newest' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => changeSort('newest')}
            title="Pesanan terbaru ditampilkan lebih dulu"
          >
            <ArrowDownWideNarrow size={13} aria-hidden />
            <span>Terbaru dulu</span>
          </button>
        </div>
      </div>

      <div className="filter-chips mb16">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`btn btn-sm ${stageFilter === f.key ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setStageFilter(f.key)}
          >
            <span>
              {f.label} ({f.count})
            </span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState title="Tidak ada pesanan di tahap ini" description="Pilih filter lain, atau tunggu pesanan baru masuk dari Shopee." />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map((o) => {
            const hoursLeft = o.shipByAt && now ? Math.round((new Date(o.shipByAt).getTime() - now.getTime()) / 3600000) : null;
            const urgent = hoursLeft !== null && hoursLeft <= 24;
            const workflow = deriveOperatorWorkflow({
              stage: o.stage,
              hasAwb: Boolean(o.awb?.trim()),
              hasShortfall: o.shortfallUnits > 0,
            });
            return (
              <div className="card" key={o.orderId} style={{ borderLeft: `3px solid ${STAGE_TONE[o.stage]}` }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 12,
                    flexWrap: 'wrap',
                    marginBottom: 10,
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="mono" style={{ fontWeight: 700 }}>{o.externalOrderId}</span>
                      <span className="badge badge-neutral">{STAGE_LABEL[o.stage]}</span>
                      {o.awb ? (
                        <span className="badge badge-neutral mono" style={{ fontSize: 11 }}>{o.awb}</span>
                      ) : (
                        <span className="badge badge-neutral" style={{ fontSize: 11 }}>Resi belum ada</span>
                      )}
                      {urgent && hoursLeft !== null && (
                        <span className="badge badge-danger" style={{ fontSize: 11 }}>
                          {hoursLeft < 0 ? `Lewat ${Math.abs(hoursLeft)} jam` : `Sisa ${hoursLeft} jam`}
                        </span>
                      )}
                    </div>
                    <div className="small muted" style={{ marginTop: 4 }}>
                      {o.buyerName ?? 'Pembeli Shopee'} · {o.shopName} · masuk{' '}
                      {formatDate(o.placedAt)} · batas kirim {formatDate(o.shipByAt)} · {o.totalUnits} barang
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {workflow.nextAction === 'ARRANGE_SHIPMENT' && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busyKey === `resi-${o.orderId}`}
                        title="Minta nomor resi ke Shopee supaya paket bisa lanjut ke tahap pemrosesan"
                        onClick={() => void ambilResi(o.orderId)}
                      >
                        <Truck size={13} aria-hidden />
                        <span>{busyKey === `resi-${o.orderId}` ? 'Memproses...' : 'Atur Pengiriman (Ambil Resi)'}</span>
                      </button>
                    )}

                    {workflow.nextAction === 'PROCESS_ORDER' && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busyKey === `siap-${o.orderId}`}
                        onClick={() => void siapkanTanpaResi(o)}
                      >
                        <ClipboardList size={13} aria-hidden />
                        <span>{busyKey === `siap-${o.orderId}` ? 'Memproses...' : 'Mulai Proses Pesanan'}</span>
                      </button>
                    )}

                    {workflow.nextAction === 'ADD_STOCK' && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          setStockVariantId(o.items.find((i) => i.shortfall > 0)?.variantId ?? null);
                          setStockOpen(true);
                        }}
                      >
                        <Boxes size={13} aria-hidden />
                        <span>Isi Stok dulu</span>
                      </button>
                    )}

                    {workflow.nextAction === 'SCAN_AWB' && o.awb && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busyKey === `kemas-${o.orderId}`}
                        title="Kembalikan fokus ke pemindai; operator tetap harus memindai barcode resi"
                        onClick={() => focusScannerForOrder(o)}
                      >
                        <ScanLine size={13} aria-hidden />
                        <span>{busyKey === `kemas-${o.orderId}` ? 'Memproses...' : 'Scan Resi untuk Selesai'}</span>
                      </button>
                    )}

                    {workflow.nextAction === 'HANDOVER' && o.fulfillmentId && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busyKey === `serah-${o.orderId}`}
                        onClick={() =>
                          void run(
                            `serah-${o.orderId}`,
                            () =>
                              api(`/api/v1/fulfillment/orders/${o.fulfillmentId}/handover`, {
                                method: 'POST',
                                body: o.awb ? { awb: o.awb, carrier: o.carrier ?? undefined } : {},
                              }),
                            'Paket sudah diserahkan ke kurir.',
                          )
                        }
                      >
                        <Handshake size={13} aria-hidden />
                        <span>{busyKey === `serah-${o.orderId}` ? 'Memproses...' : 'Serahkan ke Kurir'}</span>
                      </button>
                    )}

                    {(o.stage === 'SIAP_DIKEMAS' || o.stage === 'SIAP_KIRIM' || o.stage === 'DIKIRIM') && o.awb && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={printingLabelId === o.orderId}
                        onClick={() => void handlePrintOfficialLabel(o.orderId, o.externalOrderId)}
                      >
                        <Printer size={13} aria-hidden />
                        <span>{printingLabelId === o.orderId ? 'Menyiapkan label…' : 'Cetak Label Resi'}</span>
                      </button>
                    )}

                    <Link className="btn btn-ghost btn-sm" href={`/dashboard/pesanan/${o.orderId}`}>
                      <Info size={13} aria-hidden />
                      <span>Detail</span>
                    </Link>
                  </div>
                </div>

                {!o.awb && (
                  <div style={{ marginBottom: 10 }}>
                    <Alert tone="info">
                      Nomor resi belum ada. Klik <strong>Atur Pengiriman (Ambil Resi)</strong> supaya Shopee
                      menerbitkan nomor resi, baru paket bisa dinyatakan siap kirim.
                    </Alert>
                  </div>
                )}

                {o.shortfallUnits > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <Alert tone="warning">
                      Stok gudang kurang {o.shortfallUnits} barang untuk pesanan ini. Tambah stok dulu, atau pilih
                      &quot;Tetap kirim (stok jadi minus)&quot;.
                    </Alert>
                  </div>
                )}

                <ItemTable
                  items={o.items}
                  onAddStock={(item) => {
                    setStockVariantId(item.variantId);
                    setStockOpen(true);
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
