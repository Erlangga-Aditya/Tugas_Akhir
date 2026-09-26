/**
 * Test untuk alur label resmi Shopee.
 *
 * Fokus: keputusan yang pernah salah dan bisa merusak pengiriman —
 * format label tidak boleh di-hardcode, resi wajib ada, status harus READY,
 * dan respons batch harus dibaca per paket (bukan dianggap sukses begitu saja).
 */
import { describe, it, expect } from 'vitest';
import {
  mapDocumentParameter,
  mapDocumentTask,
  mapDocumentStatus,
  isValidDocumentType,
  resultList,
  pollUntilReady,
  assertHasTrackingNumber,
  describeLabelFailure,
} from '../domain/shipping-document';
import { toOrderList } from '../infrastructure/shopee-shipping-document.client';

describe('shipping document — format label', () => {
  it('menerima hanya 5 enum resmi yang terdaftar di dokumentasi', () => {
    expect(isValidDocumentType('THERMAL_AIR_WAYBILL')).toBe(true);
    expect(isValidDocumentType('NORMAL_AIR_WAYBILL')).toBe(true);
    expect(isValidDocumentType('THERMAL_JOB_AIR_WAYBILL')).toBe(true);
    expect(isValidDocumentType('NORMAL_JOB_AIR_WAYBILL')).toBe(true);
    expect(isValidDocumentType('THERMAL_UNPACKAGED_LABEL')).toBe(true);
  });

  it('menolak nilai yang TIDAK ada di enum resmi', () => {
    // Nilai-nilai ini tidak pernah terdaftar; memakainya = permintaan gagal diam-diam.
    for (const bogus of ['THERMAL_WAYBILL', 'PDF', 'WAYBILL', 'AWB', 'thermal_air_waybill', '']) {
      expect(isValidDocumentType(bogus)).toBe(false);
    }
  });

  it('memakai format yang disarankan Shopee, bukan menebak sendiri', () => {
    const param = mapDocumentParameter({
      order_sn: '260925ABC',
      package_number: 'PKG1',
      suggest_shipping_document_type: 'NORMAL_AIR_WAYBILL',
      selectable_shipping_document_type: ['THERMAL_AIR_WAYBILL', 'NORMAL_AIR_WAYBILL'],
    });
    expect(param.suggestedType).toBe('NORMAL_AIR_WAYBILL');
    expect(param.selectableTypes).toEqual(['THERMAL_AIR_WAYBILL', 'NORMAL_AIR_WAYBILL']);
  });

  it('menyaring enum tak dikenal dari selectable_types milik Shopee', () => {
    const param = mapDocumentParameter({
      order_sn: '260925ABC',
      selectable_shipping_document_type: ['THERMAL_AIR_WAYBILL', 'ENTAH', 'PDF'],
      suggest_shipping_document_type: 'ENTAH',
    });
    expect(param.selectableTypes).toEqual(['THERMAL_AIR_WAYBILL']);
    // Saran yang tidak dikenal enum → null, supaya kita pakai selectable.
    expect(param.suggestedType).toBeNull();
  });

  it('membuang duplikat pada selectable_types', () => {
    const param = mapDocumentParameter({
      order_sn: 'X',
      selectable_shipping_document_type: ['THERMAL_AIR_WAYBILL', 'THERMAL_AIR_WAYBILL'],
    });
    expect(param.selectableTypes).toEqual(['THERMAL_AIR_WAYBILL']);
  });
});

describe('shipping document — status task', () => {
  it('mengenal 3 status resmi', () => {
    expect(mapDocumentStatus('READY')).toBe('READY');
    expect(mapDocumentStatus('PROCESSING')).toBe('PROCESSING');
    expect(mapDocumentStatus('FAILED')).toBe('FAILED');
  });

  it('status di luar daftar resmi jadi UNKNOWN, bukan diemensionalkan diam-diam', () => {
    expect(mapDocumentStatus('DONE')).toBe('UNKNOWN');
    expect(mapDocumentStatus(undefined)).toBe('UNKNOWN');
    expect(mapDocumentStatus(123)).toBe('UNKNOWN');
  });

  it('status lowercase dari Shopee tetap dikenali', () => {
    expect(mapDocumentStatus('ready')).toBe('READY');
  });

  it('membaca fail_error/fail_message dari Shopee apa adanya', () => {
    const task = mapDocumentTask({
      order_sn: 'X',
      status: 'FAILED',
      fail_error: 'logistics.can_not_print_jit_order',
      fail_message: 'JIT order tidak bisa dicetak',
    });
    expect(task.status).toBe('FAILED');
    expect(task.failError).toBe('logistics.can_not_print_jit_order');
    expect(task.failMessage).toBe('JIT order tidak bisa dicetak');
  });
});

describe('shipping document — result_list per paket', () => {
  it('mengambil setiap entri paket (sukses HTTP ≠ semua paket sukses)', () => {
    const list = resultList({
      result_list: [
        { order_sn: 'A', status: 'READY' },
        { order_sn: 'B', fail_error: 'logistics.order_not_exist' },
      ],
    });
    expect(list).toHaveLength(2);
    expect(list[0]?.order_sn).toBe('A');
    expect(list[1]?.fail_error).toBe('logistics.order_not_exist');
  });

  it('aman saat respons tidak punya result_list', () => {
    expect(resultList(undefined)).toEqual([]);
    expect(resultList({})).toEqual([]);
    expect(resultList({ result_list: null })).toEqual([]);
  });
});

describe('shipping document — resi wajib ada', () => {
  it('menolak target tanpa resi sebelum memanggil Shopee', () => {
    expect(() => assertHasTrackingNumber({ orderSn: 'X', packageNumber: null, trackingNumber: null })).toThrow(
      /belum punya nomor resi/i,
    );
  });

  it('menerima target yang resinya ada', () => {
    expect(() =>
      assertHasTrackingNumber({ orderSn: 'X', packageNumber: null, trackingNumber: 'JP6933406921' }),
    ).not.toThrow();
  });
});

describe('shipping document — order_list', () => {
  it('tidak mengirim package_number/tracking_number sebagai string kosong', () => {
    // Dokumentasi: "You shouldn't fill the field with empty string".
    const [item] = toOrderList([{ orderSn: 'X', packageNumber: '', trackingNumber: '' }], true);
    expect(item).toEqual({ order_sn: 'X' });
    expect('package_number' in (item ?? {})).toBe(false);
    expect('tracking_number' in (item ?? {})).toBe(false);
  });

  it('memasukkan package_number & tracking_number kalau ada', () => {
    const [item] = toOrderList([{ orderSn: 'X', packageNumber: 'PKG1', trackingNumber: 'JP123' }], true);
    expect(item).toEqual({ order_sn: 'X', package_number: 'PKG1', tracking_number: 'JP123' });
  });

  it('tidak mengirim tracking_number saat hanya membaca parameter label', () => {
    const [item] = toOrderList([{ orderSn: 'X', packageNumber: null, trackingNumber: 'JP123' }], false);
    expect(item).toEqual({ order_sn: 'X' });
  });
});

describe('shipping document — polling sampai READY', () => {
  it('berhenti saat READY tanpa polls lanjutan', async () => {
    let calls = 0;
    const task = await pollUntilReady(
      async () => {
        calls++;
        return { orderSn: 'X', packageNumber: null, status: 'READY' };
      },
      [0, 0, 0],
    );
    expect(task.status).toBe('READY');
    expect(calls).toBe(1);
  });

  it('berhenti saat FAILED (tidak terus polls sia-sia)', async () => {
    const task = await pollUntilReady(
      async () => ({ orderSn: 'X', packageNumber: null, status: 'FAILED', failMessage: 'ditolak' }),
      [0, 0, 0],
    );
    expect(task.status).toBe('FAILED');
  });

  it('mengulang sampai READY lalu berhenti', async () => {
    const statuses = ['PROCESSING', 'PROCESSING', 'READY'] as const;
    let i = 0;
    const task = await pollUntilReady(
      async () => ({ orderSn: 'X', packageNumber: null, status: statuses[i++] ?? 'UNKNOWN' }),
      [0, 0, 0, 0],
    );
    expect(task.status).toBe('READY');
    expect(i).toBe(3);
  });

  it('mengembalikan status terakhir kalau tidak pernah READY', async () => {
    const task = await pollUntilReady(
      async () => ({ orderSn: 'X', packageNumber: null, status: 'PROCESSING' }),
      [0, 0],
    );
    expect(task.status).toBe('PROCESSING');
  });
});

describe('shipping document — pesan error jujur', () => {
  it('menyertakan alasan dari Shopee, bukan pesan generik', () => {
    const param = mapDocumentParameter({
      order_sn: 'X',
      fail_error: 'logistics.can_not_print_jit_order',
      fail_message: 'Pesanan JIT tidak bisa dilabeli',
    });
    const msg = describeLabelFailure(param, { orderSn: 'X', packageNumber: null, trackingNumber: null });
    expect(msg).toContain('Pesanan JIT tidak bisa dilabeli');
    expect(msg).toContain('X');
  });

  it('menjelaskan kemungkinan resi belum terbit saat tidak ada format tersedia', () => {
    const param = mapDocumentParameter({ order_sn: 'X' });
    const msg = describeLabelFailure(param, { orderSn: 'X', packageNumber: null, trackingNumber: null });
    expect(msg).toMatch(/resi belum terbit|paket belum siap/i);
  });
});
