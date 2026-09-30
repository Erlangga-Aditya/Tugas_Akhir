import { describe, it, expect } from 'vitest';
import { validateSku } from './catalog.entity';

describe('Catalog Domain — SKU Validation', () => {
  it('accepts valid alphanumeric SKUs with hyphens, dots, and underscores', () => {
    expect(validateSku('TSHIRT-BLK-L')).toBe(true);
    expect(validateSku('ITEM_001.V2')).toBe(true);
    expect(validateSku('PROD123')).toBe(true);
  });

  it('rejects invalid SKUs: empty, too short, or containing invalid special characters', () => {
    expect(validateSku('')).toBe(false);
    expect(validateSku('A')).toBe(false);
    expect(validateSku('SKU with space')).toBe(false);
    expect(validateSku('SKU@#$')).toBe(false);
  });
});
