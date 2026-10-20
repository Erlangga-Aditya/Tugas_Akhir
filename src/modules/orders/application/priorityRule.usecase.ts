/**
 * Pengaturan aturan prioritas (ADR-005: configurable, versioned, explainable).
 *
 * Satu tenant hanya boleh punya SATU aturan aktif. Aturan baru menonaktifkan
 * aturan lama (bukan menghapusnya) supaya jejak perubahan kebijakan toko tetap
 * tertinggal dan dapat diaudit kembali.
 */
import { prisma } from '@/shared/infrastructure/prisma';
import { logger } from '@/shared/observability/logger';
import { DEFAULT_PRIORITY_RULE, type PriorityRuleConfig } from '../domain/priority.engine';
import { ValidationError } from '@/shared/errors/AppError';

// Kriteria yang dikenal mesin prioritas. Diambil dari satu sumber kebenaran
// (priority.engine.ts) lewat FACTOR_CALCULATORS — di sini cuma mendaftarkan
// ulang untuk validasi. Saat kriteria baru ditambahkan di mesin, daftar ini
// wajib diupdate; akan tetap aman bila lupa: aturan tidak dikenal akan
// diabaikan oleh mesin saat menghitung, tetapi tetap ditolak di sini supaya
// bobot tidak diam-diam hilang dari perhitungan.
const KNOWN_CRITERIA: ReadonlySet<string> = new Set([
  'DEADLINE_URGENCY',
  'SLA_RISK',
  'STOCK_READY',
  'ORDER_AGE',
]);

const MAX_VERSION_LENGTH = 60;

export interface PriorityRuleSnapshot {
  id: string;
  version: string;
  isEnabled: boolean;
  description: string | null;
  config: PriorityRuleConfig;
  createdAt: string;
}

function toSnapshot(row: {
  id: string;
  version: string;
  isEnabled: boolean;
  description: string | null;
  criteriaJson: unknown;
  createdAt: Date;
}): PriorityRuleSnapshot {
  const cfg = normalizeConfig(row.criteriaJson);
  return {
    id: row.id,
    version: row.version,
    isEnabled: row.isEnabled,
    description: row.description,
    config: cfg,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Bentuk yang disimpan di `criteriaJson` boleh dua macam (mengikuti sejarah):
 *  - bentuk baru: { version, criteria: [{code, weight}], thresholds }
 *  - bentuk lawas: { version, weights: { CODE: weight }, thresholds }
 */
function normalizeConfig(raw: unknown): PriorityRuleConfig {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_PRIORITY_RULE };
  }
  const obj = raw as Record<string, unknown>;

  const criteria: PriorityRuleConfig['criteria'] = Array.isArray(obj.criteria)
    ? (obj.criteria as Array<Record<string, unknown>>)
        .filter((c) => c && typeof c === 'object')
        .map((c) => ({
          code: String(c.code ?? ''),
          weight: Number(c.weight ?? 0),
        }))
        .filter((c) => c.code !== '' && KNOWN_CRITERIA.has(c.code))
    : obj.weights && typeof obj.weights === 'object'
      ? Object.entries(obj.weights as Record<string, unknown>).map(([code, weight]) => ({
          code,
          weight: Number(weight),
        }))
      : [...DEFAULT_PRIORITY_RULE.criteria];

  const thresholds = obj.thresholds as PriorityRuleConfig['thresholds'] | undefined;

  // Jatuh ke ambang bawaan kalau nilai tidak ada — lebih aman daripada
  // memakai angka hampa yang membuat setiap pesanan LOW.
  return {
    version: typeof obj.version === 'string' && obj.version !== '' ? obj.version : DEFAULT_PRIORITY_RULE.version,
    criteria: criteria.length > 0 ? criteria : [...DEFAULT_PRIORITY_RULE.criteria],
    thresholds: {
      critical: Number(thresholds?.critical ?? DEFAULT_PRIORITY_RULE.thresholds.critical),
      high: Number(thresholds?.high ?? DEFAULT_PRIORITY_RULE.thresholds.high),
      medium: Number(thresholds?.medium ?? DEFAULT_PRIORITY_RULE.thresholds.medium),
    },
  };
}

/** Ambil aturan yang sedang aktif untuk tenant. */
export async function getActivePriorityRule(tenantId: string): Promise<PriorityRuleSnapshot | null> {
  const row = await prisma.priorityRule.findFirst({
    where: { tenantId, isEnabled: true },
    orderBy: { createdAt: 'desc' },
  });
  return row ? toSnapshot(row) : null;
}

/** Ambil aturan aktif sebagai config siap pakai oleh mesin prioritas. */
export async function getActivePriorityConfig(
  tenantId: string,
): Promise<PriorityRuleConfig> {
  const snapshot = await getActivePriorityRule(tenantId);
  return snapshot?.config ?? { ...DEFAULT_PRIORITY_RULE };
}

export interface UpdatePriorityRuleInput {
  /** Daftar kriteria beserta bobot. Jumlah bobot harus = 1. */
  criteria: PriorityRuleConfig['criteria'];
  /** Ambang skor untuk tiap tingkat. */
  thresholds: PriorityRuleConfig['thresholds'];
  /** Catatan pemilik soal perubahan ini. */
  description?: string;
}

/**
 * Simpan aturan prioritas baru. Aturan lama dinonaktifkan (bukan dihapus)
 * supaya jejak perubahan tetap ada; setiap perubahan membuat versi baru.
 */
export async function updatePriorityRule(
  tenantId: string,
  actorId: string,
  input: UpdatePriorityRuleInput,
): Promise<PriorityRuleSnapshot> {
  const totalWeight = input.criteria.reduce((sum, c) => sum + c.weight, 0);
  if (input.criteria.length === 0) {
    throw new ValidationError('Daftar kriteria tidak boleh kosong.');
  }
  const unknown = input.criteria.find((c) => !KNOWN_CRITERIA.has(c.code));
  if (unknown) {
    throw new ValidationError(`Kriteria prioritas tidak dikenal: ${unknown.code}.`);
  }
  // Toleransi kecil untuk kesalahan pembulatan (0,40 + 0,30 + 0,20 + 0,10).
  if (Math.abs(totalWeight - 1) > 0.001) {
    throw new ValidationError(
      `Jumlah bobot harus 1,00 (sekarang ${totalWeight.toFixed(2)}).`,
    );
  }
  if (
    input.thresholds.critical <= input.thresholds.high ||
    input.thresholds.high <= input.thresholds.medium
  ) {
    throw new ValidationError(
      'Ambang kritis harus lebih besar dari tinggi, dan tinggi harus lebih besar dari sedang.',
    );
  }

  const existing = await getActivePriorityRule(tenantId);
  const nextVersion = nextVersionOf(existing?.version);

  const created = await prisma.$transaction(async (tx) => {
    // Nonaktifkan aturan lama dalam transaksi yang sama. Tanpa ini, dua
    // aturan bisa aktif bersamaan dan pembaca ambigu.
    if (existing) {
      await tx.priorityRule.updateMany({
        where: { tenantId, isEnabled: true },
        data: { isEnabled: false },
      });
    }
    return tx.priorityRule.create({
      data: {
        tenantId,
        version: nextVersion,
        isEnabled: true,
        description: input.description?.trim() || null,
        criteriaJson: {
          version: nextVersion,
          criteria: input.criteria,
          thresholds: input.thresholds,
        } as unknown as object,
      },
    });
  });

  logger.info('Priority rule updated', { tenantId, actorId, version: nextVersion });
  return toSnapshot(created);
}

/** Versi berikutnya: priority-v1 → priority-v2, dst. */
function nextVersionOf(current: string | undefined): string {
  if (!current) return DEFAULT_PRIORITY_RULE.version;
  const match = /(\d+)$/.exec(current);
  if (!match) return `${current}-2`.slice(0, MAX_VERSION_LENGTH);
  const n = Number(match[1]) + 1;
  return `priority-v${n}`;
}
