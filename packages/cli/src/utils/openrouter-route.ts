import { spawn } from 'node:child_process';

export const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/settings/credits';

export function openCreditsPage(): void {
  const url = OPENROUTER_CREDITS_URL;
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    }).unref();
    return;
  }

  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(command, [url], { detached: true, stdio: 'ignore' }).unref();
}

export interface RoutableModel {
  id: string;
  contextLength: number;
  promptPrice: number;
  completionPrice: number;
}

export interface OpenRouterKeyStatus {
  limitRemaining: number | null;
  usage: number;
  usageDaily: number;
  freeRequestsRemaining: number | null;
  freeRequestsLimit: number | null;
}

export function taskNeedsStrongerModel(input: string, taskKind?: string): boolean {
  if (taskKind === 'workspace') return true;
  const text = input.toLowerCase();
  const hardWork = /\b(build|create|implement|refactor|debug|fix|test|architect|scaffold)\b/;
  const software = /\b(project|app|code|file|files|test|repo|api|website)\b/;
  return hardWork.test(text) && software.test(text);
}

export function failureNeedsLongerContext(message: string): number | null {
  const match = message.match(/context length \((\d+)\s*tokens\)/i);
  if (match) return Number(match[1]) + 1;
  if (/context length|maximum context|too many tokens/i.test(message)) return 262145;
  return null;
}

export function failureIsRateLimit(message: string): boolean {
  return /rate limit|too many requests|\b429\b/i.test(message);
}

export function accountCanUsePaidModels(status: OpenRouterKeyStatus | null): boolean {
  if (!status) return false;
  if (typeof status.limitRemaining === 'number' && status.limitRemaining > 0) return true;
  if ((status.freeRequestsLimit || 0) >= 1000) return true;
  return status.usage > 0 && status.limitRemaining !== 0;
}

function isStrongCodingModel(id: string): boolean {
  return /code|coder|sonnet|opus|gpt-5|gpt-4|gemini|deepseek|qwen|grok|claude/i.test(id);
}

export function chooseOpenRouterModel(options: {
  currentId: string;
  models: RoutableModel[];
  allowPaid: boolean;
  minimumContext?: number;
  preferStronger?: boolean;
}): { id: string; reason: string } | null {
  const minimum = options.minimumContext || (options.preferStronger ? 64000 : 0);
  const current = options.models.find((model) => model.id === options.currentId);
  const currentFits = !current || current.contextLength >= minimum || current.contextLength === 0;
  const knownFree =
    options.currentId.endsWith(':free') ||
    (!!current && current.promptPrice <= 0 && current.completionPrice <= 0);

  // A paid model that already fits stays selected. Auto-switch is for free
  // models and for models that cannot hold the current request.
  if (!knownFree && currentFits) return null;

  if (!options.preferStronger && currentFits) return null;

  const paid = options.models.filter(
    (model) => model.promptPrice > 0 || model.completionPrice > 0
  );
  const pool = (options.allowPaid ? paid : options.models.filter((model) => model.promptPrice === 0))
    .filter((model) => model.id !== options.currentId)
    .filter((model) => model.contextLength === 0 || model.contextLength >= minimum);

  if (pool.length === 0) return null;

  const ranked = [...pool].sort((a, b) => {
    const strongDelta = Number(isStrongCodingModel(b.id)) - Number(isStrongCodingModel(a.id));
    if (options.preferStronger && strongDelta !== 0) return strongDelta;
    const contextDelta = b.contextLength - a.contextLength;
    if (!currentFits && contextDelta !== 0) return contextDelta;
    return a.promptPrice - b.promptPrice;
  });

  const next = ranked[0];
  if (!next) return null;

  const why = !currentFits
    ? 'the current model ran out of context'
    : options.currentId.endsWith(':free')
      ? 'this task needs a stronger paid model than the free tier'
      : 'a better-fitting paid model is available';

  return {
    id: next.id,
    reason: 'SkyCode switched to ' + next.id + ' because ' + why + '.',
  };
}

export function formatCreditsGuide(status: OpenRouterKeyStatus | null, error?: string): string {
  const lines = [
    'OpenRouter credits',
    '',
    'One OpenRouter balance pays every paid model on this key. You do not buy a separate wallet for each AI provider.',
  ];

  if (error) {
    lines.push('', 'Could not read the key: ' + error);
  } else if (status) {
    lines.push(
      '',
      status.limitRemaining === null
        ? 'Key spending cap: none'
        : 'Key credits remaining: $' + status.limitRemaining.toFixed(2),
      'Used today: $' + status.usageDaily.toFixed(4),
      'Used all time: $' + status.usage.toFixed(4)
    );
    if (status.freeRequestsLimit !== null) {
      lines.push(
        'Free-model requests left today: ' +
          String(status.freeRequestsRemaining ?? 0) +
          ' of ' +
          String(status.freeRequestsLimit)
      );
    }
  }

  lines.push(
    '',
    'Add credits here: ' + OPENROUTER_CREDITS_URL,
    'Buy at least $10 once. That raises the free-model cap from 50 requests a day to 1,000.',
    'For a coding session that should not stop, turn on Auto Top-Up on that page: when credits are below $10, purchase $25.',
    'After the balance is above zero, SkyCode can switch a hard task from a free model to a paid one automatically.'
  );

  return lines.join('\n');
}

export async function fetchOpenRouterKeyStatus(
  apiKey: string,
  baseUrl = 'https://openrouter.ai/api/v1'
): Promise<OpenRouterKeyStatus> {
  const root = baseUrl.replace(/\/$/, '').replace(/\/chat\/completions$/, '');
  const response = await fetch(root + '/key', {
    headers: { Authorization: 'Bearer ' + apiKey },
  });
  if (!response.ok) {
    throw new Error('OpenRouter key check failed (' + response.status + ').');
  }
  return parseOpenRouterKey(await response.json());
}

export function parseOpenRouterKey(payload: unknown): OpenRouterKeyStatus {
  const data = (payload as { data?: Record<string, unknown> })?.data || {};
  const free = data.free_tier as
    | { requests_remaining?: number; requests_limit?: number }
    | undefined;
  const daily = data.free_model_daily_requests as
    | { remaining?: number; limit?: number }
    | undefined;

  return {
    limitRemaining:
      typeof data.limit_remaining === 'number' ? data.limit_remaining : null,
    usage: typeof data.usage === 'number' ? data.usage : 0,
    usageDaily: typeof data.usage_daily === 'number' ? data.usage_daily : 0,
    freeRequestsRemaining:
      typeof daily?.remaining === 'number'
        ? daily.remaining
        : typeof free?.requests_remaining === 'number'
          ? free.requests_remaining
          : null,
    freeRequestsLimit:
      typeof daily?.limit === 'number'
        ? daily.limit
        : typeof free?.requests_limit === 'number'
          ? free.requests_limit
          : null,
  };
}
