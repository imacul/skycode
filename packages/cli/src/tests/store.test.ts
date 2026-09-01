// Tests for state management
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { useConversationStore, createNewConversation, getSystemMessage } from '../store/conversation';
import { useSettingsStore, DEFAULT_SETTINGS, setOpenRouterApiKey, getOpenRouterApiKey } from '../store/settings';
import type { Message, MessageRole, Conversation } from '../store/conversation';
import type { Settings } from '../store/settings';

describe('Conversation Store', () => {
  let store: ReturnType<typeof useConversationStore>;

  beforeEach(() => {
    // Reset store before each test
    store = useConversationStore.getState();
    store.clearMessages();
    Object.keys(store.conversations).forEach((id) => {
      store.deleteConversation(id);
    });
  });

  it('should create new conversation', () => {
    const conversation = store.createConversation('Test Conversation');
    expect(conversation.title).toBe('Test Conversation');
    expect(conversation.id).toBeDefined();
    expect(conversation.messages).toEqual([]);
  });

  it('should create conversation with default title', () => {
    const conversation = store.createConversation();
    expect(conversation.title).toContain('Conversation');
  });

  it('should add message to conversation', () => {
    const conversation = store.createConversation('Test');
    const message = store.addMessage('user', 'Hello!');

    expect(message.role).toBe('user');
    expect(message.content).toBe('Hello!');
    expect(store.currentMessages.length).toBe(1);
  });

  it('should add multiple messages', () => {
    store.createConversation('Test');
    store.addMessage('user', 'Hello!');
    store.addMessage('assistant', 'Hi there!');

    expect(store.currentMessages.length).toBe(2);
  });

  it('should update message', () => {
    store.createConversation('Test');
    const message = store.addMessage('user', 'Hello!');
    store.updateMessage(message.id, { content: 'Updated!' });

    const updated = store.currentMessages.find((m) => m.id === message.id);
    expect(updated?.content).toBe('Updated!');
  });

  it('should remove message', () => {
    store.createConversation('Test');
    const message = store.addMessage('user', 'Hello!');
    store.removeMessage(message.id);

    expect(store.currentMessages.length).toBe(0);
  });

  it('should clear messages', () => {
    store.createConversation('Test');
    store.addMessage('user', 'Hello!');
    store.addMessage('assistant', 'Hi!');
    store.clearMessages();

    expect(store.currentMessages.length).toBe(0);
  });

  it('should switch conversation', () => {
    const conv1 = store.createConversation('Conv 1');
    const conv2 = store.createConversation('Conv 2');
    store.addMessage('user', 'In conv2');

    store.switchConversation(conv1.id);
    expect(store.currentConversationId).toBe(conv1.id);
    expect(store.currentMessages.length).toBe(0);
  });

  it('should delete conversation', () => {
    const conv1 = store.createConversation('Conv 1');
    const conv2 = store.createConversation('Conv 2');

    store.deleteConversation(conv1.id);
    expect(store.conversations[conv1.id]).toBeUndefined();
  });

  it('should get current conversation', () => {
    const conversation = store.createConversation('Test');
    const current = store.getCurrentConversation();
    expect(current?.id).toBe(conversation.id);
  });

  it('should get sorted conversations', () => {
    const conv1 = store.createConversation('Conv 1');
    // Add a message to conv1
    store.addMessage('user', 'Test');

    const conv2 = store.createConversation('Conv 2');

    const sorted = store.getSortedConversations();
    // Conv 2 should be first (most recent)
    expect(sorted[0].id).toBe(conv2.id);
    expect(sorted[1].id).toBe(conv1.id);
  });

  it('should handle null conversation', () => {
    expect(store.getCurrentConversation()).toBeNull();
  });
});

describe('Settings Store', () => {
  let store: ReturnType<typeof useSettingsStore>;

  beforeEach(() => {
    store = useSettingsStore.getState();
    store.resetSettings();
  });

  it('should have default settings', () => {
    expect(store.providers.openrouter.apiKey).toBe('');
    expect(store.model.defaultProvider).toBe('openrouter');
    expect(store.ui.theme).toBe('dark');
  });

  it('should update provider API key', () => {
    store.setProviderApiKey('openrouter', 'test-key');
    expect(store.providers.openrouter.apiKey).toBe('test-key');
  });

  it('should update provider settings', () => {
    store.updateProviderSettings('openrouter', { siteName: 'Test Site' });
    expect(store.providers.openrouter.siteName).toBe('Test Site');
  });

  it('should update UI settings', () => {
    store.updateUISettings({ theme: 'light' });
    expect(store.ui.theme).toBe('light');
  });

  it('should update model settings', () => {
    store.updateModelSettings({ defaultModel: 'test-model', temperature: 0.5 });
    expect(store.model.defaultModel).toBe('test-model');
    expect(store.model.temperature).toBe(0.5);
  });

  it('should update agent settings', () => {
    store.updateAgentSettings({ enabled: false });
    expect(store.agent.enabled).toBe(false);
  });

  it('should reset settings', () => {
    store.setProviderApiKey('openrouter', 'test-key');
    store.updateUISettings({ theme: 'light' });
    store.resetSettings();

    expect(store.providers.openrouter.apiKey).toBe('');
    expect(store.ui.theme).toBe('dark');
  });

  it('should get settings', () => {
    const settings = store.getSettings();
    expect(settings).toBeDefined();
    expect(settings.providers).toBeDefined();
  });

  it('should check if provider is configured', () => {
    expect(store.isProviderConfigured('openrouter')).toBe(false);
    store.setProviderApiKey('openrouter', 'test-key');
    expect(store.isProviderConfigured('openrouter')).toBe(true);
  });
});

describe('Store Utilities', () => {
  it('should create system message', () => {
    const message = getSystemMessage('openrouter', 'test-model');
    expect(message.role).toBe('system');
    expect(message.content).toContain('AI coding assistant');
    expect(message.content).toContain('test-model');
  });

  it('should create system message without provider', () => {
    const message = getSystemMessage();
    expect(message.role).toBe('system');
    expect(message.content).toContain('AI coding assistant');
  });

  it('should create new conversation with system message', () => {
    const store = useConversationStore.getState();
    store.resetSettings();
    
    const conversation = createNewConversation(store, 'Test', 'openrouter', 'test-model');
    expect(conversation.messages.length).toBe(1);
    expect(conversation.messages[0].role).toBe('system');
  });
});

describe('Settings Functions', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetSettings();
  });

  it('should set OpenRouter API key', () => {
    setOpenRouterApiKey('test-key');
    expect(useSettingsStore.getState().providers.openrouter.apiKey).toBe('test-key');
  });

  it('should get OpenRouter API key from store', () => {
    setOpenRouterApiKey('store-key');
    expect(getOpenRouterApiKey()).toBe('store-key');
  });

  it('should get OpenRouter API key from environment', () => {
    process.env.OPENROUTER_API_KEY = 'env-key';
    expect(getOpenRouterApiKey()).toBe('env-key');
    delete process.env.OPENROUTER_API_KEY;
  });
});

describe('Default Settings', () => {
  it('should have all required settings', () => {
    expect(DEFAULT_SETTINGS.version).toBe(1);
    expect(DEFAULT_SETTINGS.providers).toBeDefined();
    expect(DEFAULT_SETTINGS.ui).toBeDefined();
    expect(DEFAULT_SETTINGS.model).toBeDefined();
    expect(DEFAULT_SETTINGS.agent).toBeDefined();
  });

  it('should have provider settings', () => {
    expect(DEFAULT_SETTINGS.providers.openrouter).toBeDefined();
    expect(DEFAULT_SETTINGS.providers.local).toBeDefined();
  });

  it('should have UI settings', () => {
    expect(DEFAULT_SETTINGS.ui.theme).toBe('dark');
    expect(DEFAULT_SETTINGS.ui.fontSize).toBe(14);
  });

  it('should have model settings', () => {
    expect(DEFAULT_SETTINGS.model.defaultProvider).toBe('openrouter');
    expect(DEFAULT_SETTINGS.model.defaultModel).toBe('meta-llama/llama-3.1-70b-instruct');
  });

  it('should have agent settings', () => {
    expect(DEFAULT_SETTINGS.agent.enabled).toBe(true);
    expect(DEFAULT_SETTINGS.agent.autoSuggest).toBe(true);
  });
});
