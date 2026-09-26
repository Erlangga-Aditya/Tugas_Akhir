import { type NextRequest, NextResponse } from 'next/server';
import { ShopeeAdapter } from '@/modules/integrations/infrastructure/shopee.adapter';
import { processWebhookEvent } from '@/modules/integrations/application/sync.service';
import { getShopeeAppConfig } from '@/modules/integrations/application/appConfig.service';
import { prisma } from '@/shared/infrastructure/prisma';
import { logger } from '@/shared/observability/logger';

/**
 * Shopee Push (webhook) receiver.
 *
 * Authenticated via HMAC-SHA256 signature in Authorization header.
 * Always responds 2xx + empty body to ACK (per Shopee push docs §6.3).
 * Retry intervals: [300, 1800, 10800] seconds if we don't ACK in time.
 *
 * Handled push codes (source: 20-SHOPEE-API-REFERENCE.md §6.2):
 *   1  → shop_authorization_push
 *   2  → shop_authorization_canceled_push
 *   3  → order_status_push
 *   4  → order_trackingno_push
 *   5  → shopee_updates_push
 *   12 → open_api_authorization_expiry
 *   15 → shipping_document_status_push
 *   29 → return_updates_push
 *   30 → package_fulfillment_status_push
 */

const PUSH_EVENT_TYPES: Record<number, string> = {
  1: 'shop_authorization_push',
  2: 'shop_authorization_canceled_push',
  3: 'order_status_push',
  4: 'order_trackingno_push',
  5: 'shopee_updates_push',
  8: 'reserved_stock_change_push',
  11: 'video_upload_push',
  12: 'open_api_authorization_expiry',
  15: 'shipping_document_status_push',
  22: 'item_price_update_push',
  29: 'return_updates_push',
  30: 'package_fulfillment_status_push',
  37: 'courier_delivery_binding_status_push',
  47: 'package_info_push',
};

/** ACK Shopee push: HTTP 2xx + empty body (per docs §6.3). */
function ack(): NextResponse {
  return new NextResponse(null, { status: 200 });
}

export async function POST(request: NextRequest) {
  // Read raw body BEFORE any JSON parsing — required for signature verification.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: 'unreadable_body' }, { status: 400 });
  }

  const signature = request.headers.get('authorization') ?? '';
  const { partnerKey } = await getShopeeAppConfig();

  // ── Signature verification ─────────────────────────────────────────────────
  if (!partnerKey) {
    logger.warn('Webhook diterima tetapi Partner Key belum dikonfigurasi — tidak bisa verifikasi.');
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  if (!signature) {
    logger.warn('Webhook tanpa Authorization header ditolak');
    return NextResponse.json({ error: 'missing_signature' }, { status: 401 });
  }

  const adapter = new ShopeeAdapter();
  const callbackUrl = request.url;

  if (!adapter.verifyWebhookSignature(callbackUrl, rawBody, signature, partnerKey)) {
    logger.warn('Webhook signature tidak valid, ditolak', { url: callbackUrl });
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  // ── Parse payload ──────────────────────────────────────────────────────────
  let payload: {
    data?: Record<string, unknown>;
    shop_id?: number;
    code?: number;
    timestamp?: number;
  };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    logger.warn('Webhook dengan payload non-JSON diterima setelah verifikasi signature berhasil', {
      body: rawBody.slice(0, 200),
    });
    return ack(); // ACK to prevent retry storm
  }

  const code = payload.code ?? 0;
  const eventType = PUSH_EVENT_TYPES[code] ?? `push_code_${code}`;
  const data = payload.data ?? {};
  const externalShopId = String(payload.shop_id ?? '');

  logger.info(`Shopee webhook diterima: code=${code} (${eventType})`, {
    shopId: externalShopId,
    timestamp: payload.timestamp,
  });

  // ── Resolve tenant via external shop id ────────────────────────────────────
  const shop = await prisma.shop.findFirst({
    where: { provider: 'shopee', externalShopId },
    include: { tenant: true },
  });

  if (!shop) {
    logger.warn('Webhook untuk shop yang tidak terdaftar — ACK anyway', { externalShopId, code });
    return ack(); // ACK to prevent retry storm for unknown shops
  }

  // ── Build idempotency key ──────────────────────────────────────────────────
  // Use multiple fields to ensure uniqueness per event type
  const key =
    (data.ordersn as string) ??
    (data.order_sn as string) ??
    (data.return_sn as string) ??
    (data.booking_sn as string) ??
    (data.package_number as string) ??
    '';
  const updateTime = (data.update_time as number) ?? (payload.timestamp as number) ?? Date.now();
  const externalEventId = `${externalShopId}-${code}-${key}-${updateTime}`;

  // ── Process the event ──────────────────────────────────────────────────────
  try {
    await processWebhookEvent(
      shop.tenantId,
      shop.id,
      'shopee',
      externalEventId,
      eventType,
      payload as unknown as Record<string, unknown>,
    );
  } catch (err) {
    logger.error('Webhook processing gagal', {
      error: (err as Error).message,
      eventType,
      externalEventId,
    });
    // Do NOT return 5xx — that triggers Shopee retry storm.
    // Log the error and ACK anyway; the event is stored in webhookEvents table.
    return ack();
  }

  return ack();
}
