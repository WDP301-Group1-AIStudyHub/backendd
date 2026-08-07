import {
  StateGraph,
  START,
  END,
  MessagesAnnotation,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { concat } from "@langchain/core/utils/stream";
import { tool } from "@langchain/core/tools";
import { isValidObjectId } from "mongoose";
import { z } from "zod";
import {
  AgentAskResponse,
  AgentEvent,
  AgentToolCallSummary,
  AskQuestionRequest,
  ChatSource,
} from "../types/api.types";
import { EvaluatedChunk } from "../types/rag.types";
import { getAgentModel } from "./agentModel";
import { resolveChatScope } from "./chatScope.service";
import {
  DOCUMENT_PROCESSING_MESSAGE,
  buildContext,
  chunkContentKey,
  dedupeChunks,
  retrieveDrRagContext,
  toSources,
} from "./drRag.service";
import {
  initiateArtifactGeneration,
  listArtifacts,
} from "./artifact.service";
import { checkAnswerGrounding } from "./answerCheck.service";
import { generateFallbackAnswer } from "./fallbackAnswer.service";
import { applyCitations } from "./citations.service";
import { calculateAverageRelevance } from "./relevance.service";
import { persistAndRespond } from "./chat.service";
import { detectAnswerStyle } from "../utils/answerStyle";
import { ChatHistory } from "../models/chatHistory.model";
import { StudyDocument } from "../models/document.model";
import { getSubjectsByUser } from "../modules/subjects/subject.service";
import { getDocumentAccessRole } from "../modules/documentShares/documentShare.service";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import { summarizeDocumentOutline } from "../utils/documentOutline";

const AGENT_MODE = "agentic" as const;
const MAX_HISTORY_TURNS = 6;
const RECURSION_LIMIT = 12;

const SYSTEM_PROMPT = `You are an AI study assistant for a document Q&A platform. Users upload study documents (PDF, Word, slides) and you answer questions grounded in those documents.

Rules:
- Before answering any question about study content, call search_documents to find supporting passages. You may call it multiple times with different focused queries (for example, one query per side of a comparison).
- Answer ONLY from tool results. Never answer content questions from your own knowledge, and never invent citations.
- If search_documents returns NO_MATCHES, retry once with a rephrased, more specific query. If it still returns NO_MATCHES, tell the user their documents do not seem to cover this topic and suggest asking more specifically or uploading a relevant document.
- Questions about you or this platform (greetings, "what can you do?") may be answered directly without tools: you answer questions about the user's uploaded documents, summarize and compare them, and extract facts from them.
- Use list_documents when the user asks what files or documents they have.
- Use list_subjects when the user refers to a course or subject rather than a file.
- When the user names specific documents or a subject for an artifact, call list_documents (or list_subjects) first and pass the resolved ids to create_artifact as documentIds / subjectId. Never guess or invent an id.
- Use get_document_outline when the user asks about a document's structure, or scopes a request to a chapter or section, so the artifact instructions can name that section.
- Call list_artifacts before creating an artifact the user may already have; if a matching one exists, point them to it instead of generating a duplicate.
- If a tool returns ERROR or NOT_FOUND, do not retry with the same arguments — re-resolve the id or tell the user what you could not find.
- When the user asks you to create, make, or generate flashcards, a quiz, a mind map, a report/study guide, or a data/comparison table, call create_artifact with a fitting type, title, and instructions. Do NOT write the artifact content inline in your answer — the artifact is generated in the background and appears in the Artifacts panel. After calling it, tell the user the artifact is being generated and will appear there shortly.
- Always answer in the same language as the user's question.
- Every passage returned by search_documents carries an "id". Whenever you use information from a passage, append an inline citation marker [id] at the end of the sentence that uses it (for example, "Photosynthesis takes place in chloroplasts [1]."). If multiple passages support a statement, append multiple markers (for example, [1][3]). Cite ONLY IDs that you actually received in tool results; never invent or guess IDs. Do NOT include citation markers in greetings, meta answers, or when no passages were used. Do NOT write a manual "Sources" or "References" section at the end of your response, as the system interface renders source chips automatically.`;

type AgentRunContext = {
  collectedChunks: EvaluatedChunk[];
  retrievalQueries: string[];
  toolCalls: AgentToolCallSummary[];
  citations: Map<string, number>;
};

const buildAgentTools = (
  userId: string,
  vectorFilters: Parameters<typeof retrieveDrRagContext>[1],
  payload: AskQuestionRequest,
  run: AgentRunContext,
  onEvent?: (event: AgentEvent) => void,
  signal?: AbortSignal,
) => {
  let toolCallCounter = 0;
  // LangChain hands tools a ToolRunnableConfig, which carries the model's own
  // call id at `config.toolCall.id` — not `config.toolCallId`
  // (@langchain/core/dist/tools/types.d.ts:79). Reading the wrong key here is
  // silent: the synthetic fallback below is still unique, so tool_start and
  // tool_end match up and nothing looks broken, but the id no longer
  // corresponds to anything the model emitted.
  const getToolCallId = (
    config?: Record<string, any>,
    toolName?: string,
  ) => {
    const fromConfig = config?.toolCall?.id;
    if (typeof fromConfig === "string" && fromConfig) {
      return fromConfig;
    }
    toolCallCounter += 1;
    return `${toolName ?? "tool"}-${toolCallCounter}`;
  };

  const searchDocuments = tool(
    async ({ query }: { query: string }, config) => {
      if (signal?.aborted) {
        throw new DOMException("AbortError", "AbortError");
      }
      const toolCallId = getToolCallId(config, "search_documents");
      onEvent?.({
        type: "tool_start",
        tool: "search_documents",
        toolCallId,
        input: { query },
      });
      onEvent?.({
        type: "phase",
        phase: "retrieving",
        // The model often quotes its own query, which would otherwise render
        // as doubled quotes inside the narration.
        detail: `Searching your documents for "${query.replace(/^["']+|["']+$/g, "")}"`,
      });
      const result = await retrieveDrRagContext(query, vectorFilters);
      run.retrievalQueries.push(...result.retrievalQueries);

      if (result.chunks.length === 0) {
        const toolCall = {
          tool: "search_documents",
          input: { query },
          resultSummary: "NO_MATCHES",
        };
        run.toolCalls.push(toolCall);
        onEvent?.({
          type: "tool_end",
          tool: "search_documents",
          toolCallId,
          resultSummary: "NO_MATCHES",
        });

        return JSON.stringify({
          status: "NO_MATCHES",
          message:
            "No relevant passages were found in the user's documents for this query.",
        });
      }

      run.collectedChunks.push(...result.chunks);
      for (const chunk of result.chunks) {
        const key = chunkContentKey(chunk);
        if (!run.citations.has(key)) {
          const newId = run.citations.size + 1;
          run.citations.set(key, newId);
        }
      }

      const resultSummary = `${result.chunks.length} passages`;
      run.toolCalls.push({
        tool: "search_documents",
        input: { query },
        resultSummary,
      });
      onEvent?.({
        type: "tool_end",
        tool: "search_documents",
        toolCallId,
        resultSummary,
      });

      return JSON.stringify({
        status: "OK",
        passages: result.chunks.map((chunk) => {
          const key = chunkContentKey(chunk);
          const citationId = run.citations.get(key);
          return {
            id: citationId,
            document: chunk.metadata.title,
            section:
              chunk.metadata.sectionTitle ||
              chunk.metadata.inferredSection ||
              chunk.metadata.section ||
              undefined,
            content: chunk.content,
          };
        }),
      });
    },
    {
      name: "search_documents",
      description:
        "Search the user's uploaded study documents for passages relevant to a query. Returns the most relevant passages with their document titles and sections, or NO_MATCHES when nothing relevant exists.",
      schema: z.object({
        query: z
          .string()
          .describe(
            "A focused search query in the language of the documents. Prefer specific terms over broad topics.",
          ),
      }),
    },
  );

  const listDocuments = tool(
    async (_input, config) => {
      if (signal?.aborted) {
        throw new DOMException("AbortError", "AbortError");
      }
      const toolCallId = getToolCallId(config, "list_documents");
      onEvent?.({
        type: "tool_start",
        tool: "list_documents",
        toolCallId,
        input: {},
      });
      const documents = await StudyDocument.find({
        ownerId: userId,
        status: { $ne: "DELETED" },
      })
        .select("title fileName originalFileName status subjectId updatedAt")
        .populate("subjectId", "_id name")
        .limit(50);

      const resultSummary = `${documents.length} documents`;
      run.toolCalls.push({
        tool: "list_documents",
        input: {},
        resultSummary,
      });
      onEvent?.({
        type: "tool_end",
        tool: "list_documents",
        toolCallId,
        resultSummary,
      });

      return JSON.stringify({
        documents: documents.map((document: any) => {
          const subject = document.subjectId;
          const subjectObj =
            subject && typeof subject === "object" && "_id" in subject
              ? (subject as { _id: { toString(): string }; name?: string })
              : null;
          return {
            id: document._id.toString(),
            title: document.title,
            fileName: document.fileName || document.originalFileName || undefined,
            status: document.status,
            subjectId: subjectObj
              ? subjectObj._id.toString()
              : document.subjectId?.toString(),
            subject: subjectObj?.name,
            updatedAt: document.updatedAt,
          };
        }),
      });
    },
    {
      name: "list_documents",
      description:
        "List the study documents the user has uploaded, with their titles, processing status, subject, and update time. Returns document ids that can be passed to create_artifact or get_document_outline.",
      schema: z.object({}),
    },
  );

  const listSubjectsTool = tool(
    async (_input, config) => {
      if (signal?.aborted) {
        throw new DOMException("AbortError", "AbortError");
      }
      const toolCallId = getToolCallId(config, "list_subjects");
      onEvent?.({
        type: "tool_start",
        tool: "list_subjects",
        toolCallId,
        input: {},
      });
      // Without an explicit limit this paginates at 10, which silently hides
      // later subjects from the agent (paginate's maxLimit is 50).
      const { items } = await getSubjectsByUser(userId, { limit: "50" });

      const resultSummary = `${items.length} subjects`;
      run.toolCalls.push({
        tool: "list_subjects",
        input: {},
        resultSummary,
      });
      onEvent?.({
        type: "tool_end",
        tool: "list_subjects",
        toolCallId,
        resultSummary,
      });

      return JSON.stringify({
        subjects: items.map((item) => ({
          id: item._id.toString(),
          name: item.name,
          code: item.code,
          semester: item.semester,
          documentCount: item.documentCount,
        })),
      });
    },
    {
      name: "list_subjects",
      description:
        "List the user's subjects (courses) with how many documents each contains. Use the returned subject id with create_artifact to scope an artifact to a whole subject.",
      schema: z.object({}),
    },
  );

  const listArtifactsTool = tool(
    async (_input, config) => {
      if (signal?.aborted) {
        throw new DOMException("AbortError", "AbortError");
      }
      const toolCallId = getToolCallId(config, "list_artifacts");
      onEvent?.({
        type: "tool_start",
        tool: "list_artifacts",
        toolCallId,
        input: {},
      });
      const artifacts = await listArtifacts(
        userId,
        payload.threadId ? { threadId: payload.threadId } : {},
      );

      const capped = artifacts.slice(0, 20);
      const resultSummary = `${capped.length} artifacts`;
      run.toolCalls.push({
        tool: "list_artifacts",
        input: {},
        resultSummary,
      });
      onEvent?.({
        type: "tool_end",
        tool: "list_artifacts",
        toolCallId,
        resultSummary,
      });

      return JSON.stringify({
        artifacts: capped.map((artifact) => ({
          id: artifact._id.toString(),
          type: artifact.type,
          title: artifact.title,
          status: artifact.status,
        })),
      });
    },
    {
      name: "list_artifacts",
      description:
        "List study artifacts already generated in this conversation, with their type and generation status. Check this before creating a new artifact so you do not duplicate one that already exists.",
      schema: z.object({}),
    },
  );

  const getDocumentOutline = tool(
    async ({ documentId }: { documentId: string }, config) => {
      if (signal?.aborted) {
        throw new DOMException("AbortError", "AbortError");
      }
      const toolCallId = getToolCallId(config, "get_document_outline");
      onEvent?.({
        type: "tool_start",
        tool: "get_document_outline",
        toolCallId,
        input: { documentId },
      });

      const respond = (
        resultSummary: string,
        result: Record<string, unknown>,
      ): string => {
        run.toolCalls.push({
          tool: "get_document_outline",
          input: { documentId },
          resultSummary,
        });
        onEvent?.({
          type: "tool_end",
          tool: "get_document_outline",
          toolCallId,
          resultSummary,
        });
        return JSON.stringify(result);
      };

      // The model supplies this id, so a hallucinated one is expected. Left to
      // Mongoose it becomes a CastError that escapes the tool and aborts the
      // whole agent run; NOT_FOUND lets the model re-resolve and continue.
      if (!isValidObjectId(documentId)) {
        return respond("NOT_FOUND", { status: "NOT_FOUND" });
      }

      const document = await StudyDocument.findOne({
        _id: documentId,
        status: { $ne: "DELETED" },
      }).select("_id ownerId visibility title currentVersionId subjectId");

      if (!document) {
        return respond("NOT_FOUND", { status: "NOT_FOUND" });
      }

      const role = await getDocumentAccessRole(document, userId);
      if (!role) {
        return respond("NOT_FOUND", { status: "NOT_FOUND" });
      }

      const version = document.currentVersionId
        ? await DocumentVersion.findOne({
            _id: document.currentVersionId,
            documentId: document._id,
            isActive: true,
            deletedAt: null,
          }).select("documentOutline")
        : null;

      if (!version || !version.documentOutline || version.documentOutline.length === 0) {
        return respond("NO_OUTLINE", {
          status: "NO_OUTLINE",
          message:
            "This document has no extracted outline; use search_documents instead.",
        });
      }

      const summarized = summarizeDocumentOutline(version.documentOutline);
      const chapters = summarized.chapterSections.slice(0, 40);
      const parts = summarized.partSections.slice(0, 40);
      // sectionSections, not detectedSections: the latter is every node title
      // unfiltered, so it repeats the chapters and parts above and drags in
      // low-confidence table-of-contents entries.
      const sections = summarized.sectionSections.slice(0, 40);
      const n = new Set([...chapters, ...parts, ...sections]).size;

      return respond(`${n} outline sections`, {
        status: "OK",
        title: document.title,
        chapters,
        parts,
        sections,
      });
    },
    {
      name: "get_document_outline",
      description:
        "Get the hierarchical section/chapter outline of a study document by its document id. Returns chapters, parts, and sections, or NO_MATCHES / NO_OUTLINE when no outline is extracted.",
      schema: z.object({
        documentId: z
          .string()
          .describe("A document id returned by list_documents."),
      }),
    },
  );

  const createArtifact = tool(
    async (
      {
        type,
        title,
        instructions,
        documentIds,
        subjectId,
      }: {
        type: "FLASHCARD" | "QUIZ" | "MINDMAP" | "REPORT" | "DATA_TABLE";
        title: string;
        instructions: string;
        documentIds?: string[];
        subjectId?: string;
      },
      config,
    ) => {
      if (signal?.aborted) {
        throw new DOMException("AbortError", "AbortError");
      }
      const toolCallId = getToolCallId(config, "create_artifact");
      onEvent?.({
        type: "tool_start",
        tool: "create_artifact",
        toolCallId,
        input: { type, title, instructions, documentIds, subjectId },
      });

      try {
        let finalDocumentId: string | undefined = payload.documentId;
        let finalDocumentIds: string[] | undefined = payload.documentIds;

        if (documentIds && documentIds.length > 0) {
          if (documentIds.length === 1) {
            finalDocumentId = documentIds[0];
            finalDocumentIds = undefined;
          } else {
            finalDocumentId = undefined;
            finalDocumentIds = documentIds;
          }
        }

        const finalSubjectId = subjectId || payload.subjectId;
        const finalScope = subjectId ? "subject_all" : payload.scope;

        const artifact = await initiateArtifactGeneration(userId, {
          type,
          title,
          instructions,
          threadId: payload.threadId,
          documentId: finalDocumentId,
          documentIds: finalDocumentIds,
          subject: payload.subject,
          subjectId: finalSubjectId,
          scope: finalScope,
        });

        const artifactId = artifact._id.toString();
        onEvent?.({
          type: "artifact_created",
          artifactId,
          artifactType: type,
          title: artifact.title,
        });

        const resultSummary = `${type} artifact "${artifact.title}" started`;
        run.toolCalls.push({
          tool: "create_artifact",
          input: { type, title, instructions, documentIds, subjectId },
          resultSummary,
        });
        onEvent?.({
          type: "tool_end",
          tool: "create_artifact",
          toolCallId,
          resultSummary,
        });

        return JSON.stringify({
          artifactId,
          status: "GENERATING",
          note: `The ${type.toLowerCase().replace("_", " ")} is being generated in the background. Tell the user it will appear in the Artifacts panel shortly — do not write its content yourself.`,
        });
      } catch (err: any) {
        const resultSummary = "ERROR";
        run.toolCalls.push({
          tool: "create_artifact",
          input: { type, title, instructions, documentIds, subjectId },
          resultSummary,
        });
        onEvent?.({
          type: "tool_end",
          tool: "create_artifact",
          toolCallId,
          resultSummary,
        });

        return JSON.stringify({
          status: "ERROR",
          message: err.message || "Failed to initiate artifact generation",
        });
      }
    },
    {
      name: "create_artifact",
      description:
        "Start background generation of a study artifact from the user's documents: FLASHCARD (flashcard deck), QUIZ (multiple choice quiz), MINDMAP (hierarchical mind map), REPORT (structured study report), or DATA_TABLE (comparison/summary table). Returns immediately with the artifact id; generation finishes in the background.",
      schema: z.object({
        type: z
          .enum(["FLASHCARD", "QUIZ", "MINDMAP", "REPORT", "DATA_TABLE"])
          .describe("The kind of artifact the user asked for."),
        title: z
          .string()
          .describe(
            "A short display title for the artifact, in the user's language.",
          ),
        instructions: z
          .string()
          .describe(
            "The topic or focus for the artifact, in the language of the documents. Be specific: include the subject area and any constraints the user gave.",
          ),
        documentIds: z
          .array(z.string())
          .optional()
          .describe(
            "Ids from list_documents, when the user named specific documents. Omit to use the documents already attached to the conversation.",
          ),
        subjectId: z
          .string()
          .optional()
          .describe(
            "A subject id from list_subjects, when the user asked for a whole subject. Omit to use the conversation's own scope.",
          ),
      }),
    },
  );

  return [
    searchDocuments,
    listDocuments,
    listSubjectsTool,
    listArtifactsTool,
    getDocumentOutline,
    createArtifact,
  ];
};

const loadThreadHistory = async (
  userId: string,
  threadId?: string,
): Promise<BaseMessage[]> => {
  if (!threadId) {
    return [];
  }

  const turns = await ChatHistory.find({ userId, threadId })
    .sort({ createdAt: -1 })
    .limit(MAX_HISTORY_TURNS);

  return [...turns]
    .reverse()
    .flatMap((turn) => [
      new HumanMessage(turn.question),
      new AIMessage(turn.answer),
    ]);
};

const extractMessageText = (message: BaseMessage): string => {
  if (typeof message.content === "string") {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) =>
        typeof part === "string"
          ? part
          : "text" in part && typeof part.text === "string"
            ? part.text
            : "",
      )
      .join("");
  }

  return "";
};

export const askQuestionWithAgent = async (
  userId: string,
  payload: AskQuestionRequest,
  options: {
    persistHistory?: boolean;
    onEvent?: (event: AgentEvent) => void;
    signal?: AbortSignal;
  } = {},
): Promise<AgentAskResponse> => {
  const startedAt = Date.now();
  const persistHistory = options.persistHistory ?? true;
  const onEvent = options.onEvent;
  const signal = options.signal;

  try {
    if (signal?.aborted) {
      throw new DOMException("AbortError", "AbortError");
    }

    const chatScope = await resolveChatScope(userId, payload);

    if (chatScope.hasProcessingDocument) {
      const finalRes: AgentAskResponse = {
        answer: DOCUMENT_PROCESSING_MESSAGE,
        mode: AGENT_MODE,
        originalQuestion: payload.question,
        sources: [],
        evaluation: {
          retrievedChunksCount: 0,
          relevantChunksCount: 0,
          averageRelevanceScore: 0,
          isGrounded: false,
          confidenceScore: 0,
          responseTimeMs: Date.now() - startedAt,
          fallbackGenerated: true,
          fallbackReason: "document_processing",
          retrievalQueries: [],
          contextChunksUsed: 0,
        },
        agent: { steps: 0, toolCalls: [] },
      };
      onEvent?.({ type: "final", data: finalRes });
      return finalRes;
    }

    if (chatScope.emptyDocumentTitles && chatScope.emptyDocumentTitles.length > 0) {
      const titles = chatScope.emptyDocumentTitles.join(", ");
      const answer = chatScope.emptyDocumentTitles.length === 1
        ? `"${titles}" has no readable text — it looks like a scanned PDF or empty file, so there is nothing to search. Try running OCR or uploading a text-based copy.`
        : `The following documents have no readable text: "${titles}" — they look like scanned PDFs or empty files, so there is nothing to search. Try running OCR or uploading text-based copies.`;

      const finalRes: AgentAskResponse = {
        answer,
        mode: AGENT_MODE,
        originalQuestion: payload.question,
        sources: [],
        evaluation: {
          retrievedChunksCount: 0,
          relevantChunksCount: 0,
          averageRelevanceScore: 0,
          isGrounded: false,
          confidenceScore: 0,
          responseTimeMs: Date.now() - startedAt,
          fallbackGenerated: true,
          fallbackReason: "document_empty",
          retrievalQueries: [],
          contextChunksUsed: 0,
        },
        agent: { steps: 0, toolCalls: [] },
      };
      onEvent?.({ type: "final", data: finalRes });
      return finalRes;
    }

    const run: AgentRunContext = {
      collectedChunks: [],
      retrievalQueries: [],
      toolCalls: [],
      citations: new Map<string, number>(),
    };
    const tools = buildAgentTools(
      userId,
      chatScope.vectorFilters,
      payload,
      run,
      onEvent,
      signal,
    );
    const boundModel = getAgentModel().bindTools(tools);
    let agentSteps = 0;

    const agentNode = async (state: typeof MessagesAnnotation.State) => {
      if (signal?.aborted) {
        throw new DOMException("AbortError", "AbortError");
      }
      agentSteps += 1;
      onEvent?.({ type: "agent_step", step: agentSteps });

      const stream = await boundModel.stream(state.messages, { signal });
      let accumulated: AIMessageChunk | undefined;

      for await (const chunk of stream) {
        if (signal?.aborted) {
          throw new DOMException("AbortError", "AbortError");
        }
        accumulated = accumulated ? concat(accumulated, chunk) : chunk;

        if (typeof chunk.content === "string") {
          if (chunk.content) {
            onEvent?.({
              type: "answer_delta",
              step: agentSteps,
              text: chunk.content,
            });
          }
        } else if (Array.isArray(chunk.content)) {
          for (const part of chunk.content) {
            if (typeof part === "string") {
              if (part) {
                onEvent?.({
                  type: "answer_delta",
                  step: agentSteps,
                  text: part,
                });
              }
            } else if (typeof part === "object" && part !== null) {
              if (
                "type" in part &&
                part.type === "thinking" &&
                "thinking" in part &&
                typeof part.thinking === "string"
              ) {
                if (part.thinking) {
                  onEvent?.({
                    type: "thought",
                    step: agentSteps,
                    text: part.thinking,
                  });
                }
              } else if (
                "type" in part &&
                part.type === "text" &&
                "text" in part &&
                typeof part.text === "string"
              ) {
                if (part.text) {
                  onEvent?.({
                    type: "answer_delta",
                    step: agentSteps,
                    text: part.text,
                  });
                }
              } else if ("text" in part && typeof part.text === "string") {
                if (part.text) {
                  onEvent?.({
                    type: "answer_delta",
                    step: agentSteps,
                    text: part.text,
                  });
                }
              }
            }
          }
        }
      }

      if (!accumulated) {
        accumulated = new AIMessageChunk({ content: "" });
      }

      return { messages: [accumulated] };
    };

    // The agent loop: the model either requests tools (→ tools → agent again)
    // or produces the final answer (→ END). This conditional edge is the only
    // control flow — the model decides everything else.
    const shouldContinue = (state: typeof MessagesAnnotation.State) => {
      const lastMessage = state.messages[
        state.messages.length - 1
      ] as AIMessage;
      return (lastMessage.tool_calls?.length ?? 0) > 0 ? "tools" : END;
    };

    const graph = new StateGraph(MessagesAnnotation)
      .addNode("agent", agentNode)
      .addNode("tools", new ToolNode(tools))
      .addEdge(START, "agent")
      .addConditionalEdges("agent", shouldContinue, ["tools", END])
      .addEdge("tools", "agent")
      .compile();

    const history = await loadThreadHistory(userId, payload.threadId);

    if (signal?.aborted) {
      throw new DOMException("AbortError", "AbortError");
    }

    let contextPrompt = "";
    if (chatScope.scope === "single_document" && chatScope.documentTitle) {
      const fileNameStr = chatScope.fileName ? ` | Filename: "${chatScope.fileName}"` : "";
      contextPrompt = `\n\nActive Context:\n- Scope: Single Document\n- Active Document: "${chatScope.documentTitle}"${fileNameStr} (ID: ${chatScope.documentId})\nThe user has selected/attached this document. Note that the document's file name may differ from its title (e.g., "@${chatScope.fileName || "filename"}" refers to "${chatScope.documentTitle}"). If the user mentions either the file name or title, they are referring to this active document. Do NOT claim the document is missing.`;
    } else if (chatScope.scope === "document_set" && chatScope.documentIds) {
      contextPrompt = `\n\nActive Context:\n- Scope: Document Set\n- Active Documents: ${chatScope.documentIds.length} selected documents. Note that user @mentions (e.g., @filename.pdf) refer to the attached documents. Do NOT claim a document is missing if it matches an attached file name or title.`;
    } else if (chatScope.scope === "subject_all" && chatScope.subject) {
      contextPrompt = `\n\nActive Context:\n- Scope: Subject-wide\n- Subject: "${chatScope.subject}" (ID: ${chatScope.subjectId})`;
    } else {
      contextPrompt = `\n\nActive Context:\n- Scope: Library-wide (All uploaded documents)`;
    }

    let finalState;
    try {
      finalState = await graph.invoke(
        {
          messages: [
            new SystemMessage(SYSTEM_PROMPT + contextPrompt),
            ...history,
            new HumanMessage(payload.question),
          ],
        },
        { recursionLimit: RECURSION_LIMIT, signal },
      );
    } catch (err: any) {
      if (
        err?.lc_error_code === "GRAPH_RECURSION_LIMIT" ||
        err?.name === "GraphRecursionError" ||
        err?.message?.includes("GRAPH_RECURSION_LIMIT") ||
        err?.message?.includes("Recursion limit")
      ) {
        const uniqueChunks = dedupeChunks(run.collectedChunks);
        const fallbackAnswer = "I searched your documents several times but could not find anything relevant to that question.";
        const finalRes: AgentAskResponse = {
          answer: fallbackAnswer,
          mode: AGENT_MODE,
          originalQuestion: payload.question,
          sources: toSources(uniqueChunks, run.citations),
          evaluation: {
            retrievedChunksCount: uniqueChunks.length,
            relevantChunksCount: uniqueChunks.filter((chunk) => chunk.isRelevant).length,
            averageRelevanceScore: calculateAverageRelevance(uniqueChunks),
            isGrounded: false,
            confidenceScore: 0,
            responseTimeMs: Date.now() - startedAt,
            fallbackGenerated: true,
            fallbackReason: "recursion_limit",
            retrievalQueries: run.retrievalQueries,
            contextChunksUsed: 0,
          },
          agent: {
            steps: RECURSION_LIMIT,
            toolCalls: run.toolCalls,
          },
        };
        onEvent?.({ type: "final", data: finalRes });
        return finalRes;
      }
      throw err;
    }

    if (signal?.aborted) {
      throw new DOMException("AbortError", "AbortError");
    }

    let answer = extractMessageText(
      finalState.messages[finalState.messages.length - 1],
    ).trim();

    // Deterministic grounding gate: prompt-level grounding rules are soft, so
    // whenever retrieval happened, verify the final answer against the
    // retrieved context before returning it.
    const uniqueChunks = dedupeChunks(run.collectedChunks);
    const answerStyle = detectAnswerStyle(payload.question);
    let isGrounded = true;
    let confidenceScore = 1;
    let warning: string | undefined;
    let fallbackGenerated = false;
    let fallbackReason: string | undefined;

    if (!answer) {
      fallbackGenerated = true;
      fallbackReason = "empty_answer";
      isGrounded = false;
      confidenceScore = 0;
      onEvent?.({ type: "answer_revised", reason: "empty_answer" });
      answer = await generateFallbackAnswer({
        question: payload.question,
        language: answerStyle.language,
        retrievedChunksCount: uniqueChunks.length,
        relevantChunksCount: uniqueChunks.filter((chunk) => chunk.isRelevant)
          .length,
        averageRelevanceScore: calculateAverageRelevance(uniqueChunks),
        documentTitle: chatScope.documentTitle,
        subject: chatScope.subject,
        reason: "empty_answer",
      });
    } else if (uniqueChunks.length > 0) {
      if (signal?.aborted) {
        throw new DOMException("AbortError", "AbortError");
      }
      onEvent?.({ type: "phase", phase: "verifying" });
      const grounding = await checkAnswerGrounding(
        answer,
        buildContext(uniqueChunks),
      );
      isGrounded = grounding.isGrounded;
      confidenceScore = grounding.confidenceScore;
      warning = grounding.warning;

      if (!grounding.isGrounded) {
        fallbackGenerated = true;
        fallbackReason = "grounding_failed";
        onEvent?.({ type: "answer_revised", reason: "grounding_failed" });
        answer = await generateFallbackAnswer({
          question: payload.question,
          language: answerStyle.language,
          retrievedChunksCount: uniqueChunks.length,
          relevantChunksCount: uniqueChunks.filter((chunk) => chunk.isRelevant)
            .length,
          averageRelevanceScore: calculateAverageRelevance(uniqueChunks),
          documentTitle:
            chatScope.documentTitle || uniqueChunks[0]?.metadata.title,
          subject: chatScope.subject,
          reason: "grounding_failed",
        });
      }
    }

    if (signal?.aborted) {
      throw new DOMException("AbortError", "AbortError");
    }

    const sources: ChatSource[] = toSources(uniqueChunks, run.citations);
    let citedSources: ChatSource[] = [];

    if (fallbackGenerated) {
      answer = answer.replace(/\[\d+\]/g, "");
      citedSources = [];
    } else {
      onEvent?.({ type: "phase", phase: "citing" });
      const citationResult = applyCitations({ answer, sources });
      answer = citationResult.answer;
      citedSources = citationResult.citedSources;
    }

    const result = await persistAndRespond(
      userId,
      payload,
      chatScope,
      {
        answer,
        mode: AGENT_MODE,
        originalQuestion: payload.question,
        sources,
        citedSources,
        evaluation: {
          retrievedChunksCount: uniqueChunks.length,
          relevantChunksCount: uniqueChunks.filter((chunk) => chunk.isRelevant)
            .length,
          averageRelevanceScore: calculateAverageRelevance(uniqueChunks),
          isGrounded,
          confidenceScore,
          responseTimeMs: Date.now() - startedAt,
          retrievalQueries: run.retrievalQueries,
          contextChunksUsed: uniqueChunks.length,
          dynamicRetrievalAttempted: run.retrievalQueries.length > 1,
          fallbackGenerated,
          fallbackReason,
          warning,
        },
      },
      { persistHistory },
    );

    const finalResponse: AgentAskResponse = {
      ...result,
      agent: { steps: agentSteps, toolCalls: run.toolCalls },
      citedSources: result.citedSources ?? citedSources,
    };

    onEvent?.({ type: "final", data: finalResponse });
    return finalResponse;
  } catch (err: any) {
    // Deliberately no `error` event here. This rethrows, and the streaming
    // controller emits one from its own catch — emitting here too rendered the
    // same failure twice in the thread. The controller is also the only layer
    // that knows which key the request ran on, which the user-facing wording
    // depends on.
    throw err;
  }
};
