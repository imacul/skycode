import { describe, expect, test } from 'bun:test';
import { forgetSensitiveValue, redactSensitive, redactSensitiveText, registerSensitiveValue } from '../security/redaction';

describe('secret redaction', () => {
  test('removes registered secrets from nested values and errors', () => {
    const secret = 'test-secret-value-12345';
    registerSensitiveValue(secret);
    const result = redactSensitive({ output: `prefix ${secret} suffix`, nested: [new Error(`failed with ${secret}`)] }) as any;
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.output).toContain('[REDACTED]');
    forgetSensitiveValue(secret);
  });

  test('redacts credential-shaped text and credential fields', () => {
    const value = redactSensitive({ authorization: 'Bearer abcdefghijklmnop', output: 'api_key=abcdefghijklmnop password: hunter2' }) as any;
    expect(value.authorization).toBe('[REDACTED]');
    expect(value.output).not.toContain('abcdefghijklmnop');
    expect(value.output).not.toContain('hunter2');
  });

  test('redacts private keys and JWTs while preserving ordinary output', () => {
    const privateKey = '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----';
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';
    const result = redactSensitiveText(`ok\n${privateKey}\n${jwt}`);
    expect(result).toContain('ok');
    expect(result).not.toContain('abc123');
    expect(result).not.toContain('eyJhbGci');
  });
});
