import { prisma } from '@/shared/infrastructure/prisma';
import { ValidationError } from '@/shared/errors/AppError';

/**
 * Tentukan toko Shopee yang dipakai sebuah permintaan.
 *
 * ATURAN: kalau pemanggil tidak menyebut toko dan tenant hanya punya SATU toko,
 * pakai toko itu. Pada praktiknya satu tenant memakai satu toko, jadi mewajibkan
 * `shopId` di setiap request hanya memindahkan beban ke pemanggil tanpa menambah
 * keamanan.
 *
 * Kalau tenant punya beberapa toko, `shopId` tetap wajib — memilihkan diam-diam
 * bisa menyinkronkan toko yang salah.
 */
export async function resolveShopId(tenantId: string, shopId?: string | null): Promise<string> {
  const trimmed = shopId?.trim();
  if (trimmed) return trimmed;

  // WAJIB `id` (cuid internal), bukan `externalShopId`: `loadConnection`
  // mencari `prisma.shop.findFirst({ where: { id: shopId } })`. Memakai
  // externalShopId akan lolos validasi lalu gagal dengan "Toko tidak ditemukan".
  const shops = await prisma.shop.findMany({
    where: { tenantId },
    select: { id: true },
    take: 2,
  });

  if (shops.length === 0) {
    throw new ValidationError(
      'Belum ada toko Shopee yang terhubung. Hubungkan toko di menu Integrasi terlebih dahulu.',
    );
  }
  if (shops.length > 1) {
    throw new ValidationError(
      'Toko ini punya lebih dari satu koneksi Shopee, jadi toko tujuan harus disebutkan.',
    );
  }
  return shops[0]!.id;
}
