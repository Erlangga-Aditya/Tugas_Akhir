/**
 * Catalog Domain Entity & Invariants
 *
 * Rules:
 * - Products belong to a single tenant.
 * - ProductVariant SKU must be unique per product.
 * - Weight is in grams.
 * - Barcode can be used for warehouse scanning.
 */

export interface ProductEntity {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  category?: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductVariantEntity {
  id: string;
  productId: string;
  sku: string;
  barcode?: string | null;
  name: string;
  weight?: number | null;
  imageUrl?: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  createdAt: Date;
  updatedAt: Date;
}

export function validateSku(sku: string): boolean {
  if (!sku || sku.trim().length === 0) return false;
  // SKU alphanumeric with hyphens/underscores/dots, 2-50 chars
  return /^[a-zA-Z0-9._-]{2,50}$/.test(sku.trim());
}
