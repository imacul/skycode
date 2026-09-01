// Settings store for user preferences
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Provider settings
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
    apiKey?: string;
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
      baseUrl: 'http://localhost:11434/v1',
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
}

type SettingsStore = Settings & SettingsActions;

/**
 * Create the settings store with persistence
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
    }),
    {
      name: 'skycode-settings',
      // Don't persist API keys for security
      // We'll handle this separately with encryption
      partialize: (state) => ({
        ...state,
        providers: {
          ...state.providers,
          openrouter: {
            ...state.providers.openrouter,
            apiKey: '', // Don't persist API key
          },
          local: {
            ...state.providers.local,
            apiKey: '', // Don't persist API key
          },
        },
      }),
    }
  )
);

/**
 * Get settings from environment variables
 * Priority: Environment > Store > Defaults
 */
export function getSettingsWithEnv(): Settings {
  const storeSettings = useSettingsStore.getState();
  
  return {
    ...storeSettings,
    providers: {
      ...storeSettings.providers,
      openrouter: {
        ...storeSettings.providers.openrouter,
        apiKey: 
          process.env.OPENROUTER_API_KEY || 
          storeSettings.providers.openrouter.apiKey,
      },
    },
  };
}

/**
 * Set OpenRouter API key from environment or direct value
 */
export function setOpenRouterApiKey(apiKey: string): void {
  useSettingsStore.getState().setProviderApiKey('openrouter', apiKey);
}

/**
 * Get OpenRouter API key (from env or store)
 */
export function getOpenRouterApiKey(): string {
  return (
    process.env.OPENROUTER_API_KEY || 
    useSettingsStore.getState().providers.openrouter.apiKey
  );
}
