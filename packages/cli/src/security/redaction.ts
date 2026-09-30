const knownSecrets = new Set<string>();

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]'],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]'],
  [/\b((?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED JWT]'],
  [/\b(?:sk|sk-or-v1|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/g, '[REDACTED TOKEN]'],
];

export function registerSensitiveValue(value: string): void {
  if (value.length >= 6) knownSecrets.add(value);
}

export function forgetSensitiveValue(value: string): void {
  knownSecrets.delete(value);
}

export function redactSensitiveText(value: string): string {
  let redacted = value;
  for (const secret of knownSecrets) {
    if (redacted.includes(secret)) redacted = redacted.split(secret).join('[REDACTED]');
  }
  for (const [pattern, replacement] of SECRET_PATTERNS) redacted = redacted.replace(pattern, replacement);
  return redacted;
}

export function redactSensitive(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactSensitiveText(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveText(value.message),
      stack: value.stack ? redactSensitiveText(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, seen));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = /secret|password|api.?key|authorization|token/i.test(key)
      ? '[REDACTED]'
      : redactSensitive(item, seen);
  }
  return output;
}
