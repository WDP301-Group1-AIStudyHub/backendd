import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPineconeFilter } from "./vector.service";

describe("vector search filters", () => {
  it("uses $in when multiple document ids are selected", () => {
    const filter = buildPineconeFilter({
      userId: "user-1",
      documentIds: ["doc-1", "doc-2"],
      subjectId: "subject-1",
    });

    assert.deepEqual(filter, {
      userId: { $eq: "user-1" },
      documentId: { $in: ["doc-1", "doc-2"] },
      subjectId: { $eq: "subject-1" },
    });
  });

  it("keeps single document filtering backwards-compatible", () => {
    const filter = buildPineconeFilter({
      userId: "user-1",
      documentId: "doc-1",
    });

    assert.deepEqual(filter, {
      userId: { $eq: "user-1" },
      documentId: { $eq: "doc-1" },
    });
  });
});

