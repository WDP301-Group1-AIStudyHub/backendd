import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { AppError } from "../../middlewares/error.middleware";
import { DocumentShare } from "./documentShare.model";
import { DocumentShareInvitation } from "./documentShareInvitation.model";
import { StudyDocument } from "../documents/document.model";
import {
  claimDocumentShareInvitations,
  validateDocumentShareInvitation,
} from "./documentShareInvitation.service";

const originalInvitationFindOne = DocumentShareInvitation.findOne;
const originalInvitationFind = DocumentShareInvitation.find;
const originalInvitationDeleteMany = DocumentShareInvitation.deleteMany;
const originalShareFindOneAndUpdate = DocumentShare.findOneAndUpdate;
const originalDocumentExists = StudyDocument.exists;

afterEach(() => {
  DocumentShareInvitation.findOne = originalInvitationFindOne;
  DocumentShareInvitation.find = originalInvitationFind;
  DocumentShareInvitation.deleteMany = originalInvitationDeleteMany;
  DocumentShare.findOneAndUpdate = originalShareFindOneAndUpdate;
  StudyDocument.exists = originalDocumentExists;
});

describe("document share invitation service", () => {
  it("rejects an invalid or expired invitation token", async () => {
    DocumentShareInvitation.findOne = (() => ({
      select: async () => null,
    })) as unknown as typeof DocumentShareInvitation.findOne;

    await assert.rejects(
      () => validateDocumentShareInvitation("invitee@example.com", "bad-token"),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 400 &&
        error.message.includes("không hợp lệ"),
    );
  });

  it("claims a valid invitation and removes the pending record", async () => {
    const invitationId = new Types.ObjectId();
    const documentId = new Types.ObjectId();
    const sharedBy = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const invitation = {
      _id: invitationId,
      documentId,
      sharedBy,
      permission: "EDIT",
    };
    let shareUpdate: unknown;
    let invitationDelete: unknown;

    DocumentShareInvitation.find = (() => ({
      sort: async () => [invitation],
    })) as unknown as typeof DocumentShareInvitation.find;
    StudyDocument.exists = (async () => ({
      _id: documentId,
    })) as unknown as typeof StudyDocument.exists;
    DocumentShare.findOneAndUpdate = (async (...args: unknown[]) => {
      shareUpdate = args;
      return {};
    }) as unknown as typeof DocumentShare.findOneAndUpdate;
    DocumentShareInvitation.deleteMany = (async (filter: unknown) => {
      invitationDelete = filter;
      return { acknowledged: true, deletedCount: 1 };
    }) as typeof DocumentShareInvitation.deleteMany;

    const redirectDocumentId = await claimDocumentShareInvitations(
      "invitee@example.com",
      userId.toString(),
      "valid-token",
    );

    assert.equal(redirectDocumentId, documentId.toString());
    assert.ok(Array.isArray(shareUpdate));
    assert.deepEqual(invitationDelete, { _id: { $in: [invitationId] } });
  });
});
