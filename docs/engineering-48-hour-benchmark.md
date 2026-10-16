# SkyCode software engineer: 48-hour milestone

## Target
SkyCode should take a practical software request from an existing workspace through implementation, runtime checks, error correction, and an honest handoff. Commands are preferred for deterministic development work; screenshots and GUI interaction are for visual or interactive acceptance checks. No hardcoded app or filename routing.

## Benchmark A — greenfield app (run in a NEW, disposable empty workspace)
Prompt:
> Build a locally runnable task manager with a clean responsive UI, projects, task creation/editing/completion, local persistence, and a short README. Choose a reasonable stack. Run available tests and a production build, fix problems, start the app, check logs, and examine the actual UI if browser/desktop inspection is supported. Do not claim anything you couldn't verify.

Acceptance evidence (record in tool trace):
1. Workspace inspection, followed by appropriate architecture and multi-file implementation.
2. Real dependency installation (where required) and an actual successful build/typecheck.
3. One meaningful automated behavioral test that was executed successfully (not only created).
4. App process started and logs/localhost inspected.
5. When accessible, at least one observed GUI screen covering the main interaction, without exposing secrets.
6. Final response distinguishes verified facts, remaining limitations, and the actual local run URL.

## Benchmark B — bug-fix continuation (same disposable project)
Deliberately introduce a harmless failure in a nonsecret, user-owned test module. Prompt:
> Fix the failing test without removing or skipping it. Run the test again and summarize the root cause.

Accept only a trace showing the failed test read, a minimal repair, and a successful rerun.

## Benchmark C — method selection
Prompt 1 (code): > Find the startup script and run the smallest relevant verification check.
Prompt 2 (eyes): > Open the app and tell me if the task form is visible and usable. Do not assume from the source code.
Check that the first uses deterministic file/terminal tools and the second gathers genuine live GUI evidence.

## Scoring / shipping threshold
Record each criterion as pass/fail/not-tested with an evidence pointer (command output, trace or screenshot). A *passing code check* is not equivalent to a *passing visual acceptance check*. Never infer one from the other. Aim for 6/6 in A, 2/2 in B, and correct tool choice for both C tasks, with zero fabricated success claims.

The built-in verification gate is one necessary safeguard; it does **not** replace execution of these benchmarks on Windows. A 48-hour delivery target is a development goal, not evidence of achieved reliability.
