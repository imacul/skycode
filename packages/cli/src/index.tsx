import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/header';
import { InputBar } from './components/input-bar';
import { StatusBar } from './components/satus-bar';
import { WelcomeScreen, type SetupMode } from './components/welcome-screen';
import {
  useConversationStore,
  createNewConversation,
  formatConversationHistory,
} from './store/conversation';
import { copyToClipboard } from './utils/clipboard';
import {
  checkForUpdates,
  getUpdatePreferences,
  performUpdate,
  runUpdateCommand,
} from './utils/updater';
import { useSettingsStore, getProviderApiKey, setProviderApiKey, getConfiguredProviders } from './store/settings';
import { createOpenRouterProvider } from './providers/openrouter';
import { createLocalLLMProvider } from './providers/local';
import { createAnthropicProvider } from './providers/anthropic';
import { createOpenAIProvider } from './providers/openai';
import { createAgentOrchestrator } from './agents';
import type { BaseProvider } from './providers/base';
import type { AgentRequest, AgentResponse } from './agents/types';

const CLI_ARGS = process.argv.slice(2);
const STARTUP_COMMAND = CLI_ARGS[0]?.toLowerCase();

if (STARTUP_COMMAND === 'update') {
  const exitCode = await runUpdateCommand(CLI_ARGS.slice(1));
  process.exit(exitCode);
}

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
  const [setupMode, setSetupMode] = useState<SetupMode>('all');
  const [forceSetup, setForceSetup] = useState(false);
  const [initVersion, setInitVersion] = useState(0);
  const [historyView, setHistoryView] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  const startupCommandHandled = useRef(false);
  const updateCheckHandled = useRef(false);
  
  const {
    currentMessages,
    addMessage,
    createConversation,
    getCurrentConversation,
    getSortedConversations,
    switchConversation,
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

        // Prefer the user's configured provider, then fall back to the first available one.
        const preferredProvider = modelSettings.defaultProvider;
        const providerName = configured.includes(preferredProvider as any)
          ? preferredProvider
          : configured[0];
        const apiKey = getProviderApiKey(providerName as any);
        
        const providerInstance = createProvider(providerName);
        if (!providerInstance) {
          setShowWelcome(true);
          return;
        }

        // Initialize provider
        if (providerName === 'local') {
          const localSettings = useSettingsStore.getState().providers.local;
          await providerInstance.initialize({
            baseUrl:
              process.env.LOCAL_LLM_BASE_URL ||
              localSettings.baseUrl ||
              'http://localhost:11434',
            model: process.env.LOCAL_LLM_MODEL,
            enableThinking: process.env.LOCAL_LLM_THINKING === 'true',
          });
        } else {
          await providerInstance.initialize({
            apiKey,
          });
        }

        setProvider(providerInstance);
        
        // Resolve a model that actually belongs to the selected provider.
        let defaultModel = modelSettings.defaultModel || 'meta-llama/llama-3.1-70b-instruct';
        if (providerName === 'local') {
          const localModels = await providerInstance.listModels();
          const persistedLocalModel = localModels.find(
            (candidate) => candidate.id === modelSettings.defaultModel
          )?.id;

          defaultModel =
            process.env.LOCAL_LLM_MODEL ||
            persistedLocalModel ||
            localModels[0]?.id ||
            defaultModel;

          if (defaultModel !== modelSettings.defaultModel) {
            updateModelSettings({ defaultModel });
          }
        }
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

        if (STARTUP_COMMAND === 'resume' && !startupCommandHandled.current) {
          startupCommandHandled.current = true;
          setHistoryView(formatConversationHistory(
            useConversationStore.getState().getSortedConversations()
          ));
        }
      } catch (err) {
        setError(`Failed to initialize: ${err instanceof Error ? err.message : String(err)}`);
        setShowWelcome(true);
      }
    };

    init();
  }, [initVersion]);

  // Check for updates after startup without blocking local/offline use.
  useEffect(() => {
    if (!isInitialized || updateCheckHandled.current) return;
    updateCheckHandled.current = true;

    let cancelled = false;

    const checkUpdates = async () => {
      try {
        const check = await checkForUpdates();
        if (cancelled || !check.available) return;

        const preferences = getUpdatePreferences();
        const versionLabel =
          check.remoteVersion !== 'unknown'
            ? `v${check.remoteVersion}`
            : check.remoteSha.slice(0, 7);

        if (!preferences.autoUpdate) {
          setUpdateNotice(
            `SkyCode ${versionLabel} is available. Run "skycode update" to install it.`
          );
          return;
        }

        setUpdateNotice(`Updating SkyCode automatically to ${versionLabel}...`);

        try {
          const result = await performUpdate();
          if (!cancelled && result.updated) {
            setUpdateNotice(
              `SkyCode updated to v${result.version}. Restart SkyCode to use the update.`
            );
          }
        } catch (updateError) {
          if (!cancelled) {
            setUpdateNotice(
              `Automatic update could not be installed: ${
                updateError instanceof Error ? updateError.message : String(updateError)
              }`
            );
          }
        }
      } catch {
        // Offline or remote unavailable. SkyCode should continue normally.
      }
    };

    checkUpdates();

    return () => {
      cancelled = true;
    };
  }, [isInitialized]);

  // Handle welcome screen completion
  const handleWelcomeComplete = useCallback(() => {
    setShowWelcome(false);
    setForceSetup(false);
    setSetupMode('all');
    setIsInitialized(false);
    setError(null);
    setInitVersion((version) => version + 1);
  }, []);

  // Handle user input submission
  const handleSubmit = useCallback(async (text: string) => {
    if (!provider || !isInitialized || isProcessing) return;

    setIsProcessing(true);
    setError(null);
    setCurrentResponse('');

    try {
      // Capture the existing history before adding this turn. Agents append
      // request.input themselves, so passing the just-added user message would
      // duplicate the prompt.
      const previousMessages = useConversationStore
        .getState()
        .currentMessages
        .filter((message) => message.role !== 'system');

      addMessage('user', text);
      setHistoryView(null);

      // Create agent request
      const request: AgentRequest = {
        input: text,
        // Leave mode unset so the orchestrator can route general work,
        // coding, planning, and business requests intelligently.
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
        conversation: null,
        messages: previousMessages,
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
      createNewConversation(
        useConversationStore.getState(),
        'New Conversation',
        modelSettings.defaultProvider,
        model
      );
      setHistoryView(null);
    } else if (command === '/exit') {
      process.exit(0);
    } else if (command === '/model') {
      // Show available models
      const modelsList = `
Available Models:

OpenRouter (Open Weights):
  meta-llama/llama-3.1-70b-instruct (default)
  meta-llama/llama-3.1-8b-instruct
  mistralai/mistral-7b-instruct
  mistralai/mixtral-8x7b-instruct
  google/gemma-7b-it
  phi-3-mini-4k-instruct
  phi-3-small-8k-instruct
  openchat/openchat-7b

Local LLM (Ollama):
  llama3.1:70b-instruct
  llama3.1:8b-instruct
  llama3:70b-instruct
  llama3:8b-instruct
  mistral:7b-instruct
  mixtral:8x7b-instruct
  gemma:7b-instruct
  phi3:3.8b-mini-instruct
  phi3:7b-small-instruct
  qwen2:7b-instruct

Anthropic (Claude):
  claude-3-5-sonnet-20241022
  claude-3-opus-20240229
  claude-3-sonnet-20240229
  claude-3-haiku-20240307
  claude-2:1
  claude-instant-1:2

OpenAI (GPT):
  gpt-4o-mini
  gpt-4o
  gpt-4-turbo
  gpt-4
  gpt-3.5-turbo
  o1-preview
  o1-mini

Usage: /model <model-name>
Current model: ${model}
`.trim();
      addMessage('system', modelsList);
    } else if (command.startsWith('/model ')) {
      const modelName = command.slice(7).trim();
      setModel(modelName);
      updateModelSettings({ defaultModel: modelName });
      addMessage('system', `Switched to model: ${modelName}`);
    } else if (command === '/addcloud') {
      setSetupMode('cloud');
      setForceSetup(true);
      setShowWelcome(true);
    } else if (command === '/addlocal') {
      setSetupMode('local');
      setForceSetup(true);
      setShowWelcome(true);
    } else if (command === '/openroute' || command === '/addopenrouter') {
      setSetupMode('openrouter');
      setForceSetup(true);
      setShowWelcome(true);
    } else if (command === '/history' || command === '/chats') {
      setHistoryView(formatConversationHistory(getSortedConversations()));
    } else if (command === '/resume') {
      setHistoryView(formatConversationHistory(getSortedConversations()));
    } else if (command.startsWith('/resume ')) {
      const target = command.slice('/resume '.length).trim();
      const conversations = getSortedConversations();
      const byNumber = Number(target);
      const conversation =
        Number.isInteger(byNumber) && byNumber > 0
          ? conversations[byNumber - 1]
          : conversations.find((item) => item.id === target);

      if (!conversation) {
        setHistoryView(`Chat "${target}" was not found.\n\n${formatConversationHistory(conversations)}`);
      } else {
        switchConversation(conversation.id);
        setHistoryView(
          `Resumed: ${conversation.title}\nStarted: ${new Date(conversation.createdAt).toLocaleString()}\nMessages: ${conversation.messages.length}`
        );
      }
    } else if (command === '/copy') {
      const lastAssistant = [...useConversationStore.getState().currentMessages]
        .reverse()
        .find((message) => message.role === 'assistant');

      if (!lastAssistant) {
        setHistoryView('There is no assistant reply to copy yet.');
      } else if (copyToClipboard(lastAssistant.content)) {
        setCopiedMessageId(lastAssistant.id);
        setHistoryView('Copied the latest assistant reply to your clipboard.');
      } else {
        setHistoryView('Could not access the system clipboard on this machine.');
      }
    } else if (command === '/help') {
      const helpText = `
Available commands:
  /new       - Start a new conversation
  /exit      - Quit the application
  /model     - List available models
  /model <name> - Switch model
  /help      - Show this help
  /setup     - Configure any provider
  /addcloud  - Add a cloud AI provider (Anthropic or OpenAI)
  /addlocal  - Add a local AI server (Ollama, LM Studio, llama.cpp)
  /openroute - Add or update OpenRouter access
  /history   - List saved chats with start date and last activity
  /resume <number-or-id> - Resume a saved chat
  /copy      - Copy the latest assistant reply
  /clear     - Clear current conversation

CLI update commands:
  skycode update         - Install the latest SkyCode
  skycode update --check - Check without installing
  skycode update --auto  - Enable automatic updates and update now
  skycode update --no-auto - Disable automatic updates

Example usage:
  /model meta-llama/llama-3.1-70b-instruct
  /model claude-3-5-sonnet-20241022
  /model gpt-4o-mini

Current model: ${model}
Current provider: ${provider?.name || 'none'}
`.trim();
      addMessage('system', helpText);
    } else if (command === '/setup') {
      setSetupMode('all');
      setForceSetup(true);
      setShowWelcome(true);
    } else if (command === '/clear') {
      clearMessages();
      setHistoryView(null);
      addMessage('system', 'Conversation cleared');
    }
  }, [
    model,
    modelSettings.defaultProvider,
    provider,
    createNewConversation,
    addMessage,
    clearMessages,
    getSortedConversations,
    switchConversation,
    updateModelSettings,
  ]);

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
        <WelcomeScreen
          onComplete={handleWelcomeComplete}
          mode={setupMode}
          forceSetup={forceSetup}
        />
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

      {updateNotice && !showWelcome && (
        <box width="100%" maxWidth={78} paddingX={2}>
          <text fg="cyan">{updateNotice}</text>
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
              {msg.role === 'assistant' && (
                <text
                  fg={copiedMessageId === msg.id ? 'green' : 'gray'}
                  attributes={{ dim: copiedMessageId !== msg.id, underline: true }}
                  onMouseDown={() => {
                    if (copyToClipboard(msg.content)) {
                      setCopiedMessageId(msg.id);
                    }
                  }}
                >
                  {copiedMessageId === msg.id ? '✓ Copied' : 'Copy'}
                </text>
              )}
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
              {`${currentResponse}${isProcessing && !currentResponse.endsWith('|') ? '|' : ''}`}
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

      {historyView && (
        <box
          width="100%"
          maxWidth={78}
          paddingX={2}
          paddingY={1}
          border={['top']}
          borderColor="gray"
        >
          <text fg="yellow" wordWrap="break-word" width="100%">
            {historyView}
          </text>
        </box>
      )}

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

const renderer = await createCliRenderer({ exitOnCtrlC: false });

renderer.keyInput.on('keypress', (key) => {
  if (!(key.ctrl && key.name === 'c')) return;

  const selectedText = renderer.getSelection()?.getSelectedText() || '';
  if (selectedText) {
    copyToClipboard(selectedText);
    key.preventDefault();
    key.stopPropagation();
    return;
  }

  renderer.destroy();
});

createRoot(renderer).render(<App />);
