import { prisma } from '@/shared/infrastructure/prisma';
import { logger } from '@/shared/observability/logger';

interface AuditLogInput {
  tenantId: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Write an immutable audit log entry.
 * 
 * Rules (FR-AUD-001 to FR-AUD-004):
 * - Never update or delete audit records.
 * - Never log secrets, tokens, or passwords.
 * - Always include actor, tenant, action, entity, timestamp.
 * - Fire-and-forget: audit failures must not break the main operation.
 */
export async function auditLog(input: AuditLogInput): Promise<void> {
  try {
    let validActorId = input.actorId;
    if (validActorId && prisma?.user?.findUnique) {
      const user = await prisma.user.findUnique({ where: { id: validActorId }, select: { id: true } });
      if (!user) validActorId = undefined;
    }

    if (prisma?.auditLog?.create) {
      await prisma.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: validActorId,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          metadataJson: (input.metadata ?? {}) as object,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      });
    }
  } catch (err) {
    // Audit failure must never crash the main operation
    logger.error('Failed to write audit log', {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
