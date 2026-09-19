import { createCliRenderer, type ScrollBoxRenderable } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/header';
import { InputBar } from './components/input-bar';
import { ResponseContent } from './components/response-content';
import { WorkActivityView } from './components/work-activity-view';
import { ApprovalPrompt } from './components/approval-prompt';
import { WelcomeScreen, type SetupMode } from './components/welcome-screen';
import {
  useConversationStore,
  createNewConversation,
  formatConversationHistory,
  formatRelativeTime,
  getVisibleConversationMessages,
} from './store/conversation';
import { copyToClipboard } from './utils/clipboard';
import { runEvalCommand } from './eval/runner';
import { createContextBudget, fitHistoryToBudget } from './utils/context-window';
import {
  checkForUpdates,
  getCurrentVersion,
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
import { shouldContinueProjectTools } from './agents/project-tools';
import type { BaseProvider } from './providers/base';
import type {
  AgentActivity,
  AgentApprovalDecision,
  AgentApprovalRequest,
  AgentRequest,
  AgentResponse,
} from './agents/types';
import {
  formatCatalogLine,
  isFreeOpenRouterModel,
  type CatalogModel,
} from './utils/model-catalog';
import { SLASH_COMMANDS, validateSlashCommand } from './utils/slash-commands';
import {
  autoCaptureMemories,
  buildMemoryContext,
  clearMemories,
  forgetMemories,
  formatMemoryList,
  getMemoryPath,
  remember,
} from './store/memory';

let activeChatScroll: ScrollBoxRenderable | null = null;
let activeApprovalHandler:
  | ((decision: AgentApprovalDecision) => void)
  | null = null;

const CLI_ARGS = process.argv.slice(2);
const STARTUP_COMMAND = CLI_ARGS[0]?.toLowerCase();

if (STARTUP_COMMAND === '-v' || STARTUP_COMMAND === '--version' || STARTUP_COMMAND === 'version') {
  console.log(`SkyCode v${getCurrentVersion()}`);
  process.exit(0);
}

if (STARTUP_COMMAND === 'update') {
  const exitCode = await runUpdateCommand(CLI_ARGS.slice(1));
  process.exit(exitCode);
}

if (STARTUP_COMMAND === 'eval') {
  const exitCode = await runEvalCommand(CLI_ARGS.slice(1));
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

async function isLocalServerReachable(baseUrl: string): Promise<boolean> {
  const base = baseUrl.replace(/\/+$/, '');
  const roots = base.endsWith('/v1') ? [base.slice(0, -3), base] : [base];
  const candidates = [
    ...roots.map((root) => root + '/api/tags'),
    ...(base.endsWith('/v1')
      ? [base + '/models']
      : [base + '/v1/models', base + '/models']),
  ];

  for (const url of [...new Set(candidates)]) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      // Try the next local runtime endpoint.
    }
  }

  return false;
}

function App() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentResponse, setCurrentResponse] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<BaseProvider | null>(null);
  const [model, setModel] = useState<string>('');
  const [contextWindow, setContextWindow] = useState<number>(8192);
  const [showWelcome, setShowWelcome] = useState(false);
  const [setupMode, setSetupMode] = useState<SetupMode>('all');
  const [forceSetup, setForceSetup] = useState(false);
  const [initVersion, setInitVersion] = useState(0);
  const [historyView, setHistoryView] = useState<string | null>(null);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<string>('chat-agent');
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const [workActivities, setWorkActivities] = useState<AgentActivity[]>([]);
  const [pendingApproval, setPendingApproval] =
    useState<AgentApprovalRequest | null>(null);
  const startupCommandHandled = useRef(false);
  const updateCheckHandled = useRef(false);
  const messagesScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const orchestratorRef = useRef<ReturnType<typeof createAgentOrchestrator> | null>(null);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const approvalResolverRef = useRef<
    ((decision: AgentApprovalDecision) => void) | null
  >(null);
  const sessionPermissionKeysRef = useRef<Set<string>>(new Set());
  
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
    updatePermissionSettings,
  } = useSettingsStore();

  const visibleMessages = getVisibleConversationMessages(currentMessages);

  useEffect(() => {
    activeChatScroll = messagesScrollRef.current;

    return () => {
      if (activeChatScroll === messagesScrollRef.current) {
        activeChatScroll = null;
      }
    };
  }, []);

  const scrollChatToBottom = useCallback(() => {
    const scrollbox = messagesScrollRef.current;
    if (!scrollbox) return;

    // React/OpenTUI layout settles after the state update that appended the
    // latest stream chunk. Queue the scroll so scrollHeight includes it.
    setTimeout(() => {
      const current = messagesScrollRef.current;
      if (!current) return;

      try {
        current.scrollTo({ x: 0, y: current.scrollHeight });
      } catch {
        current.scrollTop = current.scrollHeight;
      }
    }, 0);
  }, []);

  useEffect(() => {
    if (isProcessing) {
      scrollChatToBottom();
    }
  }, [currentResponse, isProcessing, scrollChatToBottom]);

  useEffect(() => {
    scrollChatToBottom();
  }, [visibleMessages.length, scrollChatToBottom]);

  const requestAgentApproval = useCallback(
    async (request: AgentApprovalRequest): Promise<AgentApprovalDecision> => {
      const persistent = useSettingsStore.getState().permissions?.alwaysAllow || [];

      if (persistent.includes(request.permissionKey)) {
        return 'always';
      }

      if (sessionPermissionKeysRef.current.has(request.permissionKey)) {
        return 'session';
      }

      return await new Promise<AgentApprovalDecision>((resolve) => {
        approvalResolverRef.current = resolve;
        setPendingApproval(request);
        scrollChatToBottom();
      });
    },
    [scrollChatToBottom]
  );

  const resolveApproval = useCallback(
    (decision: AgentApprovalDecision) => {
      const request = pendingApproval;
      const resolver = approvalResolverRef.current;
      if (!request || !resolver) return;

      if (decision === 'session' || decision === 'always') {
        sessionPermissionKeysRef.current.add(request.permissionKey);
      }

      if (decision === 'always') {
        const current = useSettingsStore.getState().permissions?.alwaysAllow || [];
        if (!current.includes(request.permissionKey)) {
          updatePermissionSettings({
            alwaysAllow: [...current, request.permissionKey],
          });
        }
      }

      approvalResolverRef.current = null;
      setPendingApproval(null);
      resolver(decision);
      scrollChatToBottom();
    },
    [pendingApproval, scrollChatToBottom, updatePermissionSettings]
  );

  useEffect(() => {
    activeApprovalHandler = pendingApproval ? resolveApproval : null;
    return () => {
      if (activeApprovalHandler === resolveApproval) {
        activeApprovalHandler = null;
      }
    };
  }, [pendingApproval, resolveApproval]);

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

        try {
          const explicitContext = Number(
            process.env.LOCAL_LLM_CONTEXT_LENGTH || process.env.SKYCODE_CONTEXT_LENGTH || ''
          );
          const modelInfo = await providerInstance.getModel(defaultModel);
          const resolvedContext =
            Number.isFinite(explicitContext) && explicitContext > 0
              ? explicitContext
              : modelInfo?.contextLength || 8192;
          setContextWindow(resolvedContext);
        } catch {
          setContextWindow(8192);
        }

        // Initialize agents with context
        const orchestrator = createAgentOrchestrator();
        await orchestrator.initializeAll({
          provider: providerInstance,
          model: defaultModel,
          workingDirectory: process.cwd(),
          env: { ...process.env },
        });
        orchestratorRef.current = orchestrator;

        setIsInitialized(true);

        if (STARTUP_COMMAND === 'resume' && !startupCommandHandled.current) {
          startupCommandHandled.current = true;
          setShowHistoryPanel(true);
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
    if (!provider || !isInitialized) return;

    if (isProcessing) {
      setQueuedMessages((queue) => [...queue, text]);
      return;
    }

    setIsProcessing(true);
    setError(null);
    setCurrentResponse('');
    setWorkActivities([]);

    try {
      // Capture the existing history before adding this turn. Agents append
      // request.input themselves, so passing the just-added user message would
      // duplicate the prompt.
      const conversationState = useConversationStore.getState();
      const fullHistory = conversationState
        .currentMessages
        .filter((message) => message.role !== 'system');

      // Capture durable facts/preferences first so corrections become
      // authoritative before memory is retrieved for this same turn.
      autoCaptureMemories(text, {
        conversationId: conversationState.currentConversationId,
        workspace: process.cwd(),
      });

      const memoryContext = buildMemoryContext({
        query: text,
        workspace: process.cwd(),
        currentConversationId: conversationState.currentConversationId,
        conversations: conversationState.conversations,
        maxChars: Math.min(6000, Math.max(1200, Math.floor(contextWindow * 0.6))),
      });

      const budget = createContextBudget(contextWindow, text);
      const fittedHistory = fitHistoryToBudget(fullHistory, budget.historyBudget);
      const previousMessages = fittedHistory.messages;

      addMessage('user', text);
      setHistoryView(null);
      setShowHistoryPanel(false);

      const abortController = new AbortController();
      activeAbortControllerRef.current = abortController;

      // Create agent request
      const continuingProjectWork = shouldContinueProjectTools(
        text,
        previousMessages
      );

      const request: AgentRequest = {
        input: text,
        context: {
          maxTokens: budget.responseReserve,
          contextWindow: budget.contextWindow,
          droppedHistoryMessages: fittedHistory.droppedCount,
          signal: abortController.signal,
          ...(continuingProjectWork ? { agent: 'coding-agent' } : {}),
        },
        // Leave mode unset so the orchestrator can route general work,
        // coding, planning, and business requests intelligently.
        onStream: (chunk) => {
          setCurrentResponse((prev) => prev + chunk);
          scrollChatToBottom();
        },
        onActivity: (activity) => {
          setWorkActivities((current) => {
            const index = current.findIndex((item) => item.id === activity.id);
            if (index === -1) return [...current, activity];

            const next = [...current];
            next[index] = { ...next[index], ...activity };
            return next;
          });
          scrollChatToBottom();
        },
        onApproval: requestAgentApproval,
        onComplete: (response: AgentResponse) => {
          const finalContent = response.content.trim();

          // Never commit an empty assistant bubble. Empty output is a provider
          // failure, not a valid chat message.
          if (!finalContent) {
            activeAbortControllerRef.current = null;
            setCurrentResponse('');
            setError(
              'The selected model returned no visible answer. SkyCode did not add an empty assistant message; try again or switch models.'
            );
            setIsProcessing(false);
            scrollChatToBottom();
            return;
          }

          addMessage('assistant', response.content, {
            model: response.metadata?.model,
            finishReason: response.metadata?.finishReason,
          });
          activeAbortControllerRef.current = null;
          setIsProcessing(false);
          setCurrentResponse('');
          scrollChatToBottom();
        },
        onError: (err) => {
          const wasCancelled = abortController.signal.aborted;
          activeAbortControllerRef.current = null;
          setCurrentResponse('');
          setError(wasCancelled ? 'Generation cancelled.' : err.message);
          setIsProcessing(false);
          scrollChatToBottom();
        },
      };

      // Reuse one orchestrator across turns so route continuity and diagnostics
      // survive follow-up messages.
      const orchestrator = orchestratorRef.current || createAgentOrchestrator();
      orchestratorRef.current = orchestrator;

      await orchestrator.initializeAll({
        conversation: null,
        messages: previousMessages,
        provider,
        model,
        workingDirectory: process.cwd(),
        env: { ...process.env },
        memoryContext,
      });

      const streamPromise = orchestrator.routeRequestStream(request);
      const route = orchestrator.getLastRouteDecision();
      if (route) setActiveAgent(route.agentName);

      await streamPromise;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const wasCancelled =
        activeAbortControllerRef.current?.signal.aborted === true ||
        /abort|cancel/i.test(errorMessage);
      activeAbortControllerRef.current = null;
      setError(wasCancelled ? 'Generation cancelled.' : errorMessage);
      setIsProcessing(false);
    }
  }, [provider, isInitialized, isProcessing, model, contextWindow, addMessage]);

  useEffect(() => {
    if (isProcessing || queuedMessages.length === 0 || !isInitialized || !provider) return;

    const [nextMessage, ...rest] = queuedMessages;
    setQueuedMessages(rest);
    void handleSubmit(nextMessage);
  }, [isProcessing, queuedMessages, isInitialized, provider, handleSubmit]);

  const cancelGeneration = useCallback(() => {
    const approvalResolver = approvalResolverRef.current;
    approvalResolverRef.current = null;
    setPendingApproval(null);
    approvalResolver?.('deny');

    activeAbortControllerRef.current?.abort();
    setQueuedMessages([]);
  }, []);

  const loadUnifiedModelCatalog = useCallback(async (): Promise<CatalogModel[]> => {
    const entries: CatalogModel[] = [];

    const openRouterKey = getProviderApiKey('openrouter');
    if (openRouterKey) {
      const openRouter = createOpenRouterProvider();
      await openRouter.initialize({ apiKey: openRouterKey });

      try {
        const models = await openRouter.listModels();
        entries.push(
          ...models.map((item) => ({
            provider: 'openrouter' as const,
            model: item,
            free: isFreeOpenRouterModel(item),
            local: false,
          }))
        );
      } finally {
        await openRouter.close();
      }
    }

    const localSettings = useSettingsStore.getState().providers.local;
    const localBaseUrl =
      process.env.LOCAL_LLM_BASE_URL ||
      localSettings.baseUrl ||
      'http://localhost:11434';

    if (await isLocalServerReachable(localBaseUrl)) {
      const localProvider = createLocalLLMProvider();
      await localProvider.initialize({
        baseUrl: localBaseUrl,
        model: process.env.LOCAL_LLM_MODEL,
        enableThinking: process.env.LOCAL_LLM_THINKING === 'true',
      });

      try {
        const models = await localProvider.listModels();
        entries.push(
          ...models.map((item) => ({
            provider: 'local' as const,
            model: item,
            free: true,
            local: true,
          }))
        );
      } finally {
        await localProvider.close();
      }
    }

    return entries;
  }, []);

  const activateCatalogModel = useCallback(async (
    providerName: 'openrouter' | 'local',
    modelId: string
  ) => {
    const nextProvider = createProvider(providerName);
    if (!nextProvider) {
      throw new Error('Provider is not supported: ' + providerName);
    }

    if (providerName === 'openrouter') {
      const apiKey = getProviderApiKey('openrouter');
      if (!apiKey) {
        throw new Error('OpenRouter is not configured. Set OPENROUTER_API_KEY or run /openroute.');
      }
      await nextProvider.initialize({ apiKey });
    } else {
      const localSettings = useSettingsStore.getState().providers.local;
      const baseUrl =
        process.env.LOCAL_LLM_BASE_URL ||
        localSettings.baseUrl ||
        'http://localhost:11434';

      if (!(await isLocalServerReachable(baseUrl))) {
        throw new Error('Local AI server is not reachable at ' + baseUrl);
      }

      await nextProvider.initialize({
        baseUrl,
        model: modelId,
        enableThinking: process.env.LOCAL_LLM_THINKING === 'true',
      });
    }

    const modelInfo = await nextProvider.getModel(modelId);
    if (!modelInfo) {
      await nextProvider.close();
      throw new Error('Model was not found on ' + providerName + ': ' + modelId);
    }

    await provider?.close().catch(() => undefined);
    setProvider(nextProvider);
    setModel(modelId);
    setContextWindow(modelInfo.contextLength || 8192);
    updateModelSettings({
      defaultProvider: providerName,
      defaultModel: modelId,
    });

    const orchestrator = createAgentOrchestrator();
    await orchestrator.initializeAll({
      provider: nextProvider,
      model: modelId,
      workingDirectory: process.cwd(),
      env: { ...process.env },
    });
    orchestratorRef.current = orchestrator;
  }, [provider, updateModelSettings]);

  // Handle command execution
  const handleCommand = useCallback(async (command: string) => {
    const validation = validateSlashCommand(command);
    if (!validation.ok) {
      addMessage('system', validation.error || 'Invalid command. Use /help.');
      return;
    }
    command = validation.normalized;

    if (command === '/new') {
      createNewConversation(
        useConversationStore.getState(),
        'New Conversation',
        modelSettings.defaultProvider,
        model
      );
      setHistoryView(null);
      setShowHistoryPanel(false);
    } else if (command === '/exit') {
      process.exit(0);
    } else if (command === '/memory') {
      addMessage(
        'system',
        formatMemoryList(process.cwd()) + '\n\nStored at: ' + getMemoryPath()
      );
    } else if (command === '/memory clear') {
      const count = clearMemories();
      addMessage('system', 'Cleared ' + count + ' durable memory record(s). Past chat history is unchanged.');
    } else if (command === '/permissions') {
      const persistent =
        useSettingsStore.getState().permissions?.alwaysAllow || [];
      const session = [...sessionPermissionKeysRef.current];

      addMessage(
        'system',
        [
          'SkyCode permissions',
          '',
          'Persistent always-allow:',
          ...(persistent.length > 0
            ? persistent.map((key) => '  - ' + key)
            : ['  (none)']),
          '',
          'This-session allow:',
          ...(session.length > 0
            ? session.map((key) => '  - ' + key)
            : ['  (none)']),
          '',
          'Use /permissions reset to clear both lists.',
        ].join('\n')
      );
    } else if (command === '/permissions reset') {
      sessionPermissionKeysRef.current.clear();
      updatePermissionSettings({ alwaysAllow: [] });
      addMessage(
        'system',
        'Cleared persistent and session tool approvals. Future workspace-changing commands will ask again.'
      );
    } else if (command.startsWith('/remember ')) {
      const fact = command.slice('/remember '.length).trim();
      const saved = remember(fact, {
        kind: 'fact',
        sourceConversationId: useConversationStore.getState().currentConversationId || undefined,
      });
      addMessage(
        'system',
        saved
          ? 'Remembered: ' + saved.value
          : 'I did not save that. Empty values and likely secrets/API keys are rejected.'
      );
    } else if (command.startsWith('/forget ')) {
      const query = command.slice('/forget '.length).trim();
      const count = forgetMemories(query, process.cwd());
      addMessage(
        'system',
        count > 0
          ? 'Forgot ' + count + ' matching durable memory record(s).'
          : 'No durable memory matched "' + query + '".'
      );
    } else if (command === '/model') {
      try {
        const catalog = await loadUnifiedModelCatalog();
        const openRouterModels = catalog.filter((entry) => entry.provider === 'openrouter');
        const localModels = catalog.filter((entry) => entry.provider === 'local');

        const freeCount = openRouterModels.filter((entry) => entry.free).length;
        const paidCount = openRouterModels.length - freeCount;

        addMessage(
          'system',
          [
            'Available AI models',
            '',
            openRouterModels.length > 0
              ? 'OPENROUTER — ' + openRouterModels.length + ' models (' + freeCount + ' free, ' + paidCount + ' paid)'
              : 'OPENROUTER — not configured or no models returned',
            ...openRouterModels.map((entry) =>
              formatCatalogLine(entry, {
                provider: provider?.name || '',
                model,
              })
            ),
            '',
            localModels.length > 0
              ? 'LOCAL — ' + localModels.length + ' model(s) detected on your running local server'
              : 'LOCAL — no running local AI server detected',
            ...localModels.map((entry) =>
              formatCatalogLine(entry, {
                provider: provider?.name || '',
                model,
              })
            ),
            '',
            'Labels: [FREE] = zero OpenRouter prompt/completion price; [PAID] shows current per-million-token prices; [LOCAL · FREE] runs on your own machine.',
            'Switch with: /model openrouter:<model-id> or /model local:<model-id>',
            'Search everything with: /model search <query>',
          ].join('\n')
        );
      } catch (modelError) {
        addMessage(
          'system',
          'Could not load the model catalog: ' +
            (modelError instanceof Error ? modelError.message : String(modelError))
        );
      }
    } else if (command.startsWith('/model search ')) {
      const query = command.slice('/model search '.length).trim().toLowerCase();

      try {
        const catalog = await loadUnifiedModelCatalog();
        const matches = catalog.filter((entry) =>
          [
            entry.model.id,
            entry.model.name,
            entry.model.description,
            ...(entry.model.tags || []),
            entry.provider,
            entry.free ? 'free' : 'paid',
          ]
            .join(' ')
            .toLowerCase()
            .includes(query)
        );

        addMessage(
          'system',
          matches.length > 0
            ? [
                'Models matching "' + query + '" — ' + matches.length,
                '',
                ...matches.map((entry) =>
                  formatCatalogLine(entry, {
                    provider: provider?.name || '',
                    model,
                  })
                ),
                '',
                'Switch with the exact selector shown above.',
              ].join('\n')
            : 'No OpenRouter or running local models matched "' + query + '".'
        );
      } catch (modelError) {
        addMessage(
          'system',
          'Could not search models: ' +
            (modelError instanceof Error ? modelError.message : String(modelError))
        );
      }
    } else if (command.startsWith('/model ')) {
      const selector = command.slice(7).trim();
      const separator = selector.indexOf(':');
      const explicitProvider = separator > 0 ? selector.slice(0, separator) : '';
      const explicitModel = separator > 0 ? selector.slice(separator + 1) : selector;

      try {
        if (explicitProvider === 'openrouter' || explicitProvider === 'local') {
          await activateCatalogModel(explicitProvider, explicitModel);
          addMessage(
            'system',
            'Switched to ' + explicitProvider + ' model: ' + explicitModel
          );
        } else if (provider?.name === 'openrouter' || provider?.name === 'local') {
          await activateCatalogModel(provider.name, selector);
          addMessage(
            'system',
            'Switched to ' + provider.name + ' model: ' + selector
          );
        } else {
          setModel(selector);
          updateModelSettings({ defaultModel: selector });
          addMessage('system', 'Switched to model: ' + selector);
        }
      } catch (modelError) {
        addMessage(
          'system',
          'Could not switch model: ' +
            (modelError instanceof Error ? modelError.message : String(modelError))
        );
      }
    } else if (command === '/addcloud') {
      setSetupMode('cloud');
      setForceSetup(true);
      setShowWelcome(true);
    } else if (command === '/addlocal') {
      setSetupMode('local');
      setForceSetup(true);
      setShowWelcome(true);
    } else if (command === '/openroute' || command === '/openrouter' || command === '/addopenrouter') {
      setSetupMode('openrouter');
      setForceSetup(true);
      setShowWelcome(true);
    } else if (command === '/history' || command === '/chats') {
      setHistoryView(null);
      setShowHistoryPanel(true);
    } else if (command === '/resume') {
      setHistoryView(null);
      setShowHistoryPanel(true);
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
        setShowHistoryPanel(false);
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
    } else if (command === '/doctor') {
      const configuredProviders = getConfiguredProviders();
      const conversationState = useConversationStore.getState();
      const memoryPath = getMemoryPath();

      addMessage(
        'system',
        [
          'SkyCode doctor',
          '',
          'Slash commands: OK (' + SLASH_COMMANDS.length + ' public commands registered)',
          'Active provider: ' + (provider?.name || 'none'),
          'Active model: ' + (model || 'none'),
          'Configured providers: ' + (configuredProviders.length > 0 ? configuredProviders.join(', ') : 'none'),
          'Saved chats: ' + Object.keys(conversationState.conversations).length,
          'Memory store: ' + memoryPath,
          'Workspace: ' + process.cwd(),
          '',
          'This checks command wiring and local state. Provider/network-specific operations can still report their own connection errors gracefully.',
        ].join('\n')
      );
    } else if (command === '/help') {
      const helpText = `
Available commands:
  /new       - Start a new conversation
  /exit      - Quit the application
  /memory    - Show durable cross-chat memory
  /remember <fact> - Save a durable fact or preference
  /forget <query> - Remove matching durable memory
  /memory clear - Clear all durable memory
  /model     - List OpenRouter + running local models with FREE/PAID labels
  /model search <query> - Search OpenRouter + local models
  /model openrouter:<id> - Switch to an OpenRouter model
  /model local:<id> - Switch to a running local model
  /doctor    - Check command/provider/storage health
  /permissions - Show persistent/session tool approvals
  /permissions reset - Clear saved and session approvals
  /help      - Show this help
  /setup     - Configure any provider
  /addcloud  - Add a cloud AI provider (Anthropic or OpenAI)
  /addlocal  - Add a local AI server (Ollama, LM Studio, llama.cpp)
  /openroute - Add or update OpenRouter access
  /history   - List saved chats with start date and last activity
  /resume <number-or-id> - Resume a saved chat
  /copy      - Copy the latest assistant reply
  /cancel    - Cancel the active generation
  /clear     - Clear current conversation

CLI commands:
  skycode -v             - Show the installed SkyCode version
  skycode --version      - Show the installed SkyCode version
  skycode version        - Show the installed SkyCode version
  skycode update         - Install the latest SkyCode
  skycode update --check - Check without installing
  skycode update --auto  - Enable automatic updates and update now
  skycode update --no-auto - Disable automatic updates
  skycode update --status - Show automatic-update health
  skycode eval            - Run the local AI smoke evaluation
  skycode eval --all      - Run the full 100-case evaluation suite

Example usage:
  /model
  /model search qwen
  /model <provider/model-id>

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
      setShowHistoryPanel(false);
      addMessage('system', 'Conversation cleared');
    }
  }, [
    model,
    modelSettings.defaultProvider,
    provider,
    loadUnifiedModelCatalog,
    activateCatalogModel,
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
      justifyContent="flex-start"
      flexDirection="column"
      backgroundColor="#0D0D12"
      width="100%"
      height="100%"
      overflow="hidden"
      gap={1}
    >
      <box flexShrink={0} width="100%" alignItems="center">
        <Header />
      </box>
            <box flexShrink={0} width="96%" paddingX={2} flexDirection="row" gap={2}>
        <text
          fg="cyan"
          attributes={{ underline: true }}
          onMouseDown={() => {
            createNewConversation(
              useConversationStore.getState(),
              'New Conversation',
              modelSettings.defaultProvider,
              model
            );
            setHistoryView(null);
            setShowHistoryPanel(false);
          }}
        >
          + New chat
        </text>
        <text
          fg={showHistoryPanel ? 'magenta' : 'gray'}
          attributes={{ underline: true }}
          onMouseDown={() => {
            setHistoryView(null);
            setShowHistoryPanel((visible) => !visible);
          }}
        >
          Chats ({getSortedConversations().length})
        </text>
        <text fg="gray" attributes={{ dim: true }}>
          Agent: {activeAgent}
        </text>
        {queuedMessages.length > 0 && (
          <text fg="yellow">Queued: {queuedMessages.length}</text>
        )}
        {isProcessing && (
          <text
            fg="red"
            attributes={{ underline: true }}
            onMouseDown={cancelGeneration}
          >
            Cancel
          </text>
        )}
      </box>

      {showHistoryPanel && (
        <box
          width="96%"
          paddingX={2}
          flexDirection="column"
          flexShrink={0}
          maxHeight={14}
          border={['top', 'bottom']}
          borderColor="gray"
          backgroundColor="#111119"
        >
          <box width="100%" flexDirection="row" justifyContent="space-between" paddingY={1}>
            <text fg="white">Saved chats</text>
            <text
              fg="gray"
              attributes={{ underline: true }}
              onMouseDown={() => setShowHistoryPanel(false)}
            >
              Close
            </text>
          </box>

          <scrollbox
            width="100%"
            flexDirection="column"
            maxHeight={11}
            overflow="hidden"
          >
            {getSortedConversations().length === 0 ? (
              <text fg="gray" attributes={{ dim: true }}>No saved chats yet.</text>
            ) : (
              getSortedConversations().map((conversation) => {
                const isCurrent =
                  useConversationStore.getState().currentConversationId === conversation.id;

                return (
                  <box
                    key={conversation.id}
                    width="100%"
                    flexDirection="column"
                    paddingX={1}
                    paddingY={0.5}
                    backgroundColor={isCurrent ? '#1E2530' : '#111119'}
                    onMouseDown={() => {
                      switchConversation(conversation.id);
                      setShowHistoryPanel(false);
                      setHistoryView(null);
                    }}
                  >
                    <text fg={isCurrent ? 'cyan' : 'white'}>
                      {isCurrent ? '● ' : '  '}{conversation.title}
                    </text>
                    <text fg="gray" attributes={{ dim: true }}>
                      {formatRelativeTime(conversation.updatedAt)} · {getVisibleConversationMessages(conversation.messages).length} messages
                    </text>
                  </box>
                );
              })
            )}
          </scrollbox>
        </box>
      )}
      
      {/* Setup instructions if no API key */}
      {needsSetup && (
        <box width="96%" paddingX={2}>
          <text fg="yellow">
            ⚠️  No AI provider configured.
          </text>
          <text fg="gray" attributes={{ dim: true }}>
            {' Type /setup to configure API keys or use /help'}
          </text>
        </box>
      )}

      {updateNotice && !showWelcome && (
        <box width="96%" paddingX={2}>
          <text fg="cyan">{updateNotice}</text>
        </box>
      )}

      {/* Error display */}
      {error && !showWelcome && (
        <box width="96%" paddingX={2}>
          <text fg="red" wordWrap="break-word" width="100%">
            {'❌ ' + String(error)}
          </text>
        </box>
      )}

      {/* Messages display */}
      <scrollbox
        ref={messagesScrollRef}
        width="96%"
        paddingX={2}
        flexDirection="column"
        gap={1}
        flexGrow={1}
        flexShrink={1}
        minHeight={1}
        height="100%"
        overflow="hidden"
        stickyScroll={true}
        stickyStart="bottom"
      >
        {visibleMessages.length > 0 ? (
          visibleMessages.map((msg) => (
            <box
              key={msg.id}
              width="100%"
              flexDirection="column"
              gap={0.5}
              paddingY={0.5}
            >
              <text
                fg={msg.role === 'user' ? 'cyan' : msg.role === 'assistant' ? 'green' : 'yellow'}
              >
                {msg.role === 'user' ? '👤 User' : msg.role === 'assistant' ? '🤖 Assistant' : '⚙️ System'}:
              </text>
              {msg.role === 'assistant' ? (
                <ResponseContent content={msg.content} />
              ) : (
                <text wordWrap="break-word" width="100%">{msg.content}</text>
              )}
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
            <box width="100%" flexDirection="column" gap={1}>
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
          <box width="100%" flexDirection="column" gap={0.5} paddingY={0.5}>
            <text fg="green">🤖 Assistant:</text>
            <ResponseContent content={currentResponse} streaming={true} />
          </box>
        )}

        {isProcessing && workActivities.length > 0 && (
          <box width="100%" flexDirection="column" gap={0.5} paddingY={0.5}>
            <WorkActivityView activities={workActivities} />
          </box>
        )}

        {pendingApproval && (
          <box width="100%" flexDirection="column" paddingY={0.5}>
            <ApprovalPrompt
              request={pendingApproval}
              onDecision={resolveApproval}
            />
          </box>
        )}

        {isProcessing && !currentResponse && workActivities.length === 0 && !pendingApproval && (
          <box width="100%" flexDirection="column" gap={0.5} paddingY={0.5}>
            <text fg="green">🤖 Assistant:</text>
            <text attributes={{ blink: true }}>Thinking...</text>
          </box>
        )}
        {historyView && (
          <box
            width="100%"
            paddingY={1}
            border={['top']}
            borderColor="gray"
            flexShrink={0}
          >
            <text fg="yellow" wordWrap="break-word" width="100%">
              {historyView}
            </text>
          </box>
        )}
      </scrollbox>

      {/* Input bar */}
      <box width="96%" paddingX={2} flexShrink={0}>
        <InputBar 
          onSubmit={handleSubmit}
          disabled={!isInitialized || showWelcome}
          loadModelCatalog={loadUnifiedModelCatalog}
          currentProvider={provider?.name || ''}
          currentModel={model}
          onCommand={(command) => {
            if (command === '/cancel') {
              if (isProcessing) {
                cancelGeneration();
              } else {
                setHistoryView('There is no active generation to cancel.');
              }
              return;
            }

            if (isProcessing) {
              setHistoryView('Generation in progress. Use /cancel or the Cancel control first.');
              return;
            }

            void handleCommand(command).catch((commandError) => {
              addMessage(
                'system',
                'Command failed safely: ' +
                  (commandError instanceof Error ? commandError.message : String(commandError))
              );
            });
          }}
        />
      </box>

    </box>
  );
}

const renderer = await createCliRenderer({ exitOnCtrlC: false });

renderer.keyInput.on('keypress', (key) => {
  if (activeApprovalHandler && !key.ctrl) {
    const approvalKeys: Record<string, AgentApprovalDecision> = {
      '1': 'once',
      '2': 'session',
      '3': 'always',
      '4': 'deny',
    };
    const decision = approvalKeys[key.name || ''];
    if (decision) {
      activeApprovalHandler(decision);
      key.preventDefault();
      key.stopPropagation();
      return;
    }
  }

  if (key.name === 'pageup' && activeChatScroll) {
    activeChatScroll.scrollBy(-10);
    key.preventDefault();
    key.stopPropagation();
    return;
  }

  if (key.name === 'pagedown' && activeChatScroll) {
    activeChatScroll.scrollBy(10);
    key.preventDefault();
    key.stopPropagation();
    return;
  }

  if (key.ctrl && key.name === 'home' && activeChatScroll) {
    activeChatScroll.scrollTo(0);
    key.preventDefault();
    key.stopPropagation();
    return;
  }

  if (key.ctrl && key.name === 'end' && activeChatScroll) {
    activeChatScroll.scrollTo(Number.MAX_SAFE_INTEGER);
    key.preventDefault();
    key.stopPropagation();
    return;
  }

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
