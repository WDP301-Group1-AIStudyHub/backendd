import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPineconeFilter, deleteDocumentChunks } from "./vector.service";

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

describe("vector deletion", () => {
  it("uses a valid page size and deletes by both ids and document metadata", async () => {
    const listCalls: Array<Record<string, unknown>> = [];
    const deleteCalls: Array<Record<string, unknown>> = [];
    const fakeIndex = {
      listPaginated: async (payload: Record<string, unknown>) => {
        listCalls.push(payload);
        return {
          vectors: [{ id: "doc-1:version-1:0" }, { id: "doc-1:legacy:1" }],
          pagination: {},
        };
      },
      deleteMany: async (payload: Record<string, unknown>) => {
        deleteCalls.push(payload);
      },
    };

    const result = await deleteDocumentChunks("doc-1", "ignored-user", {
      getIndex: async () => fakeIndex as any,
    });

    assert.equal(listCalls[0]?.limit, 99);
    assert.deepEqual(deleteCalls[0]?.ids, ["doc-1:version-1:0", "doc-1:legacy:1"]);
    assert.deepEqual(deleteCalls[1]?.filter, { documentId: { $eq: "doc-1" } });
    assert.equal(JSON.stringify(deleteCalls).includes("ignored-user"), false);
    assert.equal(result.deletedVectorCount, 2);
  });

  it("still deletes by metadata when vector listing fails", async () => {
    const deleteCalls: Array<Record<string, unknown>> = [];
    const fakeIndex = {
      listPaginated: async () => {
        throw new Error("list unavailable");
      },
      deleteMany: async (payload: Record<string, unknown>) => {
        deleteCalls.push(payload);
      },
    };

    await deleteDocumentChunks("doc-2", undefined, {
      getIndex: async () => fakeIndex as any,
    });

    assert.equal(deleteCalls.length, 1);
    assert.deepEqual(deleteCalls[0]?.filter, { documentId: { $eq: "doc-2" } });
  });
});

