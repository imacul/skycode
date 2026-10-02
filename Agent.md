# For AI Coding Agents

SkyCode can create real project files and run workspace tools.

Owner Mode (`/owner on` then `/owner confirm`) lets agents operate as the logged-in OS user with auto-approved terminal, desktop, MCP, and network tools, including system commands and shell features. Emergency stop: create `~/.skycode/EMERGENCY_STOP`. Disable with `/owner off`.

Prefer emitting SkyCode `<tool_call>{...}</tool_call>` protocol calls rather than only describing commands.
