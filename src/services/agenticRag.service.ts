import {
  StateGraph,
  START,
  END,
  MessagesAnnotation,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
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
  dedupeChunks,
  retrieveDrRagContext,
  toSources,
} from "./drRag.service";
import { initiateArtifactGeneration } from "./artifact.service";
import { checkAnswerGrounding } from "./answerCheck.service";
import { generateFallbackAnswer } from "./fallbackAnswer.service";
import { calculateAverageRelevance } from "./relevance.service";
import { persistAndRespond } from "./chat.service";
import { detectAnswerStyle } from "../utils/answerStyle";
import { ChatHistory } from "../models/chatHistory.model";
import { StudyDocument } from "../models/document.model";

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
- When the user asks you to create, make, or generate flashcards, a quiz, a mind map, a report/study guide, or a data/comparison table, call create_artifact with a fitting type, title, and instructions. Do NOT write the artifact content inline in your answer — the artifact is generated in the background and appears in the Artifacts panel. After calling it, tell the user the artifact is being generated and will appear there shortly.
- Always answer in the same language as the user's question.
- When you used search results, mention which document (and section, if available) the answer comes from.`;

type AgentRunContext = {
  collectedChunks: EvaluatedChunk[];
  retrievalQueries: string[];
  toolCalls: AgentToolCallSummary[];
};

const buildAgentTools = (
  userId: string,
  vectorFilters: Parameters<typeof retrieveDrRagContext>[1],
  payload: AskQuestionRequest,
  run: AgentRunContext,
  onEvent?: (event: AgentEvent) => void,
  signal?: AbortSignal,
) => {
  const searchDocuments = tool(
    async ({ query }: { query: string }) => {
      if (signal?.aborted) {
        throw new DOMException("AbortError", "AbortError");
      }
      onEvent?.({
        type: "tool_start",
        tool: "search_documents",
        input: { query },
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
          resultSummary: "NO_MATCHES",
        });

        return JSON.stringify({
          status: "NO_MATCHES",
          message:
            "No relevant passages were found in the user's documents for this query.",
        });
      }

      run.collectedChunks.push(...result.chunks);
      const resultSummary = `${result.chunks.length} passages`;
      run.toolCalls.push({
        tool: "search_documents",
        input: { query },
        resultSummary,
      });
      onEvent?.({ type: "tool_end", tool: "search_documents", resultSummary });

      return JSON.stringify({
        status: "OK",
        passages: result.chunks.map((chunk, index) => ({
          index: index + 1,
          document: chunk.metadata.title,
          section:
            chunk.metadata.sectionTitle ||
            chunk.metadata.inferredSection ||
            chunk.metadata.section ||
            undefined,
          content: chunk.content,
        })),
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
    async () => {
      if (signal?.aborted) {
        throw new DOMException("AbortError", "AbortError");
      }
      onEvent?.({ type: "tool_start", tool: "list_documents", input: {} });
      const documents = await StudyDocument.find({
        ownerId: userId,
        status: { $ne: "DELETED" },
      })
        .select("title status")
        .limit(50);

      const resultSummary = `${documents.length} documents`;
      run.toolCalls.push({
        tool: "list_documents",
        input: {},
        resultSummary,
      });
      onEvent?.({ type: "tool_end", tool: "list_documents", resultSummary });

      return JSON.stringify({
        documents: documents.map((document) => ({
          id: document._id.toString(),
          title: document.title,
          status: document.status,
        })),
      });
    },
    {
      name: "list_documents",
      description:
        "List the study documents the user has uploaded, with their titles and processing status.",
      schema: z.object({}),
    },
  );

  const createArtifact = tool(
    async ({
      type,
      title,
      instructions,
    }: {
      type: "FLASHCARD" | "QUIZ" | "MINDMAP" | "REPORT" | "DATA_TABLE";
      title: string;
      instructions: string;
    }) => {
      if (signal?.aborted) {
        throw new DOMException("AbortError", "AbortError");
      }
      onEvent?.({
        type: "tool_start",
        tool: "create_artifact",
        input: { type, title, instructions },
      });

      const artifact = await initiateArtifactGeneration(userId, {
        type,
        title,
        instructions,
        threadId: payload.threadId,
        documentId: payload.documentId,
        documentIds: payload.documentIds,
        subject: payload.subject,
        subjectId: payload.subjectId,
        scope: payload.scope,
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
        input: { type, title, instructions },
        resultSummary,
      });
      onEvent?.({ type: "tool_end", tool: "create_artifact", resultSummary });

      return JSON.stringify({
        artifactId,
        status: "GENERATING",
        note: `The ${type.toLowerCase().replace("_", " ")} is being generated in the background. Tell the user it will appear in the Artifacts panel shortly — do not write its content yourself.`,
      });
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
      }),
    },
  );

  return [searchDocuments, listDocuments, createArtifact];
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

    const run: AgentRunContext = {
      collectedChunks: [],
      retrievalQueries: [],
      toolCalls: [],
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
      const response = await boundModel.invoke(state.messages, { signal });
      return { messages: [response] };
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
      contextPrompt = `\n\nActive Context:\n- Scope: Single Document\n- Active Document: "${chatScope.documentTitle}" (ID: ${chatScope.documentId})\nThe user has already selected/attached this document. If the user asks about the attached document, they are referring to this document. There is no need to call list_documents.`;
    } else if (chatScope.scope === "document_set" && chatScope.documentIds) {
      contextPrompt = `\n\nActive Context:\n- Scope: Document Set\n- Active Documents: ${chatScope.documentIds.length} selected documents.`;
    } else if (chatScope.scope === "subject_all" && chatScope.subject) {
      contextPrompt = `\n\nActive Context:\n- Scope: Subject-wide\n- Subject: "${chatScope.subject}" (ID: ${chatScope.subjectId})`;
    } else {
      contextPrompt = `\n\nActive Context:\n- Scope: Library-wide (All uploaded documents)`;
    }

    const finalState = await graph.invoke(
      {
        messages: [
          new SystemMessage(SYSTEM_PROMPT + contextPrompt),
          ...history,
          new HumanMessage(payload.question),
        ],
      },
      { recursionLimit: RECURSION_LIMIT, signal },
    );

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
      onEvent?.({ type: "grounding_check" });
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

    const sources: ChatSource[] = toSources(uniqueChunks);
    const result = await persistAndRespond(
      userId,
      payload,
      chatScope,
      {
        answer,
        mode: AGENT_MODE,
        originalQuestion: payload.question,
        sources,
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
    };

    onEvent?.({ type: "final", data: finalResponse });
    return finalResponse;
  } catch (err: any) {
    onEvent?.({ type: "error", message: err.message || "Unknown error" });
    throw err;
  }
};
