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

### Automatic visual refresh after computer actions

The desktop operator now attaches a fresh, full-desktop JPEG automatically after each `computer_act` / `computer_batch` operation, including a failed operation when capture is possible. The model receives actual new pixels in the next decision round without manually asking for a screenshot each time. `computer_focus_window` also returns a fresh visual observation. The most recent screenshot is forwarded if one tool response has multiple captures, and the transient image is cleared after the model request consumes it rather than added permanently to transcript history.

When Windows rejects `SetForegroundWindow`, the adapter also tries UI Automation's `SetFocus` against the exact previously discovered window before declining to send input. It never sends the action if the target isn't foreground. Failed actions return an error alongside post-attempt pixels, not a false success.

This loop is event-driven after GUI operations, not continuous video streaming. Screenshot evidence is observation, **not independent proof** that the requested operation succeeded. The model must inspect the resulting frame before continuing or reporting completion. Images can contain private screen content, which is sent to the configured vision model.

### GUI-first, efficient desktop execution

For an ordinary visual Windows task, the model should follow a short loop: locate/focus or launch the required application, inspect its accessible controls or screenshot, perform physical mouse/keyboard interaction, then verify the actual resulting state. `run_command` is an allowed general skill but **not** the default means of navigating windows, folders, menus or dialogs. This is a model planning preference shared across all applications, not a hardcoded dictionary of user commands or application names.

To prevent costly no-op behavior, the execution loop now rejects a third consecutive identical passive desktop observation when no other action intervened. A different observation type (such as `computer_screenshot`) or an actual GUI action can still be chosen. The activity panel distinguishes screen inspection from workspace inspection.

This does not prove tasks complete in a fixed number of actions. Results still require a real Windows acceptance test, and a selected model can still fail to choose the optimal action. If so, inspect the actual tool trace rather than treating model activity count as proof of progress.

### Dynamic task routing and cross-turn references

Automatic SkyCode requests now use **one model-led agent with optional tools**, independent of the user's exact command words. The model receives conversation context and decides whether to answer in chat, inspect the desktop, operate a window, edit source files, or combine tools. `go to VS Code and create a file`, `create a folder in Explorer`, and follow-ups like `open it` no longer need keyword matches to make computer tools available.

The separate chat, business, and planning agents remain available through explicit agent or specialist-mode selection. Owner Mode controls tool approvals and permissions, not the meaning of user phrases. The desktop adapter still validates supported action kinds, window identity, sensitive controls and permissions; removing phrase-based routing does **not** remove those safeguards.

For context-dependent instructions, first resolve the referent from recent conversation and available desktop observations. When more than one target fits, ask for clarification instead of inventing a selection. For instructions about a GUI, prefer seeing and using the real application's interface, but use file/terminal APIs when requested or when they offer a clearly authorized, verifiable outcome.

### Ambiguous controls and cross-application recovery

Targeted computer actions may identify controls by exact `name`, `automationId`, and `role` (e.g. `ControlType.Button`). When multiple fields are supplied, **all must match**; the operator never falls back to a looser name search. An ambiguous match reports a bounded sample of candidate control identities. The agent should inspect and narrow rather than repeat the same click. It should also avoid launching new application windows when the requested window is already present.

This improves generic targeting, but does not guarantee that every Windows application exposes unique accessibility identities. A screenshot/vision fallback remains future work.

### Screenshot-based visual fallback (experimental)

When UI Automation cannot identify an interface element, SkyCode can call `computer_screenshot` with `scope: "window"` to capture the **current foreground window**, and the result is supplied to the chosen vision-capable model as actual JPEG image content. By default, `computer_screenshot` uses `scope: "desktop"` to capture the **entire visible virtual desktop**, including wallpaper, icons, taskbar and overlaid windows. This prevents a floating search bar from accidentally becoming the entire visual observation. The screenshot is resized to fit within 1280 × 900 pixels and capped at 2 MB. SkyCode supports image input through its ChatGPT-plan Responses API, OpenAI Chat Completions, and OpenRouter Chat Completions adapters; the selected *model* must also support image inputs.

The image result includes the exact foreground title, process ID, native window handle, screenshot origin and size, resized image dimensions, creation time, and a temporary screenshot token. For precise mouse actions, use a **window-scoped** capture first; desktop-scoped captures are observation-only. If accessibility-based `computer_act` cannot reach a control, the agent may issue `computer_act` with `kind: "visual_click"`, `pointerKind: "click"` (or `right_click`/`double_click`), `x` and `y` in **resized screenshot image pixels**, and `snapshot` copied from the screenshot metadata. The adapter rejects screenshots more than 60 seconds old, mismatched windows, out-of-bounds points, detected credential controls and windows covered by a different application. A successful visual click consumes its screenshot token; after navigating or opening a menu, capture again rather than reuse earlier coordinates.

Capture is local, but the compressed screenshot pixels are sent to the connected model provider for analysis. Avoid opening private information before requesting screen inspection. A successful click is **not** proof of the desired application state: take a fresh UIA observation or screenshot to verify the result. Secure desktops/UAC prompts are intentionally unsupported. The visual fallback has not yet been live-validated on the user's Windows installation.

### Real Windows cursor input

Mouse actions are distinct from UI Automation invocation or shell commands. For natural-language requests involving actual mouse movement or clicking, SkyCode should choose `computer_act` with `move`, `click`, `right_click`, `double_click`, or `drag`. It will resolve a unique accessible control, hit-test the endpoint, verify the foreground identity, visibly move the real cursor, and send Windows mouse events as appropriate. The action result includes a pointer location, event count, and `outcomeVerified:false`; use a separate observation to verify whether the UI responded.

Mouse actions currently require a named accessible control. They cannot click an arbitrary screenshot coordinate or interact with controls hidden from accessibility. The skill is not yet independently live-tested across multiple applications.

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
