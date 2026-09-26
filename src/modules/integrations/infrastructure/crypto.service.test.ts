import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptSecret, decryptSecret } from './crypto.service';

describe('Crypto Service (AES-256-GCM)', () => {
  const originalEnv = process.env.ENCRYPTION_KEY;
  const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 64 hex chars = 32 bytes

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = testKey;
  });

  afterEach(() => {
    process.env.ENCRYPTION_KEY = originalEnv;
  });

  it('should successfully encrypt and decrypt a plaintext string', () => {
    const secret = JSON.stringify({
      shopId: '227924374',
      accessToken: 'test_token_12345',
      refreshToken: 'test_refresh_67890',
      tokenExpiresAt: 1774000000000,
    });

    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toBe(secret);
    expect(encrypted.split(':')).toHaveLength(3); // iv:tag:data

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(secret);
    expect(JSON.parse(decrypted)).toEqual(JSON.parse(secret));
  });

  it('should generate different ciphertexts for the same plaintext due to random IV', () => {
    const text = 'test_secret_value';
    const enc1 = encryptSecret(text);
    const enc2 = encryptSecret(text);
    expect(enc1).not.toBe(enc2);
    expect(decryptSecret(enc1)).toBe(text);
    expect(decryptSecret(enc2)).toBe(text);
  });

  it('should throw when payload format is invalid', () => {
    expect(() => decryptSecret('invalid_payload')).toThrow('Format kredensial terenkripsi tidak valid.');
    expect(() => decryptSecret('part1:part2')).toThrow('Format kredensial terenkripsi tidak valid.');
  });

  it('should throw when tampered ciphertext is provided', () => {
    const enc = encryptSecret('sensitive_data');
    const [iv, tag, data] = enc.split(':');
    // Alter ciphertext
    const tamperedData = 'ff' + (data ?? '').slice(2);
    const tampered = [iv, tag, tamperedData].join(':');

    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('should throw if ENCRYPTION_KEY is missing or not 64 hex chars', () => {
    process.env.ENCRYPTION_KEY = '';
    expect(() => encryptSecret('test')).toThrow('ENCRYPTION_KEY belum disetel');

    process.env.ENCRYPTION_KEY = 'short_key';
    expect(() => encryptSecret('test')).toThrow('ENCRYPTION_KEY belum disetel');
  });
});
