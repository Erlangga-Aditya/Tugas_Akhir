'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pagination } from '@/components/pagination';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  Ban,
  Clock,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Info,
  PackageCheck,
  Printer,
  RefreshCw,
  ScanLine,
  Truck,
  XCircle,
} from 'lucide-react';
import { api, openOfficialLabel } from '@/lib/api';
import { usePermission } from '@/hooks/usePermission';
import { OperasionalSectionPesanan } from './operasional-section';
import { BarcodeScanner, playScanFeedback } from '@/components/barcode-scanner';
import { Alert, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { StockPanel } from '@/components/stock-panel';
import { RANGE_LABEL, RANGE_PRESETS, type RangePreset } from '@/modules/fulfillment/domain/date-range';
import type { QueueBucket } from '@/modules/fulfillment/domain/work-queue';
import type { ExceptionKategori } from '@/modules/fulfillment/domain/order-exceptions';
import type { TahapOperasional } from '@/modules/reports/domain/operation-metrics';
import { OrderCard } from './order-card';
import { type ScanOutcome, type StationOrder, type StationResponse } from './types';

/**
 * Nada & judul panel hasil scan. Dikumpulkan di satu tempat supaya tidak ada
 * lagi rangkaian ternary berlapis yang mudah salah saat kode hasil scan
 * bertambah (`ALREADY_IN_TRANSIT`, `PARCEL_RETURNED`, …).
 */
type ScanTone = 'success' | 'info' | 'warning' | 'danger';

const NADA_HASIL: Record<ScanOutcome['code'], ScanTone> = {
  PACKED: 'success',
  ALREADY_PACKED: 'info',
  ALREADY_HANDED_OVER: 'info',
  ALREADY_IN_TRANSIT: 'info',
  ALREADY_DELIVERED: 'info',
  CANCELLED: 'warning',
  PARCEL_RETURNED: 'warning',
  NEEDS_PICKING: 'warning',
  NEEDS_SHIPMENT: 'warning',
  WAITING_STOCK: 'warning',
  NOT_QUEUED: 'warning',
  EXCEPTION: 'danger',
  NOT_FOUND: 'danger',
};

const JUDUL_HASIL: Record<ScanOutcome['code'], string> = {
  PACKED: 'Pesanan selesai diproses — stok gudang sudah berkurang',
  ALREADY_PACKED: 'Pesanan ini sudah pernah dipacking',
  ALREADY_HANDED_OVER: 'Pesanan sudah diserahkan ke kurir',
  ALREADY_IN_TRANSIT: 'Paket sudah dalam perjalanan — tidak perlu dipindai',
  ALREADY_DELIVERED: 'Pesanan sudah diterima pembeli',
  CANCELLED: 'Pesanan dibatalkan — resi tidak perlu diproses',
  PARCEL_RETURNED: 'Paket gagal kirim / dikembalikan',
  NEEDS_PICKING: 'Picking belum selesai',
  NEEDS_SHIPMENT: 'Resi belum ada — atur pengiriman dulu',
  WAITING_STOCK: 'Stok belum cukup untuk dipacking',
  NOT_QUEUED: 'Pesanan belum masuk antrian fulfillment',
  EXCEPTION: 'Pesanan bermasalah — periksa halaman fulfillment',
  NOT_FOUND: 'Resi / nomor pesanan tidak dikenali',
};

const WARNA_NADA: Record<ScanTone, string> = {
  success: 'var(--success)',
  info: 'var(--secondary)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};

/**
 * Halaman kerja operator: pesanan masuk → ambil resi → scan resi → serahkan.
 *
 * Prinsip yang dipegang di sini:
 *  - Aksi apa yang boleh dilakukan TIDAK ditentukan di halaman ini. Server
 *    mengirim `workflow` per pesanan (satu sumber: `domain/operator-workflow`).
 *  - Angka kartu datang dari server dan dihitung dari seluruh pesanan pada
 *    rentang tanggal yang dipilih, bukan dari halaman yang sedang tampil.
 *  - Filter tidak pernah me-remount halaman (layar penuh hanya saat pemuatan
 *    pertama), supaya pemindai tidak merebut fokus dan keyboard tidak terbuka
 *    sendiri di ponsel.
 */

/** Batas operasi massal di sisi server. */
const BATAS_MASSAL = 50;
/** Cache jawaban di sisi klien: hindari permintaan ulang saat operator
 *  bolak-balik mengklik kartu/rentang yang sama dalam hitungan detik. */
const CACHE_TTL_MS = 15_000;
const SEARCH_DEBOUNCE_MS = 350;

function rupiahNol(n: number): string {
  return n.toLocaleString('id-ID');
}

export default function PesananPengirimanPage() {
  const [data, setData] = useState<StationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'info' | 'warning'; text: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [printingLabelId, setPrintingLabelId] = useState<string | null>(null);

  const [sort, setSort] = useState<'oldest' | 'newest'>('oldest');
  const [bucket, setBucket] = useState<QueueBucket>('perluDiproses');
  /** Saringan "perlu perhatian": pembatalan / keterlambatan. */
  const [kategori, setKategori] = useState<ExceptionKategori | null>(null);
  /** Saringan tahap gudang (bukti klik kartu Ringkasan Operasional). */
  const [tahap, setTahap] = useState<TahapOperasional | null>(null);
  const [range, setRange] = useState<RangePreset>('all');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [stockVariantId, setStockVariantId] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [scannerFocusRequest, setScannerFocusRequest] = useState(0);

  const [picked, setPicked] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [negativeStockApproved, setNegativeStockApproved] = useState(false);

  const { can } = usePermission();
  const scannerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef(new Map<string, { at: number; data: StationResponse }>());

  const buildUrl = useCallback(
    (opts: {
      sort: 'oldest' | 'newest';
      bucket: QueueBucket;
      range: RangePreset;
      page: number;
      search: string;
      kategori?: ExceptionKategori | null;
      tahap?: TahapOperasional | null;
    }) => {
      const params = new URLSearchParams({
        sort: opts.sort,
        bucket: opts.bucket,
        range: opts.range,
        page: String(opts.page),
      });
      if (opts.search.trim()) params.set('search', opts.search.trim());
      if (opts.kategori) params.set('kategori', opts.kategori);
      if (opts.tahap) params.set('tahap', opts.tahap);
      return `/api/v1/fulfillment/station?${params.toString()}`;
    },
    [],
  );

  const load = useCallback(
    async (
      opts: {
        sort?: 'oldest' | 'newest';
        bucket?: QueueBucket;
        range?: RangePreset;
        page?: number;
        search?: string;
        kategori?: ExceptionKategori | null;
        tahap?: TahapOperasional | null;
        /** true = abaikan cache (tombol "Muat Ulang" / setelah aksi). */
        force?: boolean;
      } = {},
    ) => {
      const target = {
        sort: opts.sort ?? sort,
        bucket: opts.bucket ?? bucket,
        range: opts.range ?? range,
        page: opts.page ?? page,
        search: opts.search ?? search,
        kategori: opts.kategori !== undefined ? opts.kategori : kategori,
        tahap: opts.tahap !== undefined ? opts.tahap : tahap,
      };
      const url = buildUrl(target);

      if (!opts.force) {
        const hit = cacheRef.current.get(url);
        if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
          setData(hit.data);
          setPage(hit.data.page);
          setError('');
          setLoading(false);
          return;
        }
      }

      // Batalkan permintaan sebelumnya: jawaban lama tidak boleh menimpa yang baru.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await api<StationResponse>(url, { signal: controller.signal });
        cacheRef.current.set(url, { at: Date.now(), data: res });
        setData(res);
        setPage(res.page);
        setError('');
        if (target.page === 1) setPicked([]);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [buildUrl, bucket, kategori, page, range, search, sort, tahap],
  );

  // Muat pertama + muat ulang saat filter berubah.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Realtime: sinkronisasi Shopee / aksi operator → buang cache lalu muat ulang.
  useEffect(() => {
    const onRealtime = () => {
      cacheRef.current.clear();
      void load({ force: true });
    };
    window.addEventListener('shopee:synced', onRealtime);
    window.addEventListener('fulfillment:updated', onRealtime);
    const refresh = setInterval(() => onRealtime(), 30_000);
    const clock = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      window.removeEventListener('shopee:synced', onRealtime);
      window.removeEventListener('fulfillment:updated', onRealtime);
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, [load]);

  // Debounce pencarian: satu permintaan setelah operator berhenti mengetik.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const gantiRentang = (preset: RangePreset) => {
    setRange(preset);
    setPage(1);
    setLoading(true);
  };

  const gantiBucket = (next: QueueBucket) => {
    setBucket(next);
    setTahap(null);
    setPage(1);
    setLoading(true);
  };

  /**
   * Bukti kartu operasional: klik kartu tahap → daftar hanya pesanan tahap itu.
   * Bucket dibalik ke `semua` supaya pesanan yang sudah diserahkan/diterima
   * (di luar antrean kerja biasa) tetap bisa tampil sebagai buktinya.
   */
  const gantiTahap = (next: TahapOperasional) => {
    const berikut = tahap === next ? null : next;
    setTahap(berikut);
    if (berikut) setBucket('semua');
    setPage(1);
    setLoading(true);
  };

  /**
   * Saringan "perlu perhatian". Membalik bucket ke `semua` karena pembatalan
   * dan pesanan selesai tidak masuk antrean kerja biasa — tanpa ini, kartu
   * Pembatalan/Batal Sistem akan selalu kosong.
   */
  const gantiKategori = (next: ExceptionKategori) => {
    const berikut = kategori === next ? null : next;
    setKategori(berikut);
    setTahap(null);
    setBucket('semua');
    setPage(1);
    setLoading(true);
  };

  const changeSort = (next: 'oldest' | 'newest') => {
    setSort(next);
    setLoading(true);
  };

  const muatUlang = () => {
    cacheRef.current.clear();
    setLoading(true);
    void load({ force: true });
  };

  /** Pesanan yang dicentang DAN masih boleh diproses (kelayakan dari server). */
  const filtered = data?.orders ?? [];
  const pickedOrders = filtered.filter((o) => picked.includes(o.orderId) && o.workflow.canSelectForBulk);
  const pickedIds = pickedOrders.map((o) => o.orderId);
  const jumlahSiapAmbilResi = pickedOrders.filter((o) => o.workflow.canArrangeShipment).length;
  const jumlahSiapCetakLabel = pickedOrders.filter((o) => o.workflow.canPrintLabel).length;
  const idBisaDipilih = filtered.filter((o) => o.workflow.canSelectForBulk).map((o) => o.orderId);
  const semuaTerpilih = idBisaDipilih.length > 0 && idBisaDipilih.every((id) => picked.includes(id));
  const sebagianTerpilih = !semuaTerpilih && idBisaDipilih.some((id) => picked.includes(id));

  const togglePick = (orderId: string) =>
    setPicked((prev) => (prev.includes(orderId) ? prev.filter((x) => x !== orderId) : [...prev, orderId]));

  const toggleSemuaDiHalaman = () =>
    setPicked((prev) =>
      semuaTerpilih
        ? prev.filter((id) => !idBisaDipilih.includes(id))
        : [...new Set([...prev, ...idBisaDipilih])],
    );

  async function bulkAmbilResi(orderIds: string[]) {
    if (orderIds.length === 0) return;
    setBulkBusy(true);
    setError('');
    setNotice(null);
    try {
      const res = await api<{
        summary: { total: number; ok: number; gagal: number };
        results: { externalOrderId: string; status: string; message: string }[];
        message: string;
      }>('/api/v1/orders/bulk-prepare-shipment', { method: 'POST', body: { orderIds } });

      const gagal = res.results.filter((r) => r.status !== 'OK');
      if (gagal.length === 0) setNotice({ tone: 'success', text: res.message });
      else
        setNotice({
          tone: 'warning',
          text: `${res.message} Gagal: ${gagal.map((g) => `${g.externalOrderId} (${g.message})`).join('; ')}`,
        });
      muatUlang();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkCetakLabel(orderIds: string[]) {
    if (orderIds.length === 0) return;
    setBulkBusy(true);
    setError('');
    try {
      const res = await fetch('/api/v1/orders/bulk-print-labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds }),
        credentials: 'include',
      });

      const gagal = res.headers.get('X-Label-Gagal-Daftar');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Gagal membuat label (${res.status}).`);
        return;
      }
      if (gagal) setNotice({ tone: 'warning', text: `Sebagian label gagal: ${decodeURIComponent(gagal)}` });
      else setNotice({ tone: 'success', text: `${res.headers.get('X-Label-Ok')} label siap dicetak.` });

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  }

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
      cacheRef.current.clear();
      await load({ force: true });
      return result;
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
      return null;
    } finally {
      setBusyKey(null);
    }
  }

  /**
   * Menutup catatan fulfillment untuk paket yang sudah dikirim (dijemput kurir /
   * transit / diterima). Tanpa ini, scan resi paket tersebut berhenti di
   * pemeriksaan stok dan menampilkan "harus tambah stok".
   */
  /**
   * Menyetujui pembatalan yang diajukan pembeli. Konfirmasi dulu, karena
   * efeknya membatalkan pesanan di Shopee dan melepas stok.
   */
  async function setujuiPembatalan(orderId: string, externalOrderId: string) {
    const yakin = window.confirm(
      `Setujui pembatalan pesanan ${externalOrderId}?\n\n` +
        'Pesanan akan dibatalkan di Shopee (tercatat sebagai penjual) dan stok yang ' +
        'ditahan pesanan ini dilepas. Tindakan ini tidak bisa dibatalkan dari aplikasi.',
    );
    if (!yakin) return;

    setBusyKey(`batal-${orderId}`);
    setNotice(null);
    try {
      const res = await api<{ message: string }>(`/api/v1/orders/${orderId}/cancellation`, {
        method: 'POST',
        body: { operation: 'ACCEPT' },
      });
      setOutcome(null);
      cacheRef.current.clear();
      await load({ force: true });
      setNotice({ tone: 'success', text: res.message });
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusyKey(null);
    }
  }

  async function tutupPaketSudahDikirim() {
    setReconciling(true);
    setNotice(null);
    try {
      const res = await api<{
        ditutup: number;
        unitStokDipotong: number;
        varianStokMinus: number;
        messages: string[];
      }>('/api/v1/fulfillment/reconcile-shipped', { method: 'POST', body: { apply: true } });
      cacheRef.current.clear();
      await load({ force: true });
      setNotice({
        tone: res.ditutup > 0 ? 'success' : 'info',
        text: res.messages[0] ?? 'Tidak ada paket yang perlu ditutup.',
      });
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
    } finally {
      setReconciling(false);
    }
  }

  const scanResi = useCallback(
    async (code: string) => {
      setBusyKey('scan');
      setNotice(null);
      try {
        // Izin stok minus hanya untuk SATU pemindaian berikutnya (one-shot).
        const allowNegativeStock = negativeStockApproved;
        if (negativeStockApproved) setNegativeStockApproved(false);

        const res = await api<ScanOutcome>('/api/v1/fulfillment/scan-awb', {
          method: 'POST',
          body: { scannedCode: code, confirmPicking: true, allowNegativeStock },
        });
        setOutcome(res);
        playScanFeedback(res.stockDeducted || res.code !== 'NOT_FOUND');
        cacheRef.current.clear();
        await load({ force: true });
      } catch (e) {
        setOutcome(null);
        setNotice({ tone: 'danger', text: (e as Error).message });
        playScanFeedback(false);
      } finally {
        setBusyKey(null);
      }
    },
    [load, negativeStockApproved],
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
    setScannerFocusRequest((value) => value + 1);
    setNotice({
      tone: 'info',
      text: `Pindai barcode resi untuk pesanan ${order.externalOrderId}. Jangan ketik nomor pesanan sebagai pengganti resi.`,
    });
    scannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (loading && !data) return <LoadingState message="Memuat daftar pesanan..." />;
  if (error && !data) return <ErrorState message={error} onRetry={muatUlang} />;

  const kartu = data?.kartu;
  const kartuList: Array<{
    key: QueueBucket;
    label: string;
    hint: string;
    nilai: number;
    tone: string;
    icon: typeof ClipboardList;
  }> = [
    {
      key: 'baru',
      label: 'Pesanan Baru',
      hint: 'Belum diproses / belum ada nomor resi',
      nilai: kartu?.pesananBaru ?? 0,
      tone: 'var(--warning)',
      icon: ClipboardList,
    },
    {
      key: 'sudahResi',
      label: 'Sudah Ada Resi',
      hint: 'Nomor resi sudah terbit, belum diserahkan',
      nilai: kartu?.sudahResi ?? 0,
      tone: 'var(--secondary)',
      icon: PackageCheck,
    },
    {
      key: 'perluDiproses',
      label: 'Perlu Diproses',
      hint: 'Semua pesanan yang masih harus dikerjakan',
      nilai: kartu?.perluDiproses ?? 0,
      tone: 'var(--primary)',
      icon: Boxes,
    },
  ];

  const perhatianList: Array<{
    key: ExceptionKategori;
    label: string;
    hint: string;
    nilai: number;
    tone: string;
    icon: typeof AlertTriangle;
  }> = [
    {
      key: 'pembatalan',
      label: 'Pembatalan Diajukan',
      hint: 'Pembeli minta batal — perlu ditanggapi',
      nilai: data?.perhatian.pembatalanDiajukan ?? 0,
      tone: 'var(--warning)',
      icon: AlertTriangle,
    },
    {
      key: 'batalSistem',
      label: 'Batal oleh Sistem',
      hint: 'Dibatalkan otomatis Shopee (mis. terlambat kirim)',
      nilai: data?.perhatian.batalSistem ?? 0,
      tone: 'var(--danger)',
      icon: Ban,
    },
    {
      key: 'terlambat',
      label: 'Terlambat',
      hint: 'Tenggat kirim sudah lewat',
      nilai: data?.perhatian.terlambat ?? 0,
      tone: 'var(--danger)',
      icon: Clock,
    },
    {
      key: 'besokBatal',
      label: 'Besok Batal',
      hint: 'Belum ada resi, tenggat ≤ 24 jam',
      nilai: data?.perhatian.besokBatal ?? 0,
      tone: 'var(--warning)',
      icon: Clock,
    },
    {
      key: 'beresiko',
      label: 'Beresiko Terlambat',
      hint: 'Resi sudah ada, menunggu penjemputan',
      nilai: data?.perhatian.beresiko ?? 0,
      tone: 'var(--secondary)',
      icon: Clock,
    },
  ];

  return (
    <div style={{ paddingBottom: 60 }}>
      <PageHeader
        title="Pesanan & Pengiriman"
        subtitle="Pesanan masuk sampai diserahkan ke kurir — semuanya di halaman ini"
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setStockVariantId(null);
                setStockOpen(true);
              }}
              title="Tambah atau kurangi stok gudang"
            >
              <Boxes size={14} aria-hidden />
              <span>Stok Gudang</span>
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={muatUlang} title="Muat ulang data dari server">
              <RefreshCw size={14} aria-hidden />
              <span>Muat Ulang</span>
            </button>
          </div>
        }
      />

      {notice && (
        <div className="mb16">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      {error && data && (
        <div className="mb16">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      {(data?.anomali?.paketJalanBelumDitutup ?? 0) > 0 && (
        <div className="mb16">
          <Alert tone="warning">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
              <span>
                <strong>{data!.anomali.paketJalanBelumDitutup} paket sudah dikirim</strong> (dijemput kurir / dalam
                perjalanan) tetapi catatan gudangnya masih dianggap belum selesai. Selama belum ditutup, scan resi paket
                itu berhenti di pemeriksaan stok.
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={reconciling}
                onClick={() => void tutupPaketSudahDikirim()}
              >
                <PackageCheck size={13} aria-hidden />
                <span>{reconciling ? 'Menutup…' : 'Tutup otomatis'}</span>
              </button>
            </div>
          </Alert>
        </div>
      )}

      {!data?.warehouse && (
        <div className="mb16">
          <Alert tone="warning">
            Belum ada gudang aktif. Tambahkan gudang di menu <strong>Pengaturan</strong> supaya pesanan bisa diproses.
          </Alert>
        </div>
      )}

      {/* Pemindai resi: satu-satunya jalan menyelesaikan pesanan. */}
      <div className="card mb20" ref={scannerRef}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ScanLine size={18} aria-hidden />
          <span>Scan Resi</span>
        </h2>
        <p className="small muted" style={{ marginTop: 0, marginBottom: 12 }}>
          Scan hanya dipakai saat pesanan sudah berstatus <strong>Siap Dikemas</strong>. Setelah discan, stok berkurang
          dan pesanan otomatis berpindah ke <strong>Siap Kirim</strong>; setelah itu baru tekan{' '}
          <strong>Serahkan ke Kurir</strong>.
        </p>

        <BarcodeScanner
          autoFocus={false}
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
              border: `1px solid ${WARNA_NADA[NADA_HASIL[outcome.code]]}`,
              borderRadius: 12,
              padding: 16,
              background: 'var(--surface-container)',
            }}
          >
            <div style={{ display: 'flex', gap: 10 }}>
              {(() => {
                const nada = NADA_HASIL[outcome.code];
                const warna = WARNA_NADA[nada];
                const Ikon = nada === 'success' ? CheckCircle2 : nada === 'danger' ? XCircle : nada === 'info' ? Info : AlertTriangle;
                return <Ikon size={20} aria-hidden style={{ color: warna, flexShrink: 0 }} />;
              })()}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{JUDUL_HASIL[outcome.code]}</div>
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
                          <span>{printingLabelId === outcome.order.id ? 'Menyiapkan label…' : 'Cetak Label Resi'}</span>
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

      {/* Rentang tanggal + tiga kartu kerja — selalu paling atas: itulah yang
          dijawab tiap pagi ("berapa kerjaan hari ini?"). */}
      <div className="card mb16" style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <span className="small muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
            <CalendarDays size={14} aria-hidden /> Tanggal pesanan
          </span>
          <div className="filter-chips filter-chips-wrap">
            {RANGE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`btn btn-sm ${range === preset ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => gantiRentang(preset)}
              >
                {RANGE_LABEL[preset]}
              </button>
            ))}
          </div>
          {loading && data ? <span className="small muted">memperbarui…</span> : null}
        </div>

        <div className="queue-cards">
          {kartuList.map((k) => {
            const Icon = k.icon;
            const aktif = bucket === k.key;
            return (
              <button
                key={k.key}
                type="button"
                className={`queue-card ${aktif ? 'is-active' : ''}`}
                style={{ borderLeftColor: k.tone }}
                onClick={() => gantiBucket(k.key)}
                aria-pressed={aktif}
                title={`Tampilkan: ${k.label}`}
              >
                <span className="queue-card-head">
                  <Icon size={14} aria-hidden style={{ color: k.tone }} />
                  <span>{k.label}</span>
                </span>
                <span className="queue-card-value" style={{ color: k.tone }}>
                  {rupiahNol(k.nilai)}
                </span>
                <span className="queue-card-hint">{k.hint}</span>
              </button>
            );
          })}
        </div>

        {/* ── Perlu perhatian: pembatalan & keterlambatan ────────────────── */}
        <div className="queue-cards" style={{ marginTop: 10 }}>
          {perhatianList.map((k) => {
            const Icon = k.icon;
            const aktif = kategori === k.key;
            return (
              <button
                key={k.key}
                type="button"
                className={`queue-card ${aktif ? 'is-active' : ''}`}
                style={{ borderLeftColor: k.tone }}
                onClick={() => gantiKategori(k.key)}
                aria-pressed={aktif}
                title={`Tampilkan: ${k.label}`}
              >
                <span className="queue-card-head">
                  <Icon size={14} aria-hidden style={{ color: k.tone }} />
                  <span>{k.label}</span>
                </span>
                <span className="queue-card-value" style={{ color: k.tone }}>
                  {rupiahNol(k.nilai)}
                </span>
                <span className="queue-card-hint">{k.hint}</span>
              </button>
            );
          })}
        </div>

        {kategori && (
          <div
            style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
            className="small"
          >
            <span className="muted">
              Menampilkan: <strong>{perhatianList.find((k) => k.key === kategori)?.label}</strong>
              {kategori === 'pembatalan' || kategori === 'batalSistem'
                ? ' — mengikuti rentang tanggal di atas'
                : ' — dihitung dari tenggat kirim'}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => gantiKategori(kategori)}>
              Hapus saringan
            </button>
          </div>
        )}

        {tahap && (
          <div
            style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
            className="small"
          >
            <span className="muted">
              Bukti kartu: hanya pesanan tahap <strong>{tahap}</strong>
              {bucket !== 'semua' ? ' (bucket ikut menyaring)' : ''} — keadaan sekarang, bukan rentang tanggal
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setTahap(null);
                setBucket('perluDiproses');
                setPage(1);
                setLoading(true);
              }}
            >
              Hapus saringan tahap
            </button>
          </div>
        )}

        {bucket !== 'semua' && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => gantiBucket('semua')}
            title="Tampilkan semua pesanan, termasuk yang dibatalkan dan sudah selesai"
          >
            Lihat semua pesanan (termasuk batal & selesai)
          </button>
        )}
      </div>

      {/* Ringkasan operasional gudang — di bawah kartu kerja, memakai filter
          tanggal halaman yang sama (bukan filter sendiri). */}
      <OperasionalSectionPesanan
        preset={range}
        tahapAktif={tahap}
        pilihTahap={gantiTahap}
      />

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
          muatUlang();
        }}
      />

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
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>
          Daftar Pesanan ({rupiahNol(data?.total ?? 0)})
        </h2>
        {idBisaDipilih.length > 0 && (
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}
            title="Centang semua pesanan yang masih perlu diproses di halaman ini"
          >
            <input
              type="checkbox"
              checked={semuaTerpilih}
              ref={(el) => {
                if (el) el.indeterminate = sebagianTerpilih;
              }}
              onChange={toggleSemuaDiHalaman}
              style={{ width: 16, height: 16 }}
            />
            <span>Pilih semua ({idBisaDipilih.length})</span>
          </label>
        )}
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

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Cari nomor pesanan, nomor resi, nama pembeli, atau SKU"
          aria-label="Cari pesanan"
          style={{
            flex: '1 1 320px',
            minWidth: 0,
            padding: '9px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'inherit',
            fontSize: 14,
          }}
        />
      </div>

      {data?.truncated && (
        <div className="card mb16" style={{ borderLeft: '4px solid var(--warning)', background: 'var(--tertiary-container)', padding: '10px 14px' }}>
          <strong>Daftar ini dipotong.</strong> Terlalu banyak pesanan untuk ditampilkan sekaligus, jadi hanya sebagian
          yang dihitung. Selesaikan atau batalkan pesanan lama, lalu muat ulang halaman ini.
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Tidak ada pesanan pada pilihan ini"
            description="Coba ganti rentang tanggal atau kartu yang dipilih, atau tunggu pesanan baru masuk dari Shopee."
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pickedOrders.length > 0 && (
            <div className="card bulk-bar">
              <strong>
                {pickedOrders.length} pesanan dipilih
                {pickedOrders.length > BATAS_MASSAL ? (
                  <span style={{ display: 'block', fontWeight: 400, marginTop: 2 }}>
                    Maksimal {BATAS_MASSAL} pesanan sekali proses. Kurangi pilihan menjadi {BATAS_MASSAL} atau kurang.
                  </span>
                ) : null}
              </strong>
              {can('order.prepare_shipment') ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void bulkAmbilResi(pickedIds)}
                  disabled={bulkBusy || jumlahSiapAmbilResi === 0 || pickedOrders.length > BATAS_MASSAL}
                  title={
                    jumlahSiapAmbilResi === 0
                      ? 'Semua pesanan pilihan sudah punya resi atau sudah final.'
                      : 'Minta nomor resi ke Shopee untuk semua pesanan yang dicentang'
                  }
                >
                  <Truck size={13} aria-hidden />
                  <span>{bulkBusy ? 'Memproses...' : `Ambil Resi Semua (${jumlahSiapAmbilResi})`}</span>
                </button>
              ) : null}
              {can('order.pack') ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void bulkCetakLabel(pickedIds)}
                  disabled={bulkBusy || jumlahSiapCetakLabel === 0}
                  title="Unduh label resmi Shopee untuk semua pesanan yang dicentang dalam satu PDF"
                >
                  <Printer size={13} aria-hidden />
                  <span>Cetak Label Semua ({jumlahSiapCetakLabel})</span>
                </button>
              ) : null}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked([])} disabled={bulkBusy}>
                Batal pilih
              </button>
            </div>
          )}

          {filtered.map((o) => (
            <OrderCard
              key={o.orderId}
              order={o}
              now={now}
              picked={picked.includes(o.orderId)}
              busyKey={busyKey}
              printingLabelId={printingLabelId}
              selectable={o.workflow.canSelectForBulk}
              onTogglePick={() => togglePick(o.orderId)}
              onAmbilResi={() => void ambilResi(o.orderId)}
              onProses={() => void siapkanTanpaResi(o)}
              onHandover={() =>
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
              onFocusScanner={() => focusScannerForOrder(o)}
              onPrintLabel={() => void handlePrintOfficialLabel(o.orderId, o.externalOrderId)}
              onSetujuiPembatalan={
                data?.izin.setujuiPembatalan
                  ? () => void setujuiPembatalan(o.orderId, o.externalOrderId)
                  : undefined
              }
              onAddStock={(variantId) => {
                setStockVariantId(variantId);
                setStockOpen(true);
              }}
            />
          ))}

          <Pagination
            info={{
              total: data?.total ?? 0,
              page: data?.page ?? 1,
              pageSize: data?.pageSize ?? 20,
              totalPages: data?.totalPages ?? 1,
            }}
            onChange={setPage}
            label="pesanan"
            disabled={loading}
          />
        </div>
      )}
    </div>
  );
}
