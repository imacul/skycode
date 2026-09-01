// Conversation store for managing chat state
import { create } from 'zustand';

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

/**
 * Generate unique ID
 */
function generateId(): string {
  return `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create the conversation store
 */
export const useConversationStore = create<ConversationStore>((set, get) => ({
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

      const updatedConversation = {
        ...conversation,
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
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
    );
  },
}));

/**
 * Utility functions for conversations
 */

/**
 * Get system message for a conversation
 */
export function getSystemMessage(provider?: string, model?: string, customContent?: string): Message {
  let content = customContent || 'You are a helpful AI coding assistant.';
  
  if (!customContent) {
    if (model) {
      content += ` You are currently using the ${model} model.`;
    }
    
    if (provider === 'openrouter') {
      content += ' Respond with helpful, accurate, and concise answers.';
    }
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
