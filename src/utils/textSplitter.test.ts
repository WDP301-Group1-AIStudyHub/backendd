import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitTextForRag } from "./textSplitter";

describe("text splitter heading-based chunking", () => {
  it("creates chunks from multiple plain headings", async () => {
    const result = await splitTextForRag(
      [
        "Introduction",
        "React hooks overview",
        "",
        "Advanced Patterns",
        "Memoization and custom hooks",
      ].join("\n"),
    );

    assert.equal(result.chunkingStrategy, "heading-based");
    assert.equal(result.chunks.length, 2);
    assert.equal(result.chunks[0].metadata.heading, "Introduction");
    assert.equal(result.chunks[1].metadata.heading, "Advanced Patterns");
  });

  it("detects Vietnamese keyword headings", async () => {
    const result = await splitTextForRag(
      [
        "Ch\u01b0\u01a1ng 1 T\u1ed5ng quan",
        "N\u1ed9i dung m\u1edf \u0111\u1ea7u",
        "",
        "Ph\u1ea7n 2 Ki\u1ebfn th\u1ee9c n\u1ec1n",
        "N\u1ed9i dung chi ti\u1ebft",
        "",
        "B\u00e0i 3 Th\u1ef1c h\u00e0nh",
        "B\u00e0i t\u1eadp \u00e1p d\u1ee5ng",
      ].join("\n"),
    );

    assert.equal(result.chunkingStrategy, "heading-based");
    assert.deepEqual(
      result.chunks.map((chunk) => chunk.metadata.heading),
      [
        "Ch\u01b0\u01a1ng 1 T\u1ed5ng quan",
        "Ph\u1ea7n 2 Ki\u1ebfn th\u1ee9c n\u1ec1n",
        "B\u00e0i 3 Th\u1ef1c h\u00e0nh",
      ],
    );
  });

  it("normalizes markdown headings", async () => {
    const result = await splitTextForRag("# Overview\nMarkdown content");

    assert.equal(result.chunkingStrategy, "heading-based");
    assert.equal(result.chunks.length, 1);
    assert.equal(result.chunks[0].metadata.heading, "Overview");
    assert.equal(result.chunks[0].content.startsWith("Overview\n"), true);
  });

  it("repairs mojibake before chunking", async () => {
    const result = await splitTextForRag(
      "# Tri\u00e1\u00ba\u00bft h\u00e1\u00bb\u008dc\nN\u00e1\u00bb\u0099i dung b\u00e1\u00bb\u008b l\u00e1\u00bb\u0097i m\u00c3\u00a3 h\u00c3\u00b3a",
    );

    assert.equal(result.chunkingStrategy, "heading-based");
    assert.equal(result.chunks[0].metadata.heading, "Tri\u1ebft h\u1ecdc");
    assert.equal(result.chunks[0].content.includes("N\u1ed9i dung"), true);
  });

  it("splits long sections while preserving heading context", async () => {
    const longBody = Array.from(
      { length: 220 },
      (_, index) => `Sentence ${index} explains one detailed concept.`,
    ).join(" ");
    const result = await splitTextForRag(`# Long Section\n${longBody}`);

    assert.equal(result.chunkingStrategy, "heading-based");
    assert.equal(result.chunks.length > 1, true);
    assert.equal(
      result.chunks.every(
        (chunk) =>
          chunk.metadata.heading === "Long Section" &&
          chunk.content.startsWith("Long Section\n"),
      ),
      true,
    );
  });

  it("falls back to fixed-size chunks when no heading is detected", async () => {
    const result = await splitTextForRag(
      "This paragraph has no heading. It is ordinary body text.",
    );

    assert.equal(result.chunkingStrategy, "fixed-size-fallback");
    assert.equal(result.chunks.length, 1);
    assert.equal(result.chunks[0].metadata.heading, null);
  });

  it("ignores page markers and numeric-only lines as headings", async () => {
    const result = await splitTextForRag(
      [
        "1 of 214",
        "This content follows a page marker.",
        "",
        "2",
        "This content follows a page number.",
      ].join("\n"),
    );

    assert.equal(result.chunkingStrategy, "fixed-size-fallback");
    assert.equal(result.chunks.length, 1);
    assert.equal(
      result.chunks[0].content
        .split(/\r?\n/)
        .some((line) => line.trim() === "1 of 214" || line.trim() === "2"),
      false,
    );
  });

  it("returns zero chunks for empty text", async () => {
    const result = await splitTextForRag("");

    assert.equal(result.chunkingStrategy, "fixed-size-fallback");
    assert.equal(result.chunks.length, 0);
  });
});
