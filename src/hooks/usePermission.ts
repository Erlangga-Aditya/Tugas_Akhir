'use client';

/**
 * Hook izin untuk komponen sisi klien.
 *
 * `me.can` dikirim server sebagai "apakah boleh" per izin, jadi komponen
 * tidak perlu tahu aturan OWNER/STAFF maupun bentuk daftar izin mentah.
 * Aturannya hanya hidup di server.
 *
 * Penting: ini untuk MENAMPILKAN saja. Penegakan sesungguhnya ada di proxy
 * dan di setiap route API. Kalau hook ini salah, akibatnya menu terlihat atau
 * tidak — bukan data bocor.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Permission } from '@/modules/auth/domain/permissions';

type Me = {
  role: 'OWNER' | 'STAFF' | null;
  can: Partial<Record<Permission, boolean>>;
};

export type UsePermission = {
  /** True selama `/me` belum selesai — pakai untuk menyembunyikan aksi sensitif. */
  loading: boolean;
  can: (permission: Permission) => boolean;
  /** Convenience: boleh semua ini bila role OWNER. */
  isOwner: boolean;
};

export function usePermission(): UsePermission {
  const [me, setMe] = useState<Me | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<Me>('/api/v1/auth/me');
      setMe(res);
    } catch {
      // Gagal memuat bukan berarti boleh. Fail-closed: tanpa data, tidak ada
      // aksi sensitif yang ditampilkan.
      setMe({ role: null, can: {} });
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  return {
    loading: me === null,
    isOwner: me?.role === 'OWNER',
    can: (permission: Permission) =>
      me?.role === 'OWNER' ? true : me?.can?.[permission] === true,
  };
}
