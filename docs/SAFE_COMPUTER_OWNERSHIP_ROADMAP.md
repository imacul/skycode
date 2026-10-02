# Safe Computer Ownership Roadmap

Skycode "owns" a computer only in the sense that it can operate an enrolled
device for its user. The model proposes actions; deterministic policy and an
unprivileged capability broker decide what may run.

## Owner Mode (opt-in)

Local operators can raise autonomy with `/owner on` then `/owner confirm`.

When `ownership.mode = "owner"` in `~/.skycode/settings.json`:

- Approvals auto-grant (`autoApprove`)
- System/destructive commands, absolute paths, shell pipes/chaining, and arbitrary
  desktop apps become allowed under the matching flags
- Actions are appended to `~/.skycode/audit/owner-actions.jsonl`
- `/owner off` restores safe mode

Still enforced in Owner Mode:

- `~/.skycode/EMERGENCY_STOP` hard-stops every tool
- Secure desktop / lock screen / password-field rejection
- No silent Admin/UAC elevation (still the Windows user token)
- Credential vault + redaction boundaries

## Delivery rules

- Ship milestones in order. A later capability may not bypass an earlier boundary.
- Default deny when an action cannot be classified.
- Treat repositories, web pages, UI text, tool output, and MCP servers as untrusted.
- Keep privileged, financial, identity, communication, and irreversible actions human-gated.
- Every action needs provenance, a bounded capability, an audit event, and a checked result.

## G1 — Close implicit execution paths (in progress)

Acceptance criteria:

- Repository scripts never execute merely because they are named test, build, lint, or dev.
- MCP discovery cannot start a configured server without approval.
- Commands use executable/argument arrays rather than a shell string.
- Repository trust is explicit and invalidated when execution-relevant files change.
- Malicious package scripts, MCP configs, quoting, and parser evasions have regression tests.

Implemented first slice:

- Tests, builds, linters, type checks, and dev servers now require approval.
- MCP tool discovery now requires approval before server startup.
- Foreground and background commands are parsed into executable/argument arrays and launched
  without a command shell.
- Workspace log reads use an internal bounded file reader instead of shell built-ins.
- Windows process shutdown releases direct-child handles before descendant cleanup.
- Terminal, MCP, desktop-open, browser, and deletion approvals are scoped to the workspace
  and exact action. Terminal grants include execution-manifest and lockfile fingerprints;
  MCP grants include user and workspace MCP configuration fingerprints.
- Changes to repository execution metadata automatically invalidate remembered execution grants.

## G2 — Harden network access (complete)

Acceptance criteria:

- Loopback, private, link-local, multicast, metadata, and reserved destinations are denied.
- DNS answers and every redirect hop are validated.
- Local-network access is a separate explicit capability.
- Downloads have size, time, MIME, decompression, and redirect limits.
- Requests cannot inherit ambient credentials.

Implemented first slice:

- Literal private/local addresses are rejected.
- DNS answers are checked and redirects are followed manually with validation per hop.
- HTTP(S) connections are pinned to the validated DNS address, closing the rebinding gap.
- Local/private access uses a separate `web_fetch_local` capability and scoped approval.
- Public and local redirects cannot cross their respective network boundary.
- Response size, timeout, redirect count, readable MIME types, and content encoding are bounded.
- Requests send only fixed SkyCode headers, request identity encoding, and never inherit cookies,
  authorization headers, or other ambient credentials.

## G3 — Protect secrets and identity

Acceptance criteria:

- Secrets live in OS credential storage, never plaintext settings or transcripts.
- Tools receive scoped handles rather than raw credentials.
- Logs, model context, clipboard access, crash reports, and tool results are redacted.
- Account, recipient, origin, and identity use are visible in approvals.

Implemented first slice:

- Provider keys are excluded from persisted Zustand settings.
- Legacy plaintext provider keys are migrated out of `settings.json` and scrubbed.
- Windows persists provider keys as current-user DPAPI ciphertext with restricted file modes.
- Linux persists provider keys through Secret Service (`secret-tool`) when available.
- macOS persists provider keys through Security.framework/Keychain when Swift is available; the
  secret is passed through stdin and never exposed in process arguments or environment variables.
- Credential saves and legacy migrations are read-back verified before plaintext state is cleared;
  failed saves are rejected, and failed rotations restore the previously working credential.
- Unsupported platforms use environment/session credentials rather than a plaintext fallback.
- Diagnostics recursively redact credential fields, registered secrets, bearer tokens, JWTs,
  private keys, and credential-shaped values.
- Background-process logs, tool results, previews, and model-visible errors are redacted at the
  tool boundary as well as at the diagnostic-log boundary.

## G4 — Capability leases and policy broker

Acceptance criteria:

- Replace broad permission families with workspace/device/action/resource-scoped leases.
- Grants expire and are invalidated by executable or configuration changes.
- A small unprivileged broker independently enforces paths, processes, network, and UI access.
- Elevation is OS-mediated, single-use, and bound to an exact typed action.

Implemented first slice:

- Session grants expire after 30 minutes and persisted grants after 24 hours; legacy indefinite
  grants are no longer honored.
- Every grant remains bound to the workspace, exact typed action/resource, and relevant
  executable/configuration fingerprints.

## G5 — Untrusted-content and prompt-injection defenses

Acceptance criteria:

- All observations carry source provenance and trust labels.
- Untrusted content can provide data but cannot grant authority or change policy/goals.
- Secret-bearing and external-side-effect actions reject tainted destinations and instructions.
- Cross-source instruction conflicts produce a safe stop or user confirmation.

Implemented first slice:

- Repository, terminal, web, and MCP observations are labeled `untrusted-data` in the
  model-visible protocol and wrapped with an explicit data-only instruction boundary.
- Once instruction-bearing untrusted content is observed, subsequent workspace writes and
  executable actions require a separately scoped untrusted-influence approval.
- Read-only metadata remains available without granting new authority.

## G6 — Transactions, recovery, and supervision

Acceptance criteria:

- File writes use precondition hashes, journals, checkpoints, and recoverable deletion.
- External actions use idempotency keys and verify postconditions.
- Time, action, cost, and network budgets have deterministic circuit breakers.
- A broker-level emergency stop works independently of the model and UI.
- Crashes recover safely and clean up orphaned processes.

Implemented first slice:

- File writes use same-directory temporary files and atomic rename.
- Reads expose SHA-256 preconditions; mismatches reject stale overwrites.
- Writes create prepared/completed journal records and retain pre-write backups.
- Approved deletions move to per-workspace recovery trash.
- Approved transaction restoration checks workspace ownership and refuses stale rollback.
- Tool loops enforce both model-round and total-action hard limits.
- A durable local emergency-stop marker is checked independently at tool and network boundaries;
  activation default-denies actions until a local operator explicitly clears it.

## G7 — Semantic browser and desktop control

Acceptance criteria:

- Windows UI Automation, macOS Accessibility, and Linux AT-SPI/portal adapters expose typed nodes.
- Coordinate clicks and OCR are fallback mechanisms, not the primary control plane.
- Window identity and focus are verified before input or consequential clicks.
- Secure desktops, authentication prompts, password managers, and lock screens are excluded.
- Browser automation uses isolated profiles and origin-scoped permissions.

Implemented first slice:

- Browser, live-research, and natural-language music requests are hard-routed to the tool-capable
  agent instead of a text-only model.
- Brave automation uses a dedicated SkyCode profile and debugging port rather than attaching to
  arbitrary personal tabs.
- YouTube Music control only evaluates fixed code on the expected origin and reports success only
  after page media state confirms playback; opening/clicking without verification is an error.
- A typed semantic-action policy requires stable process/window/title identity, foreground focus,
  a live enabled accessibility node, and stable browser origin immediately before each action.
- Secure desktops, authentication fields, password managers, lock/login surfaces, and origin
  changes are rejected deterministically.

## G8 — Device enrollment and remote control

Acceptance criteria:

- Devices use cryptographic enrollment, mutual authentication, and signed policy/update bundles.
- Sessions visibly indicate remote control and support immediate local revocation.
- Per-device policies, offline-safe behavior, tamper-evident logs, and recovery mode exist.

Implemented first slice:

- Device enrollment creates an Ed25519 identity whose private key is accepted only after verified
  storage in the OS credential vault; the public-key fingerprint is the stable device ID.
- Mutual challenge signing detects impersonation, and signed policy/update bundles reject
  modification, expiration, and future-issued timestamps.
- Audit records form a sequence-numbered SHA-256 hash chain that detects modification, deletion,
  and reordering.
- Remote transport/control remains default-disabled until enrollment, signed policy, visible-session,
  revocation, and recovery checks are wired end to end.

## G9 — Adversarial release gates and autonomy levels

Acceptance criteria:

- Disposable Windows, macOS, and Linux VMs test prompt injection, malicious repositories,
  MCP servers, SSRF, filesystem races, approval confusion, secret exfiltration, retries,
  wrong-window input, crashes, and duplicate external actions.
- Canary credentials prove that secrets did not escape.
- No release ships with failing security tests.
- Autonomy progresses from observe-only, to reversible local changes, to narrowly scoped
  external actions only after the preceding level meets its safety target.

Implemented first slice:

- A dedicated security test gate runs redaction/canary, emergency-stop, SSRF/network,
  authorization/approval, command parser, filesystem boundary, recovery, and prompt-injection
  regressions separately on Windows, macOS, and Linux for every pull request and main push.
- Security test files run in separate Bun processes so a runtime crash cannot silently skip later
  gates; any failed or crashed gate fails the release job.
