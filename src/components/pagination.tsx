'use client';

/**
 * Kontrol halaman untuk daftar yang panjang.
 *
 * Dipakai bersama oleh halaman Produk, Inventori, Pengembalian, dan Pesanan
 * supaya aturan tampilannya cuma ditulis sekali — bukan disalin empat kali lalu
 * menyimpang satu sama lain.
 *
 * Dua hal yang sengaja selalu ditampilkan:
 *  1. jumlah sebenarnya ("Menampilkan 20 dari 347"), supaya operator tahu ada
 *     berapa banyak di luar yang sedang terlihat;
 *  2. tombol yang mati saat sudah di ujung, supaya tidak ada klik yang tidak
 *     melakukan apa pun.
 *
 * Komponen ini murni tampilan: pemanggil yang menyimpan nomor halaman dan
 * memuat ulang datanya.
 */

export interface PaginationInfo {
  total: number;
  page: number;
  pageSize: number;
  /** Boleh dihilangkan; dihitung dari total dan pageSize bila tidak ada. */
  totalPages?: number;
}

export function Pagination({
  info,
  onChange,
  label = 'data',
  disabled = false,
}: {
  info: PaginationInfo;
  onChange: (page: number) => void;
  /** Kata benda untuk keterangan, mis. "produk", "pesanan". */
  label?: string;
  disabled?: boolean;
}) {
  const totalPages = Math.max(1, info.totalPages ?? Math.ceil(info.total / Math.max(1, info.pageSize)));

  // Daftar kosong tidak butuh kontrol, dan menampilkan "Menampilkan 0 dari 0"
  // hanya menambah kebisingan di layar.
  if (info.total === 0) return null;

  // Nomor halaman terakhir yang benar-benar terisi di halaman ini.
  const terakhir = Math.min(info.page * info.pageSize, info.total);
  const pertama = (info.page - 1) * info.pageSize + 1;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        marginTop: 12,
      }}
    >
      <span className="small muted">
        Menampilkan {pertama}–{terakhir} dari {info.total} {label} · halaman {info.page} dari{' '}
        {totalPages}
      </span>
      {totalPages > 1 && (
        <div className="filter-chips">
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={disabled || info.page <= 1}
            aria-label={`Halaman sebelumnya dari ${label}`}
            onClick={() => onChange(Math.max(1, info.page - 1))}
          >
            Sebelumnya
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={disabled || info.page >= totalPages}
            aria-label={`Halaman berikutnya dari ${label}`}
            onClick={() => onChange(Math.min(totalPages, info.page + 1))}
          >
            Berikutnya
          </button>
        </div>
      )}
    </div>
  );
}
