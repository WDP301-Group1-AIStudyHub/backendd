import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { AIMessage, BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { requireCredential } from "./aiCredentialContext";

export type BoundAgentModel = {
  invoke: (messages: BaseMessage[], options?: { signal?: AbortSignal }) => Promise<AIMessage>;
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

// Kept in its own module so tests can swap the model for a scripted fake via
// the same property-override pattern used across the service tests.
export const getAgentModel = (): AgentChatModel => {
  const apiKey = testGeminiApiKeyOverride ?? requireCredential().apiKey;
  const model = new ChatGoogleGenerativeAI({
    model: process.env.GEMINI_MODEL || DEFAULT_AGENT_MODEL,
    apiKey,
    temperature: 0,
  });

  return model as unknown as AgentChatModel;
};
