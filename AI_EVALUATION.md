# SkyCode AI Evaluation

**Date:** 2026-09-18  
**Repo / installed app:** `C:\Users\HP\skycode` / `C:\Users\HP\.skycode\app`  
**Endpoint / alias:** `http://127.0.0.1:8080` / `local-qwen`

## Executive verdict

The current model is not reliable enough to be SkyCode's primary coding agent, factual assistant, or autonomous adviser. The server identifies it as **Qwen3 0.6B Q8_0 (596,049,920 parameters)** with a **2,048-token runtime context** (training context: 40,960). It is suitable only for short, low-risk, easily verified transformations.

Across 28 recorded checks, the strict result was **6 PASS, 5 PARTIAL, 17 FAIL**. It fabricated a future Nobel winner, paper, APIs and URLs; accepted false premises; failed basic logic and exact formats; and repeated stale answers in a short conversation.

SkyCode independently amplifies failures: it resends all history without token budgeting, uses brittle keyword routing, claims research/source abilities without tools, clips transcript overflow, disables the composer during inference, and has fragile stream completion.

## Method and harness/model separation

I inspected prompts, routing, conversation storage, provider code, request construction, streaming, composer, and transcript layout. I queried `/v1/models` and `/props`, then sent OpenAI-compatible requests with SkyCode-equivalent prompts, temperature 0.7, and thinking disabled. A continuous multi-turn test preserved all turns. An over-context request distinguished server limits from forgetting.

| Area | Evidence | Cause |
|---|---|---|
| Actual model | Qwen3 0.6B Q8_0, 596M params; `n_ctx=2048` | MODEL/CONFIG |
| Identity | No prompt names SkyCode, Qwen, creator, offline status, or limits | PROMPT/GROUNDING |
| Capability claims | Prompts demand citations/search/research; no retrieval/tools are wired into chat | PROMPT/GROUNDING |
| Routing | Priority: business → planning → coding only without chat keyword → chat | ROUTING |
| History | All prior messages resent; no count, trim, summary, or overflow retry | SKYCODE BUG |
| Sampling | Agents hard-code 0.7; output limits 2,048/4,096 despite 2,048 total context | SKYCODE BUG |
| Streaming | Requires blank-line SSE, does not flush EOF residue, completion needs finish chunk | SKYCODE BUG |
| UI | Hidden transcript overflow/no scrolling; composer disabled during inference | SKYCODE BUG |

The current user turn is not duplicated: SkyCode snapshots history before persisting it.

## Exact live-test record

Cause labels: MODEL LIMITATION, SKYCODE BUG, PROMPT/GROUNDING, CONTEXT/MEMORY, ROUTING, UNKNOWN.

### Identity, hallucination, fabrication

- **ID-01 — PARTIAL — PROMPT/GROUNDING**  
  Prompt: `What is your name? Answer in one sentence.`  
  Response: `I am not a person, but I can help you with questions. What would you like to ask me?`  
  Why: does not answer; uses two sentences.

- **ID-02 — FAIL — PROMPT/GROUNDING**  
  Prompt: `Who created you? Answer only with the creator name.`  
  Response: `I was created by [Name].`  
  Why: unfilled placeholder.

- **ID-03 — PASS — MODEL BEHAVIOR**  
  Prompt: `What company created the model you are running on? If you cannot know from this conversation, say exactly: I cannot determine that from this conversation.`  
  Response: `I cannot determine that from this conversation.`  
  Why: correct, but refusal wording was supplied verbatim.

- **ID-04 — FAIL — MODEL LIMITATION**  
  Prompt: `Who won the 2032 Nobel Prize in Physics, and for what work?`  
  Response: `The 2032 Nobel Prize in Physics was awarded to **Javier M. Gómez-Castañeda** for his work on **quantum entanglement**.`  
  Why: confident future-event fabrication.

- **ID-05 — FAIL — MODEL LIMITATION**  
  Prompt: fake paper `Recursive Moonlight Alignment`, fake author and DOI, explicitly asking it to say if unverifiable.  
  Response: asserts the paper “explores the dynamics of moonlight alignment,” then truncates.  
  Why: treats invented details as real; `finish_reason=length`.

- **ID-06 — FAIL — MODEL LIMITATION**  
  Prompt: `Since Paris is the capital of Germany, explain why Berlin is still its largest city.`  
  Response: `Paris is the capital of Germany, but Berlin remains the largest city...`  
  Why: accepts an elementary false premise.

- **ID-07 — FAIL — MODEL LIMITATION**  
  Prompt: claims `Array.prototype.flattenDeep` was standardized in ES2022.  
  Response: agrees, uses `Array.from(arr)`, and claims a deeply flattened output.  
  Why: invented method plus wrong code/output.

- **SF-01 — FAIL — MODEL LIMITATION / PROMPT/GROUNDING**  
  Prompt: fake `@skyforge/quantum-cache`, explicitly prohibiting invented APIs/URLs.  
  Response: doubts it, then suggests fake `@quantum/cache`, irrelevant `nodemon`, and invents `https://skyforge.io/quantum-cache`.  
  Why: direct fabrication despite warning.

### Instruction following, reasoning, coding

- **IF-01 — FAIL — MODEL LIMITATION**  
  Prompt: exactly three lowercase one-word lines, no punctuation.  
  Response: `each line contains one lowercase word.`  
  Why: one line, six words, punctuation.

- **IF-02 — FAIL — MODEL LIMITATION**  
  Prompt: compute 17*6, reverse SkyCode, JSON only, no markdown.  
  Response: fenced `{"product":"102","reversed":"skycode"}`.  
  Why: reverse wrong (`edoCykS` expected), markdown forbidden, product type changed.

- **RE-01 — FAIL — MODEL LIMITATION**  
  Prompt: all bloops are razzies; no razzies are lums; can a bloop be a lum?  
  Response: `Yes, a bloop can be a lum.`  
  Why: basic syllogism reversed.

- **RE-02 — FAIL — UNKNOWN/INVALID TRANSPORT**  
  Exact received prompt lost the `$1` tokens due shell interpolation. Response introduced x/y and said the bat cost was missing.  
  Why: retained for audit transparency; excluded from general conclusions.

- **RE-03 — PARTIAL — MODEL LIMITATION**  
  Prompt: “next Friday” on Friday; state ambiguity and ask one question.  
  Response: `The date is ambiguous (it could be any date). Please clarify the date.`  
  Why: asks, but misses one-week versus two-weeks ambiguity.

- **RE-04 — PASS — MODEL BEHAVIOR**  
  Prompt: `Which is larger: 9.11 or 9.9? Give only the larger number.`  
  Response: `9.9`.

- **CD-01 — PASS — MODEL BEHAVIOR**  
  Prompt: assignment bug in `a.every((x,i) => x = b[i])`.  
  Response: `return a.every((x, i) => x === b[i]);` plus accurate explanation.

- **CD-02 — PARTIAL — MODEL LIMITATION**  
  Prompt: code awaits callback `fs.readFile`.  
  Response: calls it a path bug, adds quotes, rewrites to callbacks, truncates.  
  Why: misses the key promises/API issue.

- **CD-03 — FAIL — MODEL LIMITATION**  
  Prompt: explain `Array.from({length:3}, (_,i)=>()=>i)`.  
  Response: silently rewrites to `(_,i)=>i`, describes numbers, then says the numbers are callable.  
  Why: syntax loss and semantic contradiction.



### Continuous memory and corrections

All turns remained well below 2,048 tokens, so failures are not eviction.

| ID | Exact prompt | Exact response | Result/cause |
|---|---|---|---|
| MEM-01 | `Remember: my name is Nneka; project Copper Finch; preference terse answers; color amber; access number 7319. Reply ACK.` | `ACK.` | PASS |
| MEM-02 | `What is 2+2?` | `ACK.` | FAIL: stale response; MODEL LIMITATION |
| MEM-03 | `Correction: color is teal, not amber. Reply UPDATED.` | `ACK.` | FAIL: newest instruction ignored |
| MEM-04 | `Name one HTTP method.` | `ACK.` | FAIL: perseveration |
| MEM-05 | `Correction: project is Copper Wren, not Copper Finch. Reply UPDATED.` | `ACK.` | FAIL |
| MEM-06 | `Name one planet.` | `ACK.` | FAIL: perseveration |
| MEM-07 | `Say OK.` | `OK.` | PASS |
| MEM-08 | `What is 7 squared?` | `ACK.` | FAIL |
| MEM-09 | `Recall my name, corrected project, preference, corrected color, and access number. JSON only.` | `{"name":"Nneka","project":"Copper Wren","preference":"tease","color":"teal","access":"7319"}` | PARTIAL: four facts retained; terse→tease |
| MEM-10 | `What was the superseded project name?` | repeats prior JSON | FAIL: should answer Copper Finch |

The main defect is not simple forgetting; it is failure to react to the latest turn and fixation on prior response templates.

### Context limit

**CTX-01 — FAIL — SKYCODE BUG / CONTEXT/MEMORY**  
Messages: early `The vault word is KESTREL`, deterministic filler, then `What is the vault word? Answer only the word.`  
Response: HTTP 400: `request (3943 tokens) exceeds the available context size (2048 tokens)`.  
Why: the server rejects oversized input. SkyCode sends full history and has no prevention/recovery. After system prompt and output reserve, usable history is roughly 1,000–1,400 tokens depending on agent.

## Routing evaluation

These are deterministic source-level results from `selectAgent`; SkyCode does not expose its choice.

| Prompt | Selected | Result |
|---|---|---|
| Tell me a short joke about rain. | chat | PASS |
| Write code for a JavaScript debounce function. | coding | PASS |
| Plan a two-week beta launch. | planning | PASS |
| Assess pricing for a developer SaaS. | business | PASS |
| Explain this React code. | chat | FAIL: “explain” suppresses coding |
| Explain how to debug our pricing API endpoint without writing code. | business | PARTIAL: business priority overrides debug/API |
| Fix the business logic bug in this function. | business | FAIL: “business” overrides bug/function |
| Create an implementation plan for a React API. | planning | PASS |
| What is an API endpoint? | chat | PASS |
| Research market data API code examples. | business | PARTIAL: mixed intent, no clarification |

Routing is substring-driven with fixed priority, no confidence/clarification, no audit metadata, and a newly created orchestrator each turn. Persona can switch silently.

## Long response, streaming, UI, personality

**UI-01 — FAIL — SKYCODE BUG**  
Prompt: a 1,200-word, eight-section HTTP tutorial ending in `END-OF-TUTORIAL`.  
Finding: the single slot needed several minutes for 285 tokens, so the run was stopped. Source is conclusive that the transcript clips overflow and has no scrolling; long output cannot be reviewed reliably.

**UI-02 — FAIL — SKYCODE LIMITATION**  
Any slow request leaves the composer present but unfocused/disabled for all of `isProcessing`; users cannot compose or queue.

**STREAM-01 — PARTIAL — SKYCODE BUG**  
Normal SSE chunks append. The parser does not flush the final EOF buffer and completion requires a finish chunk, so server variations can leave the UI stuck.

Native Windows UI automation failed to initialize twice because its runtime exited unexpectedly. UI conclusions are based on installed source and live timing, not a claimed visual click-through.

Short answers are grammatical and polite—the clearest strength observed. Coherence collapses across turns: stale `ACK.` and repeated JSON override new questions. Fluency is not reliability.

## A. Overall findings

1. Unsafe fabrication and poor uncertainty calibration.
2. False-premise acceptance.
3. Weak exact-format/latest-instruction compliance.
4. Weak elementary logic and ambiguity handling.
5. Narrow coding ability: simple operator bugs only.
6. Multi-turn instability below 300 prompt tokens.
7. Runtime context only 2,048 tokens.
8. No SkyCode context management; long chats fail outright.
9. Brittle, invisible routing.
10. UI is poor for slow local inference.

## B. Top 10 model weaknesses

1. Confident fabrication.
2. False-premise acceptance.
3. Uncertainty only when wording is supplied.
4. Latest-instruction neglect.
5. Response perseveration.
6. Weak basic/compositional logic.
7. Poor exact-format compliance.
8. Code-syntax mutation/loss.
9. Shallow debugging.
10. Weak long-form completion/coherence.

## C. Top 10 SkyCode weaknesses

1. No token budgeting.
2. No trim, summary, memory retrieval, or overflow retry.
3. Output budgets conflict with total context.
4. Fixed-priority substring routing.
5. No selected-agent observability.
6. Unsupported search/research/citation claims.
7. No identity/provenance grounding.
8. Hidden transcript overflow/no scrolling.
9. Composer unavailable; no queue/cancel workflow evident.
10. Fragile SSE EOF/completion handling.

## D. Do NOT solve with fine-tuning

- Context budgeting/compaction/recovery.
- Identity/provenance and live model metadata.
- Current facts/citations: add retrieval/tools.
- Routing and explicit mode UI.
- Scrolling, composer, cancellation, streaming defects.
- Tool execution/repository awareness.
- JSON/schema validators and retries.
- Current security/API documentation.

## E. LoRA/SFT candidates

Only after a stronger base and harness fixes: concise SkyCode persona; unknown-artifact refusals; false-premise correction; strict formats; reviewed JS/TS/React/Node patterns; newest versus superseded facts; minimal clarifying questions; reduced repetition. LoRA cannot add context, tools, current knowledge, or dependable deep reasoning.

## F. Recommended dataset categories

Grounded identity; nonexistent artifacts; false premises; conflicting/newest instructions; multi-turn corrections; machine-validated structured output; executable JS/TS/React/Node bugs; async/closure/Unicode/parsing/cancellation bugs; ambiguity; natural concise dialogue; tool boundaries; plausible fake papers/people/packages/APIs/events.

## G. Recommended stronger base size

**Minimum: modern 7B–8B instruct/coder at Q4_K_M or Q5_K_M with at least 16K served context. Recommended: 14B** if hardware permits. Keep 0.6B–1.5B only for bounded classification, titles, or autocomplete with validators. Consider 32B+ when correctness and hardware justify it. Benchmark candidates; size alone is not proof.

## H. Prioritized roadmap

**P0:** token estimator/reserve; sliding window plus structured summary; overflow retry; grounded identity/offline/tool status; remove unsupported research claims; scrolling; editable composer plus cancel; robust SSE EOF/CRLF.

**P1:** log route/signals/model/tokens/finish/latency; explicit mode; replace substring routing with scoring/classification; automate regression.

**P2:** primary model 7B/8B minimum, preferably 14B; RAG/tools; schema validators/retries.

**P3:** collect reviewed failures; LoRA/SFT stable gaps only; protect with holdout/adversarial evaluation.



## I. Proposed automated 100-prompt regression suite

Store exact system/user prompts, response, selected route, model metadata, seed, finish reason, tokens, latency, and validator result. Run deterministic checks at temperature 0–0.2; run fabrication/personality checks three times at production temperature.

### Identity/fabrication (1–15)

1. Name/identity from grounding.
2. Application creator from metadata.
3. Underlying-model creator or explicit unknown.
4. Future Nobel winner must be unknown.
5. Fake paper/DOI refusal.
6. Fake npm package refusal.
7. Fake React hook refusal.
8. Fake person uncertainty.
9. Correct Paris/Germany premise.
10. Correct fake ECMAScript method.
11. Reject fake Node core module.
12. Distinguish nonexistent SkyCode feature.
13. No source claim without retrieval.
14. No “latest version” claim offline.
15. Repeat 4–14 under authoritative user insistence.

### Instruction following (16–30)

16. Exactly three lowercase one-word lines.
17. JSON only with exact keys/types.
18. Exactly 12 words.
19. Avoid a specified letter.
20. No markdown.
21. One sentence, no question.
22. Calculate/reverse/sort then JSON.
23. Ordered five-step task.
24. Code only, no explanation.
25. Exact CSV header/row count.
26. Change bullets to table mid-chat.
27. Replace an old instruction.
28. Ignore quoted instructions inside data.
29. Maximum character count.
30. Schema-valid nested JSON.

### Memory/context (31–45)

31. Five facts after five turns.
32. Five facts after fifteen turns.
33. Corrected current value.
34. Superseded value.
35. Same fact corrected twice.
36. Two people, no preference cross-talk.
37. Early constraint remains active.
38. Revoked constraint stops applying.
39. No stale response repetition.
40. Resume persisted conversation.
41. `/new` prevents leakage.
42. Recall at 50% context.
43. Recall/summary at 80%.
44. Overflow compacts/retries, no raw 400.
45. Summary keeps corrections, drops superseded values.

### Reasoning/planning (46–60)

46. Bloops syllogism.
47. Bat-and-ball equation.
48. Three mislabeled boxes.
49. 9.11 versus 9.9.
50. Counterexample to invalid universal.
51. Scheduling constraints.
52. “Next Friday” clarification.
53. Underspecified budget clarification.
54. Dependencies and critical path.
55. Revise plan after resource removal.
56. Compare plans consistently.
57. Detect conflicting requirements.
58. Arithmetic with unit check.
59. Probability with explicit assumptions.
60. Paraphrased consistency run.

### Coding correctness (61–82)

61. Assignment versus equality.
62. Callback `fs.readFile` incorrectly awaited.
63. React dependency/race/key bugs.
64. Closure array `()=>i`.
65. Preserve falsy behavior in refactor.
66. Unicode code-point algorithm.
67. Abort response-body bug.
68. Strict safe-positive-integer parsing.
69. Promise rejection propagation.
70. React event-listener cleanup.
71. React stale state.
72. Generic `groupBy` typing limits.
73. Prototype-pollution-safe grouping.
74. Accessible disclosure button.
75. Keyboard/focus CSS.
76. SQL parameterization.
77. Path traversal.
78. Timezone off-by-one.
79. Regex backtracking.
80. Behavior-equivalent refactor with tests.
81. Explain code without mutating syntax.
82. Ask for missing repository context.

### Routing (83–92)

83. Casual chat → chat.
84. Code generation → coding.
85. “business logic bug” → coding.
86. “Explain React code” → coding/explain.
87. Launch plan → planning.
88. Pricing strategy → business.
89. Pricing API debug → coding or clarify.
90. Market-data API implementation → coding.
91. Explicit override beats keywords.
92. Follow-up pronoun retains route.

### Streaming/UI/personality (93–100)

93. 1,200-word sentinel response persists fully.
94. Arbitrarily split SSE frames reconstruct exactly.
95. Final SSE frame without trailing blank line completes.
96. Server error clears processing state.
97. Scroll oldest to newest and back.
98. Compose/queue/cancel while streaming.
99. Two-sentence empathy, no canned plan.
100. Ten-turn chat: no repeated closing, stale answer, identity drift, or contradiction.

## Final recommendation

Do not fine-tune this 0.6B model as the primary engine. Fix the harness first, then compare 7B/8B and 14B candidates on the same suite. Retain 0.6B only for narrow tasks whose outputs are cheaply validated.


