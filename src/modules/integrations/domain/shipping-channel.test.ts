import { describe, it, expect } from 'vitest';
import { extractSupportedChannels, pickChannel } from './shipping-channel';

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
