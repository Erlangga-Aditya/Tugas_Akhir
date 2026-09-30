import { describe, it, expect } from 'vitest';
import { extractSupportedChannels, pickChannel } from './shipping-channel';

/**
 * Regresi untuk bug "belum punya kanal pengiriman yang didukung Shopee".
 *
 * Bukti produksi 2026-09-26 (Shopee sandbox, order 260927416Q1VJ9): Shopee
 * menyediakan kanal pickup, tapi jawabannya meletakkan slot jemput di
 * `response.pickup.address_list[].time_slot_list[]` — bukan di
 * `pickup_time_list` seperti yang dibaca kode lama. Akibatnya aplikasi tidak
 * menemukan kanal apa pun padahal Shopee menawarkannya, dan operator terjebak
 * tanpa cara memperbaiki sendiri.
 *
 * Respons mentah yang dipakai test ini SALINAN PERSIS dari Shopee.
 */
const REAL_SANDBOX_RESPONSE = {
  error: '',
  message: '',
  response: {
    info_needed: {
      dropoff: [],
      pickup: ['address_id', 'pickup_time_id'],
    },
    pickup: {
      address_list: [
        {
          address_id: 290774,
          region: 'ID',
          state: 'DKI JAKARTA',
          city: 'KOTA JAKARTA PUSAT',
          district: 'CEMPAKA PUTIH',
          address: 'Jalan Sudirman No. 10',
          zipcode: '10510',
          address_flag: ['default_address', 'pickup_address', 'return_address'],
          time_slot_list: [
            { date: 1790499600, pickup_time_id: '1790499600', flags: ['recommended'] },
            { date: 1790586000, pickup_time_id: '1790586000', flags: [] },
            { date: 1790672400, pickup_time_id: '1790672400', flags: [] },
          ],
        },
      ],
    },
    dropoff: { branch_list: null },
  },
  warning: '',
};

describe('bentuk resmi respons kanal Shopee (time_slot_list)', () => {
  it('membaca kanal pickup dari address_list[].time_slot_list', () => {
    const channels = extractSupportedChannels(REAL_SANDBOX_RESPONSE);

    expect(channels.length).toBe(3);
    expect(channels.every((c) => c.kind === 'pickup')).toBe(true);
    expect(channels[0]!.pickupTimeId).toBe('1790499600');
  });

  it('membawa address_id karena Shopee menandainya wajib', () => {
    const channels = extractSupportedChannels(REAL_SANDBOX_RESPONSE);

    // `info_needed.pickup = ["address_id","pickup_time_id"]` — tanpa
    // address_id, ship_order akan ditolak.
    expect(channels[0]!.addressId).toBe('290774');
  });

  it('mendeteksi slot jemput yang Shopee tandai recommended', () => {
    const channels = extractSupportedChannels(REAL_SANDBOX_RESPONSE);

    const recommended = channels.filter((c) => c.recommended === true);
    expect(recommended).toHaveLength(1);
    expect(recommended[0]!.pickupTimeId).toBe('1790499600');
  });

  it('tidak gagal hanya karena dropoff branch_list bernilai null', () => {
    // `branch_list: null` adalah hal normal saat toko belum mengatur cabang
    // dropoff. Kanal pickup tetap harus terbaca.
    const channels = extractSupportedChannels(REAL_SANDBOX_RESPONSE);

    expect(channels.some((c) => c.kind === 'dropoff')).toBe(false);
    expect(channels.length).toBeGreaterThan(0);
  });

  it('pickChannel memilih slot recommended untuk pengiriman otomatis', () => {
    const channels = extractSupportedChannels(REAL_SANDBOX_RESPONSE);

    const picked = pickChannel(channels);

    expect(picked?.kind).toBe('pickup');
    expect(picked?.pickupTimeId).toBe('1790499600');
    expect(picked?.addressId).toBe('290774');
  });
});

/**
 * Regresi untuk bug `logistics.ship_order_unsupport_dropoff`.
 *
 * Versi lama mengirim `dropoff: {}` tanpa pernah menanyakan ke Shopee channel
 * apa yang didukung, sehingga Shopee menolak. Test ini memastikan kanal hanya
 * boleh dipilih dari daftar yang benar-benar dikembalikan Shopee.
 */
describe('pemilihan kanal pengiriman (anti ship_order_unsupport_dropoff)', () => {
  describe('extractSupportedChannels', () => {
    it('membaca kanal dropoff beserta branch_id-nya', () => {
      const res = {
        shipping_document_list: [
          {
            dropoff_branch_list: [
              { branch_id: 'B-1', branch_name: 'Agen Jaksel' },
              { branch_id: 'B-2', branch_name: 'Agen Bandung' },
            ],
          },
        ],
      };

      const channels = extractSupportedChannels(res);

      expect(channels).toHaveLength(2);
      expect(channels.every((c) => c.kind === 'dropoff')).toBe(true);
      expect(channels[0]!.branchId).toBe('B-1');
    });

    it('membaca kanal pickup beserta pickup_time_id-nya', () => {
      const res = {
        shipping_document_list: [
          {
            pickup_time_list: [
              { pickup_time_id: 'T-1', pickup_time_name: 'Besok 09:00' },
              { pickup_time_id: 'T-2', pickup_time_name: 'Besok 14:00' },
            ],
          },
        ],
      };

      const channels = extractSupportedChannels(res);

      expect(channels).toHaveLength(2);
      expect(channels.every((c) => c.kind === 'pickup')).toBe(true);
    });

    it('membaca keduanya dari satu respons', () => {
      const res = {
        channel_list: [
          { pickup_time_list: [{ pickup_time_id: 'T-1' }] },
          { dropoff_branch_list: [{ branch_id: 'B-9' }] },
        ],
      };

      const channels = extractSupportedChannels(res);

      expect(channels.some((c) => c.kind === 'pickup')).toBe(true);
      expect(channels.some((c) => c.kind === 'dropoff')).toBe(true);
    });

    it('membaca respons yang berupa array langsung', () => {
      const res = [{ dropoff_branch_list: [{ branch_id: 'B-7' }] }];

      expect(extractSupportedChannels(res)).toHaveLength(1);
    });

    it('mengembalikan kosong bila Shopee tidak mendukung kanal apa pun', () => {
      expect(extractSupportedChannels({ shipping_document_list: [{}] })).toEqual([]);
      expect(extractSupportedChannels({})).toEqual([]);
      expect(extractSupportedChannels(null)).toEqual([]);
    });

    it('membuang kanal duplikat', () => {
      const res = { dropoff_branch_list: [{ branch_id: 'B-1' }, { branch_id: 'B-1' }] };

      expect(extractSupportedChannels(res)).toHaveLength(1);
    });
  });

  describe('pickChannel', () => {
    const channels = [
      { kind: 'pickup' as const, pickupTimeId: 'T-1' },
      { kind: 'dropoff' as const, branchId: 'B-1' },
    ];

    it('mengembalikan null bila tidak ada kanal — pemanggil wajib menolak, bukan menebak', () => {
      expect(pickChannel([])).toBeNull();
    });

    it('menghormati pilihan pickup operator bila Shopee mendukungnya', () => {
      const chosen = pickChannel(channels, { pickupTimeId: 'T-1' });

      expect(chosen?.kind).toBe('pickup');
    });

    it('menghormati pilihan dropoff operator bila Shopee mendukungnya', () => {
      const chosen = pickChannel(channels, { branchId: 'B-1' });

      expect(chosen?.kind).toBe('dropoff');
    });

    it('TIDAK memakai pilihan yang tidak didukung Shopee', () => {
      // Operator memilih kanal yang tidak ada di daftar Shopee.
      const chosen = pickChannel(channels, { branchId: 'TIDAK-ADA' });

      expect(chosen).not.toBeNull();
      expect(chosen?.branchId).not.toBe('TIDAK-ADA');
    });

    it('memakai kanal pertama yang didukung saat operator belum memilih', () => {
      expect(pickChannel(channels)?.kind).toBe('pickup');
    });
  });
});

/**
 * Regresi untuk `logistics.ship_order_unsupport_dropoff`.
 *
 * Bukti produksi: pesanan yang kanalnya non-integrasi (kurir bawaan Shopee)
 * ditolak dengan pesan "This order does not support ship with dropoff".
 * Penyebabnya hanya ada dua jenis kanal yang dikenali (pickup/dropoff),
 * sehingga kanal non-integrasi ikut dikirim sebagai `dropoff`.
 *
 * Dokumentasi resmi `ship_order` menyatakan field wajib mengikuti
 * `info_needed`: `pickup`, `dropoff`, ATAU `non_integrated`.
 */
const NON_INTEGRATED_RESPONSE = {
  error: '',
  message: '',
  response: {
    info_needed: { non_integrated: [] },
    dropoff: { branch_list: null },
  },
  warning: '',
};

describe('kanal non-integrasi (info_needed.non_integrated)', () => {
  it('mengenali kanal non-integrasi dari info_needed walau tidak ada daftar cabang', () => {
    const channels = extractSupportedChannels(NON_INTEGRATED_RESPONSE);

    // Sebelum perbaikan, di sini nol kanal dan operator mendapat pesan
    // "belum punya kanal pengiriman yang didukung Shopee" - padahal Shopee
    // jelas menyebut kanalnya.
    expect(channels.length).toBeGreaterThan(0);
    expect(channels.some((c) => c.kind === 'non_integrated')).toBe(true);
  });

  it('kanal non-integrasi dipilih saat hanya itu yang tersedia', () => {
    const channels = extractSupportedChannels(NON_INTEGRATED_RESPONSE);
    const dipilih = pickChannel(channels);

    expect(dipilih?.kind).toBe('non_integrated');
  });

  it('kanal pickup tetap diutamakan bila Shopee menawarkannya juga', () => {
    // `info_needed` bisa memuat lebih dari satu jenis. Yang punya slot jemput
    // nyata harus menang, karena hanya kanal itu yang bisa langsung dikirim
    // tanpa operator memilih apa pun.
    const campuran = {
      response: {
        info_needed: { pickup: ['address_id', 'pickup_time_id'], non_integrated: [] },
        pickup: {
          address_list: [
            {
              address_id: 290774,
              time_slot_list: [{ pickup_time_id: '1790499600', flags: ['recommended'] }],
            },
          ],
        },
      },
    };
    const channels = extractSupportedChannels(campuran);
    expect(pickChannel(channels)?.kind).toBe('pickup');
  });
});
