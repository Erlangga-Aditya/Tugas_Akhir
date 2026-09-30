/**
 * Priority Engine — Weighted Scoring Algorithm
 * 
 * Research focus (16-RESEARCH-ALIGNMENT.md, ADR-005):
 * - Priority is configurable, versioned, and explainable.
 * - Every result must show the factors used to compute it.
 * - Criteria and weights are tenant-configurable.
 * - Default algorithm: Weighted Scoring (simple, interpretable, research-friendly).
 * 
 * Criteria (09-FULFILLMENT-RULES.md §4):
 * 1. DEADLINE_URGENCY — time remaining to ship deadline
 * 2. SLA_RISK         — SLA breach probability 
 * 3. STOCK_READY      — all items fully reserved
 * 4. ORDER_AGE        — how long order has been waiting
 */

import type {
  PriorityFactor,
  PriorityLevel,
  PriorityResult,
} from '../domain/order.entity';

// ────────────────────────────────────────────────────────────
// Priority rule configuration shape
// ────────────────────────────────────────────────────────────

export interface PriorityRuleConfig {
  version: string;
  criteria: PriorityCriteria[];
  thresholds: {
    critical: number; // score >= this → CRITICAL
    high: number;
    medium: number;
    // below medium → LOW
  };
}

export interface PriorityCriteria {
  code: string;
  weight: number; // must sum to 1.0
}

/**
 * Default priority rule — used when tenant has no custom rule configured.
 * Weights based on 09-FULFILLMENT-RULES.md recommendations.
 */
export const DEFAULT_PRIORITY_RULE: PriorityRuleConfig = {
  version: 'priority-v1',
  criteria: [
    { code: 'DEADLINE_URGENCY', weight: 0.40 },
    { code: 'SLA_RISK',         weight: 0.30 },
    { code: 'STOCK_READY',      weight: 0.20 },
    { code: 'ORDER_AGE',        weight: 0.10 },
  ],
  thresholds: {
    critical: 75,
    high: 50,
    medium: 25,
  },
};

// ────────────────────────────────────────────────────────────
// Factor calculation functions
// ────────────────────────────────────────────────────────────

interface OrderContext {
  shipByAt: Date | null;
  placedAt: Date;
  isStockReady: boolean;    // all items have active reservations
  now?: Date;
}

/**
 * DEADLINE_URGENCY: 0.0 = plenty of time, 1.0 = extremely urgent or overdue
 */
function calcDeadlineUrgency(ctx: OrderContext): number {
  const now = ctx.now ?? new Date();

  if (!ctx.shipByAt) return 0.3; // no deadline info → moderate urgency

  const totalWindow = ctx.shipByAt.getTime() - ctx.placedAt.getTime();
  const remaining = ctx.shipByAt.getTime() - now.getTime();

  if (remaining <= 0) return 1.0; // overdue

  if (totalWindow <= 0) return 1.0;

  // Less time remaining = higher urgency
  const progress = 1 - remaining / totalWindow;
  return Math.min(1.0, Math.max(0.0, progress));
}

/**
 * SLA_RISK: probability of SLA breach based on absolute remaining time.
 * < 2h → 1.0, < 6h → 0.8, < 12h → 0.6, < 24h → 0.4, else → 0.2
 */
function calcSlaRisk(ctx: OrderContext): number {
  const now = ctx.now ?? new Date();

  if (!ctx.shipByAt) return 0.2;

  const hoursRemaining = (ctx.shipByAt.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursRemaining <= 0) return 1.0;
  if (hoursRemaining <= 2) return 0.9;
  if (hoursRemaining <= 6) return 0.7;
  if (hoursRemaining <= 12) return 0.5;
  if (hoursRemaining <= 24) return 0.3;
  return 0.1;
}

/**
 * STOCK_READY: 1.0 = all items reserved, 0.0 = none reserved
 */
function calcStockReady(ctx: OrderContext): number {
  return ctx.isStockReady ? 1.0 : 0.0;
}

/**
 * ORDER_AGE: older orders get higher priority to prevent starvation.
 * Age > 48h → 1.0, > 24h → 0.7, > 12h → 0.5, > 6h → 0.3, else → 0.1
 */
function calcOrderAge(ctx: OrderContext): number {
  const now = ctx.now ?? new Date();
  const ageHours = (now.getTime() - ctx.placedAt.getTime()) / (1000 * 60 * 60);

  if (ageHours >= 48) return 1.0;
  if (ageHours >= 24) return 0.7;
  if (ageHours >= 12) return 0.5;
  if (ageHours >= 6) return 0.3;
  return 0.1;
}

const FACTOR_CALCULATORS: Record<string, (ctx: OrderContext) => number> = {
  DEADLINE_URGENCY: calcDeadlineUrgency,
  SLA_RISK: calcSlaRisk,
  STOCK_READY: calcStockReady,
  ORDER_AGE: calcOrderAge,
};

// ────────────────────────────────────────────────────────────
// Main priority calculation
// ────────────────────────────────────────────────────────────

/**
 * Calculate priority for an order.
 * Returns a score (0-100), level, and explainable factors.
 * 
 * Research note: this function is testable without database or network.
 */
export function calculatePriority(
  ctx: OrderContext,
  rule: PriorityRuleConfig = DEFAULT_PRIORITY_RULE,
): PriorityResult {
  const factors: PriorityFactor[] = [];
  let weightedSum = 0;
  let totalWeight = 0;
  // Kompatibilitas aturan lama: sebagian rule menyimpan bobot di field `weights`.
  const legacyRule = rule as
    | { weights?: Record<string, unknown> }
    | undefined;
  const rawCriteria = Array.isArray(rule?.criteria)
    ? rule.criteria
    : legacyRule?.weights && typeof legacyRule.weights === 'object'
      ? Object.entries(legacyRule.weights).map(([code, weight]) => ({ code, weight: Number(weight) }))
      : DEFAULT_PRIORITY_RULE.criteria;

  for (const criterion of rawCriteria) {
    const calculator = FACTOR_CALCULATORS[criterion.code];
    if (!calculator) continue;

    const value = calculator(ctx);
    const contribution = value * criterion.weight;

    factors.push({
      code: criterion.code,
      value: Math.round(value * 100) / 100,
      weight: criterion.weight,
    });

    weightedSum += contribution;
    totalWeight += criterion.weight;
  }

  // Normalize if weights don't sum to 1.0
  const rawScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const score = Math.round(rawScore * 100);

  const level = scoreToLevel(score, rule.thresholds);

  return {
    score,
    level,
    ruleVersion: rule.version,
    factors,
    calculatedAt: new Date(),
  };
}

function scoreToLevel(
  score: number,
  thresholds: PriorityRuleConfig['thresholds'],
): PriorityLevel {
  if (score >= thresholds.critical) return 'CRITICAL';
  if (score >= thresholds.high) return 'HIGH';
  if (score >= thresholds.medium) return 'MEDIUM';
  return 'LOW';
}

/**
 * Human-readable explanation of priority (for UI display in Bahasa Indonesia).
 */
export function explainPriority(result: PriorityResult): string {
  const parts: string[] = [];

  for (const factor of result.factors) {
    if (factor.value >= 0.7) {
      switch (factor.code) {
        case 'DEADLINE_URGENCY':
          parts.push('batas pengiriman semakin dekat');
          break;
        case 'SLA_RISK':
          parts.push('risiko pelanggaran SLA tinggi');
          break;
        case 'STOCK_READY':
          parts.push('stok sudah siap');
          break;
        case 'ORDER_AGE':
          parts.push('pesanan sudah menunggu cukup lama');
          break;
      }
    }
  }

  if (parts.length === 0) return 'Prioritas reguler.';

  const levelLabel: Record<PriorityLevel, string> = {
    CRITICAL: 'Sangat Kritis',
    HIGH: 'Tinggi',
    MEDIUM: 'Sedang',
    LOW: 'Rendah',
  };

  return `Prioritas ${levelLabel[result.level]} — ${parts.join(', ')}.`;
}
