import { createHash, createPublicKey, createVerify, randomBytes, randomUUID, verify as verifySignature } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readSecureCredential, writeSecureCredentialVerified, deleteSecureCredential } from '../store/credential-store';
import { registerSensitiveValue, forgetSensitiveValue } from '../security/redaction';

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SECRET_NAME = 'chatgpt-plan-session';
const HOST_PATH = join(homedir(), '.skycode', 'chatgpt-host-id');
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';

export interface ChatGPTSession {
  client_id: string;
  subject: string;
  email?: string;
  ext_agent_host_id: string;
  id_token: string;
  access_token: string;
  refresh_token: string;
  scopes: string[];
  expires_at: number;
}

function readSession(): ChatGPTSession | null {
  const raw = readSecureCredential(SECRET_NAME);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as ChatGPTSession;
    if (!session.client_id || !session.subject || !session.access_token) return null;
    registerSensitiveValue(session.access_token);
    if (session.refresh_token) registerSensitiveValue(session.refresh_token);
    return session;
  } catch { return null; }
}
export function getChatGPTSession(): ChatGPTSession | null { return readSession(); }
export function hasChatGPTPlan(): boolean {
  const session = readSession();
  return !!session?.scopes.includes('chatgpt.tokens.use.direct');
}
export function disconnectChatGPT(): void {
  const old = readSession();
  if (old) { forgetSensitiveValue(old.access_token); forgetSensitiveValue(old.refresh_token); }
  deleteSecureCredential(SECRET_NAME);
}
function saveSession(session: ChatGPTSession): void {
  if (!writeSecureCredentialVerified(SECRET_NAME, JSON.stringify(session))) {
    throw new Error('Unable to securely store ChatGPT authorization. No credentials saved.');
  }
  registerSensitiveValue(session.access_token);
  if (session.refresh_token) registerSensitiveValue(session.refresh_token);
}
function hostId(): string {
  if (existsSync(HOST_PATH)) {
    const id = readFileSync(HOST_PATH, 'utf8').trim();
    if (/^urn:uuid:[a-f0-9-]{36}$/i.test(id)) return id;
    throw new Error('Invalid existing ChatGPT host ID; refusing to replace its identity.');
  }
  mkdirSync(join(homedir(), '.skycode'), { recursive: true, mode: 0o700 });
  const id = 'urn:uuid:' + randomUUID();
  writeFileSync(HOST_PATH, id, { flag: 'wx', mode: 0o600 });
  return id;
}
function random(): string { return randomBytes(32).toString('base64url'); }
function decodePart(value: string): any { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }

export async function verifyOpenAIIdToken(token: string, clientId: string, nonce: string): Promise<{ sub: string; email?: string }> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid OpenAI ID token.');
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (header.alg !== 'RS256' && header.alg !== 'ES256') throw new Error('Unsupported ID-token signature algorithm.');
  const keysRes = await fetch(ISSUER + '/.well-known/jwks.json', { signal: AbortSignal.timeout(15000) });
  if (!keysRes.ok) throw new Error('Unable to retrieve OpenAI signing keys.');
  const { keys } = await keysRes.json() as { keys: any[] };
  const jwk = keys.find((key: any) => key.kid === header.kid && key.alg !== 'none' && (!key.use || key.use === 'sig'));
  if (!jwk) throw new Error('OpenAI ID-token signing key not found.');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const signed = Buffer.from(parts[0] + '.' + parts[1]);
  const signature = Buffer.from(parts[2], 'base64url');
  const valid = header.alg === 'RS256'
    ? verifySignature('RSA-SHA256', signed, key, signature)
    : verifySignature('sha256', signed, { key, dsaEncoding: 'ieee-p1363' }, signature);
  if (!valid) throw new Error('OpenAI ID-token signature failed verification.');
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== ISSUER || !(payload.aud === clientId || (Array.isArray(payload.aud) && payload.aud.includes(clientId))) ||
      typeof payload.exp !== 'number' || payload.exp < now - 5 ||
      typeof payload.iat !== 'number' || payload.iat > now + 60 ||
      payload.nonce !== nonce || typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('OpenAI ID-token claims failed validation.');
  }
  return { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
}
async function tokenRequest(params: URLSearchParams): Promise<any> {
  const res = await fetch(ISSUER + '/api/accounts/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'accept': 'application/json' },
    body: params, signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error('OpenAI token exchange failed (HTTP ' + res.status + '). Reauthorize if necessary.');
  return await res.json();
}
function parseScopes(value: any): string[] {
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : Array.isArray(value) ? value : [];
}
export async function getChatGPTAccessToken(): Promise<string> {
  const session = readSession();
  if (!session || !session.scopes.includes('chatgpt.tokens.use.direct')) {
    throw new Error('ChatGPT plan is not connected. Run skycode chatgpt login.');
  }
  if (session.expires_at > Date.now() + 60000) return session.access_token;
  if (!session.refresh_token) throw new Error('ChatGPT authorization expired. Run skycode chatgpt login.');
  const tokens = await tokenRequest(new URLSearchParams({
    grant_type: 'refresh_token', client_id: session.client_id, refresh_token: session.refresh_token, resource: RESOURCE,
  }));
  const scopes = parseScopes(tokens.scope);
  if (!scopes.includes('chatgpt.tokens.use.direct')) throw new Error('ChatGPT plan permission is no longer granted.');
  // The refresh response may omit identity; retain only previously verified identity.
  const updated: ChatGPTSession = {
    ...session, access_token: tokens.access_token, refresh_token: tokens.refresh_token || session.refresh_token,
    id_token: tokens.id_token || session.id_token, scopes,
    expires_at: Date.now() + Number(tokens.expires_in || 3600) * 1000,
  };
  if (!updated.access_token) throw new Error('OpenAI refresh response contained no access token.');
  saveSession(updated);
  return updated.access_token;
}
function openBrowser(url: string): void {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.log('Open this link in your browser: ' + url));
  child.unref();
}

export async function signInWithChatGPT(): Promise<ChatGPTSession> {
  const previous = readSession();
  const state = random(), nonce = random(), verifier = random();
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const host = hostId();
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('Could not bind callback listener.'); }
  const redirectUri = 'http://127.0.0.1:' + address.port + '/auth/callback';
  const clientId = previous?.client_id || 'dynamic_agent_client';
  const authorize = new URL(ISSUER + '/api/accounts/authorize');
  const params: Record<string, string> = {
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES, resource: RESOURCE,
    state, nonce, code_challenge_method: 'S256', code_challenge: challenge, ext_agent_host_id: host,
  };
  if (!previous) params.agent_name_hint = 'SkyCode';
  else {
    if (previous.id_token) params.id_token_hint = previous.id_token;
    if (previous.email) params.login_hint = previous.email;
  }
  authorize.search = new URLSearchParams(params).toString();
  console.log('Continue with ChatGPT in your browser. Waiting for authorization...');
  const callback = new Promise<{ code: string; clientId: string }>((resolve, reject) => {
    server.on('request', (req, res) => {
      const url = new URL(req.url || '/', redirectUri);
      if (url.pathname !== '/auth/callback' || req.method !== 'GET') { res.writeHead(404).end(); return; }
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400).end('Invalid sign-in state.'); reject(new Error('OAuth state mismatch.')); return;
      }
      const error = url.searchParams.get('error');
      if (error) { res.writeHead(400).end('Sign-in declined.'); reject(new Error('ChatGPT authorization declined.')); return; }
      const code = url.searchParams.get('code');
      const issued = url.searchParams.get('client_id') || previous?.client_id;
      if (!code || !issued || issued === 'dynamic_agent_client' || (previous && issued !== previous.client_id)) {
        res.writeHead(400).end('Invalid authorization callback.');
        reject(new Error('ChatGPT callback missing code or valid issued client ID.')); return;
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('SkyCode received authorization. You can return to the terminal.');
      resolve({ code, clientId: issued });
    });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    openBrowser(authorize.toString());
    const result = await Promise.race([callback, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('ChatGPT sign-in timed out.')), 180000);
    })]);
    const tokens = await tokenRequest(new URLSearchParams({
      grant_type: 'authorization_code', client_id: result.clientId, code: result.code,
      code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE,
    }));
    if (!tokens.id_token || !tokens.access_token || !tokens.refresh_token) throw new Error('Incomplete OpenAI token response.');
    const identity = await verifyOpenAIIdToken(tokens.id_token, result.clientId, nonce);
    if (previous && identity.sub !== previous.subject) throw new Error('Account mismatch; existing credentials unchanged.');
    const scopes = parseScopes(tokens.scope);
    if (!scopes.includes('chatgpt.tokens.use.direct')) throw new Error('ChatGPT plan usage was not approved.');
    const session: ChatGPTSession = {
      client_id: result.clientId, subject: identity.sub, email: identity.email, ext_agent_host_id: host,
      id_token: tokens.id_token, access_token: tokens.access_token, refresh_token: tokens.refresh_token,
      scopes, expires_at: Date.now() + Number(tokens.expires_in || 3600) * 1000,
    };
    saveSession(session);
    return session;
  } finally { if (timer) clearTimeout(timer); server.close(); }
}

export async function runChatGPTCommand(args: string[]): Promise<number> {
  try {
    switch (args[0]) {
      case 'login': {
        const account = await signInWithChatGPT();
        console.log('Connected ChatGPT account: ' + (account.email || account.subject));
        return 0;
      }
      case 'logout':
        disconnectChatGPT();
        console.log('ChatGPT credentials removed from this device.');
        return 0;
      case 'status': {
        const account = getChatGPTSession();
        console.log(account ? 'ChatGPT plan connected: ' + (account.email || account.subject) : 'ChatGPT plan not connected.');
        return 0;
      }
      default:
        console.log('Usage: skycode chatgpt login | status | logout');
        return args[0] ? 1 : 0;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
