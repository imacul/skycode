// Welcome Screen Component
// First screen shown when Sky Code starts
import { useState, useCallback } from 'react';
import { ProviderSelector } from './provider-selector';
import { ApiKeyPrompt } from './api-key-prompt';
import { getProviderApiKey, setProviderApiKey, getConfiguredProviders, useSettingsStore } from '../store/settings';

export type SetupMode = 'all' | 'cloud' | 'local' | 'openrouter';

export interface WelcomeScreenProps {
  onComplete: () => void;
  mode?: SetupMode;
  forceSetup?: boolean;
}

const PROVIDERS_BY_MODE: Record<SetupMode, string[]> = {
  all: ['openrouter', 'local', 'anthropic', 'openai'],
  cloud: ['anthropic', 'openai'],
  local: ['local'],
  openrouter: ['openrouter'],
};

const DEFAULT_MODEL_BY_PROVIDER: Partial<Record<string, string>> = {
  openrouter: 'meta-llama/llama-3.1-70b-instruct',
  anthropic: 'claude-3-5-sonnet-20241022',
  openai: 'gpt-4o-mini',
};

export function WelcomeScreen({ onComplete, mode = 'all', forceSetup = false }: WelcomeScreenProps) {
  const directProvider = mode === 'local' ? 'local' : mode === 'openrouter' ? 'openrouter' : null;
  const [currentStep, setCurrentStep] = useState<'provider-select' | 'api-key-prompt' | 'complete'>(
    directProvider ? 'api-key-prompt' : 'provider-select'
  );
  const [selectedProvider, setSelectedProvider] = useState<string | null>(directProvider);

  // Check if already configured
  const configuredProviders = getConfiguredProviders();
  
  // If already configured, skip welcome screen
  if (!forceSetup && configuredProviders.length > 0 && currentStep === 'provider-select') {
    onComplete();
    return null;
  }

  const handleProviderSelect = useCallback((provider: string) => {
    setSelectedProvider(provider);
    
    if (provider === 'local') {
      setCurrentStep('api-key-prompt');
      return;
    }

    const existingKey = getProviderApiKey(provider as any);
    if (existingKey && !forceSetup) {
      const defaultModel = DEFAULT_MODEL_BY_PROVIDER[provider];
      useSettingsStore.getState().updateModelSettings({
        defaultProvider: provider,
        ...(defaultModel ? { defaultModel } : {}),
      });
      onComplete();
    } else {
      setCurrentStep('api-key-prompt');
    }
  }, [onComplete]);

  const handleApiKeySubmit = useCallback((value: string) => {
    if (!selectedProvider) return;

    if (selectedProvider === 'local') {
      useSettingsStore.getState().updateProviderSettings('local', { baseUrl: value });
    } else {
      setProviderApiKey(selectedProvider as any, value);
    }

    const defaultModel = DEFAULT_MODEL_BY_PROVIDER[selectedProvider];
    useSettingsStore.getState().updateModelSettings({
      defaultProvider: selectedProvider,
      ...(defaultModel ? { defaultModel } : {}),
    });
    onComplete();
  }, [selectedProvider, onComplete]);

  const handleSkip = useCallback(() => {
    // Allow user to try without API key
    // They can configure later
    onComplete();
  }, [onComplete]);

  const handleBack = useCallback(() => {
    setCurrentStep('provider-select');
    setSelectedProvider(null);
  }, []);

  // Render based on current step
  switch (currentStep) {
    case 'provider-select':
      return (
        <box
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          width="100%"
          height="100%"
          gap={2}
          backgroundColor="#0D0D12"
        >
          <text fg="cyan" attributes={{ bold: true }}>{'🌌 Welcome to Sky Code'}</text>
          <text fg="gray" attributes={{ dim: true }}>{'Your AI Agent Harness for the Terminal'}</text>
          
          <ProviderSelector
            onSelect={handleProviderSelect}
            onBack={onComplete}
            allowedProviders={PROVIDERS_BY_MODE[mode]}
          />
        </box>
      );

    case 'api-key-prompt':
      if (!selectedProvider) return null;
      return (
        <box
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          width="100%"
          height="100%"
          gap={2}
          backgroundColor="#0D0D12"
        >
          <ApiKeyPrompt
            provider={selectedProvider as any}
            onSubmit={handleApiKeySubmit}
            onSkip={handleSkip}
            onBack={handleBack}
          />
        </box>
      );

    default:
      return null;
  }
}
