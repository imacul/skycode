# SkyCode

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-000000.svg)](https://bun.sh)
[![React 19](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev)
[![OpenTUI](https://img.shields.io/badge/UI-OpenTUI-00D4AA.svg)](https://github.com/opentui/opentui)

**SkyCode** is an open-source terminal AI harness for working with local and cloud models from one interface.

It supports local OpenAI-compatible servers such as llama.cpp, Ollama, and LM Studio, plus hosted providers including OpenAI, Anthropic, and OpenRouter. SkyCode also includes streaming responses, persistent chat history, provider setup commands, and lightweight agent routing for chat, coding, planning, and business tasks.

## Why SkyCode

- Run local models fully offline.
- Switch between local and cloud providers from one CLI.
- Stream responses in real time.
- Resume persistent conversations across sessions.
- Route different kinds of work to specialized agents.
- Keep provider configuration and chat history on your own machine.

## Status

SkyCode is under active development.

### Available today

- Multi-provider support: OpenRouter, OpenAI, Anthropic, and local LLM servers
- Local OpenAI-compatible servers, including llama.cpp
- Ollama and LM Studio support
- Streaming responses
- Chat, coding, planning, and business agents
- Automatic agent routing
- Persistent conversation history
- Scrollable long-chat transcript with a fixed input composer
- Grounded assistant identity and model/provider provenance
- Interactive slash-command picker with filtering and keyboard navigation
- `/history`, `/resume`, and `skycode resume`
- Copy controls and `/copy`
- Provider setup commands: `/addlocal`, `/addcloud`, `/openroute`
- Built-in update checks and `skycode update`

### Experimental

- Automatic routing heuristics
- Provider/model discovery across different local runtimes
- Tool infrastructure for file-system and command execution

### Planned

- Agent tool-calling integration
- More provider integrations
- Custom agents and provider plugins
- Better model management
- Desktop and web interfaces
- Multimodal input
- Voice support
- Collaboration and session sharing

## Quick start

### Windows PowerShell

```powershell
irm "https://raw.githubusercontent.com/imacul/skycode/main/install.ps1?ts=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" | iex
```

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/imacul/skycode/main/install.sh | sh
```

The installer places SkyCode under your user profile, ensures a compatible Bun version (1.4+), installs dependencies, and creates a global `skycode` command.

Run SkyCode:

```bash
skycode
```

Check the installed version:

```bash
skycode -v
```

`skycode --version` and `skycode version` are also supported.

Open saved chat history:

```bash
skycode resume
```

> If your shell was already open before installation, you may need to open a new terminal window before the `skycode` command is available.

## Updating SkyCode

SkyCode checks for a newer build at startup when internet access is available. The check is non-blocking, so local/offline use still starts normally.

Check manually without installing:

```bash
skycode update --check
```

Install the latest version:

```bash
skycode update
```

Enable automatic updates:

```bash
skycode update --auto
```

Disable automatic updates:

```bash
skycode update --no-auto
```

Automatic updates are opt-in. Without `--auto`, SkyCode only notifies you when a newer build is available.

## Local models

Inside SkyCode:

```text
/addlocal
```

Examples:

| Runtime | Typical endpoint |
|---|---|
| Ollama | `http://localhost:11434` |
| LM Studio | `http://localhost:1234/v1` |
| llama.cpp | `http://127.0.0.1:8080` |

For llama.cpp or another OpenAI-compatible local server, SkyCode can use the standard `/v1/chat/completions` API.

Example environment configuration:

```powershell
$env:LOCAL_LLM_BASE_URL="http://127.0.0.1:8080"
$env:LOCAL_LLM_MODEL="local-qwen"
$env:LOCAL_LLM_THINKING="false"

skycode
```

Local inference continues to work without internet access as long as the model server is running on your machine.

## Cloud providers

SkyCode currently supports:

| Provider | Setup |
|---|---|
| OpenRouter | `/openroute` |
| Anthropic | `/addcloud` |
| OpenAI | `/addcloud` |

You can also configure credentials through environment variables:

```bash
OPENROUTER_API_KEY="..."
ANTHROPIC_API_KEY="..."
OPENAI_API_KEY="..."
```

Model availability changes frequently, so SkyCode avoids treating a hard-coded model list as authoritative.

## Commands

| Command | Description |
|---|---|
| `/new` | Start a new conversation |
| `/model` | Show model information |
| `/model <name>` | Switch model |
| `/addlocal` | Add or update a local AI server |
| `/addcloud` | Add a cloud provider |
| `/openroute` | Add or update OpenRouter |
| `/history` | Show saved conversations |
| `/resume <number-or-id>` | Resume a saved conversation |
| `/copy` | Copy the latest assistant reply |
| `/clear` | Clear the current conversation |
| `/setup` | Open the full provider setup flow |
| `/help` | Show available commands |
| `/exit` | Exit SkyCode |

### Slash commands

Type `/` in the composer to open the command picker. Keep typing to filter it, use `↑` / `↓` to move through matches, press `Tab` to complete the highlighted command, or click a command with the mouse.

### Chat navigation

For long conversations:

- `Page Up` / `Page Down` scroll the transcript.
- `Ctrl + Home` jumps to the oldest visible part of the chat.
- `Ctrl + End` jumps back to the newest messages.
- While you stay at the bottom, streaming replies follow automatically.
- The input composer stays pinned below the transcript instead of being pushed off-screen.

## Conversation history

SkyCode stores conversation history locally at:

```text
~/.skycode/conversations.json
```

Settings are stored at:

```text
~/.skycode/settings.json
```

Use:

```text
/history
```

and:

```text
/resume 1
```

or launch directly into the history view:

```bash
skycode resume
```

## Architecture

```text
SkyCode
├── terminal UI (OpenTUI + React)
├── agent orchestrator
│   ├── chat agent
│   ├── coding agent
│   ├── planning agent
│   └── business agent
├── provider layer
│   ├── local / OpenAI-compatible
│   ├── OpenRouter
│   ├── Anthropic
│   └── OpenAI
├── persistent settings
└── persistent conversation history
```

The provider layer keeps local and hosted models behind a common interface so the terminal UI and agent system do not need provider-specific logic for every request.

## Development

Requirements:

- Git
- Bun 1.4+
- Node.js 18+ is recommended for package tooling

Clone and install:

```bash
git clone https://github.com/imacul/skycode.git
cd skycode
bun install
```

Run the CLI in development mode:

```bash
bun run dev:cli
```

Build:

```bash
bun run build
```

Run tests:

```bash
bun test
```

## Project structure

```text
packages/cli/src/
├── agents/
├── components/
├── providers/
├── store/
├── tools/
├── utils/
└── index.tsx
```

## Contributing

Contributions are welcome.

A useful contribution flow is:

1. Fork the repository.
2. Create a focused branch.
3. Make and test your changes.
4. Open a pull request with a clear description of the behavior you changed.
5. Keep unrelated refactors out of feature PRs when possible.

For provider work, implement the shared provider interface and keep provider-specific behavior isolated in `packages/cli/src/providers/`.

For agent work, register new agents through the orchestrator instead of coupling them directly to the UI.

## Documentation

Project documentation:

**https://imacul.github.io/skycode/**

Repository:

**https://github.com/imacul/skycode**

## Support

Use GitHub Issues for bugs and feature requests:

**https://github.com/imacul/skycode/issues**

Use GitHub Discussions for broader questions and ideas:

**https://github.com/imacul/skycode/discussions**

## License

SkyCode is available under the [MIT License](./LICENSE).

Copyright (c) 2026 Imacul

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=imacul/skycode&type=Date)](https://star-history.com/#imacul/skycode&Date)
