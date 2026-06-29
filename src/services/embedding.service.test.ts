import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { generateEmbedding } from "./embedding.service";

const originalFetch = globalThis.fetch;
const originalJinaApiKey = process.env.JINA_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;

  if (originalJinaApiKey === undefined) {
    delete process.env.JINA_API_KEY;
  } else {
    process.env.JINA_API_KEY = originalJinaApiKey;
  }
});

describe("Jina embedding concurrency", () => {
  it("queues requests so no more than two run at once", async () => {
    process.env.JINA_API_KEY = "test-key";
    let activeRequests = 0;
    let maxActiveRequests = 0;

    globalThis.fetch = async () => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);

      await new Promise((resolve) => setTimeout(resolve, 20));
      activeRequests -= 1;

      return new Response(
        JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2] }] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    const results = await Promise.all(
      ["one", "two", "three", "four"].map(generateEmbedding),
    );

    assert.equal(maxActiveRequests, 2);
    assert.equal(results.length, 4);
    assert.deepEqual(results[0], [0.1, 0.2]);
  });
});
