import { z } from 'zod';
import { prisma } from '@/shared/infrastructure/prisma';
import { NotFoundError, ConflictError, ValidationError } from '@/shared/errors/AppError';
import { auditLog } from '@/modules/audit/application/auditLog.service';
import { validateSku } from '../domain/catalog.entity';

// ────────────────────────────────────────────────────────────
// Validation Schemas
// ────────────────────────────────────────────────────────────

export const CreateVariantSchema = z.object({
  sku: z.string().min(2).max(50),
  barcode: z.string().max(100).optional(),
  name: z.string().min(1).max(200),
  weight: z.number().positive().optional(),
  imageUrl: z.string().optional().or(z.literal('')),
  initialStock: z.number().int().min(0).optional(),
  warehouseId: z.string().optional(),
});

export const CreateProductSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(100).optional(),
  variants: z.array(CreateVariantSchema).min(1),
});

export const UpdateProductSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(2000).optional(),
  category: z.string().max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
});

export const UpdateVariantSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  barcode: z.string().max(100).optional(),
  weight: z.number().positive().optional(),
  imageUrl: z.string().optional().or(z.literal('')),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
});

// ────────────────────────────────────────────────────────────
// Product Use Cases
// ────────────────────────────────────────────────────────────

export async function createProduct(
  tenantId: string,
  input: z.infer<typeof CreateProductSchema>,
  actorId: string,
) {
  // Validate SKUs
  for (const v of input.variants) {
    if (!validateSku(v.sku)) {
      throw new ValidationError(`Format SKU tidak valid: ${v.sku}`);
    }
  }

  // Check if any SKU already exists in this tenant's products
  const existingVariant = await prisma.productVariant.findFirst({
    where: {
      product: { tenantId },
      sku: { in: input.variants.map((v) => v.sku) },
    },
  });

  if (existingVariant) {
    throw new ConflictError(`SKU '${existingVariant.sku}' sudah digunakan di produk lain.`);
  }

  const product = await prisma.product.create({
    data: {
      tenantId,
      name: input.name,
      description: input.description,
      category: input.category,
      variants: {
        create: input.variants.map((v) => ({
          sku: v.sku,
          barcode: v.barcode ?? null,
          name: v.name,
          weight: v.weight ?? null,
          imageUrl: v.imageUrl || null,
        })),
      },
    },
    include: { variants: true },
  });

  // Allocate initial stock to warehouse if specified
  for (let i = 0; i < input.variants.length; i++) {
    const vInput = input.variants[i];
    const createdVariant = product.variants[i];
    if (vInput && createdVariant && vInput.initialStock && vInput.initialStock > 0) {
      let targetWarehouseId = vInput.warehouseId;
      if (!targetWarehouseId) {
        const wh = await prisma.warehouse.findFirst({ where: { tenantId, status: 'ACTIVE' } });
        targetWarehouseId = wh?.id;
      }
      if (targetWarehouseId) {
        await prisma.inventoryBalance.upsert({
          where: { warehouseId_variantId: { warehouseId: targetWarehouseId, variantId: createdVariant.id } },
          create: {
            warehouseId: targetWarehouseId,
            variantId: createdVariant.id,
            onHand: vInput.initialStock,
            version: 1,
          },
          update: { onHand: { increment: vInput.initialStock } },
        });

        // Resolve valid actor id for inventory movement foreign key
        const user = await prisma.user.findUnique({ where: { id: actorId }, select: { id: true } });
        await prisma.inventoryMovement.create({
          data: {
            tenantId,
            warehouseId: targetWarehouseId,
            variantId: createdVariant.id,
            movementType: 'RECEIVE',
            quantityDelta: vInput.initialStock,
            referenceType: 'initial_stock',
            reason: 'Penerimaan stok awal produk baru',
            actorId: user ? user.id : null,
          },
        });
      }
    }
  }

  await auditLog({
    tenantId,
    actorId,
    action: 'product_create',
    entityType: 'Product',
    entityId: product.id,
    metadata: { name: product.name, variantCount: product.variants.length },
  });

  return product;
}

export async function listProducts(
  tenantId: string,
  options: {
    search?: string;
    category?: string;
    status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
    page?: number;
    pageSize?: number;
  } = {},
) {
  const { search, category, status, page = 1, pageSize = 20 } = options;
  const skip = (page - 1) * pageSize;

  const where = {
    tenantId,
    status: status ? status : { not: 'ARCHIVED' as const },
    ...(category ? { category } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search } },
            {
              variants: {
                some: {
                  OR: [
                    { sku: { contains: search } },
                    { name: { contains: search } },
                    { barcode: { contains: search } },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        variants: {
          include: {
            inventoryBalances: {
              select: {
                onHand: true,
                reserved: true,
                blocked: true,
                warehouseId: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items: products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category,
      status: p.status,
      createdAt: p.createdAt,
      variants: p.variants.map((v) => {
        const totalOnHand = v.inventoryBalances.reduce((s, b) => s + b.onHand, 0);
        const totalReserved = v.inventoryBalances.reduce((s, b) => s + b.reserved, 0);
        const totalBlocked = v.inventoryBalances.reduce((s, b) => s + b.blocked, 0);
        const totalAvailable = Math.max(0, totalOnHand - totalReserved - totalBlocked);

        return {
          id: v.id,
          sku: v.sku,
          barcode: v.barcode,
          name: v.name,
          weight: v.weight,
          imageUrl: v.imageUrl,
          status: v.status,
          stock: {
            onHand: totalOnHand,
            reserved: totalReserved,
            blocked: totalBlocked,
            available: totalAvailable,
          },
        };
      }),
    })),
    pagination: {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getProductById(tenantId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    include: {
      variants: {
        include: {
          inventoryBalances: {
            include: { warehouse: { select: { id: true, name: true, code: true } } },
          },
        },
      },
    },
  });

  if (!product) throw new NotFoundError('Produk', productId);
  return product;
}

export async function updateProduct(
  tenantId: string,
  productId: string,
  input: z.infer<typeof UpdateProductSchema>,
  actorId: string,
) {
  const existing = await prisma.product.findFirst({
    where: { id: productId, tenantId },
  });

  if (!existing) throw new NotFoundError('Produk', productId);

  const updated = await prisma.product.update({
    where: { id: productId },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'product_update',
    entityType: 'Product',
    entityId: productId,
    metadata: input,
  });

  return updated;
}

/**
 * Archive (soft-delete) a product and all its variants.
 * We never hard-delete products because they may be referenced by historical OrderItems.
 * ARCHIVED products are hidden from catalog listings but preserved for audit integrity.
 */
export async function deleteProduct(tenantId: string, productId: string, actorId: string) {
  const existing = await prisma.product.findFirst({
    where: { id: productId, tenantId },
    include: { variants: { select: { id: true } } },
  });

  if (!existing) throw new NotFoundError('Produk', productId);

  await prisma.$transaction(async (tx) => {
    // Archive all variants
    await tx.productVariant.updateMany({
      where: { productId },
      data: { status: 'ARCHIVED' },
    });
    // Archive the product itself
    await tx.product.update({
      where: { id: productId },
      data: { status: 'ARCHIVED' },
    });
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'product_archive',
    entityType: 'Product',
    entityId: productId,
    metadata: { name: existing.name, variantCount: existing.variants.length },
  });
}

// ────────────────────────────────────────────────────────────
// Variant Use Cases
// ────────────────────────────────────────────────────────────

export async function addVariant(
  tenantId: string,
  productId: string,
  input: z.infer<typeof CreateVariantSchema>,
  actorId: string,
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
  });
  if (!product) throw new NotFoundError('Produk', productId);

  if (!validateSku(input.sku)) {
    throw new ValidationError(`Format SKU tidak valid: ${input.sku}`);
  }

  const existing = await prisma.productVariant.findFirst({
    where: {
      product: { tenantId },
      sku: input.sku,
    },
  });
  if (existing) {
    throw new ConflictError(`SKU '${input.sku}' sudah digunakan.`);
  }

  const variant = await prisma.productVariant.create({
    data: {
      productId,
      sku: input.sku,
      barcode: input.barcode ?? null,
      name: input.name,
      weight: input.weight ?? null,
      imageUrl: input.imageUrl || null,
    },
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'variant_create',
    entityType: 'ProductVariant',
    entityId: variant.id,
    metadata: { productId, sku: variant.sku, name: variant.name },
  });

  return variant;
}

export async function updateVariant(
  tenantId: string,
  variantId: string,
  input: z.infer<typeof UpdateVariantSchema>,
  actorId: string,
) {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, product: { tenantId } },
  });
  if (!variant) throw new NotFoundError('Varian Produk', variantId);

  const updated = await prisma.productVariant.update({
    where: { id: variantId },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
      ...(input.weight !== undefined ? { weight: input.weight } : {}),
      ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl || null } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'variant_update',
    entityType: 'ProductVariant',
    entityId: variantId,
    metadata: input,
  });

  return updated;
}

export async function deleteVariant(
  tenantId: string,
  variantId: string,
  actorId: string,
) {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, product: { tenantId } },
  });
  if (!variant) throw new NotFoundError('Varian Produk', variantId);

  await prisma.productVariant.update({
    where: { id: variantId },
    data: { status: 'ARCHIVED' },
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'variant_archive',
    entityType: 'ProductVariant',
    entityId: variantId,
    metadata: { sku: variant.sku, name: variant.name },
  });
}
