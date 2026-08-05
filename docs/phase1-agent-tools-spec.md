# Phase 1 — Expand the agentic RAG tool set (materials-aware artifact creation)

The agent at `POST /api/agent/ask/stream` currently exposes three tools: `search_documents`, `list_documents`, and `create_artifact` (all defined in `buildAgentTools` in `agenticRag.service.ts`). `create_artifact` inherits its document scope entirely from the request payload — it has no way to target documents the user named in conversation ("make flashcards from my DBMS slides"). The new `/ask` frontend sends no scope fields at all, so every agent-created artifact currently resolves to `library_all`.

This phase makes the agent able to resolve the user's materials by itself: `list_documents` gains the subject metadata needed to map a spoken name to an id, `list_subjects` and `get_document_outline` expose the rest of the library structure, `list_artifacts` lets the agent see what it already produced in this thread, and `create_artifact` accepts explicit `documentIds` / `subjectId`.

Backend only. No route, controller, model, or frontend changes.

## User Review Required

> [!IMPORTANT]
> `create_artifact`'s tool schema gains two optional arguments (`documentIds`, `subjectId`). This is additive — the existing `/aichatbox` page and the mobile/benchmark callers of `POST /api/agent/ask` are unaffected, and calls that omit both keep today's exact behaviour (scope inherited from the request payload).

> [!IMPORTANT]
> The system prompt grows by five rules. Prompt changes affect every answer, not just artifact requests, and the benchmark suite scores against this prompt. Re-run the benchmark after merging if the current numbers are being quoted anywhere.

> [!WARNING]
> Tool count goes from 3 to 6. `RECURSION_LIMIT` is 12 in `agenticRag.service.ts`; a chatty model that calls `list_subjects` → `list_documents` → `get_document_outline` → `search_documents` ×2 → `create_artifact` consumes 6 of those steps. Watch for `GraphRecursionError` in testing and raise the limit to 16 if it appears.

> [!WARNING]
> `list_documents` currently returns at most 50 documents with no subject data. Adding a `Subject` populate turns this into an N+1-free but heavier query. Keep the 50-document cap.

## Open Questions

> [!IMPORTANT]
> `get_document_outline` reads `documentOutline` off the **active** `DocumentVersion`. Documents ingested before the version migration may have no outline stored. Confirm the intended behaviour when it is missing: return `NO_OUTLINE` and let the agent fall back to `search_documents` (assumed below), or synthesize one on the fly via `extractDocumentOutline` (slower, and it needs the full `extractedText`).

> [!IMPORTANT]
> `list_artifacts` is thread-scoped in this spec (`{ threadId }`). Should it also surface artifacts created before the thread existed (`threadId: "none"`), the way the frontend's initial load does? Assumed no — thread-scoped only.

## Proposed Changes

### Agent tool layer

All six tools live in `buildAgentTools`. Every new tool follows the existing shape exactly: an `if (signal?.aborted) throw new DOMException("AbortError", "AbortError")` guard first, then `onEvent?.({ type: "tool_start", ... })`, then the work, then a `run.toolCalls.push({ tool, input, resultSummary })` plus `onEvent?.({ type: "tool_end", tool, resultSummary })`, returning a `JSON.stringify(...)` payload.

---

#### [MODIFY] [agenticRag.service.ts](file:///D:/Study/2026_Summer/WDP301/prj/backendd/src/services/agenticRag.service.ts)

**`list_documents` (existing, ~line 157)**
- Widen the projection from `"title status"` to `"title status subjectId updatedAt"` and `.populate("subjectId", "_id name")`.
- Return `{ id, title, status, subjectId, subject, updatedAt }` per document. Keep the `.limit(50)` cap and the `status: { $ne: "DELETED" }` filter.
- Update the tool `description` to state that the returned ids are what `create_artifact` and `get_document_outline` accept.
- `resultSummary` stays `"${n} documents"`.

**`list_subjects` (new)**
- Empty zod schema, like `list_documents`.
- Calls `getSubjectsByUser(userId)` from `../modules/subjects/subject.service` (re-exported by `../services/subject.service`). It returns `{ items, pagination }`; map `items` to `{ id, name, code, semester, documentCount }` and drop the pagination envelope.
- `resultSummary`: `"${n} subjects"`.
- Description: "List the user's subjects (courses) with how many documents each contains. Use the returned subject id with create_artifact to scope an artifact to a whole subject."

**`list_artifacts` (new)**
- Empty zod schema.
- Calls the existing `listArtifacts(userId, { threadId: payload.threadId })` from `./artifact.service` (add it to the existing import of `initiateArtifactGeneration`). When `payload.threadId` is absent, pass `{}` and let it return the user's recent artifacts.
- Return `{ id, type, title, status }` per record, newest first (the service already sorts by `createdAt: -1`). Cap at 20 in the mapper.
- `resultSummary`: `"${n} artifacts"`.
- Description: "List study artifacts already generated in this conversation, with their type and generation status. Check this before creating a new artifact so you do not duplicate one that already exists."

**`get_document_outline` (new)**
- Schema: `z.object({ documentId: z.string().describe("A document id returned by list_documents.") })`.
- Load the document with `StudyDocument.findOne({ _id: documentId, status: { $ne: "DELETED" } }).select("_id ownerId visibility title currentVersionId")`, then authorize with `getDocumentAccessRole(document, userId)` from `../modules/documentShares/documentShare.service` — the same guard `resolveChatScope` uses. A missing document or a null role both return `{ status: "NOT_FOUND" }`; **do not** throw `AppError` from inside a tool, since that aborts the whole agent run rather than letting the model recover.
- Load the active version: `DocumentVersion.findOne({ _id: document.currentVersionId, documentId: document._id, isActive: true, deletedAt: null }).select("documentOutline")`.
- Pass `documentOutline` through `summarizeDocumentOutline` from `../utils/documentOutline` and return `{ status: "OK", title, chapters, parts, sections }` from its `chapterSections` / `partSections` / `detectedSections` fields. Cap each list at 40 entries.
- When the version is missing or `documentOutline` is empty, return `{ status: "NO_OUTLINE", message: "This document has no extracted outline; use search_documents instead." }` (see Open Questions).
- `resultSummary`: `"${n} outline sections"` or `"NO_OUTLINE"`.

**`create_artifact` (existing, ~line 194)**
- Extend the zod schema with two optional args:
  - `documentIds: z.array(z.string()).optional()` — "Ids from list_documents, when the user named specific documents. Omit to use the documents already attached to the conversation."
  - `subjectId: z.string().optional()` — "A subject id from list_subjects, when the user asked for a whole subject. Omit to use the conversation's own scope."
- Precedence in the `initiateArtifactGeneration` call: a non-empty `documentIds` wins over `payload.documentId` / `payload.documentIds`; a supplied `subjectId` wins over `payload.subjectId` and forces `scope: "subject_all"`. When `documentIds` has exactly one entry, pass it as `documentId` (not `documentIds`) — `resolveChatScope` rejects both being set, and single-document scope is the tier that reads full `extractedText` in the artifact worker, which produces materially better artifacts.
- Ownership needs no new check: `resolveChatScope` already 404s ids the user cannot read and 400s a mixed-subject set. Wrap the `initiateArtifactGeneration` call in a `try/catch` and return `{ status: "ERROR", message: err.message }` instead of letting an `AppError` kill the run — this is what lets the model retry with corrected ids.
- Leave the `artifact_created` event, the return payload, and the "do not write the content yourself" note unchanged.

**`SYSTEM_PROMPT` (top of file)**
- Add, after the existing `list_documents` rule:
  - Use `list_subjects` when the user refers to a course or subject rather than a file.
  - When the user names specific documents or a subject for an artifact, call `list_documents` (or `list_subjects`) first and pass the resolved ids to `create_artifact` as `documentIds` / `subjectId`. Never guess or invent an id.
  - Use `get_document_outline` when the user asks about a document's structure, or scopes a request to a chapter or section, so the artifact instructions can name that section.
  - Call `list_artifacts` before creating an artifact the user may already have; if a matching one exists, point them to it instead of generating a duplicate.
  - If a tool returns `ERROR` or `NOT_FOUND`, do not retry with the same arguments — re-resolve the id or tell the user what you could not find.
- Leave the citation rules and the "answer only from tool results" rule untouched.

**Imports to add at the top of the file**
- `listArtifacts` onto the existing `./artifact.service` import.
- `getSubjectsByUser` from `../modules/subjects/subject.service`.
- `getDocumentAccessRole` from `../modules/documentShares/documentShare.service`.
- `DocumentVersion` from `../modules/documentVersions/documentVersion.model`.
- `summarizeDocumentOutline` from `../utils/documentOutline`.

---

#### [MODIFY] [agenticRag.service.test.ts](file:///D:/Study/2026_Summer/WDP301/prj/backendd/src/services/agenticRag.service.test.ts)

- Reuse the existing `mockAgentModel` / `mockScope` / `mockRetrieval` property-override helpers; do not introduce a mocking library.
- Add a case: a scripted `AIMessage` with a `create_artifact` tool call carrying `documentIds: ["doc-1"]` reaches `initiateArtifactGeneration` with `documentId: "doc-1"` (singular, per the collapse rule) and not the payload's scope. Override `artifact.service.initiateArtifactGeneration` with a recording stub in the same property-override style.
- Add a case: `create_artifact` with a `documentIds` value that makes the stub throw an `AppError` returns an `ERROR` payload to the model and the run still produces a final answer — i.e. the graph is not aborted.
- Add a case: `get_document_outline` against a document with no active version returns `NO_OUTLINE` rather than throwing.
- Restore every override in `afterEach`, matching the existing file's teardown.

## Explicitly Out of Scope

Do not touch any of the following — they are later phases of the same plan and changing them here will conflict:

- **Anything under `Front-end/`.** No frontend file is in scope, including `tool-fallback.tsx` display names.
- `artifact.routes.ts`, `artifact.controller.ts`, `artifact.validation.ts`, `artifact.model.ts`, `artifact.worker.ts` — the REST surface and the generation worker stay exactly as they are.
- `AgentEvent` in `api.types.ts`. Artifact-id correlation is being solved client-side in Phase 3; do not add fields to `tool_end` or `artifact_created`.
- `resolveChatScope` in `chatScope.service.ts`. The new tools consume it as-is; its validation rules are load-bearing for the ownership checks above.
- Wrapping `initiateMaterialGeneration` (`studyMaterial.service.ts`) as a tool. It overlaps `create_artifact` almost exactly and would degrade tool selection.
- The `search_documents` tool and the grounding / citation pipeline that follows the graph run.

## Verification Plan

### Automated Tests

```bash
npm run build
```

```bash
npm test
```

`npm test` builds first and then runs `node --test "dist/**/*.test.js"`, so a type error fails it before any test executes. Both must exit 0.

### Manual Verification

Run `npm run dev` and drive the agent through `POST /api/agent/ask/stream` with a real bearer token (the existing `/aichatbox` page is the easiest driver, since it already renders `tool_start` / `tool_end` / `artifact_created`).

1. **Name resolution** — with no documents selected, ask "make flashcards from my <document title> slides". Expect a `list_documents` call followed by `create_artifact` carrying `documentIds`, then an `artifact_created` event. Confirm in MongoDB that the new `Artifact` row has `scope: "single_document"` and the right `sourceDocumentIds`, not `library_all`.
2. **Subject scope** — ask "quiz me on everything in <subject name>". Expect `list_subjects` → `create_artifact` with `subjectId`, and a stored `scope: "subject_all"`.
3. **Bad id recovery** — temporarily point the model at a non-existent id (or ask about a document that does not exist). The stream must keep going and end with a `final` event explaining what was not found — no `error` event, no dropped connection.
4. **Outline** — ask "what chapters are in <document>?" against a document that has an indexed active version. Expect `get_document_outline` with a populated chapter list; against a pre-migration document, expect `NO_OUTLINE` and a graceful fallback to `search_documents`.
5. **Duplicate guard** — ask for the same quiz twice in one thread. The second turn should call `list_artifacts` and point at the existing one instead of creating a second row.
6. **Regression** — ask a plain content question with a document attached. The answer must still carry inline `[n]` citation markers and populated `sources`, proving the prompt additions did not disturb the citation rules.
7. **Recursion headroom** — ask a request that chains several tools ("look at my subjects, find the database one, and make a mind map of chapter 2"). Watch the server log for `GraphRecursionError`; if it appears, raise `RECURSION_LIMIT` from 12 to 16.
