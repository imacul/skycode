import type { Message } from '../store/conversation';

const MESSAGE_OVERHEAD_TOKENS = 6;

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateMessageTokens(message: Pick<Message, 'role' | 'content'>): number {
  return MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.content);
}

export function estimateMessagesTokens(messages: Array<Pick<Message, 'role' | 'content'>>): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

export interface ContextBudget {
  contextWindow: number;
  responseReserve: number;
  systemReserve: number;
  currentInputTokens: number;
  historyBudget: number;
}

export function createContextBudget(
  contextWindow: number,
  currentInput: string,
  options: {
    responseReserve?: number;
    systemReserve?: number;
  } = {}
): ContextBudget {
  const safeWindow = Math.max(1024, Math.floor(contextWindow || 8192));
  const responseReserve =
    options.responseReserve ??
    Math.min(2048, Math.max(384, Math.floor(safeWindow * 0.25)));
  const systemReserve =
    options.systemReserve ??
    Math.min(1024, Math.max(384, Math.floor(safeWindow * 0.2)));
  const currentInputTokens = estimateTextTokens(currentInput) + MESSAGE_OVERHEAD_TOKENS;
  const historyBudget = Math.max(
    0,
    safeWindow - responseReserve - systemReserve - currentInputTokens
  );

  return {
    contextWindow: safeWindow,
    responseReserve,
    systemReserve,
    currentInputTokens,
    historyBudget,
  };
}

export interface HistoryFitResult {
  messages: Message[];
  droppedCount: number;
  estimatedTokens: number;
}

export function fitHistoryToBudget(messages: Message[], tokenBudget: number): HistoryFitResult {
  if (tokenBudget <= 0 || messages.length === 0) {
    return {
      messages: [],
      droppedCount: messages.length,
      estimatedTokens: 0,
    };
  }

  const selected: Message[] = [];
  let used = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const cost = estimateMessageTokens(message);

    if (selected.length > 0 && used + cost > tokenBudget) {
      break;
    }

    // Always keep the newest message even if it is large. The provider can then
    // return a useful error for a single oversized turn instead of silently
    // dropping the user's most recent context.
    selected.unshift(message);
    used += cost;

    if (used >= tokenBudget) break;
  }

  return {
    messages: selected,
    droppedCount: Math.max(0, messages.length - selected.length),
    estimatedTokens: used,
  };
}
