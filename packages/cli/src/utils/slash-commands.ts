export type SlashCommand = {
  command: string;
  description: string;
  takesArgs?: boolean;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/new', description: 'Start a new conversation' },
  { command: '/model', description: 'Show models or switch model', takesArgs: true },
  { command: '/memory', description: 'Show durable cross-chat memory', takesArgs: true },
  { command: '/remember', description: 'Save a durable memory', takesArgs: true },
  { command: '/forget', description: 'Forget matching durable memory', takesArgs: true },
  { command: '/addlocal', description: 'Add or update a local AI server' },
  { command: '/addcloud', description: 'Add a cloud AI provider' },
  { command: '/openroute', description: 'Add or update OpenRouter' },
  { command: '/history', description: 'Show saved conversations' },
  { command: '/resume', description: 'Resume a saved conversation', takesArgs: true },
  { command: '/copy', description: 'Copy the latest assistant reply' },
  { command: '/cancel', description: 'Cancel the active generation' },
  { command: '/clear', description: 'Clear the current conversation' },
  { command: '/setup', description: 'Configure providers' },
  { command: '/doctor', description: 'Check command/provider/storage health' },
  { command: '/help', description: 'Show available commands' },
  { command: '/exit', description: 'Exit SkyCode' },
];

const EXACT_COMMANDS = new Set([
  '/new',
  '/addlocal',
  '/addcloud',
  '/openroute',
  '/addopenrouter',
  '/openrouter',
  '/history',
  '/chats',
  '/copy',
  '/cancel',
  '/clear',
  '/setup',
  '/doctor',
  '/help',
  '/exit',
]);

export interface SlashValidation {
  ok: boolean;
  normalized: string;
  error?: string;
}

export function validateSlashCommand(raw: string): SlashValidation {
  const normalized = raw.trim().replace(/\s+/g, ' ');
  if (!normalized.startsWith('/')) {
    return { ok: false, normalized, error: 'Slash commands must start with /.' };
  }

  if (EXACT_COMMANDS.has(normalized)) {
    return { ok: true, normalized };
  }

  if (normalized === '/memory' || normalized === '/memory clear') {
    return { ok: true, normalized };
  }

  if (normalized === '/remember') {
    return {
      ok: false,
      normalized,
      error: 'Usage: /remember <fact>',
    };
  }

  if (normalized.startsWith('/remember ')) {
    return normalized.slice('/remember '.length).trim()
      ? { ok: true, normalized }
      : { ok: false, normalized, error: 'Usage: /remember <fact>' };
  }

  if (normalized === '/forget') {
    return {
      ok: false,
      normalized,
      error: 'Usage: /forget <query>',
    };
  }

  if (normalized.startsWith('/forget ')) {
    return normalized.slice('/forget '.length).trim()
      ? { ok: true, normalized }
      : { ok: false, normalized, error: 'Usage: /forget <query>' };
  }

  if (normalized === '/resume' || normalized.startsWith('/resume ')) {
    return { ok: true, normalized };
  }

  if (normalized === '/model') {
    return { ok: true, normalized };
  }

  if (normalized === '/model search') {
    return {
      ok: false,
      normalized,
      error: 'Usage: /model search <query>',
    };
  }

  if (normalized.startsWith('/model search ')) {
    return normalized.slice('/model search '.length).trim()
      ? { ok: true, normalized }
      : { ok: false, normalized, error: 'Usage: /model search <query>' };
  }

  if (normalized === '/model openrouter:' || normalized === '/model local:') {
    return {
      ok: false,
      normalized,
      error: normalized.startsWith('/model openrouter:')
        ? 'Usage: /model openrouter:<model-id>'
        : 'Usage: /model local:<model-id>',
    };
  }

  if (normalized.startsWith('/model ')) {
    const selector = normalized.slice('/model '.length).trim();
    if (!selector) {
      return { ok: false, normalized, error: 'Usage: /model <model-id>' };
    }
    return { ok: true, normalized };
  }

  return {
    ok: false,
    normalized,
    error: 'Unknown command: ' + normalized + '. Use /help to see supported commands.',
  };
}

export function slashCommandRoots(): string[] {
  return [...new Set(SLASH_COMMANDS.map((item) => item.command))];
}
