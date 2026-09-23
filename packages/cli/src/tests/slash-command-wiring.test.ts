import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SLASH_COMMANDS } from '../utils/slash-commands';

const repoRoot = resolve(import.meta.dir, '../../../../');
const indexSource = readFileSync(resolve(repoRoot, 'packages/cli/src/index.tsx'), 'utf8');

const HANDLER_MARKERS: Record<string, string[]> = {
  '/new': ["command === '/new'"],
  '/model': ["command === '/model'", "command.startsWith('/model ')"],
  '/memory': ["command === '/memory'", "command === '/memory clear'"],
  '/remember': ["command.startsWith('/remember ')"],
  '/forget': ["command.startsWith('/forget ')"],
  '/addlocal': ["command === '/addlocal'"],
  '/addcloud': ["command === '/addcloud'"],
  '/openroute': ["command === '/openroute'"],
  '/history': ["command === '/history'"],
  '/resume': ["command === '/resume'", "command.startsWith('/resume ')"],
  '/copy': ["command === '/copy'"],
  '/cancel': ["command === '/cancel'"],
  '/clear': ["command === '/clear'"],
  '/setup': ["command === '/setup'"],
  '/doctor': ["command === '/doctor'"],
  '/permissions': ["command === '/permissions'"],
  '/servers': ["command === '/servers'", "command === '/servers stop'", "command.startsWith('/servers stop ')"],
  '/help': ["command === '/help'"],
  '/exit': ["command === '/exit'"],
};

describe('slash command wiring', () => {
  it('has an execution path for every public slash command', () => {
    for (const item of SLASH_COMMANDS) {
      const markers = HANDLER_MARKERS[item.command];
      expect(markers, 'missing wiring markers for ' + item.command).toBeDefined();

      for (const marker of markers) {
        expect(indexSource.includes(marker), item.command + ' is missing handler marker ' + marker).toBe(true);
      }
    }
  });

  it('contains unexpected command failures instead of rejecting the event handler promise', () => {
    expect(indexSource).toContain("handleCommand(command).catch((commandError)");
    expect(indexSource).toContain('Command failed safely: ');
  });
});
