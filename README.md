# Sky Code - AI Agent Harness

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Runtime-Bun-ff69b4.svg)](https://bun.sh)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev)
[![OpenTUI](https://img.shields.io/badge/OpenTUI-0.2.15-00D4AA.svg)](https://github.com/opentui/opentui)

**Sky Code** is a **powerful AI Agent Harness** built for the terminal. It provides a **CLI-based interface** for interacting with multiple AI models, including **open-weight models** via OpenRouter, local LLMs (Ollama, LM Studio), Anthropic, and OpenAI.

## ✨ Features

### 🎯 Core Capabilities
- ✅ **Multi-Provider Support** - OpenRouter, Local LLMs (Ollama/LM Studio), Anthropic, OpenAI
- ✅ **Agent System** - Specialized agents for coding, chat, debugging, and more
- ✅ **Intelligent Routing** - Automatically selects the best agent for your task
- ✅ **Streaming Responses** - Real-time AI responses
- ✅ **Conversation History** - Persistent chat sessions
- ✅ **File System Integration** - Read, write, search, and manage files
- ✅ **Tool Calling** - Execute commands and interact with your system
- ✅ **Token Management** - Track usage and costs

### 🤖 AI Providers

| Provider | Models | Open Weights | API Key Required |
|---------|--------|--------------|-----------------|
| **OpenRouter** | 100+ models | ✅ Yes | `OPENROUTER_API_KEY` |
| **Local LLM** | Ollama, LM Studio | ✅ Yes | No (local server) |
| **Anthropic** | Claude 3.5, Claude 3 | ❌ No | `ANTHROPIC_API_KEY` |
| **OpenAI** | GPT-4o, GPT-4, GPT-3.5 | ❌ No | `OPENAI_API_KEY` |

### 🎨 Agents

| Agent | Specialization | Capabilities |
|-------|---------------|--------------|
| **Coding Agent** | Code tasks | Code completion, explanation, bug fixing, refactoring, testing |
| **Chat Agent** | General conversation | Chat, documentation, search |

### 🔧 Tools

| Category | Tools |
|----------|-------|
| **File System** | `read_file`, `write_file`, `delete_file`, `list_files`, `search_files`, `create_directory`, `delete_directory` |
| **Commands** | `run_command`, `run_command_stream` |

---

## 🚀 Quick Start

### One-Command Install

#### macOS / Linux (Terminal):
```bash
curl -fsSL https://raw.githubusercontent.com/imacul/skycode/main/install.sh | bash
```

#### Windows PowerShell:
```powershell
irm https://raw.githubusercontent.com/imacul/skycode/main/install.sh | iex
```

#### Windows CMD:
```cmd
curl -L https://raw.githubusercontent.com/imacul/skycode/main/install.sh -o install.sh && install.sh
```

#### iOS / Android (Termux):
```bash
pkg install curl && curl -fsSL https://raw.githubusercontent.com/imacul/skycode/main/install.sh | bash
```

This will:
1. Install Bun (if not already installed)
2. Clone Sky Code
3. Install dependencies
4. Start the app

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/imacul/skycode.git
cd skycode

# Install dependencies
bun install
```

### Set API Keys (Optional)

For **OpenRouter** (open-weight models):
```bash
export OPENROUTER_API_KEY="your-openrouter-api-key"
```

For **Anthropic**:
```bash
export ANTHROPIC_API_KEY="your-anthropic-api-key"
```

For **OpenAI**:
```bash
export OPENAI_API_KEY="your-openai-api-key"
```

For **Local LLMs** (Ollama, LM Studio): No API key needed - just run your local server!

### Run Sky Code

```bash
# Start the CLI
bun run dev:cli
```

---

## 📖 Usage

### Basic Commands

| Command | Description |
|---------|-------------|
| `/new` | Start a new conversation |
| `/exit` | Quit the application |
| `/model <name>` | Switch AI model |
| `/help` | Show help |

### Example Session

```
$ bun run dev:cli

┌─────────────────────────────────────────────────────────┐
│                    🌌 Sky Code                           │
├─────────────────────────────────────────────────────────┤
│ Welcome to Sky Code!                                        │
│ Type a message to start chatting with AI.                   │
│ Use /help for available commands.                         │
└─────────────────────────────────────────────────────────┘

> Fix this JavaScript function
> function add(a, b) { return a + b; }

🤖 Assistant: The function looks correct! Here's an improved version...

> /model meta-llama/llama-3.1-70b-instruct
Switched to meta-llama/llama-3.1-70b-instruct

> /new
Started new conversation

> /exit
```

---

## 📦 Configuration

### Environment Variables

```bash
# OpenRouter (for open-weight models)
OPENROUTER_API_KEY="your-api-key"
OPENROUTER_BASE_URL="https://openrouter.ai/api/v1"

# Anthropic
ANTHROPIC_API_KEY="your-api-key"

# OpenAI
OPENAI_API_KEY="your-api-key"
OPENAI_ORGANIZATION="your-org-id"

# Local LLM (Ollama - default)
LOCAL_LLM_BASE_URL="http://localhost:11434"

# Local LLM (LM Studio)
LOCAL_LLM_BASE_URL="http://localhost:1234/v1"
```

### Settings

Sky Code persists your settings automatically. You can configure:

- **Default provider** (openrouter, local, anthropic, openai)
- **Default model** (any supported model)
- **Temperature** (0-2)
- **Max tokens** (response length)
- **Theme** (dark, light, system)
- **Font size**
- **Agent settings**

---

## 🏗️ Architecture

```
skycode/
├── packages/
│   └── cli/
│       ├── src/
│       │   ├── agents/              # AI Agents
│       │   │   ├── types.ts         # Agent types & interfaces
│       │   │   ├── coding-agent.ts  # Coding specialist
│       │   │   ├── chat-agent.ts    # General conversation
│       │   │   ├── orchestrator.ts  # Multi-agent manager
│       │   │   └── index.ts         # Agent exports
│       │   │
│       │   ├── providers/           # AI Model Providers
│       │   │   ├── base.ts          # Base provider interface
│       │   │   ├── openrouter.ts    # OpenRouter (open weights)
│       │   │   ├── local.ts         # Local LLMs (Ollama, LM Studio)
│       │   │   ├── anthropic.ts     # Anthropic (Claude)
│       │   │   ├── openai.ts        # OpenAI (GPT)
│       │   │   └── index.ts         # Provider exports
│       │   │
│       │   ├── store/               # State Management
│       │   │   ├── conversation.ts  # Conversation history
│       │   │   ├── settings.ts      # User preferences
│       │   │   └── index.ts         # Store exports
│       │   │
│       │   ├── tools/              # System Tools
│       │   │   ├── types.ts         # Tool types
│       │   │   ├── file-system.ts   # File operations
│       │   │   ├── command.ts       # Command execution
│       │   │   └── index.ts         # Tool exports
│       │   │
│       │   ├── utils/              # Utilities
│       │   │   ├── stream.ts        # Streaming helpers
│       │   │   ├── tokens.ts        # Token counting
│       │   │   └── index.ts         # Utility exports
│       │   │
│       │   ├── components/          # UI Components
│       │   │   ├── header.tsx       # App header
│       │   │   ├── input-bar.tsx    # User input
│       │   │   ├── status-bar.tsx   # Status display
│       │   │   └── ...
│       │   │
│       │   └── index.tsx            # Main app
│       │
│       └── package.json            # Dependencies
│
└── README.md
```

---

## 🔌 Providers

### OpenRouter (Open Weights)

**Default provider** - Access 100+ models including open-weight models.

**Supported Models:**
- `meta-llama/llama-3.1-70b-instruct` (Default)
- `meta-llama/llama-3.1-8b-instruct`
- `mistralai/mistral-7b-instruct`
- `mistralai/mixtral-8x7b-instruct`
- `google/gemma-7b-it`
- `phi-3-mini-4k-instruct`
- `phi-3-small-8k-instruct`
- `openchat/openchat-7b`
- And many more!

**Setup:**
```bash
export OPENROUTER_API_KEY="your-api-key"
# Or set in Sky Code settings
```

**Website:** [https://openrouter.ai](https://openrouter.ai)

### Local LLM (Ollama, LM Studio)

Run AI models **locally** without API keys!

**Supported Models (Ollama):**
- `llama3.1:70b-instruct`
- `llama3.1:8b-instruct`
- `llama3:70b-instruct`
- `llama3:8b-instruct`
- `mistral:7b-instruct`
- `mixtral:8x7b-instruct`
- `gemma:7b-instruct`
- `phi3:3.8b-mini-instruct`
- `phi3:7b-small-instruct`
- `qwen2:7b-instruct`

**Setup (Ollama):**
```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull llama3.1:70b-instruct

# Run Ollama server (automatic)
# Sky Code will connect to http://localhost:11434
```

**Setup (LM Studio):**
```bash
# Install LM Studio from https://lmstudio.ai
# Start the server on port 1234
# Sky Code will connect to http://localhost:1234/v1
```

### Anthropic (Claude)

Access **Claude 3.5, Claude 3, and Claude 2** models.

**Supported Models:**
- `claude-3-5-sonnet-20241022` (Latest)
- `claude-3-opus-20240229`
- `claude-3-sonnet-20240229`
- `claude-3-haiku-20240307`
- `claude-2:1`
- `claude-instant-1:2`

**Setup:**
```bash
export ANTHROPIC_API_KEY="your-api-key"
```

**Website:** [https://anthropic.com](https://anthropic.com)

### OpenAI (GPT)

Access **GPT-4, GPT-4o, GPT-3.5** models.

**Supported Models:**
- `gpt-4o-mini` (Recommended)
- `gpt-4o`
- `gpt-4-turbo`
- `gpt-4`
- `gpt-3.5-turbo`
- `o1-preview` (Reasoning)
- `o1-mini` (Reasoning)

**Setup:**
```bash
export OPENAI_API_KEY="your-api-key"
```

**Website:** [https://openai.com](https://openai.com)

---

## 🤖 Agents

### Coding Agent

Specialized for **code-related tasks**:

- ✅ **Code Completion** - Finish incomplete code
- ✅ **Code Explanation** - Explain how code works
- ✅ **Bug Fixing** - Find and fix bugs
- ✅ **Refactoring** - Improve code structure
- ✅ **Testing** - Generate tests

**Modes:**
- `code` (default) - General coding assistance
- `debug` - Debugging mode
- `explain` - Code explanation
- `refactor` - Code refactoring
- `test` - Test generation

**Usage:**
```
> Explain this function
> function fibonacci(n) { ... }

> Fix this bug
> The function returns wrong results for n > 100

> Refactor this code
> Make it more maintainable
```

### Chat Agent

For **general conversation and knowledge**:

- ✅ **Chat** - General conversation
- ✅ **Documentation** - Generate docs
- ✅ **Search** - Find information

**Modes:**
- `chat` (default) - General conversation
- `explain` - Detailed explanations
- `search` - Information search

**Usage:**
```
> What is TypeScript?

> Explain how React hooks work

> Search for information about WebSockets
```

---

## 🛠️ Tools

### File System Tools

| Tool | Description | Example |
|------|-------------|---------|
| `read_file` | Read file contents | `read_file(path: "src/index.ts")` |
| `write_file` | Write to a file | `write_file(path: "output.txt", content: "Hello")` |
| `delete_file` | Delete a file | `delete_file(path: "temp.txt")` |
| `list_files` | List files in directory | `list_files(path: ".", recursive: true)` |
| `search_files` | Search files by name/content | `search_files(query: "function", searchContent: true)` |
| `create_directory` | Create a directory | `create_directory(path: "new-dir")` |
| `delete_directory` | Delete a directory | `delete_directory(path: "old-dir")` |

### Command Tools

| Tool | Description | Example |
|------|-------------|---------|
| `run_command` | Execute shell command | `run_command(command: "ls -la")` |
| `run_command_stream` | Execute with streaming | `run_command_stream(command: "npm install")` |

---

## 💡 Tips & Tricks

### Switch Models

```
# OpenRouter models
/model meta-llama/llama-3.1-70b-instruct
/model mistralai/mistral-7b-instruct

# Local models (Ollama)
/model llama3.1:70b-instruct
/model mistral:7b-instruct

# Anthropic models
/model claude-3-5-sonnet-20241022
/model claude-3-opus-20240229

# OpenAI models
/model gpt-4o-mini
/model gpt-4
```

### Agent Selection

The orchestrator **automatically selects the best agent** based on your input:

- Code-related queries → **Coding Agent**
- General questions → **Chat Agent**

You can also **explicitly specify** an agent in your request.

### Token Management

Sky Code tracks your **token usage** and **costs** (for paid models).

- View token count in the status bar
- See cost estimates for each response
- Set token budgets to avoid surprises

---

## 🎯 Roadmap

### ✅ Completed
- [x] OpenRouter provider (open weights)
- [x] Local LLM provider (Ollama, LM Studio)
- [x] Anthropic provider
- [x] OpenAI provider
- [x] Coding Agent
- [x] Chat Agent
- [x] Agent Orchestrator
- [x] Conversation Store
- [x] Settings Store
- [x] File System Tools
- [x] Command Tools
- [x] Streaming Support
- [x] Token Management
- [x] Comprehensive Tests

### 🚧 In Progress
- [ ] Tool calling integration with agents
- [ ] Plugin system for custom providers
- [ ] Custom agent creation
- [ ] Model fine-tuning support

### 📋 Planned
- [ ] Web UI version
- [ ] Desktop app (Tauri)
- [ ] Mobile support
- [ ] Voice input/output
- [ ] Multi-modal support (images, audio)
- [ ] Collaborative sessions
- [ ] Session sharing

---

## 🤝 Contributing

We welcome contributions! Here's how you can help:

### Development Setup

```bash
git clone https://github.com/imacul/skycode.git
cd skycode
bun install
```

### Run Tests

```bash
bun test            # Run all tests
bun test --watch   # Run tests in watch mode
bun test --coverage # Run tests with coverage
```

### Project Structure

```
packages/cli/src/
├── agents/       # AI agents
├── providers/    # Model providers
├── store/        # State management
├── tools/        # System tools
├── utils/        # Utilities
└── components/   # UI components
```

### Adding a New Provider

1. Create a new file in `packages/cli/src/providers/`
2. Implement the `BaseProvider` interface
3. Add to `packages/cli/src/providers/index.ts`
4. Add tests in `packages/cli/src/tests/`

### Adding a New Agent

1. Create a new file in `packages/cli/src/agents/`
2. Implement the `BaseAgent` interface
3. Register in the orchestrator
4. Add tests

### Adding a New Tool

1. Create a new file in `packages/cli/src/tools/`
2. Implement the `BaseTool` interface
3. Add to `packages/cli/src/tools/index.ts`
4. Add tests

---

## 📜 License

[MIT License](https://opensource.org/licenses/MIT)

Copyright (c) 2026 Imacul

---

## 🆘 Support

- **Issues:** [GitHub Issues](https://github.com/imacul/skycode/issues)
- **Discussions:** [GitHub Discussions](https://github.com/imacul/skycode/discussions)
- **Contact:** imacul77@gmail.com

---

## 🙏 Acknowledgments

- **[Bun](https://bun.sh)** - Fast JavaScript runtime
- **[React](https://react.dev)** - UI framework
- **[OpenTUI](https://github.com/opentui/opentui)** - Terminal UI
- **[Zustand](https://github.com/pmndrs/zustand)** - State management
- **[OpenRouter](https://openrouter.ai)** - AI model aggregator
- **[Ollama](https://ollama.com)** - Local LLM runner
- **[LM Studio](https://lmstudio.ai)** - Local AI studio
- **[Anthropic](https://anthropic.com)** - Claude AI
- **[OpenAI](https://openai.com)** - GPT models

---

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=imacul/skycode&type=Date)](https://star-history.com/#imacul/skycode&Date)

---

**Built with ❤️ and AI**
