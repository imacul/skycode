import { COMMANDS } from './commands';
import type { Command } from './types';

export function getFilteredCommands(query: string): Command[] {
  if (query.length === 0) return COMMANDS;
  return COMMANDS.filter((cmd) =>
    cmd.name.toLowerCase().startsWith(query.toLowerCase())
  );
}
