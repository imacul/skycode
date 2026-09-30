import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.SKYCODE_CREDENTIALS_PATH = join(tmpdir(), `skycode-credentials-${process.pid}`);

describe('OS credential store', () => {
  test('round-trips a canary before reporting a successful save', () => {
    const {
      deleteSecureCredential,
      readSecureCredential,
      secureCredentialStoreAvailable,
      writeSecureCredentialVerified,
    } = require('../store/credential-store') as typeof import('../store/credential-store');
    if (!secureCredentialStoreAvailable()) return;
    const name = `test-canary-${process.pid}-${Date.now()}`;
    const secret = `canary-${crypto.randomUUID()}`;
    try {
      expect(writeSecureCredentialVerified(name, secret)).toBe(true);
      expect(readSecureCredential(name)).toBe(secret);
    } finally {
      deleteSecureCredential(name);
    }
    expect(readSecureCredential(name)).toBe('');
  }, 20_000);
});
