/* eslint-disable no-console */
/**
 * Seed PRODUKSI — tanpa data contoh.
 *
 * Membuat hanya yang benar-benar dibutuhkan agar aplikasi bisa dipakai penjual:
 *   1. Tenant (workspace) utama
 *   2. Akun pemilik (OWNER) dengan kata sandi yang diberikan lewat env SEED_OWNER_PASSWORD
 *   3. Gudang utama (WH-01)
 *   4. Catatan toko Shopee (nama diisi ulang otomatis saat toko diotorisasi)
 *   5. Aturan prioritas default
 *
 * Aman dijalankan berulang: kalau tenant sudah ada, seed dilewati.
 *
 * Jalankan: SEED_OWNER_EMAIL=... SEED_OWNER_PASSWORD=... npx tsx prisma/seed-production.ts
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const TENANT_NAME = process.env.SEED_TENANT_NAME ?? 'Toko Utama';
const TENANT_SLUG = process.env.SEED_TENANT_SLUG ?? 'toko-utama';
const OWNER_NAME = process.env.SEED_OWNER_NAME ?? 'Pemilik Toko';
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'owner@toko.id';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? '';

async function main() {
  if (!OWNER_PASSWORD || OWNER_PASSWORD.length < 10) {
    throw new Error('SEED_OWNER_PASSWORD wajib diisi dan minimal 10 karakter.');
  }

  const existing = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (existing) {
    console.log(`Tenant "${TENANT_SLUG}" sudah ada — seed produksi dilewati.`);
    return;
  }

  const tenant = await prisma.tenant.create({
    data: { name: TENANT_NAME, slug: TENANT_SLUG, status: 'ACTIVE' },
  });

  const owner = await prisma.user.create({
    data: {
      name: OWNER_NAME,
      email: OWNER_EMAIL.toLowerCase(),
      passwordHash: await bcrypt.hash(OWNER_PASSWORD, 12),
      status: 'ACTIVE',
    },
  });

  await prisma.tenantMembership.create({
    data: { tenantId: tenant.id, userId: owner.id, role: 'OWNER' },
  });

  const warehouse = await prisma.warehouse.create({
    data: { tenantId: tenant.id, name: 'Gudang Utama', code: 'WH-01', status: 'ACTIVE' },
  });

  const shop = await prisma.shop.create({
    data: { tenantId: tenant.id, provider: 'shopee', name: 'Toko Shopee', status: 'ACTIVE' },
  });

  await prisma.priorityRule.create({
    data: {
      tenantId: tenant.id,
      version: 'priority-v1',
      isEnabled: true,
      description: 'Aturan prioritas default (deadline, SLA, umur order, kesiapan stok)',
      criteriaJson: {
        version: 'priority-v1',
        weights: { DEADLINE_URGENT: 0.4, SLA_RISK: 0.3, STOCK_READY: 0.2, ORDER_AGE: 0.1 },
        thresholds: { critical: 80, high: 60, medium: 40 },
      },
    },
  });

  console.log('Seed produksi selesai:');
  console.log(`  Tenant    : ${tenant.name} (${tenant.slug})`);
  console.log(`  Akun      : ${owner.email}  (role OWNER)`);
  console.log(`  Gudang    : ${warehouse.name} (${warehouse.code})`);
  console.log(`  Toko      : ${shop.name}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
