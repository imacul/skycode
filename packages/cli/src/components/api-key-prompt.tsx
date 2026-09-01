// API Key Prompt Component
// Shows when no API key is configured and prompts user to enter one
import { useState, useCallback } from 'react';
import type { TextareaRenderable } from '@opentui/core';

export interface ApiKeyPromptProps {
  provider: 'openrouter' | 'anthropic' | 'openai' | 'local';
  onSubmit: (apiKey: string) => void;
  onSkip: () => void;
  onBack: () => void;
}

const PROVIDER_INFO: Record<string, { name: string; url: string; envVar: string }> = {
  openrouter: {
    name: 'OpenRouter',
    url: 'https://openrouter.ai/keys',
    envVar: 'OPENROUTER_API_KEY',
  },
  anthropic: {
    name: 'Anthropic',
    url: 'https://console.anthropic.com/settings/keys',
    envVar: 'ANTHROPIC_API_KEY',
  },
  openai: {
    name: 'OpenAI',
    url: 'https://platform.openai.com/api-keys',
    envVar: 'OPENAI_API_KEY',
  },
  local: {
    name: 'Local LLM',
    url: 'http://localhost:11434',
    envVar: 'LOCAL_LLM_BASE_URL',
  },
};

export function ApiKeyPrompt({ provider, onSubmit, onSkip, onBack }: ApiKeyPromptProps) {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const textareaRef = useState<TextareaRenderable | null>(null);

  const info = PROVIDER_INFO[provider];

  const handleSubmit = useCallback(() => {
    const key = textareaRef.current?.editBuffer.getText()?.trim() || apiKey;
    
    if (!key) {
      setError('Please enter an API key or URL');
      return;
    }

    if (provider === 'local' && !key.includes('http')) {
      setError('Local provider requires a URL (e.g., http://localhost:11434)');
      return;
    }

    setIsLoading(true);
    setError(null);
    
    try {
      onSubmit(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid API key');
      setIsLoading(false);
    }
  }, [apiKey, provider, onSubmit]);

  const handleKeyChange = useCallback(() => {
    if (textareaRef.current) {
      const key = textareaRef.current.editBuffer.getText();
      setApiKey(key);
      setError(null);
    }
  }, []);

  return (
    <box
      flexDirection="column"
      gap={2}
      width="100%"
      maxWidth={60}
      padding={2}
      backgroundColor="#1A1A24"
      border={['all']}
      borderColor="yellow"
    >
      {/* Header */}
      <box flexDirection="column" gap={1}>
        <text fg="yellow" attributes={{ bold: true }}>
          {provider === 'local' ? '🏡 Local LLM Setup' : '🔑 API Key Required'}
        </text>
        <text fg="white">
          {provider === 'local' 
            ? 'Enter your local LLM server URL'
            : `Enter your ${info.name} API key to continue`}
        </text>
      </box>

      {/* Instructions */}
      <box flexDirection="column" gap={1}>
        {provider !== 'local' ? (
          <>
            <text fg="gray">
              Get your API key from: <text fg="cyan">{info.url}</text>
            </text>
            <text fg="gray">
              Or set environment variable: <text fg="cyan">{info.envVar}</text>
            </text>
          </>
        ) : (
          <>
            <text fg="gray">
              For Ollama: <text fg="cyan">http://localhost:11434</text>
            </text>
            <text fg="gray">
              For LM Studio: <text fg="cyan">http://localhost:1234/v1</text>
            </text>
            <text fg="gray">
              Or set environment variable: <text fg="cyan">LOCAL_LLM_BASE_URL</text>
            </text>
          </>
        )}
      </box>

      {/* Input */}
      <box flexDirection="column" gap={1}>
        <textarea
          ref={textareaRef}
          focused={true}
          placeholder={provider === 'local' ? 'http://localhost:11434' : 'sk-...'}
          onChange={handleKeyChange}
          onSubmit={handleSubmit}
          width="100%"
        />
      </box>

      {/* Error */}
      {error && (
        <text fg="red">{error}</text>
      )}

      {/* Actions */}
      <box flexDirection="row" gap={2} justifyContent="flex-end">
        <text fg="gray" attributes={{ dim: true }}>
          Press Enter to submit, Esc to skip
        </text>
      </box>

      {/* Buttons */}
      <box flexDirection="row" gap={2} justifyContent="flex-end">
        <text fg="gray" attributes={{ dim: true, underline: true }} onMouseDown={onBack}>
          Back
        </text>
        {provider !== 'local' && (
          <text fg="gray" attributes={{ dim: true, underline: true }} onMouseDown={onSkip}>
            Try Without API Key
          </text>
        )}
        <text 
          fg="green" 
          attributes={{ bold: true, underline: true }} 
          onMouseDown={handleSubmit}
          disabled={isLoading}
        >
          {isLoading ? 'Validating...' : 'Submit'}
        </text>
      </box>
    </box>
  );
}
