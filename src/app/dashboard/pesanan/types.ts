/**
 * Tipe bersama halaman "Pesanan & Pengiriman".
 *
 * Dipisah dari `page.tsx` supaya kartu pesanan bisa dijadikan komponen sendiri
 * (file halaman sudah terlalu besar) tanpa dua definisi tipe yang bisa berbeda.
 */
import type { OperatorStage, OperatorWorkflow } from '@/modules/fulfillment/domain/operator-workflow';

export type Stage = OperatorStage;

export interface OrderItemRow {
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

export interface StationOrder {
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
  /** Status mentah marketplace (READY_TO_SHIP / PROCESSED / …). */
  externalStatus: string | null;
  /** Pelaku pembatalan menurut Shopee: buyer / seller / system / Ops. */
  cancelBy: string | null;
  cancelReason: string | null;
  buyerCancelReason: string | null;
  cancelRequestedAt: string | null;
  cancelledAt: string | null;
  /** Kategori pembatalan (DIAJUKAN = masih bisa ditanggapi). */
  cancelCategory: 'DIAJUKAN' | 'DIBATALKAN_PEMBELI' | 'DIBATALKAN_PENJUAL' | 'DIBATALKAN_SISTEM' | null;
  /** Jejak aktor per tahap (dasar laporan per-orang). */
  aktor: {
    pickedById: string | null;
    packedById: string | null;
    handedOverById: string | null;
    packedAt: string | null;
    handedOverAt: string | null;
    pickedByNama: string | null;
    packedByNama: string | null;
    handedOverByNama: string | null;
  };
  /** Risiko keterlambatan menurut tenggat kirim. */
  lateRisk: 'TIDAK_RELEVAN' | 'AMAN' | 'BERESIKO' | 'BESOK_BATAL' | 'TERLAMBAT';
  fulfillmentId: string | null;
  fulfillmentStatus: string | null;
  awb: string | null;
  carrier: string | null;
  /** Keadaan paket menurut catatan kita, untuk penyaring dan kartu ringkasan. */
  shipmentStatus: string | null;
  canArrangeShipment: boolean;
  /** Barang hanya boleh dinyatakan siap kirim setelah nomor resi terbit. */
  canPack: boolean;
  stage: Stage;
  /** Aksi yang boleh ditawarkan — dihitung server dari satu sumber kebenaran. */
  workflow: OperatorWorkflow;
  items: OrderItemRow[];
  totalUnits: number;
  shortfallUnits: number;
}

export interface StationResponse {
  warehouse: { id: string; name: string; code: string } | null;
  sort: 'oldest' | 'newest';
  bucket: 'semua' | 'baru' | 'sudahResi' | 'perluDiproses';
  /** Saringan tahap gudang aktif (bukti klik kartu operasional); null = tidak menyaring. */
  tahap: string | null;
  rangePreset: 'today' | 'yesterday' | 'last7' | 'last30' | 'all';
  /** Batas rentang yang benar-benar dipakai server (ISO, null = tanpa batas). */
  range: { from: string | null; to: string | null };
  /**
   * Tiga angka kartu. Selalu dihitung server dari SELURUH pesanan pada rentang
   * yang dipilih, bukan dari halaman yang sedang tampil.
   */
  kartu: {
    perluDiproses: number;
    pesananBaru: number;
    sudahResi: number;
  };
  /** Anomali yang bisa dibereskan operator (paket sudah jalan, catatan tertinggal). */
  anomali: { paketJalanBelumDitutup: number };
  /**
   * Angka "perlu perhatian". `pembatalanDiajukan` & `batalSistem` mengikuti
   * rentang tanggal yang dipilih (kapan diajukan / kapan batal); sisanya
   * dihitung dari tenggat kirim terhadap hari ini.
   */
  /** Izin yang diberikan server untuk UI (bukan tebakan dari peran). */
  izin: { setujuiPembatalan: boolean };
  perhatian: {
    pembatalanDiajukan: number;
    batalSistem: number;
    terlambat: number;
    besokBatal: number;
    beresiko: number;
  };
  orders: StationOrder[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** true bila kandidat terpotong pagar pengaman server; WAJIB diberitahukan. */
  truncated: boolean;
  generatedAt: string;
}

export interface ScanOutcome {
  code:
    | 'PACKED'
    | 'ALREADY_PACKED'
    | 'ALREADY_HANDED_OVER'
    | 'NEEDS_SHIPMENT'
    | 'NEEDS_PICKING'
    | 'WAITING_STOCK'
    | 'NOT_QUEUED'
    | 'CANCELLED'
    | 'ALREADY_DELIVERED'
    | 'ALREADY_IN_TRANSIT'
    | 'PARCEL_RETURNED'
    | 'EXCEPTION'
    | 'NOT_FOUND';
  message: string;
  stockDeducted: boolean;
  deductedUnits: number;
  needsConfirmation: 'PICKING' | 'NEGATIVE_STOCK' | null;
  shortfalls: Array<{ sku: string; productName: string; required: number; available: number; missing: number }>;
  order: { id: string; externalOrderId: string; canPrintOfficialLabel: boolean } | null;
}

export const STAGE_LABEL: Record<Stage, string> = {
  BARU: 'Pesanan Baru',
  MENUNGGU_STOK: 'Menunggu Stok',
  SIAP_DIKEMAS: 'Siap Dikemas',
  SIAP_KIRIM: 'Siap Kirim',
  DIKIRIM: 'Sudah Dikirim',
  DIBATALKAN: 'Dibatalkan',
  SELESAI: 'Selesai',
};

export const STAGE_TONE: Record<Stage, string> = {
  BARU: 'var(--warning)',
  MENUNGGU_STOK: 'var(--danger)',
  SIAP_DIKEMAS: 'var(--secondary)',
  SIAP_KIRIM: 'var(--success)',
  DIKIRIM: 'var(--info)',
  DIBATALKAN: 'var(--danger)',
  SELESAI: 'var(--success)',
};
