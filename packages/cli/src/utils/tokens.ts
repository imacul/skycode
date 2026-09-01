// Token counting and estimation utilities

/**
 * Token estimation for different models
 * Note: These are approximations. Actual token counts may vary by model.
 */

// Common tokenizers' average bytes per token
const BYTES_PER_TOKEN: Record<string, number> = {
  // OpenAI models
  'gpt-4': 4,
  'gpt-4o': 4,
  'gpt-4o-mini': 4,
  'gpt-3.5-turbo': 4,
  
  // Llama models
  'meta-llama/llama-3.1-70b-instruct': 4,
  'meta-llama/llama-3.1-8b-instruct': 4,
  'meta-llama/llama-3-70b-instruct': 4,
  'meta-llama/llama-3-8b-instruct': 4,
  
  // Mistral models
  'mistralai/mistral-7b-instruct': 4,
  'mistralai/mixtral-8x7b-instruct': 4,
  
  // Gemma models
  'google/gemma-7b-it': 4,
  'google/gemma-2b-it': 4,
  
  // Phi models
  'phi-3-mini-4k-instruct': 4,
  'phi-3-small-8k-instruct': 4,
  
  // Default
  'default': 4,
};

// Characters per token for different languages/content types
const CHARS_PER_TOKEN: Record<string, number> = {
  // English text
  english: 4,
  text: 4,
  
  // Code (varies by language)
  javascript: 3.5,
  typescript: 3.5,
  python: 3.8,
  java: 3.2,
  c: 3,
  cpp: 3,
  csharp: 3.2,
  go: 3.5,
  rust: 3.3,
  ruby: 3.7,
  php: 3.6,
  swift: 3.4,
  kotlin: 3.4,
  
  // Markup
  html: 3.8,
  xml: 3.8,
  json: 3.5,
  yaml: 3.5,
  
  // Other
  markdown: 3.8,
  sql: 3.5,
};

/**
 * Estimate tokens from text
 * @param text - The text to estimate
 * @param model - Optional model identifier for more accurate estimation
 * @returns Estimated token count
 */
export function estimateTokens(text: string, model?: string): number {
  if (!text || text.length === 0) return 0;
  
  // Get bytes per token for the model
  const bytesPerToken = BYTES_PER_TOKEN[model || 'default'] || 4;
  
  // Get the byte length of the text
  const byteLength = new TextEncoder().encode(text).length;
  
  // Estimate tokens
  return Math.ceil(byteLength / bytesPerToken);
}

/**
 * Estimate tokens for code
 * @param code - The code to estimate
 * @param language - The programming language
 * @returns Estimated token count
 */
export function estimateCodeTokens(code: string, language: string = 'text'): number {
  if (!code || code.length === 0) return 0;
  
  const charsPerToken = CHARS_PER_TOKEN[language.toLowerCase()] || CHARS_PER_TOKEN.text;
  return Math.ceil(code.length / charsPerToken);
}

/**
 * Count tokens in an array of messages
 */
export interface Message {
  role: string;
  content: string;
}

export function countMessageTokens(messages: Message[], model?: string): number {
  return messages.reduce((total, msg) => {
    // Role adds a few tokens
    const roleTokens = estimateTokens(msg.role, model);
    const contentTokens = estimateTokens(msg.content, model);
    return total + roleTokens + contentTokens;
  }, 0);
}

/**
 * Format token count for display
 */
export function formatTokenCount(count: number): string {
  if (count < 1000) {
    return `${count} tokens`;
  }
  if (count < 1000000) {
    return `${(count / 1000).toFixed(1)}K tokens`;
  }
  return `${(count / 1000000).toFixed(1)}M tokens`;
}

/**
 * Token budget for different contexts
 */
export interface TokenBudget {
  prompt: number;
  completion: number;
  total: number;
}

/**
 * Get token budget for a model
 * Returns conservative estimates for open-weight models
 */
export function getModelTokenBudget(model: string): TokenBudget {
  // Known model context lengths
  const contextLengths: Record<string, number> = {
    // OpenAI
    'gpt-4': 128000,
    'gpt-4o': 128000,
    'gpt-4o-mini': 128000,
    'gpt-3.5-turbo': 16384,
    
    // Llama 3.1
    'meta-llama/llama-3.1-70b-instruct': 128000,
    'meta-llama/llama-3.1-8b-instruct': 128000,
    
    // Llama 3
    'meta-llama/llama-3-70b-instruct': 8192,
    'meta-llama/llama-3-8b-instruct': 8192,
    
    // Mistral
    'mistralai/mistral-7b-instruct': 32000,
    'mistralai/mixtral-8x7b-instruct': 32000,
    
    // Gemma
    'google/gemma-7b-it': 8192,
    'google/gemma-2b-it': 8192,
    
    // Phi-3
    'phi-3-mini-4k-instruct': 4096,
    'phi-3-small-8k-instruct': 8192,
    
    // OpenChat
    'openchat/openchat-7b': 8192,
  };
  
  const contextLength = contextLengths[model] || 8192;
  
  // Reserve some tokens for the response
  // Use 80% for prompt, 20% for completion as a safe default
  return {
    prompt: Math.floor(contextLength * 0.8),
    completion: Math.floor(contextLength * 0.2),
    total: contextLength,
  };
}

/**
 * Check if prompt exceeds token budget
 */
export function checkTokenBudget(
  messages: Message[],
  model: string,
  maxTokens?: number
): { 
  withinBudget: boolean;
  promptTokens: number;
  maxPromptTokens: number;
  remainingTokens: number;
} {
  const budget = getModelTokenBudget(model);
  const promptTokens = countMessageTokens(messages, model);
  
  const maxPromptTokens = maxTokens || budget.prompt;
  const withinBudget = promptTokens <= maxPromptTokens;
  const remainingTokens = Math.max(0, maxPromptTokens - promptTokens);
  
  return {
    withinBudget,
    promptTokens,
    maxPromptTokens,
    remainingTokens,
  };
}

/**
 * Truncate messages to fit within token budget
 */
export function truncateMessagesToFit(
  messages: Message[],
  model: string,
  maxTokens: number,
  systemMessage?: Message
): Message[] {
  const budget = checkTokenBudget(messages, model, maxTokens);
  
  if (budget.withinBudget) {
    return messages;
  }
  
  // Start with system message if provided
  const result: Message[] = systemMessage ? [systemMessage] : [];
  let remainingTokens = maxTokens - (systemMessage ? estimateTokens(systemMessage.content, model) : 0);
  
  // Add messages from the end (most recent first)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgTokens = estimateTokens(msg.content, model) + estimateTokens(msg.role, model);
    
    if (msgTokens <= remainingTokens) {
      result.unshift(msg);
      remainingTokens -= msgTokens;
    } else {
      // Try to truncate the message
      const roleTokens = estimateTokens(msg.role, model);
      const availableForContent = remainingTokens - roleTokens;
      
      if (availableForContent > 10) { // Minimum 10 tokens for content
        const charsPerToken = CHARS_PER_TOKEN.text;
        const maxChars = Math.floor(availableForContent * charsPerToken);
        const truncatedContent = msg.content.slice(-maxChars);
        
        result.unshift({
          ...msg,
          content: `[...truncated] ${truncatedContent}`,
        });
        remainingTokens = 0;
      }
      break;
    }
  }
  
  return result;
}

/**
 * Tokenizer for common patterns
 */
export class SimpleTokenizer {
  private model: string;

  constructor(model: string = 'default') {
    this.model = model;
  }

  /**
   * Encode text to tokens (simplified estimation)
   */
  encode(text: string): number[] {
    // This is a simplified estimation
    // Real tokenizers use BPE or other algorithms
    const tokens: number[] = [];
    const bytesPerToken = BYTES_PER_TOKEN[this.model] || 4;
    const encoded = new TextEncoder().encode(text);
    
    for (let i = 0; i < encoded.length; i += bytesPerToken) {
      tokens.push(Math.floor(i / bytesPerToken));
    }
    
    return tokens;
  }

  /**
   * Decode tokens to text (not implemented for estimation)
   */
  decode(tokens: number[]): string {
    // Estimation doesn't support decoding
    return '';
  }

  /**
   * Count tokens in text
   */
  count(text: string): number {
    return estimateTokens(text, this.model);
  }
}

/**
 * Batch token counting for multiple texts
 */
export function countTokensBatch(
  texts: string[],
  model?: string
): number[] {
  return texts.map((text) => estimateTokens(text, model));
}

/**
 * Calculate cost for token usage
 */
export interface Pricing {
  prompt: number; // Price per 1K prompt tokens in USD
  completion: number; // Price per 1K completion tokens in USD
}

const MODEL_PRICING: Record<string, Pricing> = {
  // OpenRouter pricing (approximate, check openrouter.ai for actual)
  'meta-llama/llama-3.1-70b-instruct': { prompt: 0.00000065, completion: 0.000000865 },
  'meta-llama/llama-3.1-8b-instruct': { prompt: 0.0000002, completion: 0.00000026 },
  'mistralai/mistral-7b-instruct': { prompt: 0.00000025, completion: 0.00000025 },
  'mistralai/mixtral-8x7b-instruct': { prompt: 0.0000007, completion: 0.0000007 },
  'google/gemma-7b-it': { prompt: 0.0000001, completion: 0.0000001 },
  'phi-3-mini-4k-instruct': { prompt: 0.00000015, completion: 0.0000003 },
  'phi-3-small-8k-instruct': { prompt: 0.0000003, completion: 0.0000006 },
  'openchat/openchat-7b': { prompt: 0.0000001, completion: 0.0000001 },
  
  // Placeholder for others
  'default': { prompt: 0.0000005, completion: 0.0000005 },
};

/**
 * Calculate cost for token usage
 */
export function calculateCost(
  promptTokens: number,
  completionTokens: number,
  model: string
): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
  
  const promptCost = (promptTokens / 1000) * pricing.prompt;
  const completionCost = (completionTokens / 1000) * pricing.completion;
  
  return promptCost + completionCost;
}

/**
 * Format cost for display
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `<$0.01`;
  }
  if (cost < 1) {
    return `$${cost.toFixed(2)}`;
  }
  return `$${cost.toFixed(2)}`;
}
