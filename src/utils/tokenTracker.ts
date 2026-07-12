import { AsyncLocalStorage } from "node:async_hooks";

export interface TokenMetrics {
  promptTokens: number;
  completionTokens: number;
  embeddingTokens: number;
  embeddingCalls: number;
}

export const tokenStorage = new AsyncLocalStorage<TokenMetrics>();

export const initTokenTracker = <T>(fn: () => Promise<T>): Promise<T> => {
  return tokenStorage.run(
    { promptTokens: 0, completionTokens: 0, embeddingTokens: 0, embeddingCalls: 0 },
    fn,
  );
};

export const recordLlmTokens = (prompt: number, completion: number): void => {
  const store = tokenStorage.getStore();
  if (store) {
    store.promptTokens += prompt;
    store.completionTokens += completion;
  }
};

export const recordEmbeddingTokens = (tokens: number): void => {
  const store = tokenStorage.getStore();
  if (store) {
    store.embeddingTokens += tokens;
    store.embeddingCalls += 1;
  }
};

export const getTokenMetrics = (): TokenMetrics | undefined => {
  return tokenStorage.getStore();
};

export const calculateUsdCost = (
  promptTokens: number,
  completionTokens: number,
  embeddingTokens: number,
): number => {
  // Pricing:
  // - Gemini 3.1 Flash Lite: $0.075 / 1M input, $0.30 / 1M output tokens
  // - Jina Embeddings v3: $0.02 / 1M tokens
  const llmInputCost = (promptTokens / 1_000_000) * 0.075;
  const llmOutputCost = (completionTokens / 1_000_000) * 0.30;
  const embeddingCost = (embeddingTokens / 1_000_000) * 0.02;

  return Number((llmInputCost + llmOutputCost + embeddingCost).toFixed(7));
};
