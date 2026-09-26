import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/shared/infrastructure/prisma';
import { ShopeeAdapter } from '@/modules/integrations/infrastructure/shopee.adapter';
import { connectShopee, triggerFullSync } from '@/modules/integrations/application/sync.service';
import { logger } from '@/shared/observability/logger';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const shopId = searchParams.get('shop_id');
  const mainAccountId = searchParams.get('main_account_id');
  const state = searchParams.get('state');
  const shopeeError = searchParams.get('error');
  const errorMsg = searchParams.get('msg') || searchParams.get('message');

  try {
    if (shopeeError) {
      throw new Error(`Shopee mengembalikan error: ${shopeeError} ${errorMsg ? `(${errorMsg})` : ''}`);
    }
    if (!code) throw new Error('Tidak ada parameter "code" yang diterima dari Shopee.');

    let tenantId: string;
    let localShopId: string;
    let actorId = 'system';

    async function resolveOrCreateDefaultShop(): Promise<{ tenantId: string; shopId: string }> {
      // Pilih toko Shopee milik tenant ini secara PASTI (bukan acak):
      // dahulukan yang sudah punya external_shop_id, lalu yang paling awal dibuat.
      const existing =
        (await prisma.shop.findFirst({
          where: { provider: 'shopee', externalShopId: { not: null } },
          orderBy: { createdAt: 'asc' },
        })) ??
        (await prisma.shop.findFirst({
          where: { provider: 'shopee' },
          orderBy: { createdAt: 'asc' },
        }));
      if (existing) return { tenantId: existing.tenantId, shopId: existing.id };

      let tenant = await prisma.tenant.findFirst();
      if (!tenant) {
        tenant = await prisma.tenant.create({
          data: { name: 'Toko Utama', slug: `toko-utama-${Date.now()}` },
        });
      }

      const newShop = await prisma.shop.create({
        data: {
          tenantId: tenant.id,
          name: 'Shopee Official Store',
          provider: 'shopee',
        },
      });
      return { tenantId: tenant.id, shopId: newShop.id };
    }

    if (state) {
      try {
        const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as {
          tenantId: string;
          shopId: string;
          userId?: string;
        };
        // Verify shop actually exists in DB
        const shopInDb = await prisma.shop.findFirst({ where: { id: decoded.shopId, tenantId: decoded.tenantId } });
        if (shopInDb) {
          tenantId = decoded.tenantId;
          localShopId = decoded.shopId;
        } else {
          const resolved = await resolveOrCreateDefaultShop();
          tenantId = resolved.tenantId;
          localShopId = resolved.shopId;
        }
        if (decoded.userId) actorId = decoded.userId;
      } catch {
        const resolved = await resolveOrCreateDefaultShop();
        tenantId = resolved.tenantId;
        localShopId = resolved.shopId;
      }
    } else {
      const resolved = await resolveOrCreateDefaultShop();
      tenantId = resolved.tenantId;
      localShopId = resolved.shopId;
    }

    const adapter = new ShopeeAdapter();
    const tokens = await adapter.exchangeCodeForToken(code, shopId ?? undefined, mainAccountId ?? undefined);
    await connectShopee(tenantId, localShopId, {
      externalShopId: String(shopId ?? tokens.shop_id_list?.[0] ?? ''),
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: Date.now() + tokens.expire_in * 1000,
      ...(tokens.merchant_id_list?.[0] ? { mainAccountId: String(tokens.merchant_id_list[0]) } : {}),
    });

    // ── Auto-sync: jalankan full sync di background setelah OAuth berhasil ──
    // Fire-and-forget: tidak memblok redirect. Jika gagal, hanya dicatat di log.
    void triggerFullSync(tenantId, localShopId, actorId)
      .then((result) => {
        logger.info('Auto-sync pasca OAuth selesai', { localShopId, result });
      })
      .catch((err) => {
        logger.warn('Auto-sync pasca OAuth gagal (tidak kritikal — user bisa retry manual)', {
          localShopId,
          error: (err as Error).message,
        });
      });

    const successUrl = new URL('/dashboard/integrasi', request.url);
    successUrl.searchParams.set('success', 'connected');
    return NextResponse.redirect(successUrl);
  } catch (err) {
    const message = (err as Error).message;
    logger.error('Shopee OAuth callback gagal', { error: message, code, shopId });
    const url = new URL('/dashboard/integrasi', request.url);
    url.searchParams.set('error', message);
    return NextResponse.redirect(url);
  }
}
