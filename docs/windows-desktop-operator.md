## Shared computer-control skills (experimental)

These tools belong to the existing SkyCode task loop; they are not separate Notepad, Chrome, or video-production agents.

| Skill | Capability |
| --- | --- |
| `computer_observe_window` | Inspect an exact discovered window without changing foreground focus |
| `computer_focus_window` | Restore/focus an exact discovered window and verify Windows accepted activation |
| `computer_observe` | Read the foreground window identity and a bounded semantic UIA control snapshot |
| `computer_act` | Execute one UIA focus, invoke, value assignment, scroll, or approved shortcut |
| `computer_batch` | Execute 1–8 actions in the same local Windows adapter without additional model calls; stop on failure |
| `computer_verify` | Compare the current foreground window and optionally an accessible control against explicitly expected values |
| `desktop_list_windows` | Categorize top-level windows without inspecting pixel screenshots |

Call `desktop_list_windows` to obtain the exact window title, process ID, and optional handle. Use `computer_observe_window` to inspect an app without changing focus, or `computer_focus_window` to activate it. Then call `computer_observe` to obtain the foreground controls. Pass those identities into `computer_act` or `computer_batch`; the adapter refuses to act when focus changes. Use `computer_verify` after changing a control. The `postObserved` field means that another UIA snapshot was captured after an action; it is **not** proof that the user's overall task succeeded.

### Verifying typed editor content

After a `type` or `set_value` action, call `computer_verify` with `expectedTitle`, `expectedProcessId`, and `expectedText` (1–1000 characters). This checks text actually exposed by accessible Edit/Document controls, searching up to 3,000 descendants instead of relying on the first 40 nodes returned by `computer_observe`. When the app does not expose readable text, the outcome is `verified:false` (unknown), **not** proof that the action failed or succeeded. Do not use `controlName` as evidence that the expected text was typed.

### Mouse and keyboard controls (experimental)

The existing `computer_act` and `computer_batch` tools now accept these UI-targeted operations:

- `move`, `click`, `right_click`, `double_click`: find **exactly one** accessible control by name/automation ID, check its center against the selected window and Windows hit-testing, then move or click. Never supply guessed x/y pixel coordinates.
- `drag`: move an item between two different, unambiguous accessible controls in the same focused window. Source uses `name`/`automationId`; destination uses `targetName`/`targetAutomationId`. The script hit-tests both endpoints, checks window focus while moving, and releases the left mouse button even on interruption. Dragging is **not proof** that an app accepted the drop; inspect the post-action state.
- `type`: focus a named `Edit` or `Document` accessibility control and enter literal text (up to 1,000 characters per action). Typing uses native Windows SendInput Unicode key events and returns charactersSent/textVerified evidence. If UI Automation cannot read back the content, SkyCode must report uncertainty rather than repeat the typing action. IME and cross-app behavior still require live testing. Prefer `set_value` when the editor supports ValuePattern.
- `keypress`: send an explicitly allowlisted shortcut, including navigation, Enter, Escape, Backspace and Delete.
- `scroll`: use the accessibility control's vertical ScrollPattern.

All actions require the expected foreground window **title and process ID**. First use `desktop_list_windows`, `computer_focus_window` and `computer_observe`. A successful action means Windows accepted the operation and a subsequent observation was collected; independently verify the intended task result with `computer_verify` or another suitable checker.

Current pointer control is semantic and bounded. Raw coordinate moves, freehand drag/drop, screen-based vision targeting, screen recording and high-performance input injection are **not yet implemented**.

### Bounds

- Windows interactive session only, running with current user's permissions.
- No UAC, credential or secure-desktop bypass.
- Exact-match UIA targets, no coordinate guessing. Batch limited to eight steps.
- Keyboard shortcuts limited to a small allowlist; `set_value` limited to 3,000 characters per action.
- Owner Mode may auto-approve tools, but does not override UIA protections or the emergency stop.
- Accessiblity snapshots are deliberately bounded; use another observation if the desired control isn't present.
- Some software does not expose enough UI Automation information. Screenshot understanding, generic mouse targeting, recording, and phone/video calls remain future work.

### Test the two adapters

```powershell
bun test packages/cli/src/tests/windows-desktop.test.ts
bun packages/cli/src/index.tsx
```

Then ask SkyCode to list open windows and inspect the current foreground window. Test a harmless control in Notepad (such as focus) before attempting a batch. The PowerShell parser test checks **both** the legacy Notepad adapter and the new computer-control adapter.


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
