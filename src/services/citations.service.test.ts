import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCitations } from "./citations.service";
import type { ChatSource } from "../types/api.types";

const makeSource = (documentId: string, citationId: number, title: string): ChatSource => ({
  documentId,
  title,
  chunkIndex: 0,
  contentPreview: `Preview for ${title}`,
  citationId,
});

describe("applyCitations", () => {
  it("returns unchanged answer and empty citedSources when no markers exist", () => {
    const sources = [makeSource("doc-1", 1, "Doc 1"), makeSource("doc-2", 2, "Doc 2")];
    const answer = "This is a simple answer without citations.";
    const result = applyCitations({ answer, sources });

    assert.equal(result.answer, answer);
    assert.deepEqual(result.citedSources, []);
  });

  it("renumbers valid markers densely in first-appearance order", () => {
    const sources = [
      makeSource("doc-1", 5, "Doc Alpha"),
      makeSource("doc-2", 12, "Doc Beta"),
      makeSource("doc-3", 20, "Doc Gamma"),
    ];
    const answer = "First point [12]. Second point [5]. Third point [12].";
    const result = applyCitations({ answer, sources });

    assert.equal(result.answer, "First point [1]. Second point [2]. Third point [1].");
    assert.equal(result.citedSources.length, 2);
    assert.equal(result.citedSources[0].documentId, "doc-2");
    assert.equal(result.citedSources[0].citationId, 1);
    assert.equal(result.citedSources[1].documentId, "doc-1");
    assert.equal(result.citedSources[1].citationId, 2);
  });

  it("drops hallucinated IDs absent from sources", () => {
    const sources = [makeSource("doc-1", 1, "Doc Alpha")];
    const answer = "Valid point [1]. Hallucinated point [99].";
    const result = applyCitations({ answer, sources });

    // The space preceding the dropped marker goes with it, so no doubled space.
    assert.equal(result.answer, "Valid point [1]. Hallucinated point.");
    assert.equal(result.citedSources.length, 1);
    assert.equal(result.citedSources[0].documentId, "doc-1");
    assert.equal(result.citedSources[0].citationId, 1);
  });

  it("handles adjacent marker runs like [3][7]", () => {
    const sources = [makeSource("doc-1", 3, "Doc A"), makeSource("doc-2", 7, "Doc B")];
    const answer = "Supported by multiple sources [3][7].";
    const result = applyCitations({ answer, sources });

    assert.equal(result.answer, "Supported by multiple sources [1][2].");
    assert.equal(result.citedSources.length, 2);
  });

  it("preserves markers inside fenced code blocks and inline code", () => {
    const sources = [makeSource("doc-1", 1, "Doc A")];
    const answer = "Here is code:\n```\nconst arr = [1];\n```\nAnd inline `arr[1]` with text [1].";
    const result = applyCitations({ answer, sources });

    assert.equal(
      result.answer,
      "Here is code:\n```\nconst arr = [1];\n```\nAnd inline `arr[1]` with text [1].",
    );
    assert.equal(result.citedSources.length, 1);
  });

  it("preserves markdown links like [1](http://example.com)", () => {
    const sources = [makeSource("doc-1", 1, "Doc A")];
    const answer = "See link [1](http://example.com) and citation [1].";
    const result = applyCitations({ answer, sources });

    assert.equal(result.answer, "See link [1](http://example.com) and citation [1].");
    assert.equal(result.citedSources.length, 1);
  });

  it("emits one citedSource when the same id is cited repeatedly", () => {
    const sources = [makeSource("doc-1", 4, "Doc A"), makeSource("doc-2", 9, "Doc B")];
    const answer = "Claim one [4]. Claim two [4]. Claim three [4].";
    const result = applyCitations({ answer, sources });

    assert.equal(result.answer, "Claim one [1]. Claim two [1]. Claim three [1].");
    assert.equal(result.citedSources.length, 1);
    assert.equal(result.citedSources[0].documentId, "doc-1");
    assert.equal(result.citedSources[0].citationId, 1);
  });

  it("keeps every source when all of them are cited", () => {
    const sources = [
      makeSource("doc-1", 1, "Doc A"),
      makeSource("doc-2", 2, "Doc B"),
      makeSource("doc-3", 3, "Doc C"),
    ];
    const answer = "Third [3]. Second [2]. First [1].";
    const result = applyCitations({ answer, sources });

    // Renumbering follows first appearance, not the original ordinals.
    assert.equal(result.answer, "Third [1]. Second [2]. First [3].");
    assert.equal(result.citedSources.length, 3);
    assert.deepEqual(
      result.citedSources.map((source) => source.documentId),
      ["doc-3", "doc-2", "doc-1"],
    );
    assert.deepEqual(
      result.citedSources.map((source) => source.citationId),
      [1, 2, 3],
    );
  });

  it("leaves [0] as literal text rather than treating it as a citation", () => {
    const sources = [makeSource("doc-1", 1, "Doc A")];
    const answer = "Array index [0] is the first element [1].";
    const result = applyCitations({ answer, sources });

    assert.equal(result.answer, "Array index [0] is the first element [1].");
    assert.equal(result.citedSources.length, 1);
  });
});
