# Phase 4 — Real streaming for the `/ask` agent

Today nothing streams. `agentNode` calls `boundModel.invoke()` (a blocking call), the whole LangGraph run finishes, and the complete answer ships in one `final` SSE event. `AskPage` then replays that finished string as a typewriter at 4 chars / 12 ms. The "thought process" the user sees is three hardcoded strings — `Thinking (Step N)...`, `Verifying answer against your notes...`, and tool summaries like `3 passages`.

This phase makes the stream real: Gemini thought summaries streamed as they are produced, answer tokens streamed as they are generated, and the post-processing pipeline reconciled against the text the user has already read.

Backend event plumbing + frontend consumption. The reasoning/tool-group UI components are reused as-is.

## User Review Required

> [!IMPORTANT]
> **Optimistic streaming means the answer can be visibly retracted.** On grounding failure `askQuestionWithAgent` discards the generated answer and substitutes `generateFallbackAnswer` output ([agenticRag.service.ts:726-741](file:///D:/Study/2026_Summer/WDP301/prj/backendd/src/services/agenticRag.service.ts)). Once tokens are streamed, the user has already read text we then replace. This spec makes that replacement explicit and visible rather than silent. Measure the grounding-failure rate before shipping — if it is above a few percent, revisit and stream only after the check passes.

> [!IMPORTANT]
> **Streamed text carries raw `[n]` markers.** `applyCitations` runs after generation completes, so during the stream the answer renders with literal `[1]` markers and no source chips; the `final` swap installs the cited version. Verify whether `remarkCitations` renders chips without `citedSources` metadata present — if it does, there is no visual change and this is a non-issue. If it does not, expect one reflow at the end of the stream.

> [!WARNING]
> **Reasoning is session-only.** `createAskThreadHistoryAdapter` rebuilds assistant messages as a single text part; reasoning and tool-call parts are not persisted. After a reload the entire thought process is gone. This is the same known limitation that applies to artifact inline cards and is **not** addressed here. Persisting it requires storing reasoning on `ChatHistory`.

## Spike Results

Run against `gemini-3.1-flash-lite` with the real API key, a stubbed `search_documents`, and 4 representative questions per config. Three findings, two of which changed this spec.

**1. Thoughts are cleanly separable — the design is viable.** With `includeThoughts`, `chunk.content` becomes an array containing `{ type: "thinking", thinking: "..." }` parts, distinct from plain-text chunks (`content` is a bare string) and from `{ type: "functionCall" }` parts. Classification is unambiguous.

**2. `tool_calls` survive `concat()`** — verified across both turns of a tool loop. The graph-termination risk is real but the mechanism works.

**3. Thought emission is unreliable, and it is not monotonic in `thinkingLevel`:**

| Config | Turns emitting a thought | Avg first answer token | Avg total |
|---|---|---|---|
| thinking OFF (today) | 0/4 | 3075 ms | 3221 ms |
| `LOW` | 3/4 | 3459 ms | 3470 ms |
| `MEDIUM` | **0/4** | 3515 ms | 3534 ms |
| `HIGH` | 4/4 | 3875 ms | 3901 ms |

`MEDIUM` emitting zero while `LOW` emitted three is almost certainly small-sample noise, but the conclusion holds regardless: **you cannot rely on a thought summary existing for any given step.** Even at `HIGH` (which cost ~680 ms), the model emitted one thought per *question*, not per step. Thought summaries alone will not fill the dead air.

**4. Thoughts arrive as one complete block, not as a stream.** Each was a single 275–380 char chunk (one 1021-char case at `HIGH`). There is no token-by-token thought stream to render.

**5. The answer is bursty, not smooth.** Each answer arrived in 3–5 chunks with gaps of **≤1 ms** in most runs — the whole answer effectively lands at once. Raw streaming would render as a few large blocks slamming in, which looks *worse* than today's fake typewriter.

## Decisions

**`thinkingLevel: "LOW"`. Decided — do not change it without a new measurement.**

`HIGH` was the only config that gave a thought on every question, but it costs ~680 ms per turn and its guarantee is still only one thought per question, not per step. `LOW` gives 3/4 for ~250 ms. Because finding 3 forces a narration floor that must work with zero thoughts, the floor already covers the gap that `HIGH` pays to close. Real thoughts are a bonus on top of narration that always works.

This makes the narration floor the primary feature and thought summaries the secondary one. Build the floor first. If you build the floor correctly, a later switch to `HIGH` is a one-line change and a pure improvement. If you skip the floor, `LOW` ships blank steps.

> [!NOTE]
> **Resolved in implementation — post-answer phases must not create their own part.** `verifying` and `citing` arrive after the answer has streamed, by which point the last `agent_step` has already cleared the current reasoning part. Creating a part for them appends it *after* the text part, which renders a second "Reasoning" disclosure below the answer. Verified live, then fixed by routing them into the last reasoning part instead. Keep a reference that survives the `agent_step` reset.

> [!IMPORTANT]
> **Does `MessagePrimitive.GroupedParts` group non-contiguous parts?** This spec emits one reasoning part *per agent step*, so the parts array interleaves `reasoning, tool-call, reasoning, text`. If `groupBy` groups only contiguous runs, each step's thinking renders as its own disclosure next to its own tools — which is the desired outcome. If it merges all reasoning into one group, the chronology is lost and step-scoped rendering needs a different approach. Verify before building the frontend half.

## Proposed Changes

### Event schema

---

#### [MODIFY] [api.types.ts](file:///D:/Study/2026_Summer/WDP301/prj/backendd/src/types/api.types.ts) — `AgentEvent` (line 329)

```ts
export type AgentEvent =
  // Starts an agent turn. Resets the client's in-progress answer buffer (see
  // "Discarding pre-tool prose" below) and opens a new reasoning part.
  | { type: "agent_step"; step: number }
  // A complete Gemini thought summary. Arrives whole, not incrementally
  // (spike finding 4), and may never arrive for a given step (finding 3).
  | { type: "thought"; step: number; text: string }
  // Streamed answer text from the current step. Bursty — see finding 5.
  | { type: "answer_delta"; step: number; text: string }
  // Non-model work, and the narration floor that covers steps with no thought.
  | { type: "phase"; phase: "planning" | "retrieving" | "verifying" | "citing"; detail?: string }
  // The streamed answer was thrown away; `final` carries the replacement.
  | { type: "answer_revised"; reason: "grounding_failed" | "empty_answer" }
  | { type: "tool_start"; tool: string; toolCallId: string; input: unknown }
  | { type: "tool_end"; tool: string; toolCallId: string; resultSummary: string }
  | { type: "artifact_created"; artifactId: string; artifactType: string; title: string }
  | { type: "final"; data: AgentAskResponse }
  | { type: "error"; message: string };
```

Changes from today: `thought`, `answer_delta`, `phase`, `answer_revised` are new; `tool_start` / `tool_end` gain `toolCallId`; `grounding_check` is removed in favour of `phase: "verifying"`.

**The narration floor is mandatory, not optional.** Spike finding 3 means a step may produce no thought at all. `phase` events carry the descriptive fallback and must be specific enough to stand alone when no thought arrives — `phase: "retrieving"` with `detail: 'Searching your documents for "thylakoid membrane"'`, not a bare label. The rule: **every step emits at least one of `thought` or `phase`.** Never leave a step with nothing on screen.

`toolCallId` exists because the frontend currently matches `tool_end` to its `tool_start` by scanning backwards for the last part with the same `toolName` and no `result` ([AskPage.tsx:120-131](file:///D:/Study/2026_Summer/WDP301/prj/Front-end/Front-end-AIStudyHub/src/pages/AskPage.tsx)). That is already fragile with two concurrent `search_documents` calls and gets worse as events multiply. Use the id LangChain assigns the tool call; synthesize `${tool}-${counter}` only if unavailable.

Mirror the same union in [chat.ts](file:///D:/Study/2026_Summer/WDP301/prj/Front-end/Front-end-AIStudyHub/src/types/chat.ts).

---

### Backend

---

#### [MODIFY] [agentModel.ts](file:///D:/Study/2026_Summer/WDP301/prj/backendd/src/services/agentModel.ts)

- Add `thinkingConfig: { includeThoughts: true, thinkingLevel: "LOW" }` to the `ChatGoogleGenerativeAI` constructor. Keep `temperature: 0`.
- Extend `BoundAgentModel` with `stream(messages, options?): Promise<AsyncIterable<AIMessageChunk>>` alongside the existing `invoke`. Keep `invoke` — the non-stream `/api/agent/ask` route (mobile app, benchmark suite) still uses it.
- The scripted-fake pattern used by the service tests must now also fake `stream`. A fake yielding a single chunk equal to the current fake's return value keeps existing tests passing.

---

#### [MODIFY] [agenticRag.service.ts](file:///D:/Study/2026_Summer/WDP301/prj/backendd/src/services/agenticRag.service.ts) — `agentNode` (line 622)

This is the core change. Replace the single `invoke` with a streaming accumulation:

- Iterate `boundModel.stream(state.messages, { signal })`.
- Classify each chunk's content — the exact shapes confirmed by the spike:

```ts
// content is a bare string  → answer text
// content is an array of parts, each one of:
//   { type: "thinking",     thinking: string }   → thought summary
//   { type: "functionCall", functionCall: {...} } → tool call, ignore here
//   { type: "text",         text: string }        → answer text
```

  Thought parts → `onEvent({ type: "thought", step, text })`. Text → `onEvent({ type: "answer_delta", step, text })`.

- Accumulate chunks into one `AIMessageChunk` via `concat()` from `@langchain/core/utils/stream`, and return `{ messages: [accumulated] }`.

> [!WARNING]
> Return the **accumulated chunk itself**. Do not rebuild a fresh `AIMessage` from its text: the spike showed Gemini attaches `additional_kwargs.__gemini_function_call_thought_signatures__` (a signed blob keyed by tool-call id) to tool-calling chunks. Those signatures are fed back on the next turn; dropping them risks the model rejecting or degrading the continuation. `concat()` preserves them — hand-rolled reconstruction will not.

> [!WARNING]
> The accumulated message **must** carry the merged `tool_calls`, or `shouldContinue` (line 635) reads an empty array and the graph terminates instead of running tools. The spike verified `concat()` does merge them correctly — but assert on it in a test anyway, because a silently-broken tool loop looks like "the agent stopped searching my documents" and is easy to misdiagnose as a retrieval bug.

> [!NOTE]
> `extractMessageText` (line 540) maps array content parts by looking for a `text` property. A `{ type: "thinking", thinking }` part has none, so it contributes `""` and thoughts cannot leak into the persisted answer. This works by accident, not by intent — add a test pinning it before relying on it.

- Keep the existing `signal?.aborted` check at the top of the node, and check it again inside the chunk loop so an aborted stream stops writing.

**Discarding pre-tool prose.** The model can emit text *and* request tools in the same step ("Let me look that up." + `search_documents`). That prose is not the answer. Rather than buffering it (which would defeat streaming), emit it optimistically and let `agent_step` reset the client's answer buffer — by the time step N+1 begins, step N's prose is known to be non-final. This is why `answer_delta` carries `step`.

#### [MODIFY] `askQuestionWithAgent` — post-processing (lines 682-758)

- Emit `phase: "verifying"` where `grounding_check` is emitted today (line 717).
- Emit `phase: "citing"` before `applyCitations` (line 755).
- Emit `answer_revised` with the reason whenever `fallbackGenerated` is set — both the `empty_answer` branch (line 697) and the `grounding_failed` branch (line 726).
- `final` is unchanged and remains authoritative: the frontend always replaces streamed text with `final.data.answer`.

#### [MODIFY] tool bodies in `buildAgentTools` (lines 88-508)

- Thread `toolCallId` through `tool_start` / `tool_end`. LangChain's `tool()` exposes the call id via the second config argument; if plumbing it through is awkward, a per-run counter in `AgentRunContext` is an acceptable fallback.
- In `searchDocuments`, emit `phase: "retrieving"` before `retrieveDrRagContext` — that call is the single longest non-model wait in the run.

---

#### [MODIFY] [agent.controller.ts](file:///D:/Study/2026_Summer/WDP301/prj/backendd/src/controllers/agent.controller.ts) — `askStream` (line 29)

- **Do not coalesce.** An earlier draft called for a 50 ms delta buffer to avoid hundreds of tiny SSE frames. The spike makes that unnecessary and harmful: an entire answer arrives in 3–5 chunks with ≤1 ms between them, so there is nothing to coalesce and buffering would only add latency. Write each event as it comes. (Smoothing belongs on the client — see below.)
- **Add a keepalive.** Write a `: ping\n\n` comment every 15 s. Retrieval and the grounding check can still open multi-second gaps that intermediate proxies may treat as a dead connection.
- Clear both timers in the `finally` block alongside `res.end()`.

---

### Frontend

---

#### [MODIFY] [AskPage.tsx](file:///D:/Study/2026_Summer/WDP301/prj/Front-end/Front-end-AIStudyHub/src/pages/AskPage.tsx) — `modelAdapter.run` (lines 54-197)

Rewrite the event loop. Replace the ad-hoc `parts` mutation with explicit state: `currentStep`, `answerPartIndex | null`, `reasoningPartIndex | null`, and a `Map<toolCallId, partIndex>`.

- **`agent_step`** — increment `currentStep`; set `reasoningPartIndex = null` so the next `thought_delta` opens a *new* reasoning part; if an answer part exists from the previous step, remove it (pre-tool prose, see above) and null `answerPartIndex`.
- **`thought`** — create the reasoning part if absent, then **append** `event.text`. Do not overwrite — this is the single biggest behavioural change from today's `reasoningPart.text = "Thinking (Step N)..."` (line 90). Arrives as one whole block, so it will pop in rather than type out; feed it through the same smoothing buffer as the answer if that reads badly.
- **`answer_delta`** — append to a **pacing buffer**, not directly to the text part. See below.
- **`phase`** — if the current step has produced no `thought`, render `detail` into the reasoning part so the step is never blank; otherwise render as a transient status line. `"verifying"` in particular must not block or dim the answer the user is already reading; a subtle inline indicator under the message is the intent.
- **`tool_start` / `tool_end`** — look the part up by `toolCallId` instead of the reverse scan at lines 120-131.
- **`answer_revised`** — mark the streamed text part as superseded so the `final` swap reads as an intentional correction rather than a glitch. Minimum viable: a short muted line above the replaced answer (e.g. "Revised — the first draft was not supported by your documents"). Do not silently swap.
- **`final`** — replace the text part's content with `event.data.answer` in one assignment (this is what installs citations) and attach the existing `metadata.custom.sources` / `citedSources`. Yield once.
- **`artifact_created` / `error`** — unchanged.

Keep the `useChatThreadStore.getState().refresh()` call and the `catch` block (lines 182-196) exactly as they are.

---

#### [KEEP, REPURPOSED] The typewriter — lines 144-168

The original plan was to delete this loop. **Do not.** Spike finding 5 shows Gemini delivers an entire answer in 3–5 chunks separated by ≤1 ms; rendering them raw would slam the answer in as a few large blocks — visually worse than what ships today. The existing pacing loop is the right mechanism pointed at the wrong data source.

Rewrite it as a **drain loop over a live buffer** rather than a replay of a finished string:

- `answer_delta` appends to `pending`; the render loop drains `pending` at a steady rate (the existing 4 chars / 12 ms is a reasonable starting point) and yields.
- When `pending` is empty the loop idles instead of terminating — more deltas may still arrive.
- On `final`, drain whatever remains **immediately** with no pacing, then apply the authoritative `final.data.answer` swap. Never make the user wait on cosmetic pacing after the real answer is known.
- On abort, stop draining at once.

The user-visible difference from today is not smoothness — it is *when* text starts moving. Today the first character appears only after the full run **plus** the grounding check and citation pass. With this change it appears as soon as the model starts answering.

> [!IMPORTANT]
> Be honest about the ceiling here. Per the spike, time-to-first-answer-token *within a generation step* is ~3.1 s with thinking off and ~3.5 s with `LOW`, and the answer lands essentially all at once. Real streaming does not make Gemini's generation incremental. The wins are (a) text appears before post-processing instead of after, and (b) genuine thoughts and specific tool narration fill the earlier steps. If someone expects OpenAI-style smooth token flow from this change, they will be disappointed — that is a property of the provider, not of the plumbing.

---

#### [VERIFY] [thread.tsx](file:///D:/Study/2026_Summer/WDP301/prj/Front-end/Front-end-AIStudyHub/src/components/thread.tsx) — `groupAskParts` (line ~95)

No change is planned. Confirm the non-contiguous grouping question above, and regression-check that a plain Q&A turn with two `search_documents` calls still collapses into one "2 tool calls" group.

`reasoning.tsx` needs no changes — its streaming disclosure, bottom-pinned live preview and shimmer trigger (`ReasoningRoot streaming`, `ReasoningText` pinning) are already built for exactly this and have only ever been fed placeholders.

## Acceptance Criteria

1. Time-to-first-visible-token drops from "after the full run **and** the grounding check" to "during generation". Measure both against the current baseline on the same question. Expect first text at roughly 3–4 s, not sub-second — see the ceiling note above.
2. Reasoning content differs between questions — no `Thinking (Step N)` string remains in the codebase.
3. **Every step shows something specific**, whether or not the model emitted a thought. Force this case: run with `includeThoughts` disabled entirely and confirm the narration floor alone still reads as a coherent trace with no blank steps.
4. A question requiring two `search_documents` calls shows two distinct reasoning blocks, each adjacent to its own tool calls, in chronological order.
5. The answer does not slam in as 3–5 blocks — the pacing buffer smooths it — and `final` is never delayed by pacing.
6. Pre-tool prose from step N is not visible in the final answer.
7. Thought text never leaks into the persisted answer (`ChatHistory.answer` contains no thought summary).
8. A grounding failure visibly replaces the answer with a labelled correction; it never silently swaps and never leaves both versions on screen.
9. The final rendered answer is byte-identical to `final.data.answer`, with citation chips intact.
10. Abort mid-stream (stop button / navigate away) stops token rendering immediately and writes nothing after `req.on("close")`.
11. `/api/agent/ask` (non-stream) returns exactly what it does today — mobile and the benchmark suite are unaffected.
12. Existing `agenticRag.service.test.ts` passes with the streaming fake; new tests assert (a) `tool_calls` survive chunk accumulation and (b) `extractMessageText` ignores thinking parts.

## Risks

- ~~Thought-part detection~~ — **resolved by the spike.** Thoughts are cleanly separable.
- **Sparse thoughts** — the headline risk now. Emission was 0–100% depending on config, and never more than one per question. The narration floor carries the feature; treat thoughts as a bonus. If the floor is skipped, this ships as an expensive no-op.
- **Provider burstiness** — the answer lands nearly all at once. Client-side pacing is not polish here, it is what makes the feature look like streaming at all.
- **Cost** — thinking tokens are billed on every turn. `aiUsage.service` counts messages, not tokens, so this will not appear in existing quota metrics.
- **Grounding-failure rate** — determines whether optimistic streaming is the right call at all. Instrument `fallbackReason` before shipping.
- **Dropped thought signatures** — rebuilding the message instead of returning the accumulated chunk loses `__gemini_function_call_thought_signatures__`. Failure mode would be subtle degradation on multi-turn tool loops, not a hard error.
- **Line references age fast** — `agenticRag.service.ts` has ~330 lines of uncommitted local changes as of writing. Re-locate by symbol, not line number.
