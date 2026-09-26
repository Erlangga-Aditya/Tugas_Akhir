/**
 * Typed API client for the internal v1 API.
 * The session is an httpOnly cookie (sent automatically on same-origin fetch),
 * so no token handling is needed client-side.
 */
export interface ApiError extends Error {
  code?: string;
  details?: Record<string, unknown>;
}

export async function api<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: options?.method ?? 'GET',
    headers: options?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: { code?: string; message?: string; details?: Record<string, unknown> };
    meta?: { pagination?: { total?: number; page?: number; pageSize?: number; hasMore?: boolean } };
  };

  if (!res.ok) {
    const err = new Error(json.error?.message ?? 'Terjadi kesalahan. Silakan coba lagi.') as ApiError;
    err.code = json.error?.code;
    err.details = json.error?.details;
    throw err;
  }

  return json.data as T;
}

export interface Pagination {
 total: number;
 page: number;
 pageSize: number;
 hasMore?: boolean;
}

/**
 * Unduh file label RESMI Shopee untuk satu pesanan.
 *
 * Endpoint `print-label` mengembalikan FILE (PDF/HTML/ZIP dari Shopee), bukan
 * JSON. Fungsi ini mengambil filenya lalu menampilkannya di tab baru lewat
 * object URL, lalu membersihkannya supaya tidak menumpuk di memori.
 *
 * Fungsi ini tidak pernah membuat label sendiri: kalau Shopee menolak, error
 * dari server diteruskan apa adanya.
 */
export async function openOfficialLabel(orderId: string, options?: { shopId?: string; packageNumber?: string }): Promise<void> {
 const res = await fetch(`/api/v1/orders/${orderId}/print-label`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(options ?? {}),
 });

 if (!res.ok) {
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  throw new Error(json.error?.message ?? 'Shopee belum bisa membuat label untuk pesanan ini.');
 }

 const blob = await res.blob();
 if (blob.size === 0) throw new Error('File label dari Shopee kosong.');

 const url = URL.createObjectURL(blob);
 const win = window.open(url, '_blank', 'noopener,noreferrer');
 if (!win) {
  // Popup diblokir peramban → tetap buka di tab yang sama.
  window.location.href = url;
  // Jangan buat object URL membocor jika halaman langsung digantikan.
  return;
 }
 // Beri waktu browser membaca file, lalu bebaskan object URL.
 setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function formatRupiah(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
