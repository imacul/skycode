import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/header';
import { InputBar } from './components/input-bar';
import { StatusBar } from './components/satus-bar';
import { WelcomeScreen } from './components/welcome-screen';
import { useConversationStore, createNewConversation } from './store/conversation';
import { useSettingsStore, getProviderApiKey, setProviderApiKey, getConfiguredProviders } from './store/settings';
import { createOpenRouterProvider } from './providers/openrouter';
import { createLocalLLMProvider } from './providers/local';
import { createAnthropicProvider } from './providers/anthropic';
import { createOpenAIProvider } from './providers/openai';
import { createAgentOrchestrator } from './agents';
import type { BaseProvider } from './providers/base';
import type { AgentRequest, AgentResponse } from './agents/types';

// Provider factory
function createProvider(provider: string): BaseProvider | null {
  switch (provider) {
    case 'openrouter':
      return createOpenRouterProvider();
    case 'local':
      return createLocalLLMProvider();
    case 'anthropic':
      return createAnthropicProvider();
    case 'openai':
      return createOpenAIProvider();
    default:
      return null;
  }
}

function App() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentResponse, setCurrentResponse] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<BaseProvider | null>(null);
  const [model, setModel] = useState<string>('');
  const [showWelcome, setShowWelcome] = useState(false);
  
  const {
    currentMessages,
    addMessage,
    createConversation,
    getCurrentConversation,
    clearMessages,
  } = useConversationStore();
  
  const { 
    model: modelSettings,
    updateModelSettings,
  } = useSettingsStore();

  // Initialize on mount
  useEffect(() => {
    const init = async () => {
      try {
        // Check if any provider is configured
        const configured = getConfiguredProviders();
        
        if (configured.length === 0) {
          // Show welcome screen for first-time setup
          setShowWelcome(true);
          return;
        }

        // Use first configured provider
        const providerName = configured[0];
        const apiKey = getProviderApiKey(providerName as any);
        
        const providerInstance = createProvider(providerName);
        if (!providerInstance) {
          setShowWelcome(true);
          return;
        }

        // Initialize provider
        if (providerName === 'local') {
          await providerInstance.initialize({
            baseUrl: apiKey || 'http://localhost:11434',
          });
        } else {
          await providerInstance.initialize({
            apiKey,
          });
        }

        setProvider(providerInstance);
        
        // Set default model
        const defaultModel = modelSettings.defaultModel || 'meta-llama/llama-3.1-70b-instruct';
        setModel(defaultModel);

        // Initialize agents with context
        const orchestrator = createAgentOrchestrator();
        await orchestrator.initializeAll({
          provider: providerInstance,
          model: defaultModel,
          workingDirectory: process.cwd(),
          env: { ...process.env },
        });

        setIsInitialized(true);
      } catch (err) {
        setError(`Failed to initialize: ${err instanceof Error ? err.message : String(err)}`);
        setShowWelcome(true);
      }
    };

    init();
  }, []);

  // Handle welcome screen completion
  const handleWelcomeComplete = useCallback(() => {
    setShowWelcome(false);
    // Re-initialize
    setTimeout(() => {
      window.location.reload();
    }, 100);
  }, []);

  // Handle user input submission
  const handleSubmit = useCallback(async (text: string) => {
    if (!provider || !isInitialized || isProcessing) return;

    setIsProcessing(true);
    setError(null);
    setCurrentResponse('');

    try {
      // Add user message to conversation
      addMessage('user', text);

      // Create agent request
      const request: AgentRequest = {
        input: text,
        mode: 'code', // Default to code mode
        onStream: (chunk) => {
          setCurrentResponse((prev) => prev + chunk);
        },
        onComplete: (response: AgentResponse) => {
          // Add assistant response to conversation
          addMessage('assistant', response.content, {
            model: response.metadata?.model,
            finishReason: response.metadata?.finishReason,
          });
          setIsProcessing(false);
        },
        onError: (err) => {
          setError(err.message);
          setIsProcessing(false);
        },
      };

      // Create orchestrator and route request
      const orchestrator = createAgentOrchestrator();
      await orchestrator.initializeAll({
        provider,
        model,
        workingDirectory: process.cwd(),
        env: { ...process.env },
      });
      
      await orchestrator.routeRequestStream(request);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsProcessing(false);
    }
  }, [provider, isInitialized, isProcessing, model, addMessage]);

  // Handle command execution
  const handleCommand = useCallback(async (command: string) => {
    if (command === '/new') {
      createNewConversation(useConversationStore.getState(), 'New Conversation', 'openrouter', model);
    } else if (command === '/exit') {
      process.exit(0);
    } else if (command === '/model') {
      addMessage('system', 'Usage: /model <model-name>');
    } else if (command.startsWith('/model ')) {
      const modelName = command.slice(7).trim();
      setModel(modelName);
      updateModelSettings({ defaultModel: modelName });
      addMessage('system', `Switched to model: ${modelName}`);
    } else if (command === '/help') {
      const helpText = `
Available commands:
  /new       - Start a new conversation
  /exit      - Quit the application
  /model <name> - Switch model
  /help      - Show this help
  /setup     - Configure API keys

Available models (open weights):
  meta-llama/llama-3.1-70b-instruct
  meta-llama/llama-3.1-8b-instruct
  mistralai/mistral-7b-instruct
  mistralai/mixtral-8x7b-instruct
  google/gemma-7b-it
  phi-3-mini-4k-instruct
  phi-3-small-8k-instruct
  openchat/openchat-7b

Current model: ${model}
Current provider: ${provider?.name || 'none'}
`.trim();
      addMessage('system', helpText);
    } else if (command === '/setup') {
      setShowWelcome(true);
    } else if (command === '/clear') {
      clearMessages();
      addMessage('system', 'Conversation cleared');
    }
  }, [model, provider, createNewConversation, addMessage, clearMessages, updateModelSettings]);

  // Check if we need to show setup instructions
  const needsSetup = !isInitialized && !showWelcome;

  // Show welcome screen first if not configured
  if (showWelcome) {
    return (
      <box
        width="100%"
        height="100%"
        backgroundColor="#0D0D12"
      >
        <WelcomeScreen onComplete={handleWelcomeComplete} />
      </box>
    );
  }

  return (
    <box
      alignItems="center"
      justifyContent="center"
      backgroundColor="#0D0D12"
      width="100%"
      height="100%"
      gap={2}
    >
      <Header />
      
      {/* Setup instructions if no API key */}
      {needsSetup && (
        <box width="100%" maxWidth={78} paddingX={2}>
          <text fg="yellow">
            ⚠️  No AI provider configured.
          </text>
          <text fg="gray" attributes={{ dim: true }}>
            {' Type /setup to configure API keys or use /help'}
          </text>
        </box>
      )}

      {/* Error display */}
      {error && !showWelcome && (
        <box width="100%" maxWidth={78} paddingX={2}>
          <text fg="red">❌ {error}</text>
        </box>
      )}

      {/* Messages display */}
      <box
        width="100%"
        maxWidth={78}
        paddingX={2}
        flexDirection="column"
        gap={1}
        overflow="hidden"
        flexGrow={1}
      >
        {currentMessages.length > 0 ? (
          currentMessages.map((msg, index) => (
            <box
              key={msg.id}
              flexDirection="column"
              gap={0.5}
              paddingY={0.5}
            >
              <text
                fg={msg.role === 'user' ? 'cyan' : msg.role === 'assistant' ? 'green' : 'yellow'}
              >
                {msg.role === 'user' ? '👤 User' : msg.role === 'assistant' ? '🤖 Assistant' : '⚙️ System'}:
              </text>
              <text wordWrap="break-word" width="100%">
                {msg.content}
              </text>
            </box>
          ))
        ) : (
          !isProcessing && !showWelcome && (
            <box flexDirection="column" gap={1}>
              <text fg="gray" attributes={{ dim: true }}>
                Welcome to Sky Code!
              </text>
              <text fg="gray" attributes={{ dim: true }}>
                Type a message to start chatting with AI.
              </text>
              <text fg="gray" attributes={{ dim: true }}>
                Use /help for available commands.
              </text>
            </box>
          )
        )}

        {/* Streaming response */}
        {isProcessing && currentResponse && (
          <box flexDirection="column" gap={0.5} paddingY={0.5}>
            <text fg="green">🤖 Assistant:</text>
            <text wordWrap="break-word" width="100%">
              {currentResponse}
              {isProcessing && !currentResponse.endsWith('|') && (
                <text attributes={{ blink: true }}>|</text>
              )}
            </text>
          </box>
        )}

        {isProcessing && !currentResponse && (
          <box flexDirection="column" gap={0.5} paddingY={0.5}>
            <text fg="green">🤖 Assistant:</text>
            <text attributes={{ blink: true }}>Thinking...</text>
          </box>
        )}
      </box>

      {/* Input bar */}
      <box width="100%" maxWidth={78} paddingX={2}>
        <InputBar 
          onSubmit={handleSubmit}
          disabled={!isInitialized || isProcessing || showWelcome}
          onCommand={handleCommand}
        />
      </box>

      {/* Status bar */}
      <StatusBar />
    </box>
  );
}

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
