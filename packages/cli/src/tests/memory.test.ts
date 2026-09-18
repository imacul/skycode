import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Conversation } from '../store/conversation';
import {
  autoCaptureMemories,
  buildMemoryContext,
  clearMemories,
  forgetMemories,
  listMemories,
  remember,
} from '../store/memory';

let tempDir = '';

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'skycode-memory-'));
  process.env.SKYCODE_MEMORY_PATH = join(tempDir, 'memory.json');
});

afterEach(async () => {
  delete process.env.SKYCODE_MEMORY_PATH;
  await rm(tempDir, { recursive: true, force: true });
});

describe('cross-chat memory', () => {
  it('persists durable memory and retrieves it in a new context', () => {
    remember('I prefer concise technical answers', {
      kind: 'preference',
      key: 'preference:answer-style',
    });

    expect(listMemories()).toHaveLength(1);

    const context = buildMemoryContext({
      query: 'How should you answer me?',
      conversations: {},
    });

    expect(context).toContain('I prefer concise technical answers');
  });

  it('treats corrected profile facts as authoritative instead of duplicating them', () => {
    autoCaptureMemories('My favorite editor is VS Code.', {
      conversationId: 'chat-1',
    });
    autoCaptureMemories('Correction: my favorite editor is Zed.', {
      conversationId: 'chat-2',
    });

    const memories = listMemories();
    expect(memories).toHaveLength(1);
    expect(memories[0].value).toContain('Zed');
    expect(memories[0].sourceConversationId).toBe('chat-2');
  });

  it('keeps project memory scoped to the current workspace', () => {
    const one = join(tempDir, 'one');
    const two = join(tempDir, 'two');

    remember('Use feature-based folders', {
      kind: 'project',
      key: 'project:folders',
      scope: 'workspace',
      workspace: one,
    });

    expect(listMemories(one)).toHaveLength(1);
    expect(listMemories(two)).toHaveLength(0);
  });

  it('recalls relevant user messages from prior conversations but never assistant output', () => {
    const conversation: Conversation = {
      id: 'old-chat',
      title: 'Atlas architecture',
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [
        {
          id: 'u1',
          role: 'user',
          content: 'Atlas uses BullMQ and Redis for conversion jobs.',
          timestamp: new Date(),
        },
        {
          id: 'a1',
          role: 'assistant',
          content: 'Atlas secretly uses RabbitMQ.',
          timestamp: new Date(),
        },
      ],
    };

    const context = buildMemoryContext({
      query: 'What queue does Atlas use?',
      currentConversationId: 'new-chat',
      conversations: { 'old-chat': conversation },
    });

    expect(context).toContain('BullMQ');
    expect(context).not.toContain('RabbitMQ');
  });

  it('rejects likely secrets from durable memory', () => {
    expect(remember('My API key is sk-abcdefghijklmnopqrstuv')).toBeNull();
    expect(listMemories()).toHaveLength(0);
  });

  it('forgets matching records and can clear all memory', () => {
    remember('I prefer dark mode', { key: 'preference:theme', kind: 'preference' });
    remember('I use TypeScript', { key: 'fact:language' });

    expect(forgetMemories('dark mode')).toBe(1);
    expect(listMemories()).toHaveLength(1);
    expect(clearMemories()).toBe(1);
    expect(listMemories()).toHaveLength(0);
  });
});
