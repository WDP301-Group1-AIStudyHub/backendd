import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AIMessage } from "@langchain/core/messages";
import * as agentModel from "./agentModel";
import * as answerCheckService from "./answerCheck.service";
import * as chatScopeService from "./chatScope.service";
import * as fallbackAnswerService from "./fallbackAnswer.service";
import * as vectorService from "./vector.service";
import { askQuestionWithAgent } from "./agenticRag.service";
import type { EvaluatedChunk } from "../types/rag.types";

const originalGetAgentModel = agentModel.getAgentModel;
const originalResolveChatScope = chatScopeService.resolveChatScope;
const originalSearchRelevantChunks = vectorService.searchRelevantChunks;
const originalCheckAnswerGrounding = answerCheckService.checkAnswerGrounding;
const originalGenerateFallbackAnswer =
  fallbackAnswerService.generateFallbackAnswer;

const makeChunk = (id: string, content: string): EvaluatedChunk => ({
  id,
  content,
  pineconeScore: 0.9,
  metadata: {
    documentId: "doc-1",
    userId: "user-1",
    subject: "Philosophy",
    subjectId: "subject-1",
    title: "Triết học Mác-Lênin",
    chunkIndex: 0,
    sectionTitle: "Chương 2",
  },
  relevanceScore: 0.9,
  isRelevant: true,
});

// A scripted model: returns the next message from the script on every agent
// step, regardless of input — letting tests drive the loop deterministically.
const mockAgentModel = (script: AIMessage[]) => {
  let step = 0;
  (
    agentModel as unknown as {
      getAgentModel: typeof agentModel.getAgentModel;
    }
  ).getAgentModel = () => ({
    bindTools: () => ({
      invoke: async () => {
        const message = script[step];
        step += 1;
        return message;
      },
    }),
  });
};

const mockScope = () => {
  (
    chatScopeService as unknown as {
      resolveChatScope: typeof chatScopeService.resolveChatScope;
    }
  ).resolveChatScope = async () => ({
    scope: "library_all",
    hasProcessingDocument: false,
    vectorFilters: { userId: "user-1" },
    isMultiDocumentScope: false,
  });
};

const mockRetrieval = (chunk: EvaluatedChunk): string[] => {
  const calls: string[] = [];
  (
    vectorService as unknown as {
      searchRelevantChunks: typeof vectorService.searchRelevantChunks;
    }
  ).searchRelevantChunks = async (queryOrEmbedding) => {
    const query = String(queryOrEmbedding);
    calls.push(query);
    return query.includes("Known context:") ? [] : [chunk];
  };
  return calls;
};

const mockGrounding = (
  grounding: Awaited<ReturnType<typeof answerCheckService.checkAnswerGrounding>>,
) => {
  (
    answerCheckService as unknown as {
      checkAnswerGrounding: typeof answerCheckService.checkAnswerGrounding;
    }
  ).checkAnswerGrounding = async () => grounding;
};

afterEach(() => {
  (
    agentModel as unknown as {
      getAgentModel: typeof agentModel.getAgentModel;
    }
  ).getAgentModel = originalGetAgentModel;
  (
    chatScopeService as unknown as {
      resolveChatScope: typeof chatScopeService.resolveChatScope;
    }
  ).resolveChatScope = originalResolveChatScope;
  (
    vectorService as unknown as {
      searchRelevantChunks: typeof vectorService.searchRelevantChunks;
    }
  ).searchRelevantChunks = originalSearchRelevantChunks;
  (
    answerCheckService as unknown as {
      checkAnswerGrounding: typeof answerCheckService.checkAnswerGrounding;
    }
  ).checkAnswerGrounding = originalCheckAnswerGrounding;
  (
    fallbackAnswerService as unknown as {
      generateFallbackAnswer: typeof fallbackAnswerService.generateFallbackAnswer;
    }
  ).generateFallbackAnswer = originalGenerateFallbackAnswer;
});

describe("agentic RAG loop", () => {
  it("loops through tool calls and answers from retrieved context", async () => {
    mockScope();
    const chunk = makeChunk(
      "doc-1:0",
      "Vật chất quyết định ý thức trong triết học Mác-Lênin.",
    );
    const retrievalCalls = mockRetrieval(chunk);
    mockGrounding({ isGrounded: true, confidenceScore: 0.9 });
    mockAgentModel([
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "call_1",
            name: "search_documents",
            args: { query: "vật chất quyết định ý thức" },
          },
        ],
      }),
      new AIMessage(
        "Theo Triết học Mác-Lênin (Chương 2), vật chất quyết định ý thức.",
      ),
    ]);

    const result = await askQuestionWithAgent(
      "user-1",
      { question: "vật chất với ý thức cái nào có trước?" },
      { persistHistory: false },
    );

    assert.equal(result.mode, "agentic");
    assert.match(result.answer, /vật chất quyết định ý thức/i);
    // agent decided → tool ran → agent answered: two model invocations
    assert.equal(result.agent.steps, 2);
    assert.equal(result.agent.toolCalls.length, 1);
    assert.equal(result.agent.toolCalls[0].tool, "search_documents");
    // stage-one search + one QDC expansion for the single static seed
    assert.equal(retrievalCalls.length, 2);
    assert.equal(result.sources.length, 1);
    assert.equal(result.evaluation?.isGrounded, true);
    assert.equal(result.evaluation?.fallbackGenerated, false);
  });

  it("answers meta questions directly without any tool call", async () => {
    mockScope();
    const retrievalCalls = mockRetrieval(makeChunk("doc-1:0", "unused"));
    mockAgentModel([
      new AIMessage(
        "I answer questions about your uploaded study documents.",
      ),
    ]);

    const result = await askQuestionWithAgent(
      "user-1",
      { question: "what can you do?" },
      { persistHistory: false },
    );

    assert.equal(result.agent.steps, 1);
    assert.equal(result.agent.toolCalls.length, 0);
    assert.equal(retrievalCalls.length, 0);
    assert.equal(result.sources.length, 0);
    assert.equal(result.evaluation?.isGrounded, true);
  });

  it("replaces ungrounded answers through the deterministic gate", async () => {
    mockScope();
    mockRetrieval(
      makeChunk("doc-1:0", "Vật chất quyết định ý thức."),
    );
    mockGrounding({
      isGrounded: false,
      confidenceScore: 0.2,
      warning: "Answer not supported by context",
    });
    (
      fallbackAnswerService as unknown as {
        generateFallbackAnswer: typeof fallbackAnswerService.generateFallbackAnswer;
      }
    ).generateFallbackAnswer = async () => "Fallback for ungrounded answer";
    mockAgentModel([
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "call_1",
            name: "search_documents",
            args: { query: "vật chất" },
          },
        ],
      }),
      new AIMessage("A hallucinated claim about the document."),
    ]);

    const result = await askQuestionWithAgent(
      "user-1",
      { question: "vật chất là gì?" },
      { persistHistory: false },
    );

    assert.equal(result.answer, "Fallback for ungrounded answer");
    assert.equal(result.evaluation?.fallbackGenerated, true);
    assert.equal(result.evaluation?.fallbackReason, "grounding_failed");
    assert.equal(result.evaluation?.isGrounded, false);
  });

  it("reports NO_MATCHES to the model when retrieval finds nothing", async () => {
    mockScope();
    const retrievalCalls: string[] = [];
    (
      vectorService as unknown as {
        searchRelevantChunks: typeof vectorService.searchRelevantChunks;
      }
    ).searchRelevantChunks = async (queryOrEmbedding) => {
      retrievalCalls.push(String(queryOrEmbedding));
      return [];
    };
    mockAgentModel([
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "call_1",
            name: "search_documents",
            args: { query: "quantum chromodynamics" },
          },
        ],
      }),
      new AIMessage(
        "Your documents do not seem to cover this topic.",
      ),
    ]);

    const result = await askQuestionWithAgent(
      "user-1",
      { question: "explain quantum chromodynamics" },
      { persistHistory: false },
    );

    assert.equal(result.agent.toolCalls[0].resultSummary, "NO_MATCHES");
    assert.equal(result.sources.length, 0);
    assert.match(result.answer, /do not seem to cover/i);
    // nothing retrieved → nothing to ground against → no fallback
    assert.equal(result.evaluation?.fallbackGenerated, false);
  });

  it("emits streaming progress events in sequence", async () => {
    mockScope();
    const chunk = makeChunk(
      "doc-1:0",
      "Vật chất quyết định ý thức trong triết học Mác-Lênin.",
    );
    mockRetrieval(chunk);
    mockGrounding({ isGrounded: true, confidenceScore: 0.9 });
    mockAgentModel([
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "call_1",
            name: "search_documents",
            args: { query: "vật chất quyết định ý thức" },
          },
        ],
      }),
      new AIMessage(
        "Theo Triết học Mác-Lênin (Chương 2), vật chất quyết định ý thức.",
      ),
    ]);

    const events: any[] = [];
    const result = await askQuestionWithAgent(
      "user-1",
      { question: "vật chất với ý thức cái nào có trước?" },
      {
        persistHistory: false,
        onEvent: (event) => {
          events.push(event);
        },
      },
    );

    assert.equal(result.mode, "agentic");
    assert.deepEqual(events.map(e => e.type), [
      "agent_step",
      "tool_start",
      "tool_end",
      "agent_step",
      "grounding_check",
      "final",
    ]);

    assert.equal(events[0].step, 1);
    assert.equal(events[1].tool, "search_documents");
    assert.equal(events[2].tool, "search_documents");
    assert.match(events[2].resultSummary, /1 passages/);
    assert.equal(events[3].step, 2);
    assert.equal(events[5].data.answer, result.answer);
  });
});

