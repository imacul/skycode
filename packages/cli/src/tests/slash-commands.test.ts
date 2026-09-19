import { describe, expect, it } from 'bun:test';
import { SLASH_COMMANDS, validateSlashCommand } from '../utils/slash-commands';

describe('slash command validation', () => {
  it('accepts every public picker command in its base form when valid', () => {
    const commands = SLASH_COMMANDS.map((item) => item.command);

    expect(commands).toContain('/new');
    expect(commands).toContain('/model');
    expect(commands).toContain('/memory');
    expect(commands).toContain('/history');
    expect(commands).toContain('/setup');
    expect(commands).toContain('/doctor');
    expect(commands).toContain('/exit');

    for (const item of SLASH_COMMANDS) {
      if (item.command === '/remember') {
        expect(validateSlashCommand('/remember test fact').ok).toBe(true);
      } else if (item.command === '/forget') {
        expect(validateSlashCommand('/forget test').ok).toBe(true);
      } else {
        expect(validateSlashCommand(item.command).ok).toBe(true);
      }
    }
  });

  it('rejects missing required arguments with usage guidance', () => {
    expect(validateSlashCommand('/remember').error).toBe('Usage: /remember <fact>');
    expect(validateSlashCommand('/forget').error).toBe('Usage: /forget <query>');
    expect(validateSlashCommand('/model search').error).toBe('Usage: /model search <query>');
    expect(validateSlashCommand('/model openrouter:').error).toBe('Usage: /model openrouter:<model-id>');
    expect(validateSlashCommand('/model local:').error).toBe('Usage: /model local:<model-id>');
  });

  it('rejects unknown commands instead of silently doing nothing', () => {
    const result = validateSlashCommand('/totallyfake');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown command');
    expect(result.error).toContain('/help');
  });

  it('normalizes harmless whitespace', () => {
    const result = validateSlashCommand('  /model   search   qwen  ');
    expect(result.ok).toBe(true);
    expect(result.normalized).toBe('/model search qwen');
  });

  it('accepts supported hidden aliases', () => {
    expect(validateSlashCommand('/chats').ok).toBe(true);
    expect(validateSlashCommand('/addopenrouter').ok).toBe(true);
    expect(validateSlashCommand('/openrouter').ok).toBe(true);
  });
});
