import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getActivePriorityRule,
  updatePriorityRule,
} from '@/modules/orders/application/priorityRule.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import {
  getAuthContext,
  getRequestId,
  assertPermission,
} from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/settings/priority
 *
 * Mengembalikan aturan prioritas yang sedang aktif: daftar kriteria, bobot,
 * ambang tingkat, dan versinya. Dipakai halaman Pengaturan.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'settings.manage');
    const rule = await getActivePriorityRule(ctx.tenantId);
    return successResponse({ rule }, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}

const CriterionSchema = z.object({
  code: z.string().min(1),
  weight: z.number().min(0).max(1),
});

const UpdatePrioritySchema = z.object({
  criteria: z.array(CriterionSchema).min(1),
  thresholds: z.object({
    critical: z.number().min(0).max(100),
    high: z.number().min(0).max(100),
    medium: z.number().min(0).max(100),
  }),
  description: z.string().max(200).optional(),
});

/**
 * POST /api/v1/settings/priority
 *
 * Menyimpan aturan prioritas baru. Aturan lama dinonaktifkan (bukan dihapus)
 * supaya jejak perubahan kebijakan toko tetap dapat diaudit.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'settings.manage');

    const parsed = UpdatePrioritySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError('Data aturan prioritas tidak valid.', {
        fields: parsed.error.flatten().fieldErrors,
      });
    }

    const rule = await updatePriorityRule(ctx.tenantId, ctx.userId, {
      criteria: parsed.data.criteria,
      thresholds: parsed.data.thresholds,
      description: parsed.data.description,
    });

    return successResponse({ rule }, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
