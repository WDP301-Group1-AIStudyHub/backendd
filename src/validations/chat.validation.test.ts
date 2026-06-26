import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { askQuestionSchema } from "./chat.validation";

const objectId = "665f2a9d2a5b6f0012a67890";
const otherObjectId = "665f2a9d2a5b6f0012a67891";

describe("chat validation", () => {
  it("accepts document set scope with documentIds", () => {
    const result = askQuestionSchema.safeParse({
      body: {
        question: "Compare these documents",
        documentIds: [objectId, otherObjectId],
        subjectId: objectId,
        scope: "document_set",
        mode: "basic",
      },
    });

    assert.equal(result.success, true);
  });

  it("rejects documentId and documentIds together", () => {
    const result = askQuestionSchema.safeParse({
      body: {
        question: "Compare",
        documentId: objectId,
        documentIds: [otherObjectId],
      },
    });

    assert.equal(result.success, false);
  });

  it("requires subjectId for subject_all scope", () => {
    const result = askQuestionSchema.safeParse({
      body: {
        question: "Summarize the subject",
        scope: "subject_all",
      },
    });

    assert.equal(result.success, false);
  });
});

