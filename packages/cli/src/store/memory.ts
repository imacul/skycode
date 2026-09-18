import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { Conversation } from '../store/conversation';

export type MemoryKind = 'profile' | 'preference' | 'project' | 'fact' | 'instruction';

export interface MemoryRecord {
  id: string;
  key: string;
  value: string;
  kind: MemoryKind;
  scope: 'global' | 'workspace';
  workspace?: string;
  sourceConversationId?: string;
  createdAt: string;
  updatedAt: string;
  confidence: number;
}

interface MemoryFile {
  version: 1;
  memories: MemoryRecord[];
}

function memoryFilePath(): string {
  return (
    process.env.SKYCODE_MEMORY_PATH ||
    join(homedir(), '.skycode', 'memory.json')
  );
}

const STOPWORDS = new Set([
  'the','a','an','and','or','but','to','of','in','on','for','with','is','are','was','were',
  'be','been','being','i','me','my','you','your','it','this','that','these','those','do','does',
  'did','can','could','should','would','will','just','about','from','as','at','by','we','our',
  'they','their','he','she','his','her','them','what','which','who','when','where','why','how',
]);

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function normalizeSpace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeKeyPart(value: string): string {
  return normalizeSpace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function tokens(value: string): string[] {
  return [...new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9+#.\- ]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1 && !STOPWORDS.has(token))
  )];
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function loadMemoryFile(): MemoryFile {
  try {
    if (!existsSync(memoryFilePath())) {
      return { version: 1, memories: [] };
    }

    const parsed = JSON.parse(readFileSync(memoryFilePath(), 'utf8')) as Partial<MemoryFile>;
    return {
      version: 1,
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
    };
  } catch {
    return { version: 1, memories: [] };
  }
}

function saveMemoryFile(file: MemoryFile): void {
  mkdirSync(dirname(memoryFilePath()), { recursive: true });
  writeFileSync(memoryFilePath(), JSON.stringify(file, null, 2) + '\n', 'utf8');
}

function looksSensitive(value: string): boolean {
  const text = value.toLowerCase();
  return (
    /\b(password|passphrase|secret|api[_ -]?key|private key|seed phrase|mnemonic|otp|one[- ]time code|cvv|pin)\b/.test(text) ||
    /\bsk-[a-z0-9_-]{16,}\b/i.test(value) ||
    /\b[a-f0-9]{32,}\b/i.test(value)
  );
}

function scopeMatches(record: MemoryRecord, workspace: string): boolean {
  return record.scope === 'global' ||
    (record.scope === 'workspace' && record.workspace === resolve(workspace));
}

export function listMemories(workspace = process.cwd()): MemoryRecord[] {
  return loadMemoryFile().memories
    .filter((record) => scopeMatches(record, workspace))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function remember(
  value: string,
  options: {
    key?: string;
    kind?: MemoryKind;
    scope?: 'global' | 'workspace';
    workspace?: string;
    sourceConversationId?: string;
    confidence?: number;
  } = {}
): MemoryRecord | null {
  const clean = normalizeSpace(value).slice(0, 800);
  if (!clean || looksSensitive(clean)) return null;

  const scope = options.scope || 'global';
  const workspace = scope === 'workspace'
    ? resolve(options.workspace || process.cwd())
    : undefined;
  const key = options.key || 'fact:' + hashText(clean.toLowerCase());
  const file = loadMemoryFile();
  const existingIndex = file.memories.findIndex((record) =>
    record.key === key &&
    record.scope === scope &&
    record.workspace === workspace
  );
  const timestamp = nowIso();

  if (existingIndex >= 0) {
    const existing = file.memories[existingIndex];
    const updated: MemoryRecord = {
      ...existing,
      value: clean,
      kind: options.kind || existing.kind,
      sourceConversationId: options.sourceConversationId || existing.sourceConversationId,
      updatedAt: timestamp,
      confidence: options.confidence ?? existing.confidence,
    };
    file.memories[existingIndex] = updated;
    saveMemoryFile(file);
    return updated;
  }

  const record: MemoryRecord = {
    id: newId(),
    key,
    value: clean,
    kind: options.kind || 'fact',
    scope,
    workspace,
    sourceConversationId: options.sourceConversationId,
    createdAt: timestamp,
    updatedAt: timestamp,
    confidence: options.confidence ?? 1,
  };

  file.memories.push(record);
  saveMemoryFile(file);
  return record;
}

export function forgetMemories(query: string, workspace = process.cwd()): number {
  const clean = normalizeSpace(query).toLowerCase();
  if (!clean) return 0;

  const file = loadMemoryFile();
  const before = file.memories.length;
  file.memories = file.memories.filter((record) => {
    if (!scopeMatches(record, workspace)) return true;
    return !(
      record.id.toLowerCase() === clean ||
      record.key.toLowerCase().includes(clean) ||
      record.value.toLowerCase().includes(clean)
    );
  });

  if (file.memories.length !== before) saveMemoryFile(file);
  return before - file.memories.length;
}

export function clearMemories(): number {
  const file = loadMemoryFile();
  const count = file.memories.length;
  saveMemoryFile({ version: 1, memories: [] });
  return count;
}

export function autoCaptureMemories(
  input: string,
  options: {
    conversationId?: string | null;
    workspace?: string;
  } = {}
): MemoryRecord[] {
  const text = normalizeSpace(input);
  if (!text || looksSensitive(text)) return [];

  const captured: MemoryRecord[] = [];
  const sourceConversationId = options.conversationId || undefined;
  const workspace = options.workspace || process.cwd();

  const explicit = text.match(/\bremember(?: that)?\s+(.+)$/i);
  if (explicit?.[1]) {
    const record = remember(explicit[1], {
      kind: 'fact',
      sourceConversationId,
      confidence: 1,
    });
    if (record) captured.push(record);
  }

  const profile = text.match(/(?:^|\b)(?:correction:\s*)?my\s+([a-z][a-z0-9 _-]{1,30}?)\s+is\s+(.+?)(?:[.!?]|$)/i);
  if (profile?.[1] && profile?.[2]) {
    const fieldText = normalizeSpace(profile[1]).toLowerCase();
    const stableField =
      /^(name|age|location|city|country|timezone|job|role|profession|occupation|editor|language|preferred .+|favorite .+)$/.test(fieldText);

    if (stableField) {
      const field = normalizeKeyPart(profile[1]);
      const value = normalizeSpace('My ' + profile[1] + ' is ' + profile[2]);
      const record = remember(value, {
        key: 'profile:' + field,
        kind: 'profile',
        sourceConversationId,
        confidence: 0.98,
      });
      if (record) captured.push(record);
    }
  }

  const location = text.match(/(?:^|\b)i\s+live\s+in\s+(.+?)(?:[.!?]|$)/i);
  if (location?.[1]) {
    const record = remember('I live in ' + normalizeSpace(location[1]), {
      key: 'profile:location',
      kind: 'profile',
      sourceConversationId,
      confidence: 0.98,
    });
    if (record) captured.push(record);
  }

  const role = text.match(/(?:^|\b)i\s+(?:work\s+as|am)\s+(?:an?\s+)?([a-z][a-z0-9 /+&_-]{2,60}?)(?:[.!?]|$)/i);
  if (role?.[1] && /\b(developer|engineer|designer|student|founder|consultant|analyst|manager|researcher|architect|writer|teacher)\b/i.test(role[1])) {
    const record = remember('I work as ' + normalizeSpace(role[1]), {
      key: 'profile:role',
      kind: 'profile',
      sourceConversationId,
      confidence: 0.94,
    });
    if (record) captured.push(record);
  }

  const preference = text.match(/(?:^|\b)i\s+(?:really\s+)?prefer\s+(.+?)(?:[.!?]|$)/i);
  if (preference?.[1]) {
    const raw = normalizeSpace(preference[1]);
    const record = remember('I prefer ' + raw, {
      key: 'preference:' + hashText(raw.toLowerCase()),
      kind: 'preference',
      sourceConversationId,
      confidence: 0.95,
    });
    if (record) captured.push(record);
  }

  const projectField = text.match(/(?:^|\b)(?:the\s+)?(?:project\s+)?(stack|framework|database|backend|frontend|styling|state management)\s+is\s+(.+?)(?:[.!?]|$)/i);
  if (projectField?.[1] && projectField?.[2]) {
    const field = normalizeKeyPart(projectField[1]);
    const record = remember(
      normalizeSpace(projectField[1] + ' is ' + projectField[2]),
      {
        key: 'project:' + field,
        kind: 'project',
        scope: 'workspace',
        workspace,
        sourceConversationId,
        confidence: 0.97,
      }
    );
    if (record) captured.push(record);
  }

  const projectRule = text.match(/(?:for (?:this|the) project|in this project)[,:]?\s*(?:please\s+)?(.+?)(?:[.!?]|$)/i);
  if (projectRule?.[1] && /\b(use|keep|avoid|prefer|must|should|architecture|stack|framework|style)\b/i.test(projectRule[1])) {
    const raw = normalizeSpace(projectRule[1]);
    const record = remember(raw, {
      key: 'project:' + hashText(raw.toLowerCase()),
      kind: 'project',
      scope: 'workspace',
      workspace,
      sourceConversationId,
      confidence: 0.92,
    });
    if (record) captured.push(record);
  }

  return captured;
}

function memoryScore(record: MemoryRecord, queryTokens: string[]): number {
  const haystack = new Set(tokens(record.key + ' ' + record.value));
  let overlap = 0;
  for (const token of queryTokens) {
    if (haystack.has(token)) overlap += 1;
  }

  const daysOld = Math.max(
    0,
    (Date.now() - new Date(record.updatedAt).getTime()) / 86_400_000
  );
  const recency = 1 / (1 + daysOld / 90);
  const kindBoost =
    record.kind === 'profile' ? 1.2 :
    record.kind === 'preference' ? 1.1 :
    record.kind === 'project' ? 1.15 : 1;

  return overlap * 4 + recency * kindBoost + record.confidence;
}

function conversationRecallScore(content: string, queryTokens: string[], updatedAt: Date | string): number {
  const messageTokens = new Set(tokens(content));
  let overlap = 0;
  for (const token of queryTokens) {
    if (messageTokens.has(token)) overlap += 1;
  }
  if (overlap === 0) return 0;

  const ageDays = Math.max(
    0,
    (Date.now() - new Date(updatedAt).getTime()) / 86_400_000
  );
  return overlap * 3 + 1 / (1 + ageDays / 30);
}

export function buildMemoryContext(options: {
  query: string;
  workspace?: string;
  currentConversationId?: string | null;
  conversations?: Record<string, Conversation>;
  maxMemories?: number;
  maxPastChatSnippets?: number;
  maxChars?: number;
}): string {
  const workspace = options.workspace || process.cwd();
  const queryTokens = tokens(options.query);
  const maxMemories = options.maxMemories ?? 10;
  const maxPastChatSnippets = options.maxPastChatSnippets ?? 4;
  const maxChars = options.maxChars ?? 2400;

  const memories = listMemories(workspace)
    .map((record) => ({ record, score: memoryScore(record, queryTokens) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxMemories)
    .map(({ record }) => record);

  const authoritativeTopicTokens = new Set(
    memories
      .filter((record) => record.key.startsWith('profile:') || record.key.startsWith('project:'))
      .flatMap((record) => tokens(record.key.replace(':', ' ')))
  );

  const snippets: Array<{ content: string; score: number; title: string }> = [];
  for (const conversation of Object.values(options.conversations || {})) {
    if (conversation.id === options.currentConversationId) continue;

    for (const message of conversation.messages) {
      if (message.role !== 'user') continue;
      const content = normalizeSpace(message.content);
      if (content.length < 8 || looksSensitive(content)) continue;

      // When we have an authoritative durable profile/project value, avoid
      // resurfacing older chat excerpts about the same recognized subject.
      const contentTokens = new Set(tokens(content));
      if (
        authoritativeTopicTokens.size > 0 &&
        [...authoritativeTopicTokens].some((token) => contentTokens.has(token))
      ) {
        continue;
      }

      const score = conversationRecallScore(content, queryTokens, conversation.updatedAt);
      if (score <= 0) continue;

      snippets.push({
        content: content.slice(0, 500),
        score,
        title: conversation.title,
      });
    }
  }

  snippets.sort((a, b) => b.score - a.score);
  const recalled = snippets.slice(0, maxPastChatSnippets);

  if (memories.length === 0 && recalled.length === 0) return '';

  const lines = [
    'SkyCode cross-chat memory:',
    '- Use memory only when relevant to the current request.',
    '- Newer durable records with the same subject are authoritative.',
    '- Past-chat recalls below are excerpts from USER messages, not verified facts; do not invent details around them.',
    '- Never claim you remember something that is not present here or in the current conversation.',
    '',
  ];

  if (memories.length > 0) {
    lines.push('Durable memory:');
    for (const record of memories) {
      const scope = record.scope === 'workspace' ? 'project' : 'global';
      lines.push('- [' + scope + '/' + record.kind + '] ' + record.value);
    }
    lines.push('');
  }

  if (recalled.length > 0) {
    lines.push('Relevant past-chat recalls:');
    for (const snippet of recalled) {
      lines.push('- [' + snippet.title + '] ' + snippet.content);
    }
  }

  const rendered = lines.join('\n').trim();
  if (rendered.length <= maxChars) return rendered;

  const clipped = rendered.slice(0, Math.max(0, maxChars - 80));
  const lastNewline = clipped.lastIndexOf('\n');
  return (
    (lastNewline > 0 ? clipped.slice(0, lastNewline) : clipped) +
    '\n- [memory context clipped to fit the model context budget]'
  );
}

export function formatMemoryList(workspace = process.cwd()): string {
  const memories = listMemories(workspace);
  if (memories.length === 0) return 'SkyCode memory is empty.';

  return [
    'SkyCode durable memory (' + memories.length + '):',
    '',
    ...memories.map((record, index) =>
      (index + 1) + '. [' + record.scope + '/' + record.kind + '] ' +
      record.value + '\n   key: ' + record.key
    ),
    '',
    'Use /remember <fact> to add memory, /forget <query> to remove matching memory, or /memory clear to clear all durable memory.',
  ].join('\n');
}

export function getMemoryPath(): string {
  return memoryFilePath();
}
