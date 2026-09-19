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
- Clickable saved-chat browser with one-click resume
- Runtime-aware context budgeting for long conversations
- Scored agent routing with visible active-agent diagnostics
- Compose while generating, queue follow-up messages, and cancel active local inference
- Built-in AI evaluation harness with smoke tests and a 100-case regression suite
- Autonomous coding-agent project creation with safe workspace-scoped file tools
- Architecture-first project planning with stack-aware separation of concerns and clarification questions
- Harness capability grounding so provider models know SkyCode can create real project folders/files instead of falling back to "I can only provide snippets"
- Unified OpenRouter + local model catalog with FREE/PAID labels and provider-aware switching
- Interactive searchable `/model` picker with keyboard/mouse selection and compact model metadata
- Durable cross-chat memory with correction-aware facts, preferences, project memory, and relevant past-chat recall
- Clean chat transcripts: internal system/identity prompts stay hidden from the visible conversation
- Rich assistant responses with headings, lists, quotes, dedicated writing cards, themed code blocks, line numbers, syntax colors, and per-block copy controls
- `/history`, `/resume`, and `skycode resume`
- Copy controls and `/copy`
- Provider setup commands: `/addlocal`, `/addcloud`, `/openroute`
- Hardened slash-command registry with validation, safe failure handling, and `/doctor` diagnostics
- Built-in update checks and `skycode update`

### Experimental

- Automatic routing heuristics
- Provider/model discovery across different local runtimes
- Command execution infrastructure (not yet exposed to autonomous project builds)

### Planned

- MCP tool/server integration
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

On managed installs, `skycode update`, `skycode update --check`, and version commands are handled by a small bootstrap layer before the main TypeScript application loads. This means a broken application release can still update and repair itself instead of bricking the updater.

Enable automatic updates:

```bash
skycode update --auto
```

Disable automatic updates:

```bash
skycode update --no-auto
```

Inspect auto-update health and the last successful update:

```bash
skycode update --status
```

Automatic updates are opt-in. With `skycode update --auto`, the global bootstrap checks for a new release **before the SkyCode application starts**. SkyCode records the last check, last successful update, version, and whether it was automatic or manual so the update path is auditable with `skycode update --status`. The status command is supported both by the bootstrap updater and by the app-level updater as a fallback. If one exists, it repairs/updates the managed install first and then launches the updated app. Without `--auto`, SkyCode only notifies you when a newer build is available.

If an older pre-bootstrap-safe install is already broken, rerun the official installer once. That rewrites the global shim; future update/version commands no longer depend on the app parsing successfully.

## Harness-aware software creation

SkyCode separates the raw model from the capabilities of the harness around it. Coding models are explicitly told that SkyCode can inspect the active workspace and create/read/search/write project files and directories. Software-creation prompts are routed toward the coding agent, while pure capability questions such as `Can you create software?` are answered from SkyCode's real capabilities instead of the upstream model's generic chatbot disclaimer.

For actual build requests, SkyCode retries models that incorrectly answer with raw-model limitations instead of using workspace tools. If a weak model repeatedly refuses or fails to emit the structured tool protocol, SkyCode reports that the selected model failed the tool protocol rather than falsely claiming that SkyCode cannot create software.

## Project creation

When a coding request explicitly asks SkyCode to create, scaffold, build, edit, or modify project files, the coding agent can now work directly in the directory where SkyCode was launched.

For example, launch SkyCode from the parent directory where you want the project:

```bash
cd projects
skycode
```

Then ask:

```text
Create a portfolio website in ./portfolio using HTML, CSS, and JavaScript.
Add a hero, project cards, and a contact section.
```

The coding agent can create directories and write/read/search files instead of only returning code blocks in chat. Before writing, it now reasons about project architecture, follows stack conventions, separates UI/styles/domain/API/configuration concerns when appropriate, and asks only blocking clarification questions when missing information would materially change the implementation. Tool activity is shown in the conversation as it happens.

Autonomous project tools are deliberately workspace-scoped. SkyCode currently exposes only non-destructive project operations to this loop: listing, reading, searching, creating directories, and writing files. Attempts to escape the directory where SkyCode was launched are blocked. Shell execution, package installation, and file deletion are not part of the autonomous project loop yet.

## AI evaluation

Run the fast smoke evaluation against the configured local model:

```bash
skycode eval
```

Run all 100 regression cases:

```bash
skycode eval --all
```

You can target a category or specific case IDs:

```bash
skycode eval --category coding
skycode eval --ids 4,17,31,46,61
```

Reports are saved locally under `~/.skycode/evals/` as both Markdown and JSON. The suite covers identity/fabrication, instruction following, memory, reasoning, coding, routing, and streaming/UI checks. Cases that require visual or integration review are marked `SKIP` or `REVIEW` instead of pretending they were automatically verified.

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

Model availability changes frequently, so SkyCode discovers models at runtime. Select `/model` from the slash-command picker (or type `/model` and press Enter) to open the model picker. The picker is capped to five visible rows so the chat composer always remains on-screen, while ↑/↓ can browse the full filtered catalog. Use Esc or the clickable Close control to dismiss it. Keep typing to filter by model name, provider, tag, `free`, `paid`, or `local`; use ↑/↓ to move, Enter or click to switch, and Tab to fill the exact selector without switching yet. The picker shows compact provider, price, context-window, and current-model metadata.

## Commands

| Command | Description |
|---|---|
| `/new` | Start a new conversation |
| `/memory` | Show durable cross-chat memory |
| `/remember <fact>` | Save a durable memory |
| `/forget <query>` | Remove matching durable memory |
| `/memory clear` | Clear all durable memory |
| `/model` | List OpenRouter and running local models with FREE/PAID labels |
| `/model search <query>` | Search across OpenRouter and local models |
| `/model openrouter:<id>` | Switch to an OpenRouter model |
| `/model local:<id>` | Switch to a running local model |
| `/addlocal` | Add or update a local AI server |
| `/addcloud` | Add a cloud provider |
| `/openroute` | Add or update OpenRouter |
| `/history` | Show saved conversations |
| `/resume <number-or-id>` | Resume a saved conversation |
| `/copy` | Copy the latest assistant reply |
| `/cancel` | Cancel the active generation |
| `/clear` | Clear the current conversation |
| `/setup` | Open the full provider setup flow |
| `/doctor` | Check slash-command wiring, active provider/model, chat storage, memory path, and workspace |
| `/help` | Show available commands |
| `/exit` | Exit SkyCode |

### Slash commands

Slash commands are validated before execution. Missing required arguments now return usage guidance instead of silently doing nothing, unknown commands point to `/help`, and unexpected command errors are caught and surfaced inside the chat instead of crashing the terminal UI. Run `/doctor` before a demo to inspect the current command/provider/storage state.

Type `/` in the composer to open the command picker. Keep typing to filter it, use `↑` / `↓` to move through matches, press `Tab` to complete the highlighted command, or click a command with the mouse.

### Chat navigation

For long conversations, SkyCode now budgets the history sent to the model against the model's served context window. On llama.cpp-compatible local runtimes, SkyCode attempts to detect the active runtime context from `/props`; you can override it with `LOCAL_LLM_CONTEXT_LENGTH` or `SKYCODE_CONTEXT_LENGTH`.

- `Page Up` / `Page Down` scroll the transcript.
- `Ctrl + Home` jumps to the oldest visible part of the chat.
- `Ctrl + End` jumps back to the newest messages.
- While you stay at the bottom, streaming replies follow automatically.
- The input composer stays pinned below the transcript instead of being pushed off-screen.

## Cross-chat memory

SkyCode now has a local memory layer that is separate from ordinary chat history. It combines:

- **Durable memory** for stable facts, preferences, and project decisions.
- **Correction-aware updates** for recognized profile facts, so a newer value replaces the older value instead of producing conflicting copies.
- **Workspace memory** for project-specific decisions that should only follow the project where they were learned.
- **Relevant past-chat recall** that searches prior **user messages** and injects matching excerpts into a new chat when they are useful.
- **Secret filtering** so likely passwords, API keys, seed phrases, PINs, and similar credentials are not intentionally persisted as durable memory.
- **Context-aware retrieval** so only a bounded amount of relevant memory is injected into the active model rather than dumping the whole memory file into every prompt.

Durable memory is stored locally at:

```text
~/.skycode/memory.json
```

Useful commands:

```text
/memory
/remember I prefer concise TypeScript examples
/forget concise TypeScript
/memory clear
```

SkyCode also automatically captures some explicit durable statements such as `remember that ...`, `my ... is ...`, corrections to those profile facts, preferences, and project-specific rules. For anything important that you definitely want preserved, `/remember <fact>` is the explicit path.

Memory is grounded with two rules: newer durable records are authoritative for the same recognized subject, and past-chat recalls are treated as excerpts from user messages rather than as independently verified facts.

## Rich response rendering

SkyCode renders assistant Markdown-like output as terminal-native UI instead of dumping every response as one plain text blob.

- Headings, paragraphs, bullets, numbered lists, quotes, and dividers get distinct visual treatment.
- Triple-backtick code fences become dark code cards with a language label, line numbers, syntax-themed colors, and a clickable Copy action.
- Syntax coloring is language-aware for common programming constructs and still provides a consistent theme for unknown languages.
- ```writing fences render as dedicated writing cards for drafts, emails, messages, notes, and other copyable prose.
- Streaming responses use the same renderer, so formatting appears as the model generates it.

Models are prompted to include a language identifier on code fences (for example ```typescript, ```python, ```rust, ```html, ```css, ```sql, or ```bash) so SkyCode can theme code consistently.

## Conversation history

SkyCode includes a visible **Chats** control in the terminal UI. Open it to browse saved conversations and click any chat to resume it immediately. The active chat is highlighted, and each row shows recent activity and message count.

The existing `/history`, `/resume`, and `skycode resume` flows remain available for keyboard-driven use.

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
├── durable cross-chat memory + relevant history retrieval
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
