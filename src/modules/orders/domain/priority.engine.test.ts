import { describe, it, expect } from 'vitest';
import {
  calculatePriority,
  DEFAULT_PRIORITY_RULE,
  explainPriority,
} from '@/modules/orders/domain/priority.engine';

describe('Priority Engine', () => {
  const baseNow = new Date('2024-01-15T10:00:00Z');

  describe('calculatePriority', () => {
    it('should return CRITICAL for overdue order with stock ready', () => {
      const result = calculatePriority(
        {
          shipByAt: new Date('2024-01-15T08:00:00Z'), // 2 hours ago
          placedAt: new Date('2024-01-14T08:00:00Z'),
          isStockReady: true,
          now: baseNow,
        },
        DEFAULT_PRIORITY_RULE,
      );

      expect(result.score).toBeGreaterThanOrEqual(75);
      expect(result.level).toBe('CRITICAL');
      expect(result.ruleVersion).toBe('priority-v1');
    });

    it('should return LOW for order with plenty of time and no stock', () => {
      const result = calculatePriority(
        {
          shipByAt: new Date('2024-01-17T10:00:00Z'), // 2 days later
          placedAt: new Date('2024-01-15T09:00:00Z'), // 1 hour ago
          isStockReady: false,
          now: baseNow,
        },
        DEFAULT_PRIORITY_RULE,
      );

      expect(result.score).toBeLessThan(50);
      expect(result.level).toBe('LOW');
    });

    it('should include all 4 factors in result', () => {
      const result = calculatePriority(
        {
          shipByAt: new Date('2024-01-15T12:00:00Z'),
          placedAt: new Date('2024-01-14T10:00:00Z'),
          isStockReady: true,
          now: baseNow,
        },
        DEFAULT_PRIORITY_RULE,
      );

      const codes = result.factors.map((f) => f.code);
      expect(codes).toContain('DEADLINE_URGENCY');
      expect(codes).toContain('SLA_RISK');
      expect(codes).toContain('STOCK_READY');
      expect(codes).toContain('ORDER_AGE');
    });

    it('should produce score between 0 and 100', () => {
      const result = calculatePriority(
        {
          shipByAt: new Date('2024-01-15T11:00:00Z'),
          placedAt: new Date('2024-01-15T09:00:00Z'),
          isStockReady: false,
          now: baseNow,
        },
        DEFAULT_PRIORITY_RULE,
      );

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should return CRITICAL when only 1 hour to deadline', () => {
      const result = calculatePriority(
        {
          shipByAt: new Date(baseNow.getTime() + 60 * 60 * 1000), // 1 hour
          placedAt: new Date(baseNow.getTime() - 24 * 60 * 60 * 1000),
          isStockReady: true,
          now: baseNow,
        },
        DEFAULT_PRIORITY_RULE,
      );

      expect(result.level).toBe('CRITICAL');
    });

    it('should handle null ship deadline', () => {
      const result = calculatePriority(
        {
          shipByAt: null,
          placedAt: new Date('2024-01-14T10:00:00Z'),
          isStockReady: true,
          now: baseNow,
        },
        DEFAULT_PRIORITY_RULE,
      );

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.level).toBeDefined();
    });

    it('factors should respect weights', () => {
      const result = calculatePriority(
        {
          shipByAt: new Date('2024-01-16T10:00:00Z'),
          placedAt: new Date('2024-01-14T10:00:00Z'),
          isStockReady: true,
          now: baseNow,
        },
        DEFAULT_PRIORITY_RULE,
      );

      const deadlineFactor = result.factors.find((f) => f.code === 'DEADLINE_URGENCY')!;
      expect(deadlineFactor.weight).toBe(0.40);

      const slaFactor = result.factors.find((f) => f.code === 'SLA_RISK')!;
      expect(slaFactor.weight).toBe(0.30);
    });
  });

  describe('explainPriority', () => {
    it('should produce human-readable Indonesian explanation', () => {
      const result = calculatePriority(
        {
          shipByAt: new Date(baseNow.getTime() + 60 * 60 * 1000),
          placedAt: new Date(baseNow.getTime() - 24 * 60 * 60 * 1000),
          isStockReady: true,
          now: baseNow,
        },
        DEFAULT_PRIORITY_RULE,
      );

      const explanation = explainPriority(result);
      expect(explanation).toBeTruthy();
      expect(typeof explanation).toBe('string');
      expect(explanation.length).toBeGreaterThan(5);
    });
  });
});
