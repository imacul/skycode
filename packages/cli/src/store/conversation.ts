// Conversation store for managing chat state
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Message role types
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Message interface
 */
export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  // Metadata
  metadata?: {
    model?: string;
    finishReason?: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };
}

/**
 * Conversation interface
 */
export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
  // Metadata
  metadata?: {
    model?: string;
    provider?: string;
    totalTokens?: number;
  };
}

/**
 * Conversation store state
 */
interface ConversationState {
  // Current active conversation
  currentConversationId: string | null;
  // All conversations
  conversations: Record<string, Conversation>;
  // Messages in current conversation (for quick access)
  currentMessages: Message[];
  // Loading state
  isLoading: boolean;
  isStreaming: boolean;
  // Error state
  error: string | null;
  // Provider info
  currentProvider: string;
  currentModel: string;
}

/**
 * Conversation store actions
 */
interface ConversationActions {
  // Create a new conversation
  createConversation: (title?: string) => Conversation;
  
  // Switch to an existing conversation
  switchConversation: (conversationId: string) => void;
  
  // Add a message to current conversation
  addMessage: (role: MessageRole, content: string, metadata?: Message['metadata']) => Message;
  
  // Update a message (e.g., for streaming)
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  
  // Remove a message
  removeMessage: (messageId: string) => void;
  
  // Clear all messages in current conversation
  clearMessages: () => void;
  
  // Delete a conversation
  deleteConversation: (conversationId: string) => void;
  
  // Set loading state
  setLoading: (isLoading: boolean) => void;
  
  // Set streaming state
  setStreaming: (isStreaming: boolean) => void;
  
  // Set error
  setError: (error: string | null) => void;
  
  // Set provider and model
  setProvider: (provider: string, model: string) => void;
  
  // Get current conversation
  getCurrentConversation: () => Conversation | null;
  
  // Get messages for a conversation
  getConversationMessages: (conversationId: string) => Message[];
  
  // Get all conversations sorted by updatedAt
  getSortedConversations: () => Conversation[];
}

/**
 * Conversation store type
 */
type ConversationStore = ConversationState & ConversationActions;

const CONVERSATIONS_FILE =
  process.env.SKYCODE_HISTORY_PATH ||
  join(homedir(), '.skycode', 'conversations.json');

const conversationStorage: StateStorage = {
  getItem: () => {
    if (!existsSync(CONVERSATIONS_FILE)) return null;
    return readFileSync(CONVERSATIONS_FILE, 'utf8');
  },
  setItem: (_name, value) => {
    mkdirSync(dirname(CONVERSATIONS_FILE), { recursive: true });
    writeFileSync(CONVERSATIONS_FILE, value, 'utf8');
  },
  removeItem: () => {
    if (existsSync(CONVERSATIONS_FILE)) unlinkSync(CONVERSATIONS_FILE);
  },
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatRelativeTime(value: Date | string, now = new Date()): string {
  const date = toDate(value);
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

export function formatConversationHistory(conversations: Conversation[]): string {
  if (conversations.length === 0) {
    return 'No saved chats yet.';
  }

  const lines = conversations.map((conversation, index) => {
    const created = toDate(conversation.createdAt);
    const updated = toDate(conversation.updatedAt);
    return `${index + 1}. ${conversation.title}\n   ID: ${conversation.id}\n   Started: ${created.toLocaleString()}\n   Last chat: ${formatRelativeTime(updated)}\n   Messages: ${conversation.messages.length}`;
  });

  return `Saved chats:\n\n${lines.join('\n\n')}\n\nUse /resume <number-or-id> to open one.`;
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create the conversation store
 */
export const useConversationStore = create<ConversationStore>()(
  persist(
    (set, get) => ({
  // State
  currentConversationId: null,
  conversations: {},
  currentMessages: [],
  isLoading: false,
  isStreaming: false,
  error: null,
  currentProvider: 'openrouter',
  currentModel: 'meta-llama/llama-3.1-70b-instruct',

  // Actions
  createConversation: (title?: string) => {
    const id = generateId();
    const now = new Date();
    const conversation: Conversation = {
      id,
      title: title || `Conversation ${Object.keys(get().conversations).length + 1}`,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    set((state) => ({
      conversations: {
        ...state.conversations,
        [id]: conversation,
      },
      currentConversationId: id,
      currentMessages: [],
    }));

    return conversation;
  },

  switchConversation: (conversationId: string) => {
    const conversation = get().conversations[conversationId];
    if (!conversation) {
      console.warn(`Conversation ${conversationId} not found`);
      return;
    }

    set({
      currentConversationId: conversationId,
      currentMessages: conversation.messages,
    });
  },

  addMessage: (role, content, metadata) => {
    const id = generateId();
    const now = new Date();
    const message: Message = {
      id,
      role,
      content,
      timestamp: now,
      metadata,
    };

    const currentId = get().currentConversationId;
    if (!currentId) {
      // Create a new conversation if none exists
      const conversation = get().createConversation();
      return get().addMessage(role, content, metadata);
    }

    set((state) => {
      const conversation = state.conversations[currentId];
      if (!conversation) return state;

      const shouldAutoTitle =
        role === 'user' &&
        conversation.messages.filter((msg) => msg.role === 'user').length === 0 &&
        /^(Conversation \d+|New Conversation)$/.test(conversation.title);

      const autoTitle = content.trim().replace(/\s+/g, ' ').slice(0, 60);
      const updatedConversation = {
        ...conversation,
        title: shouldAutoTitle && autoTitle ? autoTitle : conversation.title,
        messages: [...conversation.messages, message],
        updatedAt: now,
      };

      return {
        conversations: {
          ...state.conversations,
          [currentId]: updatedConversation,
        },
        currentMessages: updatedConversation.messages,
      };
    });

    return message;
  },

  updateMessage: (messageId, updates) => {
    const currentId = get().currentConversationId;
    if (!currentId) return;

    set((state) => {
      const conversation = state.conversations[currentId];
      if (!conversation) return state;

      const updatedMessages = conversation.messages.map((msg) =>
        msg.id === messageId ? { ...msg, ...updates } : msg
      );

      const updatedConversation = {
        ...conversation,
        messages: updatedMessages,
        updatedAt: new Date(),
      };

      return {
        conversations: {
          ...state.conversations,
          [currentId]: updatedConversation,
        },
        currentMessages: updatedMessages,
      };
    });
  },

  removeMessage: (messageId: string) => {
    const currentId = get().currentConversationId;
    if (!currentId) return;

    set((state) => {
      const conversation = state.conversations[currentId];
      if (!conversation) return state;

      const updatedMessages = conversation.messages.filter(
        (msg) => msg.id !== messageId
      );

      const updatedConversation = {
        ...conversation,
        messages: updatedMessages,
        updatedAt: new Date(),
      };

      return {
        conversations: {
          ...state.conversations,
          [currentId]: updatedConversation,
        },
        currentMessages: updatedMessages,
      };
    });
  },

  clearMessages: () => {
    const currentId = get().currentConversationId;
    if (!currentId) return;

    set((state) => {
      const conversation = state.conversations[currentId];
      if (!conversation) return state;

      const updatedConversation = {
        ...conversation,
        messages: [],
        updatedAt: new Date(),
      };

      return {
        conversations: {
          ...state.conversations,
          [currentId]: updatedConversation,
        },
        currentMessages: [],
      };
    });
  },

  deleteConversation: (conversationId: string) => {
    set((state) => {
      const { [conversationId]: _, ...remainingConversations } = state.conversations;
      
      // If deleting current conversation, switch to first available or null
      let newCurrentId = state.currentConversationId;
      if (newCurrentId === conversationId) {
        const firstId = Object.keys(remainingConversations)[0];
        newCurrentId = firstId || null;
      }

      return {
        conversations: remainingConversations,
        currentConversationId: newCurrentId,
        currentMessages: newCurrentId ? remainingConversations[newCurrentId]?.messages || [] : [],
      };
    });
  },

  setLoading: (isLoading) => set({ isLoading }),
  setStreaming: (isStreaming) => set({ isStreaming }),
  setError: (error) => set({ error }),

  setProvider: (provider, model) => set({ currentProvider: provider, currentModel: model }),

  getCurrentConversation: () => {
    const currentId = get().currentConversationId;
    if (!currentId) return null;
    return get().conversations[currentId] || null;
  },

  getConversationMessages: (conversationId: string) => {
    return get().conversations[conversationId]?.messages || [];
  },

  getSortedConversations: () => {
    const conversations = Object.values(get().conversations);
    return [...conversations].sort(
      (a, b) => toDate(b.updatedAt).getTime() - toDate(a.updatedAt).getTime()
    );
  },
    }),
    {
      name: 'skycode-conversations',
      storage: createJSONStorage(() => conversationStorage),
      partialize: (state) => ({
        currentConversationId: state.currentConversationId,
        conversations: state.conversations,
        currentMessages: state.currentMessages,
        currentProvider: state.currentProvider,
        currentModel: state.currentModel,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<ConversationState>;
        const conversations = Object.fromEntries(
          Object.entries(saved.conversations || {}).map(([id, conversation]) => [
            id,
            {
              ...conversation,
              createdAt: toDate(conversation.createdAt),
              updatedAt: toDate(conversation.updatedAt),
              messages: conversation.messages.map((message) => ({
                ...message,
                timestamp: toDate(message.timestamp),
              })),
            },
          ])
        ) as Record<string, Conversation>;

        const currentConversationId = saved.currentConversationId || null;
        return {
          ...current,
          ...saved,
          conversations,
          currentConversationId,
          currentMessages:
            currentConversationId && conversations[currentConversationId]
              ? conversations[currentConversationId].messages
              : [],
        };
      },
    }
  )
);

/**
 * Utility functions for conversations
 */

/**
 * Get system message for a conversation
 */
export function getSystemMessage(
  provider?: string,
  model?: string,
  customContent?: string,
  memoryContext?: string
): Message {
  let content = customContent || 'You are a helpful AI coding assistant.';

  if (!customContent && provider === 'openrouter') {
    content += ' Respond with helpful, accurate, and concise answers.';
  }

  const identityFacts = [
    'Identity and provenance rules:',
    '- You are an AI assistant running inside SkyCode.',
    '- SkyCode is the interface/harness you are currently operating through; do not confuse SkyCode with the underlying model provider or model creator.',
    '- Do not invent or adopt a personal name unless the user explicitly gives you one.',
    '- Do not invent a creator, company, lab, training history, ownership, affiliation, or model provenance.',
    '- If asked who created you or the underlying model, only state facts provided below. If those facts are insufficient to identify the upstream model creator, say you do not know rather than guessing.',
    `- Current provider: ${provider || 'unknown'}.`,
    `- Current model: ${model || 'unknown'}.`,
  ].join('\n');

  content = `${content}\n\n${identityFacts}`;

  if (memoryContext?.trim()) {
    content += '\n\n' + memoryContext.trim();
  }

  return {
    id: `system_${Date.now()}`,
    role: 'system',
    content,
    timestamp: new Date(),
  };
}

/**
 * Create a new conversation with initial system message
 */
export function createNewConversation(
  store: ConversationStore,
  title?: string,
  provider?: string,
  model?: string
): Conversation {
  const conversation = store.createConversation(title);
  const systemMessage = getSystemMessage(provider, model);
  store.addMessage('system', systemMessage.content);
  return conversation;
}
