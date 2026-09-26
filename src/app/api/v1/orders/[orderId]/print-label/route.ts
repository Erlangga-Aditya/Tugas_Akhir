import { type NextRequest } from 'next/server';
import { generateShippingLabel } from '@/modules/integrations/application/sync.service';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { handleRouteError } from '@/shared/application/apiResponse';
import { logger } from '@/shared/observability/logger';

type Ctx = { params: Promise<{ orderId: string }> };

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/orders/[orderId]/print-label
 * Unduh label RESMI Shopee untuk satu pesanan.
 *
 * Mengembalikan file label persis seperti Shopee menerbitkannya (PDF, HTML, atau
 * ZIP untuk printer thermal) — tidak ada gambar ulang, tidak ada barcode buatan,
 * tidak ada data asumsi. Alur 4 langkah Shopee dijalankan di service layer.
 *
 * Respons:
 *  - 200 + file label (Content-Type dari Shopee / hasil yang terdeteksi)
 *  - 4xx/5xx + JSON berisi pesan error apa adanya (tidak pernah memakai label palsu)
 *
 * Body: { shopId?: string, packageNumber?: string }
 */
export async function POST(request: NextRequest, { params }: Ctx) {
 const requestId = getRequestId(request);
 try {
  const ctx = getAuthContext(request);
  const { orderId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
   shopId?: string;
   packageNumber?: string;
  };

  const label = await generateShippingLabel(ctx.tenantId, body.shopId ?? '', orderId, body.packageNumber);

  return new Response(new Uint8Array(label.bytes), {
   status: 200,
   headers: {
    'Content-Type': label.contentType,
    'Content-Disposition': `inline; filename="${label.fileName}"`,
    'Content-Length': String(label.bytes.byteLength),
    'Cache-Control': 'no-store',
    'X-Request-Id': requestId,
    'X-Shopee-Document-Type': label.documentType,
   },
  });
 } catch (error) {
  // Log di server (operasional). Balasan ke klien tetap jujur: pesan error Shopee
  // diteruskan apa adanya, tidak pernah digantikan label buatan.
  logger.error('Gagal membuat label resmi Shopee', { requestId, message: (error as Error).message });
  return handleRouteError(error, requestId, request);
 }
}
