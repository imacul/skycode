// Tests for utilities
import { describe, it, expect } from 'bun:test';
import {
  estimateTokens,
  countMessageTokens,
  formatTokenCount,
  getModelTokenBudget,
  checkTokenBudget,
  truncateMessagesToFit,
  SimpleTokenizer,
  countTokensBatch,
  calculateCost,
  formatCost,
} from '../utils/tokens';
import { AIStream, collectStream, collectStreamToString } from '../utils/stream';

describe('Token Utilities', () => {
  describe('estimateTokens', () => {
    it('should estimate tokens for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('should estimate tokens for short text', () => {
      const tokens = estimateTokens('Hello, World!');
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    it('should estimate tokens for longer text', () => {
      const text = 'This is a longer sentence that should have more tokens.';
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should estimate tokens with model', () => {
      const tokens = estimateTokens('Hello', 'gpt-4');
      expect(tokens).toBeGreaterThan(0);
    });

    it('should return 0 for null/undefined', () => {
      expect(estimateTokens(null as unknown as string)).toBe(0);
      expect(estimateTokens(undefined as unknown as string)).toBe(0);
    });
  });

  describe('countMessageTokens', () => {
    it('should count tokens for messages', () => {
      const messages = [
        { role: 'user', content: 'Hello!' },
        { role: 'assistant', content: 'Hi there!' },
      ];
      const count = countMessageTokens(messages);
      expect(count).toBeGreaterThan(0);
    });

    it('should count tokens for empty messages', () => {
      const count = countMessageTokens([]);
      expect(count).toBe(0);
    });

    it('should count tokens with model', () => {
      const messages = [{ role: 'user', content: 'Hello!' }];
      const count = countMessageTokens(messages, 'gpt-4');
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('formatTokenCount', () => {
    it('should format small count', () => {
      expect(formatTokenCount(100)).toBe('100 tokens');
    });

    it('should format thousands', () => {
      const formatted = formatTokenCount(1500);
      expect(formatted).toContain('1.5K');
    });

    it('should format millions', () => {
      const formatted = formatTokenCount(2500000);
      expect(formatted).toContain('2.5M');
    });
  });

  describe('getModelTokenBudget', () => {
    it('should return budget for known model', () => {
      const budget = getModelTokenBudget('gpt-4');
      expect(budget.total).toBeGreaterThan(0);
      expect(budget.prompt).toBeGreaterThan(0);
      expect(budget.completion).toBeGreaterThan(0);
    });

    it('should return default budget for unknown model', () => {
      const budget = getModelTokenBudget('unknown-model');
      expect(budget.total).toBeGreaterThan(0);
    });

    it('should return budget for Llama 3.1 70B', () => {
      const budget = getModelTokenBudget('meta-llama/llama-3.1-70b-instruct');
      expect(budget.total).toBe(128000);
    });

    it('should return budget for Mistral 7B', () => {
      const budget = getModelTokenBudget('mistralai/mistral-7b-instruct');
      expect(budget.total).toBe(32000);
    });
  });

  describe('checkTokenBudget', () => {
    it('should check within budget', () => {
      const messages = [{ role: 'user', content: 'Hello!' }];
      const result = checkTokenBudget(messages, 'gpt-4', 10000);
      expect(result.withinBudget).toBe(true);
    });

    it('should check over budget', () => {
      const messages = [{ role: 'user', content: 'A'.repeat(100000) }];
      const result = checkTokenBudget(messages, 'gpt-4', 100);
      expect(result.withinBudget).toBe(false);
    });

    it('should return correct token counts', () => {
      const messages = [{ role: 'user', content: 'Hello!' }];
      const result = checkTokenBudget(messages, 'gpt-4');
      expect(result.promptTokens).toBeGreaterThan(0);
      expect(result.maxPromptTokens).toBeGreaterThan(0);
    });
  });

  describe('truncateMessagesToFit', () => {
    it('should not truncate within budget', () => {
      const messages = [{ role: 'user', content: 'Hello!' }];
      const result = truncateMessagesToFit(messages, 'gpt-4', 1000);
      expect(result.length).toBe(1);
      expect(result[0].content).toBe('Hello!');
    });

    it('should truncate messages', () => {
      const messages = [
        { role: 'user', content: 'A'.repeat(1000) },
        { role: 'assistant', content: 'B'.repeat(1000) },
        { role: 'user', content: 'C'.repeat(1000) },
      ];
      const result = truncateMessagesToFit(messages, 'gpt-4', 100);
      expect(result.length).toBeLessThan(3);
    });

    it('should include system message', () => {
      const systemMessage = { role: 'system', content: 'System prompt' };
      const messages = [{ role: 'user', content: 'Hello!' }];
      const result = truncateMessagesToFit(messages, 'gpt-4', 100, systemMessage);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('SimpleTokenizer', () => {
    it('should count tokens', () => {
      const tokenizer = new SimpleTokenizer('gpt-4');
      const count = tokenizer.count('Hello, World!');
      expect(count).toBeGreaterThan(0);
    });

    it('should encode text', () => {
      const tokenizer = new SimpleTokenizer();
      const encoded = tokenizer.encode('Hello');
      expect(Array.isArray(encoded)).toBe(true);
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should use different models', () => {
      const tokenizer1 = new SimpleTokenizer('gpt-4');
      const tokenizer2 = new SimpleTokenizer('llama3.1:70b-instruct');
      const count1 = tokenizer1.count('Hello');
      const count2 = tokenizer2.count('Hello');
      // Both should be similar for short text
      expect(Math.abs(count1 - count2)).toBeLessThan(2);
    });
  });

  describe('countTokensBatch', () => {
    it('should count tokens for multiple texts', () => {
      const texts = ['Hello!', 'World!', 'Test!'];
      const counts = countTokensBatch(texts);
      expect(counts.length).toBe(3);
      expect(counts.every(c => c > 0)).toBe(true);
    });

    it('should count with model', () => {
      const texts = ['Hello!'];
      const counts = countTokensBatch(texts, 'gpt-4');
      expect(counts.length).toBe(1);
      expect(counts[0]).toBeGreaterThan(0);
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost for OpenRouter model', () => {
      const cost = calculateCost(1000, 2000, 'meta-llama/llama-3.1-70b-instruct');
      expect(cost).toBeGreaterThan(0);
    });

    it('should calculate cost for unknown model', () => {
      const cost = calculateCost(1000, 2000, 'unknown-model');
      expect(cost).toBeGreaterThan(0);
    });

    it('should calculate zero cost for zero tokens', () => {
      const cost = calculateCost(0, 0, 'gpt-4');
      expect(cost).toBe(0);
    });
  });

  describe('formatCost', () => {
    it('should format small cost', () => {
      expect(formatCost(0.001)).toBe('$0.00');
    });

    it('should format less than cent', () => {
      expect(formatCost(0.0001)).toBe('<$0.01');
    });

    it('should format dollar amount', () => {
      expect(formatCost(1.5)).toBe('$1.50');
    });

    it('should format large amount', () => {
      expect(formatCost(100.25)).toBe('$100.25');
    });
  });
});

describe('Stream Utilities', () => {
  describe('AIStream', () => {
    it('should create stream', () => {
      const stream = new AIStream();
      expect(stream.isClosed()).toBe(false);
    });

    it('should write to stream', async () => {
      const stream = new AIStream();
      stream.write('Hello');
      stream.write('World');
      
      const reader = stream.getStream().getReader();
      const { value: chunk1 } = await reader.read();
      const { value: chunk2 } = await reader.read();
      
      expect(chunk1).toBe('Hello');
      expect(chunk2).toBe('World');
    });

    it('should close stream', async () => {
      const stream = new AIStream();
      stream.close();
      expect(stream.isClosed()).toBe(true);
    });

    it('should error stream', async () => {
      const stream = new AIStream();
      const error = new Error('Test error');
      stream.error(error);
      expect(stream.isClosed()).toBe(true);
    });

    it('should not write after close', () => {
      const stream = new AIStream();
      stream.close();
      stream.write('Should not appear');
      expect(stream.isClosed()).toBe(true);
    });
  });

  describe('collectStream', () => {
    it('should collect all chunks', async () => {
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('chunk1');
          controller.enqueue('chunk2');
          controller.enqueue('chunk3');
          controller.close();
        },
      });

      const chunks = await collectStream(stream);
      expect(chunks).toEqual(['chunk1', 'chunk2', 'chunk3']);
    });

    it('should collect empty stream', async () => {
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.close();
        },
      });

      const chunks = await collectStream(stream);
      expect(chunks).toEqual([]);
    });
  });

  describe('collectStreamToString', () => {
    it('should concatenate chunks', async () => {
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue('Hello');
          controller.enqueue(' ');
          controller.enqueue('World');
          controller.close();
        },
      });

      const result = await collectStreamToString(stream);
      expect(result).toBe('Hello World');
    });

    it('should handle empty stream', async () => {
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.close();
        },
      });

      const result = await collectStreamToString(stream);
      expect(result).toBe('');
    });
  });
});
