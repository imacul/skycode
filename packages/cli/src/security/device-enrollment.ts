import { createHash, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { readSecureCredential, writeSecureCredentialVerified } from '../store/credential-store';

export interface DeviceIdentity {
  deviceId: string;
  publicKey: string;
}

export interface SignedBundle<T> {
  payload: T;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
}

function bundleBytes<T>(bundle: Omit<SignedBundle<T>, 'signature'>): Buffer {
  return Buffer.from(canonical(bundle), 'utf8');
}

export function createDeviceIdentity(): { identity: DeviceIdentity; privateKey: string } {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const deviceId = createHash('sha256').update(publicKey).digest('hex').slice(0, 32);
  return { identity: { deviceId, publicKey }, privateKey };
}

export function enrollLocalDevice(): DeviceIdentity {
  const existingPublic = readSecureCredential('device-public-key');
  const existingPrivate = readSecureCredential('device-private-key');
  if (existingPublic && existingPrivate) {
    return {
      deviceId: createHash('sha256').update(existingPublic).digest('hex').slice(0, 32),
      publicKey: existingPublic,
    };
  }
  const created = createDeviceIdentity();
  if (!writeSecureCredentialVerified('device-private-key', created.privateKey) ||
      !writeSecureCredentialVerified('device-public-key', created.identity.publicKey)) {
    throw new Error('Device enrollment failed because OS credential storage could not be verified.');
  }
  return created.identity;
}

export function createChallenge(): string {
  return randomBytes(32).toString('base64url');
}

export function signChallenge(challenge: string, privateKey: string): string {
  return sign(null, Buffer.from(challenge, 'utf8'), privateKey).toString('base64url');
}

export function verifyChallenge(challenge: string, signature: string, publicKey: string): boolean {
  return verify(null, Buffer.from(challenge, 'utf8'), publicKey, Buffer.from(signature, 'base64url'));
}

export function signBundle<T>(payload: T, privateKey: string, lifetimeMs: number): SignedBundle<T> {
  if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0) throw new Error('Bundle lifetime must be positive.');
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + lifetimeMs).toISOString();
  const unsigned = { payload, issuedAt, expiresAt };
  return { ...unsigned, signature: sign(null, bundleBytes(unsigned), privateKey).toString('base64url') };
}

export function verifyBundle<T>(bundle: SignedBundle<T>, publicKey: string, now = Date.now()): boolean {
  const issued = Date.parse(bundle.issuedAt);
  const expires = Date.parse(bundle.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > now + 60_000 || expires <= now) return false;
  const { signature, ...unsigned } = bundle;
  return verify(null, bundleBytes(unsigned), publicKey, Buffer.from(signature, 'base64url'));
}

export interface AuditRecord {
  sequence: number;
  timestamp: string;
  event: string;
  detailsHash: string;
  previousHash: string;
  hash: string;
}

export function appendAuditRecord(previous: AuditRecord | null, event: string, details: unknown): AuditRecord {
  const base = {
    sequence: (previous?.sequence || 0) + 1,
    timestamp: new Date().toISOString(),
    event,
    detailsHash: createHash('sha256').update(canonical(details)).digest('hex'),
    previousHash: previous?.hash || 'GENESIS',
  };
  return { ...base, hash: createHash('sha256').update(canonical(base)).digest('hex') };
}

export function verifyAuditChain(records: AuditRecord[]): boolean {
  let previous: AuditRecord | null = null;
  for (const record of records) {
    const { hash, ...base } = record;
    if (record.sequence !== (previous?.sequence || 0) + 1 || record.previousHash !== (previous?.hash || 'GENESIS')) return false;
    if (createHash('sha256').update(canonical(base)).digest('hex') !== hash) return false;
    previous = record;
  }
  return true;
}
