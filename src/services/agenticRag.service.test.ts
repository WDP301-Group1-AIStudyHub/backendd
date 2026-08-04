import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import * as agentModel from "./agentModel";
import * as answerCheckService from "./answerCheck.service";
import * as chatScopeService from "./chatScope.service";
import * as fallbackAnswerService from "./fallbackAnswer.service";
import * as vectorService from "./vector.service";
import * as artifactService from "./artifact.service";
import * as documentShareService from "../modules/documentShares/documentShare.service";
import { askQuestionWithAgent } from "./agenticRag.service";
import { StudyDocument } from "../models/document.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import { AppError } from "../middlewares/error.middleware";
import type { EvaluatedChunk } from "../types/rag.types";

const originalGetAgentModel = agentModel.getAgentModel;
const originalResolveChatScope = chatScopeService.resolveChatScope;
const originalSearchRelevantChunks = vectorService.searchRelevantChunks;
const originalCheckAnswerGrounding = answerCheckService.checkAnswerGrounding;
const originalGenerateFallbackAnswer =
  fallbackAnswerService.generateFallbackAnswer;
const originalInitiateArtifactGeneration =
  artifactService.initiateArtifactGeneration;
const originalGetDocumentAccessRole =
  documentShareService.getDocumentAccessRole;
const originalStudyDocumentFindOne = StudyDocument.findOne;
const originalDocumentVersionFindOne = DocumentVersion.findOne;

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

const toChunk = (msg: AIMessage): AIMessageChunk => {
  return new AIMessageChunk({
    content: msg.content,
    tool_calls: msg.tool_calls,
    invalid_tool_calls: msg.invalid_tool_calls,
    additional_kwargs: msg.additional_kwargs,
    response_metadata: msg.response_metadata,
  });
};

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
      stream: async () => {
        const message = script[step];
        step += 1;
        return (async function* () {
          yield toChunk(message);
        })();
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
  (
    artifactService as unknown as {
      initiateArtifactGeneration: typeof artifactService.initiateArtifactGeneration;
    }
  ).initiateArtifactGeneration = originalInitiateArtifactGeneration;
  (
    documentShareService as unknown as {
      getDocumentAccessRole: typeof documentShareService.getDocumentAccessRole;
    }
  ).getDocumentAccessRole = originalGetDocumentAccessRole;
  StudyDocument.findOne = originalStudyDocumentFindOne;
  DocumentVersion.findOne = originalDocumentVersionFindOne;
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
      "phase",
      "tool_end",
      "agent_step",
      "answer_delta",
      "phase",
      "phase",
      "final",
    ]);

    assert.equal(events[0].step, 1);
    assert.equal(events[1].tool, "search_documents");
    assert.equal(events[2].phase, "retrieving");
    assert.equal(events[3].tool, "search_documents");
    assert.match(events[3].resultSummary, /1 passages/);
    assert.equal(events[4].step, 2);
    assert.equal(events[8].data.answer, result.answer);
  });

  it("collapses single documentIds item to documentId in create_artifact", async () => {
    mockScope();
    let capturedParams: any = null;
    (
      artifactService as unknown as {
        initiateArtifactGeneration: typeof artifactService.initiateArtifactGeneration;
      }
    ).initiateArtifactGeneration = async (_userId, params) => {
      capturedParams = params;
      return {
        _id: "art-1",
        title: params.title || "Test Quiz",
        type: params.type,
      } as any;
    };

    mockAgentModel([
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "call_1",
            name: "create_artifact",
            args: {
              type: "QUIZ",
              title: "Quiz 1",
              instructions: "Make a quiz",
              documentIds: ["doc-1"],
            },
          },
        ],
      }),
      new AIMessage("Artifact generation started for your quiz."),
    ]);

    const result = await askQuestionWithAgent(
      "user-1",
      { question: "make a quiz from doc 1" },
      { persistHistory: false },
    );

    assert.equal(result.agent.steps, 2);
    assert.equal(capturedParams.documentId, "doc-1");
    assert.equal(capturedParams.documentIds, undefined);
  });

  it("returns ERROR payload when create_artifact throws AppError and allows agent run to complete", async () => {
    mockScope();
    (
      artifactService as unknown as {
        initiateArtifactGeneration: typeof artifactService.initiateArtifactGeneration;
      }
    ).initiateArtifactGeneration = async () => {
      throw new AppError("Access denied to selected document", 403);
    };

    mockAgentModel([
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "call_1",
            name: "create_artifact",
            args: {
              type: "FLASHCARD",
              title: "Flashcards",
              instructions: "Make flashcards",
              documentIds: ["doc-unauthorized"],
            },
          },
        ],
      }),
      new AIMessage("I could not access that document to make flashcards."),
    ]);

    const result = await askQuestionWithAgent(
      "user-1",
      { question: "make flashcards from unauthorized doc" },
      { persistHistory: false },
    );

    assert.equal(result.agent.steps, 2);
    assert.equal(result.agent.toolCalls[0].resultSummary, "ERROR");
    assert.match(result.answer, /could not access/i);
  });

  it("returns NO_OUTLINE for get_document_outline when active version or outline is missing", async () => {
    mockScope();
    (StudyDocument as any).findOne = () => ({
      select: async () => ({
        _id: "507f1f77bcf86cd799439011",
        ownerId: "user-1",
        title: "Test Doc",
        currentVersionId: "ver-1",
      }),
    });
    (
      documentShareService as unknown as {
        getDocumentAccessRole: typeof documentShareService.getDocumentAccessRole;
      }
    ).getDocumentAccessRole = async () => "OWNER";
    (DocumentVersion as any).findOne = () => ({
      select: async () => null,
    });

    mockAgentModel([
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "call_1",
            name: "get_document_outline",
            args: { documentId: "507f1f77bcf86cd799439011" },
          },
        ],
      }),
      new AIMessage("This document has no extracted outline."),
    ]);

    const result = await askQuestionWithAgent(
      "user-1",
      { question: "what is the outline?" },
      { persistHistory: false },
    );

    assert.equal(result.agent.steps, 2);
    assert.equal(result.agent.toolCalls[0].resultSummary, "NO_OUTLINE");
  });

  it("returns NOT_FOUND for get_document_outline when the model invents a document id", async () => {
    mockScope();
    // Unmocked on purpose: a non-ObjectId id must never reach Mongoose, where
    // it would throw a CastError and abort the whole agent run.
    (StudyDocument as any).findOne = () => {
      throw new Error("findOne should not be reached for a malformed id");
    };

    mockAgentModel([
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "call_1",
            name: "get_document_outline",
            args: { documentId: "doc-1" },
          },
        ],
      }),
      new AIMessage("I could not find that document."),
    ]);

    const result = await askQuestionWithAgent(
      "user-1",
      { question: "what chapters are in doc-1?" },
      { persistHistory: false },
    );

    assert.equal(result.agent.steps, 2);
    assert.equal(result.agent.toolCalls[0].resultSummary, "NOT_FOUND");
  });

  it("emits thought, phase, answer_delta, and toolCallId events during streaming run", async () => {
    mockScope();
    const chunk = makeChunk("c1", "Photosynthesis converts light to energy.");
    mockRetrieval(chunk);
    mockGrounding({ isGrounded: true, confidenceScore: 0.9 });

    (
      agentModel as unknown as {
        getAgentModel: typeof agentModel.getAgentModel;
      }
    ).getAgentModel = () => ({
      bindTools: () => ({
        invoke: async () => new AIMessage("Photosynthesis is process..."),
        stream: async (messages) => {
          if (messages.length <= 2) {
            return (async function* () {
              yield new AIMessageChunk({
                content: [
                  { type: "thinking", thinking: "Looking for photosynthesis details" },
                ],
                tool_calls: [
                  {
                    id: "call_search_1",
                    name: "search_documents",
                    args: { query: "photosynthesis" },
                  },
                ],
              });
            })();
          }
          return (async function* () {
            yield new AIMessageChunk({
              content: [
                { type: "text", text: "Photosynthesis converts light into chemical energy." },
              ],
            });
          })();
        },
      }),
    });

    const events: any[] = [];
    const result = await askQuestionWithAgent(
      "user-1",
      { question: "What is photosynthesis?" },
      {
        persistHistory: false,
        onEvent: (event) => events.push(event),
      },
    );

    assert.equal(result.agent.steps, 2);
    assert.ok(events.some((e) => e.type === "thought" && e.text.includes("Looking for photosynthesis")));
    assert.ok(events.some((e) => e.type === "phase" && e.phase === "retrieving"));
    assert.ok(events.some((e) => e.type === "tool_start" && e.toolCallId === "call_search_1"));
    assert.ok(events.some((e) => e.type === "tool_end" && e.toolCallId === "call_search_1"));
    assert.ok(events.some((e) => e.type === "answer_delta"));
    assert.ok(events.some((e) => e.type === "phase" && e.phase === "citing"));
  });

  it("does not leak thinking parts into extractMessageText or final answer", async () => {
    mockScope();
    (
      agentModel as unknown as {
        getAgentModel: typeof agentModel.getAgentModel;
      }
    ).getAgentModel = () => ({
      bindTools: () => ({
        invoke: async () => new AIMessage("Final answer without thoughts."),
        stream: async () => {
          return (async function* () {
            yield new AIMessageChunk({
              content: [
                { type: "thinking", thinking: "Internal reasoning block" },
                { type: "text", text: "Final answer text" },
              ],
            });
          })();
        },
      }),
    });

    const result = await askQuestionWithAgent(
      "user-1",
      { question: "Simple question" },
      { persistHistory: false },
    );

    assert.equal(result.answer, "Final answer text");
    assert.ok(!result.answer.includes("Internal reasoning block"));
  });

  // Gemini splits tool-call arguments across several stream chunks. If the
  // accumulation in agentNode drops or mangles them, shouldContinue reads an
  // empty tool_calls array and the graph goes straight to END — the agent
  // silently stops searching and answers from nothing. The other streaming
  // tests yield one whole chunk per step, so only this one covers it.
  it("reassembles tool calls split across stream chunks", async () => {
    mockScope();
    const chunk = makeChunk("c1", "Photosynthesis converts light to energy.");
    const retrievalCalls = mockRetrieval(chunk);
    mockGrounding({ isGrounded: true, confidenceScore: 0.9 });

    (
      agentModel as unknown as {
        getAgentModel: typeof agentModel.getAgentModel;
      }
    ).getAgentModel = () => ({
      bindTools: () => ({
        invoke: async () => new AIMessage("unused"),
        stream: async (messages) => {
          if (messages.length <= 2) {
            // One tool call arriving as three partial chunks, the way the
            // provider actually streams it: name and id on the first, the
            // JSON argument string split across all three.
            return (async function* () {
              yield new AIMessageChunk({
                content: "",
                tool_call_chunks: [
                  {
                    type: "tool_call_chunk",
                    id: "call_split_1",
                    name: "search_documents",
                    args: '{"query":"photo',
                    index: 0,
                  },
                ],
              });
              yield new AIMessageChunk({
                content: "",
                tool_call_chunks: [
                  { type: "tool_call_chunk", args: "synthesis in the", index: 0 },
                ],
              });
              yield new AIMessageChunk({
                content: "",
                tool_call_chunks: [
                  { type: "tool_call_chunk", args: ' thylakoid"}', index: 0 },
                ],
              });
            })();
          }
          return (async function* () {
            yield new AIMessageChunk({
              content: [{ type: "text", text: "It happens in the thylakoid." }],
            });
          })();
        },
      }),
    });

    const events: any[] = [];
    const result = await askQuestionWithAgent(
      "user-1",
      { question: "Where does photosynthesis happen?" },
      { persistHistory: false, onEvent: (event) => events.push(event) },
    );

    // The loop ran a second step, which only happens if the merged message
    // still carried its tool_calls.
    assert.equal(result.agent.steps, 2);
    assert.equal(result.agent.toolCalls.length, 1);
    // The argument string was reassembled from all three fragments, not just
    // the first one. Later entries are the retrieval layer's own expanded
    // queries, so only the first reflects what the model asked for.
    assert.equal(retrievalCalls[0], "photosynthesis in the thylakoid");
    assert.ok(
      events.some(
        (e) => e.type === "tool_start" && e.toolCallId === "call_split_1",
      ),
      "tool_start should carry the provider's own call id",
    );
    assert.equal(result.answer, "It happens in the thylakoid.");
  });
});

