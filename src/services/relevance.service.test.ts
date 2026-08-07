import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateChunkRelevance,
  removeVietnameseAccents,
} from "./relevance.service";
import { RetrievedChunk } from "./vector.service";

describe("relevance service accent & diacritics handling", () => {
  it("strips Vietnamese diacritics correctly", () => {
    assert.equal(
      removeVietnameseAccents("Nội dung chương 2 Mác - Lênin"),
      "Noi dung chuong 2 Mac - Lenin",
    );
  });

  it("matches non-diacritic Vietnamese query against accented document text", () => {
    const chunk: RetrievedChunk = {
      id: "doc-1:0",
      content:
        "Nội dung chương 2 Mác - Lênin trình bày về hàng hóa, giá trị và tiền tệ.",
      pineconeScore: 0.65,
      metadata: {
        documentId: "doc-1",
        userId: "user-1",
        subject: "MLN",
        subjectId: "subj-1",
        title: "tai lieu maclenin test",
        chunkIndex: 0,
        heading: "Chương 2",
        sectionTitle: "Nội dung chương 2",
      },
    };

    const evaluated = evaluateChunkRelevance(
      '"noi dung chuong 2 MLN"',
      chunk,
      0.55,
    );

    assert.equal(evaluated.isRelevant, true);
    assert.ok(evaluated.relevanceScore >= 0.55);
    assert.ok(evaluated.relevanceDecisionReason);
    assert.ok(evaluated.relevanceDecisionReason.length > 0);

  });

  it("strips wrapping double quotes from input query strings", () => {
    const chunk: RetrievedChunk = {
      id: "doc-1:1",
      content: "Chủ nghĩa Mác Lênin là nền tảng tư tưởng.",
      pineconeScore: 0.7,
      metadata: {
        documentId: "doc-1",
        userId: "user-1",
        subject: "MLN",
        subjectId: "subj-1",
        title: "Triết học",
        chunkIndex: 1,
      },
    };

    const evaluated = evaluateChunkRelevance(
      '""chu nghia mac lenin""',
      chunk,
      0.55,
    );

    assert.equal(evaluated.isRelevant, true);
    assert.ok(evaluated.relevanceScore >= 0.7);
  });
});
