import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { AIMessage, AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { reportCredentialFailure, requireCredential } from "./aiCredentialContext";

export type BoundAgentModel = {
  invoke: (messages: BaseMessage[], options?: { signal?: AbortSignal }) => Promise<AIMessage>;
  stream: (messages: BaseMessage[], options?: { signal?: AbortSignal }) => Promise<AsyncIterable<AIMessageChunk>>;
};

export type AgentChatModel = {
  bindTools: (tools: StructuredToolInterface[]) => BoundAgentModel;
};

export const DEFAULT_AGENT_MODEL = "gemini-3.1-flash-lite";

let testGeminiApiKeyOverride: string | null = null;

export const setTestGeminiApiKey = (key: string | null): void => {
  testGeminiApiKeyOverride = key;
};

export const resetTestGeminiApiKey = (): void => {
  testGeminiApiKeyOverride = null;
};

// The agent is the only model path the web app uses, so without this wrapper a
// user's revoked key never gets flagged and degraded mode never engages. Both
// entry points are covered: `stream` can reject on the initial call or throw
// part-way through iteration, and only the latter happens for a key that
// Google rejects after the connection opens.
const withFailureReporting = (bound: BoundAgentModel): BoundAgentModel => ({
  invoke: async (messages, options) => {
    try {
      return await bound.invoke(messages, options);
    } catch (error) {
      await reportCredentialFailure(error);
      throw error;
    }
  },
  stream: async (messages, options) => {
    let iterable: AsyncIterable<AIMessageChunk>;
    try {
      iterable = await bound.stream(messages, options);
    } catch (error) {
      await reportCredentialFailure(error);
      throw error;
    }

    return {
      async *[Symbol.asyncIterator]() {
        try {
          yield* iterable;
        } catch (error) {
          await reportCredentialFailure(error);
          throw error;
        }
      },
    };
  },
});

// Kept in its own module so tests can swap the model for a scripted fake via
// the same property-override pattern used across the service tests.
export const getAgentModel = (): AgentChatModel => {
  const apiKey = testGeminiApiKeyOverride ?? requireCredential().apiKey;
  const model = new ChatGoogleGenerativeAI({
    model: process.env.GEMINI_MODEL || DEFAULT_AGENT_MODEL,
    apiKey,
    temperature: 0,
    thinkingConfig: { includeThoughts: true, thinkingLevel: "LOW" },
  });

  const typedModel = model as unknown as AgentChatModel;

  return {
    bindTools: (tools) => withFailureReporting(typedModel.bindTools(tools)),
  };
};
