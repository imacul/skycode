import { describe, expect, it } from 'bun:test';
import {
  getVisibleConversationMessages,
  isInternalSystemMessage,
  type Message,
} from '../store/conversation';

function message(role: Message['role'], content: string, visibility?: 'chat' | 'internal'): Message {
  return {
    id: role + '-' + content.slice(0, 8),
    role,
    content,
    timestamp: new Date(),
    metadata: visibility ? { visibility } : undefined,
  };
}

describe('conversation visibility', () => {
  it('hides internal system prompts from the chat transcript', () => {
    const internal = message(
      'system',
      [
        'You are a helpful AI coding assistant.',
        '',
        'Identity and provenance rules:',
        '- You are an AI assistant running inside SkyCode.',
      ].join('\n')
    );

    expect(isInternalSystemMessage(internal)).toBe(true);
    expect(getVisibleConversationMessages([internal])).toEqual([]);
  });

  it('keeps user-facing system command output visible', () => {
    const help = message('system', 'Available commands:\n/help\n/model');
    const doctor = message('system', 'SkyCode doctor\nSlash commands: OK');

    expect(getVisibleConversationMessages([help, doctor])).toEqual([help, doctor]);
  });

  it('supports explicit internal visibility metadata', () => {
    const hidden = message('system', 'internal context', 'internal');
    expect(isInternalSystemMessage(hidden)).toBe(true);
  });

  it('keeps ordinary user and assistant chat visible', () => {
    const user = message('user', 'Hello');
    const assistant = message('assistant', 'Hi');

    expect(getVisibleConversationMessages([user, assistant])).toEqual([user, assistant]);
  });
});
