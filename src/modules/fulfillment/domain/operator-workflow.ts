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
  | 'DIBATALKAN';

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
  canScan: boolean;
  canHandover: boolean;
}

/**
 * Kontrak satu sumber untuk menentukan aksi berikutnya di UI. Backend tetap
 * menjadi penjaga; helper ini hanya mencegah tombol yang salah tampil.
 */
export function deriveOperatorWorkflow(input: OperatorWorkflowInput): OperatorWorkflow {
  // Pesanan batal: tidak ada aksi sama sekali. Tanpa guard ini, UI bisa
  // menampilkan tombol scan/serahkan untuk pesanan yang tidak akan pernah
  // dikirim — dan operator bisa memicu perubahan stok untuk pesanan batal.
  if (input.stage === 'DIBATALKAN') {
    return { stage: input.stage, nextAction: 'NONE', canScan: false, canHandover: false };
  }

  if (input.stage === 'DIKIRIM') {
    return { stage: input.stage, nextAction: 'NONE', canScan: false, canHandover: false };
  }

  if (!input.hasAwb) {
    return { stage: input.stage, nextAction: 'ARRANGE_SHIPMENT', canScan: false, canHandover: false };
  }

  if (input.stage === 'BARU') {
    return { stage: input.stage, nextAction: 'PROCESS_ORDER', canScan: false, canHandover: false };
  }

  if (input.stage === 'MENUNGGU_STOK' || input.hasShortfall) {
    return { stage: input.stage, nextAction: 'ADD_STOCK', canScan: false, canHandover: false };
  }

  if (input.stage === 'SIAP_KIRIM') {
    return { stage: input.stage, nextAction: 'HANDOVER', canScan: false, canHandover: true };
  }

  return { stage: input.stage, nextAction: 'SCAN_AWB', canScan: true, canHandover: false };
}
