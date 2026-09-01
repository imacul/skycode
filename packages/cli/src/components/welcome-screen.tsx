// Welcome Screen Component
// First screen shown when Sky Code starts
import { useState, useCallback } from 'react';
import { ProviderSelector } from './provider-selector';
import { ApiKeyPrompt } from './api-key-prompt';
import { getProviderApiKey, setProviderApiKey, getConfiguredProviders } from '../store/settings';

export interface WelcomeScreenProps {
  onComplete: () => void;
}

export function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
  const [currentStep, setCurrentStep] = useState<'provider-select' | 'api-key-prompt' | 'complete'>('provider-select');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  // Check if already configured
  const configuredProviders = getConfiguredProviders();
  
  // If already configured, skip welcome screen
  if (configuredProviders.length > 0 && currentStep === 'provider-select') {
    onComplete();
    return null;
  }

  const handleProviderSelect = useCallback((provider: string) => {
    setSelectedProvider(provider);
    
    // Check if provider needs API key
    if (provider === 'local') {
      // Local provider doesn't need API key
      setProviderApiKey('local', 'http://localhost:11434');
      onComplete();
    } else {
      // Check if already have API key
      const existingKey = getProviderApiKey(provider as any);
      if (existingKey) {
        onComplete();
      } else {
        setCurrentStep('api-key-prompt');
      }
    }
  }, [onComplete]);

  const handleApiKeySubmit = useCallback((apiKey: string) => {
    if (selectedProvider) {
      setProviderApiKey(selectedProvider as any, apiKey);
      onComplete();
    }
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
          <text fg="cyan" attributes={{ bold: true, size: 24 }}>
            🌌 Welcome to Sky Code
          </text>
          <text fg="gray" attributes={{ dim: true }}>
            Your AI Agent Harness for the Terminal
          </text>
          
          <ProviderSelector
            onSelect={handleProviderSelect}
            onBack={onComplete} // Skip setup
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
