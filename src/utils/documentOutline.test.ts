import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyOutlineToChunks,
  extractDocumentOutline,
  summarizeDocumentOutline,
  type DocumentOutlineNode,
} from "./documentOutline";
import { splitTextForRag } from "./textSplitter";

describe("document outline extraction", () => {
  it("does not count unmatched table-of-contents headings as body chapters", async () => {
    const chunkingResult = await splitTextForRag(`
Chuong I
Muc luc tom tat.

Chuong II
Muc luc tom tat.

Chuong III
Muc luc tom tat.

Chuong I: Khai luoc ve triet hoc
Noi dung chuong mot.

Chuong II: Lich su triet hoc truoc Mac
Noi dung chuong hai.
`);
    const outline = extractDocumentOutline({
      text: chunkingResult.chunks.map((chunk) => chunk.content).join("\n\n"),
      chunkingResult,
    });
    const summary = summarizeDocumentOutline(outline);

    assert.equal(summary.chapterCount, 2);
    assert.deepEqual(summary.chapterSections, [
      "Chuong I: Khai luoc ve triet hoc",
      "Chuong II: Lich su triet hoc truoc Mac",
    ]);
  });

  it("keeps a semantic part, chapter, and section hierarchy", () => {
    const semanticOutline: DocumentOutlineNode[] = [
      {
        id: "semantic-1",
        parentId: null,
        level: 1,
        type: "part",
        title: "Phan I: Nen tang",
        source: "semantic",
        confidence: 0.95,
      },
      {
        id: "semantic-2",
        parentId: null,
        level: 2,
        type: "chapter",
        title: "Chuong 1: Tong quan",
        source: "semantic",
        confidence: 0.95,
      },
      {
        id: "semantic-3",
        parentId: null,
        level: 3,
        type: "section",
        title: "Muc 1.1: Khai niem",
        source: "semantic",
        confidence: 0.95,
      },
    ];
    const outline = extractDocumentOutline({
      text: "Phan I: Nen tang\nChuong 1: Tong quan\nMuc 1.1: Khai niem",
      semanticOutline,
    });
    const summary = summarizeDocumentOutline(outline);

    assert.equal(summary.partCount, 1);
    assert.equal(summary.chapterCount, 1);
    assert.equal(summary.sectionCount, 1);
    assert.equal(outline[1].parentId, outline[0].id);
    assert.equal(outline[2].parentId, outline[1].id);
  });

  it("keeps a Roman-numbered chapter title at the end of a PDF", async () => {
    const text = `
Chuong XIV
Quan diem triet hoc Mac - Lenin ve con nguoi
Noi dung chuong muoi bon.

Muc luc
Chuong XIV: Quan diem triet hoc Mac - Lenin ve con nguoi`;
    const chunkingResult = await splitTextForRag(text);
    const outline = extractDocumentOutline({ text, chunkingResult });
    const summary = summarizeDocumentOutline(outline);

    assert.equal(summary.chapterCount, 1);
    assert.equal(
      summary.chapterSections[0],
      "Chuong XIV: Quan diem triet hoc Mac - Lenin ve con nguoi",
    );
  });

  it("adds outline path and chapter ordinal to matching chunks", async () => {
    const text = `
Chuong 1: Tong quan
Noi dung chuong mot.

Muc 1.1: Khai niem
Noi dung muc mot mot.
`;
    const chunkingResult = await splitTextForRag(text);
    const outline = extractDocumentOutline({ text, chunkingResult });
    const chunks = applyOutlineToChunks(chunkingResult.chunks, outline);
    const sectionChunk = chunks.find(
      (chunk) => chunk.metadata.sectionTitle === "Muc 1.1: Khai niem",
    );

    assert.equal(sectionChunk?.metadata.outlineType, "section");
    assert.equal(sectionChunk?.metadata.chapterOrdinal, "1");
    assert.match(sectionChunk?.metadata.outlinePath || "", /Chuong 1/);
  });
});
