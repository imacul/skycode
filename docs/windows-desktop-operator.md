# Windows desktop operator (experimental milestone)

This feature is a bounded foundation for SkyCode's future observe → reason → act → verify computer engine. It is **not** unrestricted desktop control yet.

## Available agent tools

- `desktop_snapshot`: approval-gated inspection of the current foreground window through Windows UI Automation. The result reports the window and up to 60 accessibility elements. It does not use screenshots or interpret pixels.
- `desktop_notepad_document`: creates a **new** `.txt` document under the active workspace (max 20,000 characters), reads it back from disk, opens and verifies the editor, closes only the matched Notepad document tab, reopens it, and verifies the editor again. Each stage is independently reported. This first version writes with the filesystem and *opens* the document in Notepad; it does not pretend to type into the GUI.

Both operations require user approval unless the user has deliberately enabled Owner Mode with automatic approval. The durable emergency stop remains part of the agent's tool boundary.

## Manual Windows test

Check out `feature/windows-notepad-operator`, install dependencies, and run:

```powershell
bun test packages/cli/src/tests/windows-desktop.test.ts
bun packages/cli/src/index.tsx
```

In the SkyCode chat:

> Create a new file named skycode-demo.txt with three lines explaining DNS, open it in Notepad, and verify the document.

Review and approve the requested operation. Inspect its result:

- `diskVerified: true` means the saved bytes were read back successfully.
- `notepadOpened: true` means an accessible Notepad window was located.
- `editorVerified: true` means the accessible editor content matched the file on first open.
- `documentClosed: true` means the target document tab/window was confirmed absent after closing.
- `documentReopened: true` and `reopenEditorVerified: true` mean reopening and a second editor check succeeded.
- `verified: true` requires all of these stages.
- An unsuccessful editor verification must be reported as **unverified**, not completion.

The file is placed in the current working directory used to launch SkyCode. Use a new filename for each test; this milestone refuses to overwrite existing files.

## Next milestones

1. Live foreground-window snapshots with stable element identities and window-focus checks.
2. Approved UI Automation actions (`focus`, `invoke`, `set-value`) with before/after snapshots; fallback to vision/coordinates only when needed.
3. GUI-native Notepad editing, Save dialog handling, close/reopen, and verified read-back.
4. Reusable application operations for browsers, file management, developer tools and video-production workflows.
5. Recording/editing/exporting educational videos, then approval-gated publishing.

Never label a task successful without evidence appropriate to each stage.
