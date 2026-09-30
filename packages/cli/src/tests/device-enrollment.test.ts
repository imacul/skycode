import { describe, expect, test } from 'bun:test';
import {
  appendAuditRecord, createChallenge, createDeviceIdentity, signBundle, signChallenge,
  verifyAuditChain, verifyBundle, verifyChallenge,
} from '../security/device-enrollment';

describe('device enrollment security', () => {
  test('uses a device-bound Ed25519 identity for mutual challenge verification', () => {
    const device = createDeviceIdentity();
    const impostor = createDeviceIdentity();
    const challenge = createChallenge();
    const signature = signChallenge(challenge, device.privateKey);
    expect(verifyChallenge(challenge, signature, device.identity.publicKey)).toBe(true);
    expect(verifyChallenge(challenge, signature, impostor.identity.publicKey)).toBe(false);
  });

  test('rejects modified and expired policy bundles', () => {
    const device = createDeviceIdentity();
    const bundle = signBundle({ deviceId: device.identity.deviceId, allow: ['observe'] }, device.privateKey, 60_000);
    expect(verifyBundle(bundle, device.identity.publicKey)).toBe(true);
    expect(verifyBundle({ ...bundle, payload: { ...bundle.payload, allow: ['control'] } }, device.identity.publicKey)).toBe(false);
    expect(verifyBundle(bundle, device.identity.publicKey, Date.now() + 120_000)).toBe(false);
  });

  test('detects tampering and deletion in chained audit records', () => {
    const first = appendAuditRecord(null, 'session.started', { device: 'a' });
    const second = appendAuditRecord(first, 'action.executed', { action: 'read' });
    expect(verifyAuditChain([first, second])).toBe(true);
    expect(verifyAuditChain([first, { ...second, event: 'action.hidden' }])).toBe(false);
    expect(verifyAuditChain([second])).toBe(false);
  });
});
