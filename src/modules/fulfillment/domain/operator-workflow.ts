/**
 * Tahap yang dilihat operator.
 *
 * `DIBATALKAN` sengaja ada di sini: pesanan batal bukan tahap kerja, tapi
 * operator tetap harus bisa melihatnya (dan tidak boleh offer aksi apa pun).
 */
export type OperatorStage =
  | 'BARU'
  | 'MENUNGGU_STOK'
  | 'SIAP_DIKEMAS'
  | 'SIAP_KIRIM'
  | 'DIKIRIM'
  | 'DIBATALKAN'
  /** Pesanan tuntas - sudah diterima pembeli. Tidak ada langkah kerja lagi. */
  | 'SELESAI';

export type NextOperatorAction =
  | 'ARRANGE_SHIPMENT'
  | 'PROCESS_ORDER'
  | 'ADD_STOCK'
  | 'SCAN_AWB'
  | 'HANDOVER'
  | 'NONE';

export interface OperatorWorkflowInput {
  stage: OperatorStage;
  hasAwb: boolean;
  hasShortfall: boolean;
}

export interface OperatorWorkflow {
  stage: OperatorStage;
  nextAction: NextOperatorAction;
  /** Boleh memfokuskan pemindai untuk pesanan ini (tidak berarti boleh memotong stok). */
  canScan: boolean;
  canHandover: boolean;
  /** Boleh meminta nomor resi ke Shopee (`prepare-shipment`). */
  canArrangeShipment: boolean;
  /** Boleh memasukkan pesanan ke antrian fulfillment tanpa resi. */
  canProcess: boolean;
  /** Boleh membuka panel stok untuk menutup kekurangan pesanan ini. */
  canAddStock: boolean;
  /** Boleh mencetak label resmi Shopee (butuh resi, dan hanya sebelum diserahkan). */
  canPrintLabel: boolean;
  /** Boleh ikut dicentang pada operasi massal (Ambil Resi Semua / Cetak Label Semua). */
  canSelectForBulk: boolean;
  /** true bila pesanan sudah final: batal, sudah dikirim, atau sudah diterima pembeli. */
  isFinal: boolean;
}

/** Workflow yang tidak menawarkan aksi apa pun — dipakai pesanan batal/final. */
function noAction(stage: OperatorStage, isFinal: boolean): OperatorWorkflow {
  return {
    stage,
    nextAction: 'NONE',
    canScan: false,
    canHandover: false,
    canArrangeShipment: false,
    canProcess: false,
    canAddStock: false,
    canPrintLabel: false,
    canSelectForBulk: false,
    isFinal,
  };
}

/**
 * Satu-satunya tempat memetakan keadaan pesanan di database menjadi tahap kerja
 * yang dipakai UI. Server (antrian gudang & detail pesanan) dan klien memakai
 * fungsi ini supaya tidak pernah ada dua definisi "pesanan ini sudah selesai".
 */
export function resolveOperatorStage(input: {
  orderStatus: string;
  fulfillmentStatus: string | null;
  shipmentStatus: string | null;
}): OperatorStage {
  const { orderStatus, fulfillmentStatus, shipmentStatus } = input;

  if (orderStatus === 'CANCELLED') return 'DIBATALKAN';
  if (orderStatus === 'COMPLETED') return 'SELESAI';

  // Sudah keluar gudang menurut catatan kurir, atau sudah diserahkan operator.
  if (
    shipmentStatus === 'PICKED_UP' ||
    shipmentStatus === 'IN_TRANSIT' ||
    shipmentStatus === 'DELIVERED' ||
    fulfillmentStatus === 'HANDED_OVER'
  ) {
    return 'DIKIRIM';
  }

  if (!fulfillmentStatus) return 'BARU';
  if (fulfillmentStatus === 'WAITING_STOCK') return 'MENUNGGU_STOK';
  if (fulfillmentStatus === 'PACKED' || fulfillmentStatus === 'READY_TO_SHIP') return 'SIAP_KIRIM';
  return 'SIAP_DIKEMAS';
}

/**
 * Kontrak satu sumber untuk menentukan aksi berikutnya di UI. Backend tetap
 * menjadi penjaga; helper ini hanya mencegah tombol yang salah tampil.
 *
 * Aturan yang dipegang:
 *  - Pesanan final (batal / sudah dikirim / sudah diterima pembeli) tidak
 *    menawarkan aksi apa pun. Ini yang dulu bocor: tombol "Ambil Resi" muncul
 *    untuk pesanan batal dan pesanan yang sudah diterima pembeli.
 *  - Tanpa resi, satu-satunya langkah yang masuk akal adalah meminta resi.
 *  - Label resmi hanya berguna sebelum paket diserahkan ke kurir.
 */
export function deriveOperatorWorkflow(input: OperatorWorkflowInput): OperatorWorkflow {
  // Pesanan batal: tidak ada aksi sama sekali. Tanpa guard ini, UI bisa
  // menampilkan tombol scan/serahkan untuk pesanan yang tidak akan pernah
  // dikirim — dan operator bisa memicu perubahan stok untuk pesanan batal.
  if (input.stage === 'DIBATALKAN') return noAction(input.stage, true);

  // Sudah diserahkan ke kurir / sudah diterima pembeli: tidak ada langkah kerja.
  if (input.stage === 'DIKIRIM' || input.stage === 'SELESAI') return noAction(input.stage, true);

  if (!input.hasAwb) {
    return {
      ...noAction(input.stage, false),
      nextAction: 'ARRANGE_SHIPMENT',
      canArrangeShipment: true,
      canSelectForBulk: true,
    };
  }

  if (input.stage === 'BARU') {
    return {
      ...noAction(input.stage, false),
      nextAction: 'PROCESS_ORDER',
      canProcess: true,
      canPrintLabel: true,
      canSelectForBulk: true,
    };
  }

  if (input.stage === 'MENUNGGU_STOK' || input.hasShortfall) {
    return {
      ...noAction(input.stage, false),
      nextAction: 'ADD_STOCK',
      canAddStock: true,
      canPrintLabel: true,
      canSelectForBulk: true,
    };
  }

  if (input.stage === 'SIAP_KIRIM') {
    return {
      ...noAction(input.stage, false),
      nextAction: 'HANDOVER',
      canHandover: true,
      canPrintLabel: true,
      canSelectForBulk: true,
    };
  }

  return {
    ...noAction(input.stage, false),
    nextAction: 'SCAN_AWB',
    canScan: true,
    canPrintLabel: true,
    canSelectForBulk: true,
  };
}
