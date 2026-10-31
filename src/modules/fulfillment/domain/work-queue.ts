/**
 * Antrean kerja gudang — definisi TUNGGAL untuk kartu ringkasan halaman Pesanan
 * dan untuk badge angka di menu samping.
 *
 * Kenapa memakai status MENTAH marketplace lebih dulu:
 * `orders.status` internal memetakan beberapa status Shopee ke `CONFIRMED`,
 * sehingga READY_TO_SHIP ("Belum diproses") dan PROCESSED ("Telah diproses")
 * tidak bisa dibedakan. Akibatnya angka kartu bisa meleset dari Seller Centre.
 * Bila `externalStatus` tersedia, ia yang menentukan; bila belum tersinkron
 * (baris lama / marketplace lain), dipakai cadangan berbasis ada-tidaknya resi.
 */
import { resolveOperatorStage, type OperatorStage } from './operator-workflow';

/** Shopee: pesanan sudah dibayar, penjual BELUM mengatur pengiriman. */
const EXTERNAL_AWAITING_SHIP = new Set(['READY_TO_SHIP']);
/** Shopee: pengiriman sudah diatur (resi terbit), menunggu dijemput kurir. */
const EXTERNAL_PROCESSED = new Set(['PROCESSED', 'RETRY_SHIP']);
/**
 * Shopee: tidak lagi menunggu pekerjaan gudang.
 * `IN_CANCEL`/`TO_RETURN` penting di sini — keduanya dipetakan ke `NEW`
 * internal, sehingga tanpa daftar ini pesanan yang sedang dibatalkan pembeli
 * tetap ikut dihitung sebagai pekerjaan.
 */
const EXTERNAL_NOT_IN_QUEUE = new Set([
  'UNPAID',
  'PENDING',
  'IN_CANCEL',
  'TO_RETURN',
  'SHIPPED',
  'TO_CONFIRM_RECEIVE',
  'COMPLETED',
  'CANCELLED',
]);

export type QueueBucket = 'semua' | 'baru' | 'sudahResi' | 'perluDiproses';

export const QUEUE_BUCKETS: readonly QueueBucket[] = ['semua', 'baru', 'sudahResi', 'perluDiproses'] as const;

export function isQueueBucket(value: string | null | undefined): value is QueueBucket {
  return typeof value === 'string' && (QUEUE_BUCKETS as readonly string[]).includes(value);
}

/** Tahap yang berarti pesanan MASIH menunggu pekerjaan gudang (cadangan). */
const WORK_STAGES: readonly OperatorStage[] = ['BARU', 'MENUNGGU_STOK', 'SIAP_DIKEMAS', 'SIAP_KIRIM'] as const;

export interface WorkQueueInput {
  orderStatus: string;
  /** Status mentah marketplace (`orders.externalStatus`), mis. `READY_TO_SHIP`. */
  externalStatus?: string | null;
  fulfillmentStatus: string | null;
  shipmentStatus: string | null;
  hasAwb: boolean;
}

export interface WorkQueueEntry {
  stage: OperatorStage;
  /** true = masih perlu dikerjakan gudang. */
  needsWork: boolean;
  hasAwb: boolean;
  /** Kartu tempat pesanan ini masuk; `null` = tidak masuk antrean kerja. */
  bucket: 'baru' | 'sudahResi' | null;
}

export function classifyWorkQueue(input: WorkQueueInput): WorkQueueEntry {
  const stage = resolveOperatorStage({
    orderStatus: input.orderStatus,
    fulfillmentStatus: input.fulfillmentStatus,
    shipmentStatus: input.shipmentStatus,
  });

  const paketSudahJalan =
    input.shipmentStatus === 'PICKED_UP' ||
    input.shipmentStatus === 'IN_TRANSIT' ||
    input.shipmentStatus === 'DELIVERED' ||
    input.fulfillmentStatus === 'HANDED_OVER';

  const external = (input.externalStatus ?? '').trim().toUpperCase();

  if (paketSudahJalan) {
    return { stage, needsWork: false, hasAwb: input.hasAwb, bucket: null };
  }

  // Status mentah marketplace lebih dipercaya daripada status internal.
  if (external) {
    if (EXTERNAL_NOT_IN_QUEUE.has(external)) {
      return { stage, needsWork: false, hasAwb: input.hasAwb, bucket: null };
    }
    if (EXTERNAL_AWAITING_SHIP.has(external)) {
      return { stage, needsWork: true, hasAwb: input.hasAwb, bucket: 'baru' };
    }
    if (EXTERNAL_PROCESSED.has(external)) {
      // RESI YANG KITA MILIKI adalah penentu kartu, bukan status mentahnya.
      //
      // Shopee bisa melaporkan `PROCESSED` sementara baris `shipments` kita
      // belum menyimpan AWB (webhook telat, atau pesanan diproses sebelum
      // aplikasi terhubung). Versi lama langsung menaruhnya di "Sudah Ada
      // Resi" — padahal kartunya menampilkan tombol "Ambil Resi" karena AWB
      // kosong. Operator melihat dua hal yang bertentangan.
      return {
        stage,
        needsWork: true,
        hasAwb: input.hasAwb,
        bucket: input.hasAwb ? 'sudahResi' : 'baru',
      };
    }
  }

  // Cadangan: belum ada status mentah. Pakai tahap kerja + keberadaan resi.
  const needsWork = WORK_STAGES.includes(stage);
  return {
    stage,
    needsWork,
    hasAwb: input.hasAwb,
    bucket: needsWork ? (input.hasAwb ? 'sudahResi' : 'baru') : null,
  };
}

export function belongsToBucket(bucket: QueueBucket, entry: WorkQueueEntry): boolean {
  if (bucket === 'semua') return true;
  if (!entry.needsWork || entry.bucket === null) return false;
  if (bucket === 'perluDiproses') return true;
  return entry.bucket === bucket;
}

export interface QueueCounts {
  perluDiproses: number;
  pesananBaru: number;
  sudahResi: number;
}

export function countBuckets(entries: WorkQueueEntry[]): QueueCounts {
  let pesananBaru = 0;
  let sudahResi = 0;
  for (const entry of entries) {
    if (!entry.needsWork) continue;
    if (entry.bucket === 'sudahResi') sudahResi += 1;
    else pesananBaru += 1;
  }
  return { perluDiproses: pesananBaru + sudahResi, pesananBaru, sudahResi };
}
