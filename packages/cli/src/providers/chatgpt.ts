import type { BaseProvider, ProviderConfig, ChatRequestOptions, ChatResponse, ChatStreamChunk, ModelInfo } from './base';
import { getChatGPTAccessToken, hasChatGPTPlan } from '../auth/chatgpt';

const API = 'https://api.openai.com/v1';
type ResponseEvent = { type: string; delta?: string; response?: { error?: { code?: string; message?: string }; usage?: { input_tokens?: number; output_tokens?: number } } };

export class ChatGPTPlanProvider implements BaseProvider {
  readonly name = 'chatgpt';
  private config: ProviderConfig = {};
  async initialize(config: ProviderConfig): Promise<void> { this.config = config; }
  isConfigured(): boolean { return hasChatGPTPlan(); }
  getConfig(): ProviderConfig { return { ...this.config }; }
  async validateApiKey(): Promise<boolean> { return false; }
  async close(): Promise<void> {}
  async listModels(): Promise<ModelInfo[]> {
    const token = await getChatGPTAccessToken();
    const response = await fetch(API + '/models', {
      headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error('ChatGPT model catalog failed (HTTP ' + response.status + ')');
    const data = await response.json() as { models?: Array<{ slug: string; display_name?: string; visibility?: string }> };
    return (data.models || []).filter(m => m.visibility === 'list').map(m => ({
      id: m.slug, name: m.display_name || m.slug, description: 'ChatGPT plan model',
      contextLength: 8192, tags: ['chatgpt', 'subscription'],
    }));
  }
  async getModel(id: string): Promise<ModelInfo | undefined> {
    return (await this.listModels()).find(m => m.id === id);
  }
  async chat(request: ChatRequestOptions): Promise<ChatResponse> {
    let content = '', finishReason = '';
    await this.chatStream(request, chunk => {
      content += chunk.content;
      if (chunk.finishReason) finishReason = chunk.finishReason;
    });
    return { content, model: request.model || this.config.model || '', finishReason: finishReason || 'stop' };
  }
  async chatStream(request: ChatRequestOptions, onChunk: (chunk: ChatStreamChunk) => void): Promise<void> {
    const model = request.model || this.config.model;
    if (!model) throw new Error('Select a ChatGPT plan model first.');
    const token = await getChatGPTAccessToken();
    const response = await fetch(API + '/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        model, input: request.messages.map(m => ({ role: m.role, content: m.content })),
        store: false, stream: true,
      }),
      signal: AbortSignal.timeout(Number(request.timeout || this.config.timeout || 600000)),
    });
    if (!response.ok) throw new Error('ChatGPT plan inference failed (HTTP ' + response.status + ').');
    if (!response.body) throw new Error('ChatGPT plan response stream unavailable.');
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '', completed = false;
    const parseFrame = (frame: string) => {
      const raw = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!raw || raw === '[DONE]') return;
      let event: ResponseEvent;
      try { event = JSON.parse(raw) as ResponseEvent; } catch { throw new Error('Malformed ChatGPT response event.'); }
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') onChunk({ content: event.delta });
      if (event.type === 'response.failed') throw new Error('ChatGPT plan response failed: ' + (event.response?.error?.code || event.response?.error?.message || 'unknown'));
      if (event.type === 'response.incomplete' || event.type === 'error') throw new Error('ChatGPT plan response incomplete or interrupted.');
      if (event.type === 'response.completed') {
        completed = true;
        const usage = event.response?.usage;
        onChunk({ content: '', finishReason: 'stop', usage: usage ? {
          promptTokens: usage.input_tokens || 0,
          completionTokens: usage.output_tokens || 0,
          totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
        } : undefined });
      }
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let index: number;
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          parseFrame(frame);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) parseFrame(buffer);
      if (!completed) throw new Error('ChatGPT plan stream ended without response.completed.');
    } finally { reader.releaseLock(); }
  }
}

export function createChatGPTPlanProvider(): BaseProvider { return new ChatGPTPlanProvider(); }
