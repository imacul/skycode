// Provider Selector Component
// Allows user to choose and configure their AI provider
import { useState, useCallback } from 'react';

export interface ProviderSelectorProps {
  onSelect: (provider: string, config?: Record<string, string>) => void;
  onBack: () => void;
  allowedProviders?: string[];
}

const PROVIDERS = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Access 100+ models including open weights',
    icon: '🌐',
    requiresApiKey: true,
    envVar: 'OPENROUTER_API_KEY',
  },
  {
    id: 'local',
    name: 'Local LLM',
    description: 'Run models locally (Ollama, LM Studio)',
    icon: '🏡',
    requiresApiKey: false,
    envVar: 'LOCAL_LLM_BASE_URL',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude 3.5, Claude 3 models',
    icon: '🎭',
    requiresApiKey: true,
    envVar: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4, GPT-3.5 models',
    icon: '✨',
    requiresApiKey: true,
    envVar: 'OPENAI_API_KEY',
  },
];

export function ProviderSelector({ onSelect, onBack, allowedProviders }: ProviderSelectorProps) {
  const visibleProviders = allowedProviders?.length
    ? PROVIDERS.filter((provider) => allowedProviders.includes(provider.id))
    : PROVIDERS;

  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleSelect = useCallback(() => {
    const provider = visibleProviders[selectedIndex];
    if (provider) onSelect(provider.id);
  }, [selectedIndex, onSelect, visibleProviders]);

  const handleKeyDown = useCallback((key: string) => {
    if (key === 'up') {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : visibleProviders.length - 1));
    } else if (key === 'down') {
      setSelectedIndex((prev) => (prev < visibleProviders.length - 1 ? prev + 1 : 0));
    } else if (key === 'enter' || key === 'return') {
      handleSelect();
    }
  }, [handleSelect]);

  return (
    <box
      flexDirection="column"
      gap={2}
      width="100%"
      maxWidth={60}
      padding={2}
      backgroundColor="#1A1A24"
      border={['all']}
      borderColor="cyan"
    >
      {/* Header */}
      <box flexDirection="column" gap={1}>
        <text fg="cyan" attributes={{ bold: true }}>
          🎯 Select AI Provider
        </text>
        <text fg="gray">
          Choose how you want to use Sky Code
        </text>
      </box>

      {/* Provider List */}
      <box flexDirection="column" gap={1}>
        {visibleProviders.map((provider, index) => (
          <box
            key={provider.id}
            flexDirection="row"
            gap={2}
            alignItems="center"
            paddingX={1}
            paddingY={0.5}
            backgroundColor={selectedIndex === index ? '#2A2A38' : undefined}
            onMouseMove={() => setSelectedIndex(index)}
            onMouseDown={() => {
              setSelectedIndex(index);
              handleSelect();
            }}
          >
            <text fg={selectedIndex === index ? 'cyan' : 'white'}>
              {provider.icon}
            </text>
            <text fg={selectedIndex === index ? 'white' : 'gray'} attributes={{ bold: selectedIndex === index }}>
              {provider.name}
            </text>
            <text fg="gray" attributes={{ dim: true }}>
              - {provider.description}
            </text>
          </box>
        ))}
      </box>

      {/* Info */}
      <box flexDirection="column" gap={1} paddingTop={1} border={['top']} borderColor="gray">
        <text fg="yellow">
          {visibleProviders[selectedIndex].icon} {visibleProviders[selectedIndex].name}
        </text>
        <text fg="gray">
          {visibleProviders[selectedIndex].description}
        </text>
        {visibleProviders[selectedIndex].requiresApiKey ? (
          <text fg="gray">
            Requires: <text fg="cyan">{visibleProviders[selectedIndex].envVar}</text>
          </text>
        ) : (
          <text fg="green">
            No API key required - Just run your local server!
          </text>
        )}
      </box>

      {/* Actions */}
      <box flexDirection="row" gap={2} justifyContent="flex-end">
        <text fg="gray" attributes={{ dim: true, underline: true }} onMouseDown={onBack}>
          Back
        </text>
        <text 
          fg="green" 
          attributes={{ bold: true, underline: true }} 
          onMouseDown={handleSelect}
        >
          Select {visibleProviders[selectedIndex].name}
        </text>
      </box>
    </box>
  );
}
