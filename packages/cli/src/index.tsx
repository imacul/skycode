import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/header';
import { InputBar } from './components/input-bar';
import { StatusBar } from './components/satus-bar';
import { useConversationStore, createNewConversation } from './store/conversation';
import { useSettingsStore, getOpenRouterApiKey, setOpenRouterApiKey } from './store/settings';
import { createOpenRouterProvider } from './providers';
import { createAgentOrchestrator } from './agents';
import type { BaseProvider } from './providers/base';
import type { AgentRequest, AgentResponse } from './agents/types';

// Initialize the agent orchestrator
const orchestrator = createAgentOrchestrator();

// Initialize providers
const openrouterProvider = createOpenRouterProvider();

function App() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentResponse, setCurrentResponse] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<BaseProvider | null>(null);
  const [model, setModel] = useState<string>('');
  
  const {
    currentMessages,
    addMessage,
    createConversation,
    getCurrentConversation,
  } = useConversationStore();
  
  const { 
    providers: settingsProviders,
    model: modelSettings,
    updateModelSettings,
  } = useSettingsStore();

  // Initialize on mount
  useEffect(() => {
    const init = async () => {
      try {
        // Check for API key
        const apiKey = getOpenRouterApiKey();
        
        if (!apiKey) {
          console.warn('No OPENROUTER_API_KEY found. Using placeholder for UI.');
        }

        // Initialize provider
        await openrouterProvider.initialize({
          apiKey: apiKey || '',
        });

        setProvider(openrouterProvider);
        
        // Set default model
        const defaultModel = modelSettings.defaultModel || 'meta-llama/llama-3.1-70b-instruct';
        setModel(defaultModel);

        // Initialize agents with context
        await orchestrator.initializeAll({
          provider: openrouterProvider,
          model: defaultModel,
          workingDirectory: process.cwd(),
          env: { ...process.env },
        });

        setIsInitialized(true);
      } catch (err) {
        setError(`Failed to initialize: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    init();

    return () => {
      orchestrator.cleanupAll();
    };
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

      // Route request through orchestrator
      await orchestrator.routeRequestStream(request);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsProcessing(false);
    }
  }, [provider, isInitialized, isProcessing, addMessage]);

  // Handle command execution
  const handleCommand = useCallback(async (command: string) => {
    if (command === '/new') {
      createNewConversation(useConversationStore.getState(), 'New Conversation', 'openrouter', model);
    } else if (command === '/exit') {
      process.exit(0);
    } else if (command.startsWith('/model ')) {
      const modelName = command.slice(7).trim();
      setModel(modelName);
      updateModelSettings({ defaultModel: modelName });
    } else if (command === '/help') {
      const helpText = `
Available commands:
  /new       - Start a new conversation
  /exit      - Quit the application
  /model <name> - Switch model
  /help      - Show this help

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
Current provider: ${provider?.name || 'openrouter'}
`.trim();
      addMessage('system', helpText);
    }
  }, [model, provider, createNewConversation, addMessage, updateModelSettings]);

  // Check if we need to show setup instructions
  const needsSetup = !getOpenRouterApiKey();

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
            ⚠️  Set OPENROUTER_API_KEY environment variable to use AI models.
          </text>
          <text fg="gray" attributes={{ dim: true }}>
            {' '}
            Example: export OPENROUTER_API_KEY="your-api-key"
          </text>
        </box>
      )}

      {/* Error display */}
      {error && (
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
          !isProcessing && (
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
          disabled={!isInitialized || isProcessing}
        />
      </box>

      {/* Status bar */}
      <StatusBar />
    </box>
  );
}

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
