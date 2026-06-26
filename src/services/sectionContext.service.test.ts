import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RetrievedChunk } from "./vector.service";
import {
  buildNeighborVectorIds,
  chunkMatchesSectionReference,
  findSectionSeedChunk,
  selectExpandedSectionChunks,
} from "./sectionContext.service";

const makeChunk = (
  chunkIndex: number,
  sectionIndex: number,
  sectionTitle: string,
  content = "Body",
  score = 0.5,
): RetrievedChunk => ({
  id: `doc:v1:${chunkIndex}`,
  content,
  pineconeScore: score,
  metadata: {
    documentId: "doc",
    userId: "user",
    subject: "subject",
    subjectId: "subject-id",
    title: "Document",
    chunkIndex,
    heading: sectionTitle,
    sectionTitle,
    sectionIndex,
  },
});

describe("section context helpers", () => {
  it("builds neighbor vector ids around a seed chunk", () => {
    assert.deepEqual(buildNeighborVectorIds("doc:v1:4", 2), [
      "doc:v1:2",
      "doc:v1:3",
      "doc:v1:4",
      "doc:v1:5",
      "doc:v1:6",
    ]);
  });

  it("matches numbered and Roman section headings", () => {
    assert.equal(
      chunkMatchesSectionReference(makeChunk(2, 1, "Chương II: Triết học"), {
        keyword: "chuong",
        rawValue: "2",
        numericValue: 2,
      }),
      true,
    );
  });

  it("finds the best matching section seed chunk", () => {
    const seed = findSectionSeedChunk(
      [
        makeChunk(0, 0, "Chương 1", "Intro", 0.9),
        makeChunk(5, 1, "Chương 2", "Target", 0.7),
        makeChunk(6, 1, "Chương 2", "Target later", 0.8),
      ],
      {
        keyword: "chuong",
        rawValue: "2",
        numericValue: 2,
      },
    );

    assert.equal(seed?.metadata.chunkIndex, 6);
  });

  it("selects same-section chunks ordered by chunk index", () => {
    const seed = makeChunk(5, 2, "Chương 2");
    const selected = selectExpandedSectionChunks(seed, [
      makeChunk(8, 2, "Chương 2"),
      makeChunk(1, 1, "Chương 1"),
      seed,
      makeChunk(6, 2, "Chương 2"),
    ]);

    assert.deepEqual(
      selected.map((chunk) => chunk.metadata.chunkIndex),
      [5, 6, 8],
    );
  });
});
