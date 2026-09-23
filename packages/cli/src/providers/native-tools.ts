/**
 * Turn provider-native tool calls into SkyCode's text tool envelope.
 * Models often stop the visible message and put the real action in
 * tool_calls / tool_use. Without this, the agent loop sees an empty reply
 * and ends the task.
 */
export function appendNativeToolCalls(content: string, message: unknown): string {
  const rendered = renderNativeToolCalls(message);
  const visible = content || '';
  if (!rendered) return visible;
  return [visible.trim(), rendered].filter(Boolean).join('\n');
}

function renderNativeToolCalls(message: unknown): string {
  if (!message || typeof message !== 'object') return '';

  const record = message as {
    tool_calls?: unknown;
    content?: unknown;
  };
  const chunks: string[] = [];

  if (Array.isArray(record.tool_calls)) {
    for (const call of record.tool_calls) {
      chunks.push(renderCall(call));
    }
  }

  if (Array.isArray(record.content)) {
    for (const block of record.content) {
      if (!block || typeof block !== 'object') continue;
      const toolUse = block as { type?: string; name?: string; input?: unknown };
      if (toolUse.type === 'tool_use' && typeof toolUse.name === 'string') {
        chunks.push(envelope(toolUse.name, toolUse.input));
      }
    }
  }

  return chunks.filter(Boolean).join('\n');
}

function renderCall(call: unknown): string {
  if (!call || typeof call !== 'object') return '';
  const record = call as {
    name?: string;
    input?: unknown;
    arguments?: unknown;
    function?: { name?: string; arguments?: unknown };
  };
  const name = record.function?.name || record.name;
  if (typeof name !== 'string' || name.length === 0) return '';
  const args = record.function?.arguments ?? record.arguments ?? record.input ?? {};
  return envelope(name, args);
}

function envelope(name: string, args: unknown): string {
  let parsed: unknown = args;
  if (typeof args === 'string') {
    try {
      parsed = JSON.parse(args);
    } catch {
      parsed = { command: args };
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    parsed = {};
  }
  return '<tool_call>' + JSON.stringify({ name, args: parsed }) + '</tool_call>';
}
