import { AppError } from "../middlewares/error.middleware";
import { retryAsync } from "../utils/retry";

export const JINA_EMBEDDING_DIMENSION = 1024;
const JINA_MAX_CONCURRENT_REQUESTS = 2;

let activeJinaRequests = 0;
const pendingJinaRequests: Array<() => void> = [];

interface JinaEmbeddingItem {
  index: number;
  embedding: number[];
}

interface JinaEmbeddingResponse {
  data?: JinaEmbeddingItem[];
  detail?: string;
  message?: string;
}

const getJinaApiKey = (): string => {
  const apiKey = process.env.JINA_API_KEY;

  if (!apiKey) {
    throw new AppError("JINA_API_KEY is required for RAG features", 500);
  }

  return apiKey;
};

const getJinaEmbeddingModel = (): string => {
  return process.env.JINA_EMBEDDING_MODEL || "jina-embeddings-v3";
};

const acquireJinaRequestSlot = async (): Promise<void> => {
  if (activeJinaRequests < JINA_MAX_CONCURRENT_REQUESTS) {
    activeJinaRequests += 1;
    return;
  }

  await new Promise<void>((resolve) => {
    pendingJinaRequests.push(resolve);
  });
};

const releaseJinaRequestSlot = (): void => {
  const nextRequest = pendingJinaRequests.shift();

  if (nextRequest) {
    nextRequest();
    return;
  }

  activeJinaRequests -= 1;
};

const isRetryableJinaError = (error: unknown): boolean =>
  error instanceof AppError &&
  (error.statusCode === 429 || error.statusCode >= 500);

const requestJinaEmbeddings = async (texts: string[]): Promise<number[][]> => {
  if (texts.length === 0) {
    return [];
  }

  await acquireJinaRequestSlot();

  try {
    return await retryAsync(
      async () => {
        const response = await fetch("https://api.jina.ai/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${getJinaApiKey()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: getJinaEmbeddingModel(),
            input: texts,
          }),
        });

        const body = (await response
          .json()
          .catch(() => ({}))) as JinaEmbeddingResponse;

        if (!response.ok) {
          throw new AppError(
            body.detail ||
              body.message ||
              `Jina embedding request failed with status ${response.status}`,
            response.status >= 500 ? 502 : response.status,
          );
        }

        if (!Array.isArray(body.data)) {
          throw new AppError("Jina embedding response did not include data", 502);
        }

        return body.data
          .sort((a, b) => a.index - b.index)
          .map((item) => item.embedding);
      },
      {
        retries: 3,
        baseDelayMs: 500,
        maxDelayMs: 4_000,
        shouldRetry: isRetryableJinaError,
      },
    );
  } finally {
    releaseJinaRequestSlot();
  }
};

export const generateEmbedding = async (text: string): Promise<number[]> => {
  const [embedding] = await requestJinaEmbeddings([text]);

  if (!embedding) {
    throw new AppError("Jina embedding response was empty", 502);
  }

  return embedding;
};

export const generateEmbeddings = async (
  texts: string[],
): Promise<number[][]> => {
  return requestJinaEmbeddings(texts);
};
