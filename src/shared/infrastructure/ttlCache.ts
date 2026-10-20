/**
 * Cache TTL kecil untuk agregat yang dipanggil berulang.
 *
 * Kenapa perlu: badge di menu samping dan kartu ringkasan halaman Pesanan
 * meminta angka yang sama setiap 30 detik (dan setiap ada event realtime).
 * Menghitungnya ulang dari database pada setiap permintaan hanya membebani
 * database tanpa menambah kebenaran — angka itu memang bergerak lambat.
 *
 * Kenapa TTL pendek (detik, bukan menit): data pesanan berubah karena
 * sinkronisasi Shopee tiap 60 detik. TTL 15 detik berarti paling buruk operator
 * melihat angka yang tertinggal 15 detik, dan itu masih di bawah irama
 * sinkronisasi. Tidak ada cache yang "diam-diam basi berjam-jam".
 *
 * Tidak memakai Redis/Upstash: aplikasi ini satu proses PM2, jadi Map di memori
 * sudah cukup dan tidak menambah ketergantungan baru.
 */

export interface TtlCacheOptions {
  /** Umur entri dalam milidetik. */
  ttlMs: number;
  /** Batas jumlah entri; entri tertua dibuang lebih dulu. */
  maxEntries?: number;
}

export interface TtlCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  /** Hapus semua entri yang kuncinya diawali `prefix`. */
  invalidatePrefix(prefix: string): void;
  clear(): void;
  readonly size: number;
}

export function createTtlCache<T>({ ttlMs, maxEntries = 200 }: TtlCacheOptions): TtlCache<T> {
  const store = new Map<string, { value: T; expiresAt: number }>();

  const buangKedaluwarsa = (now: number) => {
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) store.delete(key);
    }
  };

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      const now = Date.now();
      if (store.size >= maxEntries) {
        buangKedaluwarsa(now);
        // Masih penuh berarti semua entri masih segar: buang yang paling lama dibuat.
        while (store.size >= maxEntries) {
          const tertua = store.keys().next();
          if (tertua.done) break;
          store.delete(tertua.value);
        }
      }
      store.set(key, { value, expiresAt: now + ttlMs });
    },
    delete(key) {
      store.delete(key);
    },
    invalidatePrefix(prefix) {
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) store.delete(key);
      }
    },
    clear() {
      store.clear();
    },
    get size() {
      return store.size;
    },
  };
}
