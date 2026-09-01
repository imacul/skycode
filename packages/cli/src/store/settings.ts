// Settings store for user preferences
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Provider settings
 * Note: API keys are NOT stored here for security.
 * They are stored separately in a secure manner or prompted when needed.
 */
export interface ProviderSettings {
  // OpenRouter
  openrouter: {
    apiKey: string;
    siteName?: string;
    siteUrl?: string;
    appName?: string;
  };
  // Local LLM (future)
  local: {
    baseUrl: string;
  };
  // Anthropic
  anthropic: {
    apiKey: string;
  };
  // OpenAI
  openai: {
    apiKey: string;
    organization?: string;
  };
}

/**
 * UI settings
 */
export interface UISettings {
  theme: 'dark' | 'light' | 'system';
  fontSize: number;
  animationSpeed: 'fast' | 'normal' | 'slow';
  showTimestamps: boolean;
  showTokenCount: boolean;
}

/**
 * Model settings
 */
export interface ModelSettings {
  defaultProvider: string;
  defaultModel: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
}

/**
 * Agent settings
 */
export interface AgentSettings {
  enabled: boolean;
  autoSuggest: boolean;
  codeCompletion: boolean;
  explainCode: boolean;
  fixBugs: boolean;
}

/**
 * All settings combined
 */
export interface Settings {
  providers: ProviderSettings;
  ui: UISettings;
  model: ModelSettings;
  agent: AgentSettings;
  // Version for migrations
  version: number;
}

/**
 * Default settings
 * API keys are empty by default - will be prompted when needed
 */
export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  providers: {
    openrouter: {
      apiKey: '',
      siteName: 'Sky Code',
      siteUrl: 'https://github.com/imacul/skycode',
      appName: 'SkyCode',
    },
    local: {
      baseUrl: 'http://localhost:11434',
    },
    anthropic: {
      apiKey: '',
    },
    openai: {
      apiKey: '',
      organization: '',
    },
  },
  ui: {
    theme: 'dark',
    fontSize: 14,
    animationSpeed: 'normal',
    showTimestamps: true,
    showTokenCount: true,
  },
  model: {
    defaultProvider: 'openrouter',
    defaultModel: 'meta-llama/llama-3.1-70b-instruct',
    temperature: 0.7,
    maxTokens: 4096,
    topP: 0.9,
    frequencyPenalty: 0,
    presencePenalty: 0,
  },
  agent: {
    enabled: true,
    autoSuggest: true,
    codeCompletion: true,
    explainCode: true,
    fixBugs: true,
  },
};

/**
 * Settings store actions
 */
interface SettingsActions {
  // Update provider API key
  setProviderApiKey: (provider: keyof ProviderSettings, apiKey: string) => void;
  
  // Update provider settings
  updateProviderSettings: <K extends keyof ProviderSettings>(
    provider: K,
    settings: Partial<ProviderSettings[K]>
  ) => void;
  
  // Update UI settings
  updateUISettings: (settings: Partial<UISettings>) => void;
  
  // Update model settings
  updateModelSettings: (settings: Partial<ModelSettings>) => void;
  
  // Update agent settings
  updateAgentSettings: (settings: Partial<AgentSettings>) => void;
  
  // Reset to defaults
  resetSettings: () => void;
  
  // Get current settings
  getSettings: () => Settings;
  
  // Check if provider is configured
  isProviderConfigured: (provider: keyof ProviderSettings) => boolean;
  
  // Clear API key for a provider
  clearProviderApiKey: (provider: keyof ProviderSettings) => void;
}

type SettingsStore = Settings & SettingsActions;

/**
 * Create the settings store with persistence
 * Note: API keys are persisted for convenience but can be cleared
 */
export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,

      setProviderApiKey: (provider, apiKey) =>
        set((state) => ({
          providers: {
            ...state.providers,
            [provider]: {
              ...state.providers[provider],
              apiKey,
            },
          },
        })),

      updateProviderSettings: (provider, settings) =>
        set((state) => ({
          providers: {
            ...state.providers,
            [provider]: {
              ...state.providers[provider],
              ...settings,
            },
          },
        })),

      updateUISettings: (settings) =>
        set((state) => ({
          ui: {
            ...state.ui,
            ...settings,
          },
        })),

      updateModelSettings: (settings) =>
        set((state) => ({
          model: {
            ...state.model,
            ...settings,
          },
        })),

      updateAgentSettings: (settings) =>
        set((state) => ({
          agent: {
            ...state.agent,
            ...settings,
          },
        })),

      resetSettings: () => set({ ...DEFAULT_SETTINGS }),

      getSettings: () => get(),

      isProviderConfigured: (provider) => {
        const settings = get();
        return !!settings.providers[provider]?.apiKey;
      },

      clearProviderApiKey: (provider) =>
        set((state) => ({
          providers: {
            ...state.providers,
            [provider]: {
              ...state.providers[provider],
              apiKey: '',
            },
          },
        })),
    }),
    {
      name: 'skycode-settings',
      // Persist all settings including API keys for convenience
      // Users can clear them manually if needed
      // In production, consider using secure storage for API keys
    }
  )
);

/**
 * Get API key for a provider (from store or environment)
 * Priority: Store > Environment
 */
export function getProviderApiKey(provider: keyof ProviderSettings): string {
  const storeKey = useSettingsStore.getState().providers[provider]?.apiKey;
  
  // Check environment first (for security-conscious users)
  const envKey = process.env[`${provider.toUpperCase()}_API_KEY`];
  
  return envKey || storeKey || '';
}

/**
 * Set API key for a provider (in store)
 */
export function setProviderApiKey(provider: keyof ProviderSettings, apiKey: string): void {
  useSettingsStore.getState().setProviderApiKey(provider, apiKey);
}

/**
 * Clear API key for a provider
 */
export function clearProviderApiKey(provider: keyof ProviderSettings): void {
  useSettingsStore.getState().clearProviderApiKey(provider);
}

/**
 * Check if any provider is configured
 */
export function hasAnyProviderConfigured(): boolean {
  const providers: (keyof ProviderSettings)[] = ['openrouter', 'local', 'anthropic', 'openai'];
  return providers.some((p) => {
    const key = getProviderApiKey(p);
    // Local provider doesn't need API key
    if (p === 'local') return true;
    return !!key;
  });
}

/**
 * Get all configured providers
 */
export function getConfiguredProviders(): (keyof ProviderSettings)[] {
  const providers: (keyof ProviderSettings)[] = ['openrouter', 'local', 'anthropic', 'openai'];
  return providers.filter((p) => {
    if (p === 'local') return true; // Local always available
    return !!getProviderApiKey(p);
  });
}
