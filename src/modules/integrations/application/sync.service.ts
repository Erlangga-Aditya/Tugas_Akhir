import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/shared/infrastructure/prisma';
import { ShopeeAdapter } from '../infrastructure/shopee.adapter';
import { encryptSecret, decryptSecret } from '../infrastructure/crypto.service';
import { importOrder } from '@/modules/orders/application/order.usecase';
import { processOrderForFulfillment } from '@/modules/fulfillment/application/fulfillment.usecase';
import { NotFoundError, ExternalIntegrationError } from '@/shared/errors/AppError';
import { auditLog } from '@/modules/audit/application/auditLog.service';
import { logger } from '@/shared/observability/logger';
import type { ShopCredentials, ArrangeShipmentInput } from '../domain/marketplace.adapter';
import { broadcastSystemEvent } from '@/lib/sse';
import { getShopeeAppConfig } from './appConfig.service';
import { computePlatformFee, toAmount } from '../domain/escrow-fee-mapping';

const shopee = new ShopeeAdapter();

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

interface StoredCredentials {
  shopId: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds when access_token expires. */
  tokenExpiresAt: number;
  mainAccountId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load shop + integration connection from DB.
 * Throws NotFoundError when shop or credentials are missing.
 */
async function loadConnection(tenantId: string, shopId: string) {
  const shop = await prisma.shop.findFirst({ where: { id: shopId, tenantId } });
  if (!shop) throw new NotFoundError('Toko', shopId);

  const conn = await prisma.integrationConnection.findFirst({
    where: { shopId, provider: 'shopee' },
  });
  if (!conn?.encryptedCredentials) {
    throw new ExternalIntegrationError(
      'shopee',
      'Koneksi Shopee belum dikonfigurasi. Hubungkan toko terlebih dahulu melalui menu Integrasi.',
    );
  }
  const creds = JSON.parse(decryptSecret(conn.encryptedCredentials)) as StoredCredentials;
  return { shop, conn, creds };
}

/**
 * Build ShopCredentials for adapter calls from stored creds + env.
 */
function buildShopCredentials(creds: StoredCredentials): ShopCredentials {
  return {
    shopId: creds.shopId,
    accessToken: creds.accessToken,
    partnerId: process.env.SHOPEE_PARTNER_ID ?? '',
    partnerKey: process.env.SHOPEE_PARTNER_KEY ?? '',
  };
}

/**
 * Refresh access_token if expired or within 5 minutes of expiry.
 * Persists refreshed credentials (encrypted) back to DB.
 */
async function ensureFreshToken(connId: string, creds: StoredCredentials): Promise<StoredCredentials> {
  const now = Date.now();
  if (creds.tokenExpiresAt - now > 5 * 60 * 1000) return creds; // still valid

  logger.info('Shopee access_token mendekati expiry, refresh...', { shopId: creds.shopId });
  const refreshed = await shopee.refreshAccessToken(creds.refreshToken, creds.shopId);

  if (refreshed.error && refreshed.error !== '') {
    throw new ExternalIntegrationError(
      'shopee',
      `Gagal refresh token: [${refreshed.error}] ${refreshed.message ?? ''}. Otorisasi ulang diperlukan.`,
    );
  }

  const next: StoredCredentials = {
    ...creds,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token, // single-use; always update
    tokenExpiresAt: now + refreshed.expire_in * 1000,
  };
  await prisma.integrationConnection.update({
    where: { id: connId },
    data: {
      encryptedCredentials: encryptSecret(JSON.stringify(next)),
      status: 'ACTIVE',
      lastSyncAt: new Date(),
    },
  });
  logger.info('Shopee token refreshed berhasil', { shopId: creds.shopId });
  return next;
}

/**
 * Map Shopee order_status → internal OrderStatus enum.
 * Source: 20-SHOPEE-API-REFERENCE.md §5.1 (verified).
 */
export function mapShopeeStatusToInternal(status: string): 'NEW' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' {
  switch (status) {
    case 'UNPAID':
    case 'PENDING':
    case 'IN_CANCEL':
    case 'TO_RETURN':
      return 'NEW';
    case 'READY_TO_SHIP':
    case 'PROCESSED':
    case 'RETRY_SHIP':
    case 'SHIPPED':
    case 'TO_CONFIRM_RECEIVE':
      return 'CONFIRMED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'COMPLETED':
      return 'COMPLETED';
    default:
      return 'NEW';
  }
}

/**
 * Map Shopee return status → internal ReturnStatus.
 */
export function mapReturnStatus(
  status: string,
): 'REQUESTED' | 'IN_TRANSIT' | 'RECEIVED' | 'INSPECTION' | 'RESTOCKED' | 'DAMAGED' | 'REJECTED' | 'CLOSED' {
  switch (status.toUpperCase()) {
    case 'REQUESTED':
    case 'PROCESSING':
      return 'REQUESTED';
    case 'ACCEPTED':
      return 'IN_TRANSIT';
    case 'RECEIVED':
    case 'TO_RECEIVE':
      return 'RECEIVED';
    case 'COMPLETED':
      return 'CLOSED';
    case 'REJECTED':
      return 'REJECTED';
    default:
      return 'REQUESTED';
  }
}

/**
 * Resolve a local ProductVariant from a Shopee order item.
 * Strategy (in order):
 *  1. Lookup via ExternalProductMapping (most reliable after product sync)
 *  2. Fallback: match by SKU across the tenant's products
 *  3. Returns null if not found (we log & skip the item but NOT the whole order)
 */
async function resolveVariant(
  tenantId: string,
  shopId: string,
  externalVariantId: string,
  sku: string,
  externalProductId?: string,
) {
  // Strategy 1: ExternalProductMapping by externalVariantId
  if (externalVariantId && externalVariantId !== '0') {
    const mapping = await prisma.externalProductMapping.findFirst({
      where: { shopId, externalVariantId },
      include: { variant: true },
    });
    if (mapping?.variant) return mapping.variant;
  }

  // Strategy 2: ExternalProductMapping by externalProductId (for single-variant items)
  if (externalProductId) {
    const mapping = await prisma.externalProductMapping.findFirst({
      where: { shopId, externalProductId },
      include: { variant: true },
    });
    if (mapping?.variant) return mapping.variant;
  }

  // Strategy 3: SKU fallback across tenant
  if (sku) {
    const variant = await prisma.productVariant.findFirst({
      where: { product: { tenantId }, sku },
    });
    if (variant) return variant;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sync orders from Shopee → local DB.
 * - Uses cursor-based pagination (7-day default window)
 * - Maps items via ExternalProductMapping first, SKU as fallback
 * - Skips unmapped items (not orders) to avoid data loss
 * - Auto-creates Shipment when order has a tracking number
 * - Auto-processes CONFIRMED orders (reserve stock + create fulfillment)
 */
export async function triggerOrderSync(tenantId: string, shopId: string, actorId: string) {
  const { conn, creds } = await loadConnection(tenantId, shopId);
  const fresh = await ensureFreshToken(conn.id, creds);
  const credentials = buildShopCredentials(fresh);

  const syncRun = await prisma.syncRun.create({
    data: { tenantId, shopId, operation: 'import_orders', status: 'RUNNING' },
  });

  const warehouse = await prisma.warehouse.findFirst({
    where: { tenantId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  });

  try {
    const orders = await shopee.getOrders(credentials, {});
    const recordsRead = orders.length;
    let recordsWritten = 0;
    let skippedOrders = 0;
    /** orderSn → daftar SKU yang belum ter-mapping (dilaporkan ke UI, bukan cuma di log). */
    const unmappedByOrder = new Map<string, string[]>();

    logger.info(`Shopee sync: ${orders.length} pesanan diterima dari API`, { shopId: fresh.shopId });

    for (const mOrder of orders) {
      // Build local item list (skip unmapped items, but not the whole order)
      const items: Array<{ variantId: string; quantity: number; unitPrice?: number }> = [];
      const unmappedSkus: string[] = [];

      for (const mi of mOrder.items) {
        const variant = await resolveVariant(
          tenantId,
          shopId,
          mi.externalVariantId,
          mi.sku,
          mi.externalItemId,
        );
        if (variant) {
          items.push({ variantId: variant.id, quantity: mi.quantity, unitPrice: mi.unitPrice });
        } else {
          unmappedSkus.push(mi.sku || mi.externalVariantId);
        }
      }

      if (unmappedSkus.length > 0) {
        unmappedByOrder.set(mOrder.externalOrderId, unmappedSkus);
      }

      if (items.length === 0) {
        // All items unmapped → skip this order but log clearly
        logger.warn(
          `Order ${mOrder.externalOrderId} dilewati: semua item tidak ter-mapping (SKU: ${unmappedSkus.join(', ')}). ` +
            `Lakukan sinkronisasi produk terlebih dahulu.`,
          { externalOrderId: mOrder.externalOrderId },
        );
        skippedOrders++;
        continue;
      }

      if (unmappedSkus.length > 0) {
        logger.warn(
          `Order ${mOrder.externalOrderId}: ${unmappedSkus.length} item tidak ter-mapping (${unmappedSkus.join(', ')}), ` +
            `diimpor dengan ${items.length} item yang dikenali.`,
        );
      }

      const result = await importOrder(tenantId, {
        shopId,
        externalOrderId: mOrder.externalOrderId,
        placedAt: mOrder.placedAt,
        shipByAt: mOrder.shipByAt,
        buyerName: mOrder.buyerName,
        buyerPhone: mOrder.buyerPhone,
        buyerNote: mOrder.buyerNote,
        shippingAddress: mOrder.shippingAddress,
        status: mapShopeeStatusToInternal(mOrder.rawStatus),
        items,
        currency: mOrder.payment?.currency ?? undefined,
        totalAmount: mOrder.payment?.totalAmount ?? undefined,
        itemSubtotal: mOrder.payment?.itemSubtotal ?? undefined,
        sellerDiscount: mOrder.payment?.sellerDiscount ?? undefined,
        shopeeDiscount: mOrder.payment?.shopeeDiscount ?? undefined,
        buyerShippingFee: mOrder.payment?.buyerShippingFee ?? undefined,
        shippingFeeDiscount: mOrder.payment?.shippingFeeDiscount ?? undefined,
        platformFee: mOrder.payment?.platformFee ?? undefined,
        escrowAmount: mOrder.payment?.escrowAmount ?? undefined,
        paymentMethod: mOrder.payment?.paymentMethod ?? undefined,
        isCod: mOrder.payment?.isCod,
        paidAt: mOrder.payment?.paidAt ?? undefined,
        packageNumber: mOrder.payment?.packageNumber ?? undefined,
        incomeJson: mOrder.payment?.income ?? undefined,
      });

      // Auto-create/update Shipment if order has tracking info
      if (mOrder.trackingNumber) {
        await upsertShipment(tenantId, result.orderId, mOrder.trackingNumber, mOrder.carrier, mOrder.rawStatus);
      }

      // Auto-process newly imported CONFIRMED orders
      if (result.created && warehouse && mapShopeeStatusToInternal(mOrder.rawStatus) === 'CONFIRMED') {
        try {
          await processOrderForFulfillment(tenantId, result.orderId, warehouse.id, actorId);
        } catch (err) {
          logger.warn('Gagal memproses fulfillment otomatis', {
            orderId: result.orderId,
            error: (err as Error).message,
          });
        }
      }

      if (result.created) recordsWritten++;
    }

    const unmappedSkuList = [...new Set([...unmappedByOrder.values()].flat())];

    const completed = await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: 'COMPLETED',
        recordsRead,
        recordsWritten,
        finishedAt: new Date(),
        ...(skippedOrders > 0 || unmappedSkuList.length > 0
          ? {
              metadataJson: {
                skippedOrders,
                unmappedSkus: unmappedSkuList,
                unmappedOrders: [...unmappedByOrder.keys()],
              },
            }
          : {}),
      },
    });

    await auditLog({
      tenantId,
      actorId,
      action: 'sync_orders_complete',
      entityType: 'Shop',
      entityId: shopId,
      metadata: { recordsRead, recordsWritten, skippedOrders, unmappedSkus: unmappedSkuList },
    });

    // Beri tahu semua klien (SSE) SETELAH data benar-benar tersimpan.
    broadcastSystemEvent('orders:synced', {
      tenantId,
      shopId,
      data: {
        recordsRead,
        recordsWritten,
        skippedOrders,
        unmappedSkuCount: unmappedSkuList.length,
      },
    });

    logger.info(`Shopee sync selesai: ${recordsWritten} baru, ${skippedOrders} dilewati`, { shopId: fresh.shopId });

    // Rincian biaya (komisi, biaya layanan, dana yang dilepas ke penjual) diambil dari
    // modul Payment Shopee — hanya untuk pesanan yang belum punya rincian, sehingga
    // tidak menambah panggilan setelah semua terisi.
    try {
      await syncEscrowDetailsForShop(tenantId, shopId, actorId, { limit: 20 });
    } catch (err) {
      logger.warn('Sinkronisasi rincian biaya dilewati', { error: (err as Error).message });
    }

    return completed;
  } catch (err) {
    const msg = (err as Error).message || 'Sync error tidak diketahui';
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: { status: 'FAILED', errorMessage: msg, finishedAt: new Date() },
    });
    throw new ExternalIntegrationError('shopee', msg);
  }
}

/**
 * Sync products & variants from Shopee → local DB.
 * - Upserts Product + ProductVariant records
 * - Creates ExternalProductMapping linking externalVariantId → local variantId
 * - Initializes InventoryBalance (0) for new variants in the default warehouse
 * This is the REQUIRED first step before order sync can work.
 */
export async function triggerProductSync(tenantId: string, shopId: string, actorId: string) {
  const { conn, creds, shop } = await loadConnection(tenantId, shopId);
  const fresh = await ensureFreshToken(conn.id, creds);
  const credentials = buildShopCredentials(fresh);

  const syncRun = await prisma.syncRun.create({
    data: { tenantId, shopId, operation: 'sync_products', status: 'RUNNING' },
  });

  const warehouse = await prisma.warehouse.findFirst({
    where: { tenantId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  });

  try {
    const products = await shopee.getProducts(credentials);
    let productsWritten = 0;
    let variantsWritten = 0;

    logger.info(`Shopee sync produk: ${products.length} produk dari API`, { shopId: fresh.shopId });

    for (const mp of products) {
      // Upsert Product (match by externalProductId stored via mapping, or existing SKU, or create new)
      let localProduct = await findLocalProduct(tenantId, shopId, mp.externalProductId);

      if (!localProduct && mp.sku) {
        const existingVariant = await prisma.productVariant.findFirst({
          where: { product: { tenantId }, sku: mp.sku },
          include: { product: true },
        });
        if (existingVariant?.product) {
          localProduct = existingVariant.product;
        }
      }

      if (!localProduct) {
        localProduct = await prisma.product.create({
          data: {
            tenantId,
            name: mp.name,
            description: null,
            category: null,
            status: 'ACTIVE',
          },
        });
        productsWritten++;
      } else {
        // Update name if changed
        await prisma.product.update({
          where: { id: localProduct.id },
          data: { name: mp.name, updatedAt: new Date() },
        });
      }

      // Upsert variants
      for (const mv of mp.variants) {
        if (!mv.externalVariantId) continue;

        // Check existing mapping
        const existingMapping = await prisma.externalProductMapping.findFirst({
          where: { shopId, externalVariantId: mv.externalVariantId },
          include: { variant: true },
        });

        let localVariant = existingMapping?.variant ?? null;

        if (!localVariant) {
          // Check by SKU within the product first
          const bySku = mv.sku
            ? await prisma.productVariant.findFirst({
                where: { productId: localProduct.id, sku: mv.sku },
              })
            : null;

          if (bySku) {
            localVariant = bySku;
          } else {
            // Create new variant
            const sku = mv.sku || `${mp.externalProductId}-${mv.externalVariantId}`;
            localVariant = await prisma.productVariant.create({
              data: {
                productId: localProduct.id,
                sku,
                name: mv.name || mp.name,
                imageUrl: mp.imageUrl,
                status: 'ACTIVE',
              },
            });
            variantsWritten++;
          }
        } else {
          // Update variant name and imageUrl if changed
          await prisma.productVariant.update({
            where: { id: localVariant.id },
            data: {
              name: mv.name || mp.name,
              ...(mp.imageUrl && !localVariant.imageUrl ? { imageUrl: mp.imageUrl } : {}),
              updatedAt: new Date(),
            },
          });
        }

        // Upsert ExternalProductMapping
        await prisma.externalProductMapping.upsert({
          where: { shopId_externalVariantId: { shopId, externalVariantId: mv.externalVariantId } },
          create: {
            shopId,
            variantId: localVariant.id,
            externalProductId: mp.externalProductId,
            externalVariantId: mv.externalVariantId,
          },
          update: {
            variantId: localVariant.id,
            externalProductId: mp.externalProductId,
          },
        });

        // Initialize InventoryBalance for new variant (stock = Shopee stock or 0)
        if (warehouse) {
          const stockQty = mv.stock ?? 0;
          await prisma.inventoryBalance.upsert({
            where: { warehouseId_variantId: { warehouseId: warehouse.id, variantId: localVariant.id } },
            create: {
              warehouseId: warehouse.id,
              variantId: localVariant.id,
              onHand: stockQty,
              reserved: 0,
              blocked: 0,
            },
            update: {
              onHand: stockQty, // sync with Shopee stock
            },
          });
        }
      }
    }

    const completed = await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: 'COMPLETED',
        recordsRead: products.length,
        recordsWritten: productsWritten + variantsWritten,
        finishedAt: new Date(),
      },
    });

    await auditLog({
      tenantId,
      actorId,
      action: 'sync_products_complete',
      entityType: 'Shop',
      entityId: shopId,
      metadata: { productsFromShopee: products.length, productsWritten, variantsWritten },
    });

    logger.info(`Shopee sync produk selesai: ${productsWritten} produk baru, ${variantsWritten} varian baru`, {
      shopId: shop.externalShopId,
    });
    return completed;
  } catch (err) {
    const msg = (err as Error).message || 'Sync produk error';
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: { status: 'FAILED', errorMessage: msg, finishedAt: new Date() },
    });
    throw new ExternalIntegrationError('shopee', msg);
  }
}

/**
 * Find local product via ExternalProductMapping (any variant of this product).
 */
async function findLocalProduct(tenantId: string, shopId: string, externalProductId: string) {
  const mapping = await prisma.externalProductMapping.findFirst({
    where: { shopId, externalProductId },
    include: { variant: { include: { product: true } } },
  });
  if (mapping?.variant?.product?.tenantId === tenantId) {
    return mapping.variant.product;
  }
  return null;
}

/**
 * Sync returns from Shopee → local DB.
 * Maps Shopee return_sn → local Return record, linked to the local Order.
 */
export async function triggerReturnSync(tenantId: string, shopId: string, actorId: string) {
  const { conn, creds } = await loadConnection(tenantId, shopId);
  const fresh = await ensureFreshToken(conn.id, creds);
  const credentials = buildShopCredentials(fresh);

  const syncRun = await prisma.syncRun.create({
    data: { tenantId, shopId, operation: 'sync_returns', status: 'RUNNING' },
  });

  try {
    const returns = await shopee.getReturns(credentials);
    let recordsWritten = 0;

    for (const mr of returns) {
      // Find local order
      const order = await prisma.order.findUnique({
        where: { shopId_externalOrderId: { shopId, externalOrderId: mr.externalOrderId } },
      });
      if (!order) {
        logger.warn(`Return ${mr.externalReturnId}: order ${mr.externalOrderId} tidak ditemukan di DB lokal`);
        continue;
      }

      // Upsert Return
      const existing = await prisma.return.findFirst({
        where: { orderId: order.id, externalReturnId: mr.externalReturnId },
      });

      const status = mapReturnStatus(mr.status);

      if (!existing) {
        // Build return items (only those with resolvable variants)
        const returnItems: Array<{ variantId: string; quantity: number }> = [];
        for (const ri of mr.items) {
          const variant = await resolveVariant(
            tenantId,
            shopId,
            ri.externalVariantId,
            ri.sku,
            ri.externalItemId,
          );
          if (variant) {
            returnItems.push({ variantId: variant.id, quantity: ri.quantity });
          }
        }

        if (returnItems.length > 0) {
          await prisma.return.create({
            data: {
              orderId: order.id,
              externalReturnId: mr.externalReturnId,
              status,
              reason: mr.reason,
              items: { create: returnItems },
            },
          });
          recordsWritten++;
        }
      } else if (existing.status !== status) {
        await prisma.return.update({
          where: { id: existing.id },
          data: { status },
        });
      }
    }

    const completed = await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: 'COMPLETED',
        recordsRead: returns.length,
        recordsWritten,
        finishedAt: new Date(),
      },
    });

    await auditLog({
      tenantId,
      actorId,
      action: 'sync_returns_complete',
      entityType: 'Shop',
      entityId: shopId,
      metadata: { returnsFromShopee: returns.length, recordsWritten },
    });

    return completed;
  } catch (err) {
    const msg = (err as Error).message || 'Sync return error';
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: { status: 'FAILED', errorMessage: msg, finishedAt: new Date() },
    });
    throw new ExternalIntegrationError('shopee', msg);
  }
}

/**
 * Sync tracking information for all active shipments AND active orders without shipment yet.
 * - For orders with tracking_number in Shopee (SHIPPED/TO_CONFIRM_RECEIVE) but no local Shipment,
 *   auto-creates Shipment + ShipmentEvents.
 * - For orders with existing Shipment not yet DELIVERED/FAILED, updates status and events.
 */
export async function triggerTrackingSync(tenantId: string, shopId: string, actorId: string) {
  const { conn, creds } = await loadConnection(tenantId, shopId);
  const fresh = await ensureFreshToken(conn.id, creds);
  const credentials = buildShopCredentials(fresh);

  const syncRun = await prisma.syncRun.create({
    data: { tenantId, shopId, operation: 'sync_tracking', status: 'RUNNING' },
  });

  try {
    let recordsWritten = 0;

    // ── 1. Active shipments that need status update ──────────────────────────
    const activeShipments = await prisma.shipment.findMany({
      where: {
        order: { shopId, tenantId },
        status: { notIn: ['DELIVERED', 'FAILED', 'RETURNED'] },
      },
      include: { order: { select: { externalOrderId: true, status: true } } },
      take: 200,
    });

    for (const shipment of activeShipments) {
      const orderSn = shipment.order.externalOrderId;
      const tracking = await shopee.getTrackingInfo(credentials, orderSn);
      if (!tracking) continue;

      const newStatus = mapLogisticsStatus(tracking.status);
      await prisma.shipment.update({
        where: { id: shipment.id },
        data: {
          awb: tracking.awb && tracking.awb !== orderSn ? tracking.awb : (shipment.awb ?? undefined),
          carrier: tracking.carrier || shipment.carrier,
          status: newStatus,
          ...(newStatus === 'DELIVERED' && !shipment.deliveredAt ? { deliveredAt: new Date() } : {}),
          ...(newStatus !== 'PENDING' && newStatus !== 'READY_TO_SHIP' && !shipment.shippedAt ? { shippedAt: new Date() } : {}),
        },
      });

      // Upsert tracking events (use update_time as surrogate key)
      for (const ev of tracking.events) {
        if (!ev.externalEventId) continue;
        await prisma.shipmentEvent.upsert({
          where: { shipmentId_externalEventId: { shipmentId: shipment.id, externalEventId: ev.externalEventId } },
          create: {
            shipmentId: shipment.id,
            externalEventId: ev.externalEventId,
            status: ev.status,
            description: ev.description,
            occurredAt: ev.occurredAt,
          },
          update: { status: ev.status, description: ev.description },
        });
      }
      recordsWritten++;
    }

    // ── 2. CONFIRMED orders without local Shipment — check if Shopee has AWB ─
    const ordersWithoutShipment = await prisma.order.findMany({
      where: {
        shopId,
        tenantId,
        status: 'CONFIRMED',
        shipments: { none: {} },
      },
      select: { id: true, externalOrderId: true },
      take: 100,
    });

    for (const order of ordersWithoutShipment) {
      const awb = await shopee.getTrackingNumber(credentials, order.externalOrderId);
      if (!awb) continue; // no AWB yet from Shopee

      const tracking = await shopee.getTrackingInfo(credentials, order.externalOrderId);
      const rawStatus = tracking?.status ?? 'LOGISTICS_REQUEST_CREATED';
      await upsertShipment(tenantId, order.id, awb, tracking?.carrier ?? null, rawStatus);

      if (tracking) {
        const newShipment = await prisma.shipment.findFirst({ where: { orderId: order.id } });
        if (newShipment) {
          for (const ev of tracking.events) {
            if (!ev.externalEventId) continue;
            await prisma.shipmentEvent.upsert({
              where: { shipmentId_externalEventId: { shipmentId: newShipment.id, externalEventId: ev.externalEventId } },
              create: {
                shipmentId: newShipment.id,
                externalEventId: ev.externalEventId,
                status: ev.status,
                description: ev.description,
                occurredAt: ev.occurredAt,
              },
              update: { status: ev.status, description: ev.description },
            });
          }
        }
      }
      recordsWritten++;
      logger.info(`Shipment auto-created via tracking sync: order ${order.externalOrderId}, AWB ${awb}`);
    }

    const completed = await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: 'COMPLETED',
        recordsRead: activeShipments.length + ordersWithoutShipment.length,
        recordsWritten,
        finishedAt: new Date(),
      },
    });

    await auditLog({
      tenantId,
      actorId,
      action: 'sync_tracking_complete',
      entityType: 'Shop',
      entityId: shopId,
      metadata: {
        shipmentsChecked: activeShipments.length,
        ordersWithoutShipment: ordersWithoutShipment.length,
        updated: recordsWritten,
      },
    });

    return completed;
  } catch (err) {
    const msg = (err as Error).message || 'Sync tracking error';
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: { status: 'FAILED', errorMessage: msg, finishedAt: new Date() },
    });
    throw new ExternalIntegrationError('shopee', msg);
  }
}

/**
 * Force-refresh the Shopee access token immediately.
 * Useful for UI-triggered refresh and webhook expiry alerts.
 */
export async function forceRefreshToken(tenantId: string, shopId: string) {
  const { conn, creds } = await loadConnection(tenantId, shopId);
  // Force expiry so ensureFreshToken always refreshes
  const expiredCreds: StoredCredentials = { ...creds, tokenExpiresAt: 0 };
  const refreshed = await ensureFreshToken(conn.id, expiredCreds);
  return {
    refreshed: true,
    tokenExpiresAt: new Date(refreshed.tokenExpiresAt).toISOString(),
    expiresInMinutes: Math.floor((refreshed.tokenExpiresAt - Date.now()) / 60000),
  };
}

/**
 * Sinkronisasi penuh — jalankan semua operasi secara berurutan:
 * 1. Sinkronkan Produk (wajib pertama, agar mapping SKU terbentuk)
 * 2. Tarik Pesanan (auto-process CONFIRMED orders)
 * 3. Update Tracking (deteksi AWB baru + update status pengiriman)
 * 4. Sinkronkan Return
 *
 * Idempoten — aman untuk dipanggil berkali-kali.
 * Non-blocking per tahap: jika satu tahap gagal, tahap berikutnya tetap dijalankan.
 */
export async function triggerFullSync(tenantId: string, shopId: string, actorId: string) {
  logger.info('triggerFullSync dimulai', { tenantId, shopId });

  const results: Record<string, { status: string; error?: string; recordsWritten?: number }> = {};

  // Step 1: Produk
  try {
    const r = await triggerProductSync(tenantId, shopId, actorId);
    results.products = { status: 'COMPLETED', recordsWritten: r.recordsWritten };
  } catch (err) {
    results.products = { status: 'FAILED', error: (err as Error).message };
    logger.warn('triggerFullSync: sync produk gagal (lanjut ke step berikutnya)', { error: (err as Error).message });
  }

  // Step 2: Pesanan
  try {
    const r = await triggerOrderSync(tenantId, shopId, actorId);
    results.orders = { status: 'COMPLETED', recordsWritten: r.recordsWritten };
  } catch (err) {
    results.orders = { status: 'FAILED', error: (err as Error).message };
    logger.warn('triggerFullSync: sync pesanan gagal (lanjut ke step berikutnya)', { error: (err as Error).message });
  }

  // Step 3: Tracking
  try {
    const r = await triggerTrackingSync(tenantId, shopId, actorId);
    results.tracking = { status: 'COMPLETED', recordsWritten: r.recordsWritten };
  } catch (err) {
    results.tracking = { status: 'FAILED', error: (err as Error).message };
    logger.warn('triggerFullSync: sync tracking gagal (lanjut ke step berikutnya)', { error: (err as Error).message });
  }

  // Step 4: Return
  try {
    const r = await triggerReturnSync(tenantId, shopId, actorId);
    results.returns = { status: 'COMPLETED', recordsWritten: r.recordsWritten };
  } catch (err) {
    results.returns = { status: 'FAILED', error: (err as Error).message };
    logger.warn('triggerFullSync: sync return gagal', { error: (err as Error).message });
  }

  const allOk = Object.values(results).every((r) => r.status === 'COMPLETED');
  logger.info('triggerFullSync selesai', { results });

  await auditLog({
    tenantId,
    actorId,
    action: 'full_sync_complete',
    entityType: 'Shop',
    entityId: shopId,
    metadata: results,
  });

  return { success: allOk, results };
}

/**
 * Ambil RINCIAN BIAYA pesanan dari Shopee (modul Payment).
 *
 * Kenapa terpisah: dokumentasi resmi menyatakan `v2.order.get_order_detail` TIDAK
 * menyediakan rincian komisi/dana dilepas. Angka itu hanya ada di
 * `v2.payment.get_escrow_detail(_batch)` — di sinilah nilai "estimasi dana masuk",
 * komisi, biaya layanan, pajak, dan diskon yang sebenarnya didapat.
 *
 * Dipanggil otomatis oleh sinkronisasi ringan (untuk pesanan yang belum punya
 * rincian) dan bisa dipicu manual dari halaman Laporan Keuangan.
 */
export async function syncEscrowDetailsForShop(
  tenantId: string,
  shopId: string,
  actorId: string,
  options: { limit?: number } = {},
) {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 200);

  const orders = await prisma.order.findMany({
    where: {
      tenantId,
      shopId,
      status: { notIn: ['CANCELLED'] },
      // Ambil juga order yang rinciannya sudah ada tapi perlu disegarkan.
      // Filter lama hanya `escrowAmount: null`, sehingga order yang gagal di
      // sinkronisasi pertama tidak pernah dicoba lagi. `platformFee = 0` juga
      // ikut diambil: nol bisa berarti "belum pernah dihitung" pada run lama
      // (mapping fee sebelumnya salah nama field), bukan "memang tanpa potongan".
      OR: [{ escrowAmount: null }, { platformFee: null }, { platformFee: 0 }],
    },
    orderBy: { placedAt: 'desc' },
    take: limit,
    select: { id: true, externalOrderId: true, itemSubtotal: true },
  });

  if (orders.length === 0) {
    return {
      requested: 0,
      updated: 0,
      message: 'Semua pesanan sudah punya rincian dana dan potongan Shopee.',
    };
  }

  const { conn, creds } = await loadConnection(tenantId, shopId);
  const fresh = await ensureFreshToken(conn.id, creds);
  const credentials = buildShopCredentials(fresh);

  const escrows = await shopee.getEscrowDetails(
    credentials,
    orders.map((o) => o.externalOrderId),
  );

  // `toAmount` dipakai agar konversi angka konsisten dengan pemetaan biaya.
  const num = toAmount;

  let updated = 0;
  for (const order of orders) {
    const income = escrows.get(order.externalOrderId);
    if (!income) continue;

    // "Potongan Shopee" memakai daftar field biaya resmi Shopee. Nama fieldnya
    // bukan `commission_fee` saja — pada toko ini biaya sebenarnya ada di
    // `pay_per_sale`, sehingga asumsi lama selalu menghasilkan null.
    // Lihat `domain/escrow-fee-mapping.ts`.
    const platformFee = computePlatformFee(income);

    await prisma.order.update({
      where: { id: order.id },
      data: {
        itemSubtotal: num(income.order_selling_price) ?? order.itemSubtotal,
        sellerDiscount: num(income.seller_discount) ?? num(income.order_seller_discount),
        shopeeDiscount: num(income.shopee_discount) ?? num(income.original_shopee_discount),
        buyerShippingFee: num(income.buyer_paid_shipping_fee) ?? num(income.actual_shipping_fee),
        shippingFeeDiscount:
          num(income.shipping_fee_discount_from_3pl) ?? num(income.shopee_shipping_rebate),
        // `null` = Shopee belum mengirim rincian. `0` = memang tanpa potongan.
        // Keduanya sengaja dibedakan supaya UI tidak menampilkan "Rp0" palsu.
        platformFee,
        escrowAmount: num(income.escrow_amount_after_adjustment) ?? num(income.escrow_amount),
        incomeJson: income as Prisma.InputJsonValue,
      },
    });
    updated += 1;
  }

  await auditLog({
    tenantId,
    actorId,
    action: 'sync_escrow_details',
    entityType: 'Shop',
    entityId: shopId,
    metadata: { requested: orders.length, updated },
  });

  return {
    requested: orders.length,
    updated,
    message:
      updated > 0
        ? `Rincian biaya diperbarui untuk ${updated} pesanan.`
        : 'Shopee belum menyediakan rincian biaya untuk pesanan ini (biasanya muncul setelah pesanan selesai).',
  };
}

/**
 * Mengatur pengiriman untuk satu pesanan ("Atur Pengiriman").
 * Memanggil Shopee logistics/init, kemudian auto-menyimpan AWB ke database lokal.
 */
export async function arrangeShipmentForOrder(
  tenantId: string,
  shopId: string,
  orderId: string,
  input: Omit<ArrangeShipmentInput, 'orderSn'>,
  actorId: string,
) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
  });
  if (!order) throw new NotFoundError('Pesanan', orderId);

  const effectiveShopId = shopId || order.shopId;
  let trackingNumber: string | null = null;
  let success = false;
  let message = '';
  /**
   * Deprecated: resi simulasi DILARANG. Nomor resi hanya boleh berasal dari Shopee.
   * Field ini tetap ada supaya UI lama tidak rusak, tapi selalu `false`.
   * Aturan ini menutup celah sebelumnya di mana aplikasi membuat nomor `SPXID…`
   * sendiri sehingga paket bisa "lolos" tanpa nomor resi asli dari kurir.
   */
  const simulated = false;

  try {
    const { conn, creds } = await loadConnection(tenantId, effectiveShopId);
    const fresh = await ensureFreshToken(conn.id, creds);
    const credentials = buildShopCredentials(fresh);

    const result = await shopee.arrangeShipment(credentials, {
      orderSn: order.externalOrderId,
      // `package_number` WAJIB diteruskan. Tanpa itu, `get_shipping_parameter`
      // dijawab `logistics.package_not_exist`, dan kalau diteruskan angka yang
      // salah, Shopee mengembalikan 0 channel sehingga aplikasi pernah jatuh ke
      // `dropoff: {}` dan gagal dengan `ship_order_unsupport_dropoff`.
      // Sumbernya: `package_number` dari Shopee yang tersimpan saat order diimpor.
      ...(order.packageNumber ? { packageNumber: order.packageNumber } : {}),
      ...input,
    });
    success = result.success;
    trackingNumber = result.trackingNumber;
    message = result.message || '';

    // Shopee bisa menjawab sukses HTTP tetapi tidak menerbitkan resi (mis. kanal
    // logistik belum siap). Kasus itu dilaporkan apa adanya — TIDAK pernah
    // digantikan nomor karangan, karena itu memalsukan data pengiriman.
    if (!success && !trackingNumber && !message) {
      message = 'Shopee belum menerbitkan nomor resi untuk pesanan ini. Coba lagi beberapa saat lagi.';
    }
  } catch (err) {
    const errMsg = (err as Error).message;
    logger.warn(`arrangeShipment gagal untuk order ${order.externalOrderId}: ${errMsg}`);
    message = `Gagal meminta nomor resi ke Shopee: ${errMsg}`;
  }

  if (success && trackingNumber) {
    await upsertShipment(tenantId, orderId, trackingNumber, null, 'LOGISTICS_REQUEST_CREATED');
    logger.info(`Pengiriman diatur: order ${order.externalOrderId}, AWB ${trackingNumber}`);
    broadcastSystemEvent('awb:updated', { orderId, awb: trackingNumber });
  }

  await auditLog({
    tenantId,
    actorId,
    action: 'arrange_shipment',
    entityType: 'Order',
    entityId: orderId,
    metadata: { externalOrderId: order.externalOrderId, success, trackingNumber },
  });

  return { success, trackingNumber, message, simulated };
}

/** Hasil label resmi: file dari Shopee + format yang dipakainya. */
export interface OfficialLabelOutcome {
 orderSn: string;
 documentType: string;
 fileName: string;
 contentType: string;
 bytes: Uint8Array;
}

/**
 * Ambil label resmi Shopee untuk satu pesanan.
 *
 * Mengikuti alur 4 langkah resmi (dokumentasi Shopee module 95, api_id
 * 549/547/561/548): parameter → create → result (poll sampai READY) → download.
 *
 * Semua data diambil dari Shopee. Fungsi ini TIDAK PERNAH membuat label sendiri
 * dan TIDAK PERNAH mengarang resi: kalau Shopee belum bisa mengeluarkan label,
 * error-nya dikembalikan apa adanya supaya operator tahu harus menyelesaikan
 * "Atur Pengiriman" lebih dulu.
 */
export async function generateShippingLabel(
 tenantId: string,
 shopId: string,
 orderId: string,
 packageNumber?: string,
): Promise<OfficialLabelOutcome> {
 const order = await prisma.order.findFirst({
  where: { id: orderId, tenantId },
  include: {
   shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
  },
 });
 if (!order) throw new NotFoundError('Pesanan', orderId);

 // Resi harus berasal dari Shopee. Kalau belum ada, berhenti di sini.
 const shipment = order.shipments[0];
 const trackingNumber = shipment?.awb?.trim() || null;
 if (!trackingNumber) {
  throw new ExternalIntegrationError(
   'shopee',
   `Pesanan ${order.externalOrderId} belum punya nomor resi dari Shopee, jadi label resmi belum bisa dibuat. ` +
    'Selesaikan "Atur Pengiriman" dulu sampai nomor resi muncul.',
  );
 }

 const { conn, creds } = await loadConnection(tenantId, shopId || order.shopId);
 const fresh = await ensureFreshToken(conn.id, creds);
 const credentials = buildShopCredentials(fresh);

 const { label, documentType } = await shopee.fetchOfficialShippingLabel(credentials, {
  orderSn: order.externalOrderId,
  packageNumber: packageNumber ?? null,
  trackingNumber,
 });

 return {
  orderSn: order.externalOrderId,
  documentType,
  fileName: label.fileName,
  contentType: label.contentType,
  bytes: label.bytes,
 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook event processing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process a verified Shopee push (webhook).
 * Idempotent: unique constraint on (shopId, provider, externalEventId).
 *
 * Handled push codes:
 *   code 3  → order_status_push: reconcile order status
 *   code 4  → order_trackingno_push: update shipment AWB
 *   code 29 → return_updates_push: create/update return
 *   code 30 → package_fulfillment_status_push: update fulfillment status
 *   code 12 → open_api_authorization_expiry: log warning
 *   others  → logged and acknowledged
 */
export async function processWebhookEvent(
  tenantId: string,
  shopId: string,
  provider: string,
  externalEventId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<{ status: string }> {
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

  try {
    const created = await prisma.webhookEvent.create({
      data: { tenantId, shopId, provider, externalEventId, eventType, payloadHash, status: 'PROCESSING' },
    });

    const data = (payload.data ?? {}) as Record<string, unknown>;

    // ── Code 3: order_status_push ──────────────────────────────────────────
    if (eventType === 'order_status_push' && data.ordersn) {
      await handleOrderStatusPush(tenantId, shopId, data);
    }

    // ── Code 4: order_trackingno_push ─────────────────────────────────────
    else if (eventType === 'order_trackingno_push' && (data.ordersn || data.order_sn)) {
      await handleTrackingNoPush(tenantId, shopId, data);
    }

    // ── Code 29: return_updates_push ──────────────────────────────────────
    else if (eventType === 'return_updates_push' && data.return_sn) {
      await handleReturnPush(tenantId, shopId, data);
    }

    // ── Code 30: package_fulfillment_status_push ──────────────────────────
    else if (eventType === 'package_fulfillment_status_push' && (data.ordersn || data.order_sn)) {
      await handlePackageFulfillmentPush(tenantId, shopId, data);
    }

    // ── Code 12: authorization_expiry ─────────────────────────────────────
    else if (eventType === 'open_api_authorization_expiry') {
      logger.warn('Shopee otorisasi mendekati habis masa berlaku. Segera re-authorize.', {
        shopId,
        payload: data,
      });
    }

    await prisma.webhookEvent.update({
      where: { id: created.id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });
    return { status: 'PROCESSED' };
  } catch (err) {
    // Duplicate event → already processed (P2002 = unique constraint violation)
    if ((err as { code?: string }).code === 'P2002') {
      logger.info(`Webhook duplikat diabaikan: ${externalEventId}`, { eventType });
      return { status: 'SKIPPED' };
    }
    await prisma.webhookEvent.updateMany({
      where: { shopId, provider, externalEventId },
      data: { status: 'FAILED', errorMessage: (err as Error).message },
    });
    throw err;
  }
}

/** Handle code 3: order_status_push */
async function handleOrderStatusPush(
  tenantId: string,
  shopId: string,
  data: Record<string, unknown>,
) {
  const orderSn = String(data.ordersn ?? '');
  const status = mapShopeeStatusToInternal(String(data.status ?? ''));
  const order = await prisma.order.findUnique({
    where: { shopId_externalOrderId: { shopId, externalOrderId: orderSn } },
  });

  if (!order) {
    logger.info(`Webhook order baru checkout: ${orderSn}, memulai auto-import...`);
    // Import dulu, BARU beri tahu UI — supaya event realtime tidak mendahului data
    // (kalau dibroadcast duluan, halaman sempat reload saat pesanan belum ada di DB).
    triggerOrderSync(tenantId, shopId, 'webhook')
      .then(async () => {
        const imported = await prisma.order.findUnique({
          where: { shopId_externalOrderId: { shopId, externalOrderId: orderSn } },
          select: { id: true },
        });
        if (!imported) {
          logger.warn(`Order ${orderSn} tidak ditemukan setelah auto-import (kemungkinan SKU belum ter-mapping)`);
          return;
        }
        broadcastSystemEvent('order:new', {
          tenantId,
          shopId,
          orderId: imported.id,
          externalOrderId: orderSn,
          data: { status },
        });
      })
      .catch((e) => {
        logger.warn(`Gagal auto-sync order baru ${orderSn}: ${(e as Error).message}`);
      });
    return;
  }

  if (order.status !== status) {
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { status: status as import('@prisma/client').OrderStatus },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: order.status as import('@prisma/client').OrderStatus,
          toStatus: status as import('@prisma/client').OrderStatus,
          reason: 'Diperbarui via Shopee push webhook',
        },
      });
    });
    logger.info(`Order ${orderSn} status diupdate via webhook: ${order.status} → ${status}`);
    broadcastSystemEvent('order:updated', {
      tenantId,
      shopId,
      orderId: order.id,
      externalOrderId: orderSn,
      data: { status },
    });
  }
}

/** Handle code 4: order_trackingno_push */
async function handleTrackingNoPush(
  tenantId: string,
  shopId: string,
  data: Record<string, unknown>,
) {
  const orderSn = String(data.ordersn ?? data.order_sn ?? '');
  const trackingNo = String(data.tracking_no ?? data.tracking_number ?? '');
  if (!orderSn || !trackingNo) return;

  const order = await prisma.order.findUnique({
    where: { shopId_externalOrderId: { shopId, externalOrderId: orderSn } },
  });
  if (!order) return;

  await upsertShipment(tenantId, order.id, trackingNo, null, 'PROCESSED');
  logger.info(`Shipment AWB diupdate via webhook: order ${orderSn}, AWB ${trackingNo}`);
  broadcastSystemEvent('awb:updated', {
    tenantId,
    shopId,
    orderId: order.id,
    externalOrderId: orderSn,
    awb: trackingNo,
  });
}

/** Handle code 29: return_updates_push */
async function handleReturnPush(
  tenantId: string,
  shopId: string,
  data: Record<string, unknown>,
) {
  const returnSn = String(data.return_sn ?? '');
  const orderSn = String(data.order_sn ?? data.ordersn ?? '');
  if (!returnSn || !orderSn) return;

  const order = await prisma.order.findUnique({
    where: { shopId_externalOrderId: { shopId, externalOrderId: orderSn } },
  });
  if (!order) return;

  const updatedValues = (data.updated_values ?? []) as string[];
  const statusFromPush = updatedValues.includes('status') ? (data.status as string) : null;

  const existing = await prisma.return.findFirst({
    where: { orderId: order.id, externalReturnId: returnSn },
  });

  if (!existing) {
    // Create a minimal return record; full detail can be synced via triggerReturnSync
    const status = statusFromPush ? mapReturnStatus(statusFromPush) : 'REQUESTED';
    await prisma.return.create({
      data: {
        orderId: order.id,
        externalReturnId: returnSn,
        status,
        reason: 'Diperbarui dari webhook Shopee',
      },
    });
    logger.info(`Return ${returnSn} dibuat via webhook untuk order ${orderSn}`);
  } else if (statusFromPush) {
    const newStatus = mapReturnStatus(statusFromPush);
    await prisma.return.update({
      where: { id: existing.id },
      data: { status: newStatus },
    });
  }
}

/** Handle code 30: package_fulfillment_status_push */
async function handlePackageFulfillmentPush(
  tenantId: string,
  shopId: string,
  data: Record<string, unknown>,
) {
  const orderSn = String(data.ordersn ?? data.order_sn ?? '');
  const fulfillmentStatus = String(data.fulfillment_status ?? '');
  if (!orderSn) return;

  const order = await prisma.order.findUnique({
    where: { shopId_externalOrderId: { shopId, externalOrderId: orderSn } },
  });
  if (!order) return;

  // Map Shopee package fulfillment status to shipment status
  const shipmentStatus = mapLogisticsStatus(fulfillmentStatus);
  const shipment = await prisma.shipment.findFirst({ where: { orderId: order.id } });
  if (shipment) {
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        status: shipmentStatus,
        ...(shipmentStatus === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
        ...(shipmentStatus === 'IN_TRANSIT' ? { shippedAt: shipment.shippedAt ?? new Date() } : {}),
      },
    });
    logger.info(`Shipment ${shipment.id} status diupdate via webhook: ${shipmentStatus}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upsert a Shipment record for a given order.
 */
async function upsertShipment(
  tenantId: string,
  orderId: string,
  awb: string,
  carrier: string | null,
  rawStatus: string,
) {
  const status = mapLogisticsStatus(rawStatus);
  const existing = await prisma.shipment.findFirst({ where: { orderId } });

  if (existing) {
    await prisma.shipment.update({
      where: { id: existing.id },
      data: {
        awb: awb || existing.awb,
        carrier: carrier || existing.carrier,
        status,
        ...(status === 'DELIVERED' ? { deliveredAt: existing.deliveredAt ?? new Date() } : {}),
        ...(status === 'IN_TRANSIT' && !existing.shippedAt ? { shippedAt: new Date() } : {}),
      },
    });
  } else {
    await prisma.shipment.create({
      data: {
        orderId,
        awb,
        carrier,
        status,
        shippedAt: status !== 'PENDING' && status !== 'READY_TO_SHIP' ? new Date() : null,
      },
    });
  }
}

/**
 * Map Shopee logistics/fulfillment status strings → internal ShipmentStatus.
 */
export function mapLogisticsStatus(
  status: string,
): 'PENDING' | 'READY_TO_SHIP' | 'PICKED_UP' | 'IN_TRANSIT' | 'DELIVERED' | 'FAILED' | 'RETURNED' {
  // `LOGISTICS_REQUEST_CREATED` = Shopee sudah membuat permintaan pengiriman,
  // paket BELUM diambil kurir. Semuanya sebelum diambil kurir dipetakan ke
  // `READY_TO_SHIP` supaya "Lacak Kiriman" tidak menampilkan status yang salah.
  // Hanya `LOGISTICS_PICKUP_DONE` yang benar-benar berarti sudah diambil.
  switch (status.toUpperCase()) {
    case 'LOGISTICS_NOT_START':
    case 'LOGISTICS_PENDING_ARRANGE':
      return 'PENDING';
    case 'LOGISTICS_READY':
    case 'READY_TO_SHIP':
      return 'READY_TO_SHIP';
    case 'LOGISTICS_REQUEST_CREATED':
    case 'LOGISTICS_PICKUP_RETRY':
    case 'PROCESSED':
      return 'READY_TO_SHIP';
    case 'LOGISTICS_PICKUP_DONE':
      return 'PICKED_UP';
    case 'SHIPPED':
    case 'TO_CONFIRM_RECEIVE':
      return 'IN_TRANSIT';
    case 'LOGISTICS_DELIVERY_DONE':
    case 'COMPLETED':
      return 'DELIVERED';
    case 'LOGISTICS_INVALID':
    case 'LOGISTICS_REQUEST_CANCELED':
    case 'LOGISTICS_PICKUP_FAILED':
    case 'LOGISTICS_DELIVERY_FAILED':
    case 'LOGISTICS_LOST':
    case 'CANCELLED':
      return 'FAILED';
    case 'TO_RETURN':
    case 'RETURNED':
      return 'RETURNED';
    default:
      return 'IN_TRANSIT';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public query functions
// ─────────────────────────────────────────────────────────────────────────────

export async function listSyncRuns(tenantId: string, shopId?: string, operation?: string) {
  return prisma.syncRun.findMany({
    where: {
      tenantId,
      ...(shopId ? { shopId } : {}),
      ...(operation ? { operation } : {}),
    },
    include: { shop: { select: { name: true, provider: true } } },
    orderBy: { startedAt: 'desc' },
    take: 50,
  });
}

/** Connect Shopee by storing (encrypted) seller tokens + setting the external shop id. */
export async function connectShopee(
  tenantId: string,
  shopId: string,
  input: {
    externalShopId: string;
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt?: number;
    mainAccountId?: string;
  },
) {
  const shop = await prisma.shop.findFirst({ where: { id: shopId, tenantId } });
  if (!shop) throw new NotFoundError('Toko', shopId);

  const creds: StoredCredentials = {
    shopId: input.externalShopId,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    tokenExpiresAt: input.tokenExpiresAt ?? Date.now() + 4 * 3600 * 1000,
    ...(input.mainAccountId ? { mainAccountId: input.mainAccountId } : {}),
  };
  const encrypted = encryptSecret(JSON.stringify(creds));
  const appConfig = await getShopeeAppConfig();
  const sandbox = appConfig.sandbox;

  await prisma.$transaction(async (tx) => {
    await tx.integrationConnection.upsert({
      where: { shopId_provider: { shopId, provider: 'shopee' } },
      create: { shopId, provider: 'shopee', encryptedCredentials: encrypted, status: 'ACTIVE', sandbox },
      update: { encryptedCredentials: encrypted, status: 'ACTIVE', sandbox, lastSyncAt: new Date() },
    });
    await tx.shop.update({ where: { id: shopId }, data: { externalShopId: input.externalShopId } });
  });

  return { connected: true, externalShopId: input.externalShopId, sandbox };
}

export async function getShopeeConnectionStatus(tenantId: string, shopId: string) {
  const shop = await prisma.shop.findFirst({ where: { id: shopId, tenantId } });
  if (!shop) throw new NotFoundError('Toko', shopId);

  const conn = await prisma.integrationConnection.findFirst({ where: { shopId, provider: 'shopee' } });
  const appConfig = await getShopeeAppConfig();
  const partnerConfigured = Boolean(appConfig.partnerId && appConfig.partnerKey);

  // Decode token expiry info if available (non-sensitive)
  let tokenExpiresAt: string | null = null;
  let tokenExpiresInMinutes: number | null = null;
  if (conn?.encryptedCredentials) {
    try {
      const stored = JSON.parse(decryptSecret(conn.encryptedCredentials)) as StoredCredentials;
      tokenExpiresAt = new Date(stored.tokenExpiresAt).toISOString();
      tokenExpiresInMinutes = Math.floor((stored.tokenExpiresAt - Date.now()) / 60000);
    } catch {
      // ignore decryption errors in status check
    }
  }

  // Catatan sinkronisasi terakhir diambil dari database, supaya panel status tetap
  // benar walau penjadwal berjalan di salinan modul terpisah (perilaku Next.js).
  const lastRun = await prisma.syncRun.findFirst({
    where: { shopId, operation: 'import_orders' },
    orderBy: { startedAt: 'desc' },
    select: {
      startedAt: true,
      finishedAt: true,
      status: true,
      recordsRead: true,
      recordsWritten: true,
      errorMessage: true,
    },
  });

  return {
    connected: Boolean(conn?.encryptedCredentials),
    status: conn?.status ?? 'PENDING',
    sandbox: conn?.sandbox ?? appConfig.sandbox,
    lastSyncAt: conn?.lastSyncAt ?? null,
    partnerConfigured,
    externalShopId: shop.externalShopId,
    tokenExpiresAt,
    tokenExpiresInMinutes,
    /** Catatan sinkronisasi terakhir (jujur dari database). */
    lastRun: lastRun
      ? {
          startedAt: lastRun.startedAt,
          finishedAt: lastRun.finishedAt,
          status: lastRun.status as string,
          recordsRead: lastRun.recordsRead,
          recordsWritten: lastRun.recordsWritten,
          errorMessage: lastRun.errorMessage,
        }
      : null,
    // Info toko dipakai panel status di kanan atas supaya tahu toko mana yang aktif.
    shop: {
      id: shop.id,
      name: shop.name,
      externalShopId: shop.externalShopId,
      tokenExpiresAt,
    },
  };
}
