import { StateGraph, START, END, MessagesAnnotation } from "@langchain/langgraph";
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
  run: AgentRunContext,
) => {
  const searchDocuments = tool(
    async ({ query }: { query: string }) => {
      const result = await retrieveDrRagContext(query, vectorFilters);
      run.retrievalQueries.push(...result.retrievalQueries);

      if (result.chunks.length === 0) {
        run.toolCalls.push({
          tool: "search_documents",
          input: { query },
          resultSummary: "NO_MATCHES",
        });

        return JSON.stringify({
          status: "NO_MATCHES",
          message:
            "No relevant passages were found in the user's documents for this query.",
        });
      }

      run.collectedChunks.push(...result.chunks);
      run.toolCalls.push({
        tool: "search_documents",
        input: { query },
        resultSummary: `${result.chunks.length} passages`,
      });

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
      const documents = await StudyDocument.find({
        ownerId: userId,
        status: { $ne: "DELETED" },
      })
        .select("title status")
        .limit(50);

      run.toolCalls.push({
        tool: "list_documents",
        input: {},
        resultSummary: `${documents.length} documents`,
      });

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

  return [searchDocuments, listDocuments];
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
  options: { persistHistory?: boolean } = {},
): Promise<AgentAskResponse> => {
  const startedAt = Date.now();
  const persistHistory = options.persistHistory ?? true;
  const chatScope = await resolveChatScope(userId, payload);

  if (chatScope.hasProcessingDocument) {
    return {
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
  }

  const run: AgentRunContext = {
    collectedChunks: [],
    retrievalQueries: [],
    toolCalls: [],
  };
  const tools = buildAgentTools(userId, chatScope.vectorFilters, run);
  const boundModel = getAgentModel().bindTools(tools);
  let agentSteps = 0;

  const agentNode = async (state: typeof MessagesAnnotation.State) => {
    agentSteps += 1;
    const response = await boundModel.invoke(state.messages);
    return { messages: [response] };
  };

  // The agent loop: the model either requests tools (→ tools → agent again)
  // or produces the final answer (→ END). This conditional edge is the only
  // control flow — the model decides everything else.
  const shouldContinue = (state: typeof MessagesAnnotation.State) => {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
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
  const finalState = await graph.invoke(
    {
      messages: [
        new SystemMessage(SYSTEM_PROMPT),
        ...history,
        new HumanMessage(payload.question),
      ],
    },
    { recursionLimit: RECURSION_LIMIT },
  );

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

  return {
    ...result,
    agent: { steps: agentSteps, toolCalls: run.toolCalls },
  };
};
