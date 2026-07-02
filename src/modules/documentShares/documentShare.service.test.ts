import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { AppError } from "../../middlewares/error.middleware";
import { User } from "../../models/user.model";
import * as emailService from "../../services/email.service";
import { StudyDocument } from "../documents/document.model";
import { DocumentShare } from "./documentShare.model";
import { DocumentShareInvitation } from "./documentShareInvitation.model";
import {
  assertRoleHasAccess,
  createOrUpdateDocumentShare,
  permissionToAccessRole,
  revokeDocumentShare,
  updateDocumentSharePermission,
} from "./documentShare.service";

const originalDocumentFindOne = StudyDocument.findOne;
const originalUserFindOne = User.findOne;
const originalUserFindById = User.findById;
const originalShareFindOne = DocumentShare.findOne;
const originalShareDeleteOne = DocumentShare.deleteOne;
const originalInvitationFindOneAndUpdate = DocumentShareInvitation.findOneAndUpdate;
const originalInvitationFindOne = DocumentShareInvitation.findOne;
const originalInvitationDeleteOne = DocumentShareInvitation.deleteOne;
const originalSendDocumentShareEmail = emailService.sendDocumentShareEmail;

afterEach(() => {
  StudyDocument.findOne = originalDocumentFindOne;
  User.findOne = originalUserFindOne;
  User.findById = originalUserFindById;
  DocumentShare.findOne = originalShareFindOne;
  DocumentShare.deleteOne = originalShareDeleteOne;
  DocumentShareInvitation.findOneAndUpdate = originalInvitationFindOneAndUpdate;
  DocumentShareInvitation.findOne = originalInvitationFindOne;
  DocumentShareInvitation.deleteOne = originalInvitationDeleteOne;
  (
    emailService as unknown as {
      sendDocumentShareEmail: typeof emailService.sendDocumentShareEmail;
    }
  ).sendDocumentShareEmail = originalSendDocumentShareEmail;
});

const ownerId = new Types.ObjectId();
const recipientId = new Types.ObjectId();
const documentId = new Types.ObjectId();
const shareId = new Types.ObjectId();

const fakeDocument = {
  _id: documentId,
  ownerId,
  title: "Shared handbook",
  status: "ACTIVE",
};

const fakeRecipient = {
  _id: recipientId,
  fullName: "Recipient User",
  email: "recipient@example.com",
  avatar: "",
};

const fakeSender = {
  _id: ownerId,
  fullName: "Owner User",
  email: "owner@example.com",
  avatar: "",
};

const createSelectQuery = <T>(value: T) => ({
  select: async () => value,
});

describe("document share service", () => {
  it("maps share permissions to access roles and blocks viewer edits", () => {
    assert.equal(permissionToAccessRole("VIEW"), "VIEWER");
    assert.equal(permissionToAccessRole("EDIT"), "EDITOR");
    assert.throws(
      () => assertRoleHasAccess("VIEWER", "EDIT"),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 403 &&
        error.message.includes("permission"),
    );
    assert.doesNotThrow(() => assertRoleHasAccess("EDITOR", "EDIT"));
  });

  it("creates a pending invitation when the recipient is not registered", async () => {
    let emailPayload: emailService.DocumentShareEmailPayload | undefined;
    const invitation = {
      _id: new Types.ObjectId(),
      documentId,
      email: "missing@example.com",
      permission: "VIEW",
      sharedBy: ownerId,
      tokenHash: "hash",
      expiresAt: new Date("2026-07-09T00:00:00.000Z"),
      createdAt: new Date("2026-07-02T00:00:00.000Z"),
      updatedAt: new Date("2026-07-02T00:00:00.000Z"),
    };

    StudyDocument.findOne = (async () => fakeDocument) as typeof StudyDocument.findOne;
    User.findOne = (() => createSelectQuery(null)) as unknown as typeof User.findOne;
    User.findById = (() =>
      createSelectQuery(fakeSender)) as unknown as typeof User.findById;
    DocumentShareInvitation.findOneAndUpdate = (async () =>
      invitation) as unknown as typeof DocumentShareInvitation.findOneAndUpdate;
    (
      emailService as unknown as {
        sendDocumentShareEmail: typeof emailService.sendDocumentShareEmail;
      }
    ).sendDocumentShareEmail = async (payload) => {
      emailPayload = payload;
    };

    const result = await createOrUpdateDocumentShare(
      documentId.toString(),
      ownerId.toString(),
      { email: "missing@example.com", permission: "VIEW" },
    );

    assert.equal(result.status, "PENDING");
    assert.equal(result.sharedWithUser.email, "missing@example.com");
    assert.equal(emailPayload?.isInvitation, true);
    assert.match(emailPayload?.documentUrl || "", /\/register\?invite=/);
    assert.match(emailPayload?.mobileUrl || "", /^aistudyhub:\/\/register\?/);
  });

  it("updates permission and sends a notification email", async () => {
    let emailPayload: emailService.DocumentShareEmailPayload | undefined;
    const fakeShare = {
      _id: shareId,
      documentId,
      sharedWithUserId: recipientId,
      permission: "VIEW",
      sharedBy: ownerId,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      save: async () => undefined,
      populate: async function populate() {
        this.sharedWithUserId = fakeRecipient as unknown as Types.ObjectId;
        return this;
      },
    };

    StudyDocument.findOne = (async () => fakeDocument) as typeof StudyDocument.findOne;
    DocumentShare.findOne = (async () => fakeShare) as typeof DocumentShare.findOne;
    User.findById = ((id: unknown) =>
      createSelectQuery(
        id?.toString() === recipientId.toString() ? fakeRecipient : fakeSender,
      )) as unknown as typeof User.findById;
    (
      emailService as unknown as {
        sendDocumentShareEmail: typeof emailService.sendDocumentShareEmail;
      }
    ).sendDocumentShareEmail = async (payload) => {
      emailPayload = payload;
    };

    const result = await updateDocumentSharePermission(
      documentId.toString(),
      shareId.toString(),
      ownerId.toString(),
      "EDIT",
    );

    assert.equal(result.permission, "EDIT");
    assert.equal(emailPayload?.to, fakeRecipient.email);
    assert.equal(emailPayload?.permission, "EDIT");
    assert.equal(emailPayload?.isPermissionUpdate, true);
    assert.match(emailPayload?.mobileUrl || "", /^aistudyhub:\/\/document\//);
  });

  it("updates a pending invitation and sends a refreshed invite", async () => {
    let emailPayload: emailService.DocumentShareEmailPayload | undefined;
    const pendingInvitation = {
      _id: shareId,
      documentId,
      email: "pending@example.com",
      permission: "VIEW",
      sharedBy: ownerId,
      expiresAt: new Date("2026-07-09T00:00:00.000Z"),
      createdAt: new Date("2026-07-02T00:00:00.000Z"),
      updatedAt: new Date("2026-07-02T00:00:00.000Z"),
    };
    const updatedInvitation = { ...pendingInvitation, permission: "EDIT" };

    StudyDocument.findOne = (async () => fakeDocument) as typeof StudyDocument.findOne;
    DocumentShare.findOne = (async () => null) as typeof DocumentShare.findOne;
    DocumentShareInvitation.findOne = (async () =>
      pendingInvitation) as unknown as typeof DocumentShareInvitation.findOne;
    DocumentShareInvitation.findOneAndUpdate = (async () =>
      updatedInvitation) as unknown as typeof DocumentShareInvitation.findOneAndUpdate;
    User.findById = (() =>
      createSelectQuery(fakeSender)) as unknown as typeof User.findById;
    (
      emailService as unknown as {
        sendDocumentShareEmail: typeof emailService.sendDocumentShareEmail;
      }
    ).sendDocumentShareEmail = async (payload) => {
      emailPayload = payload;
    };

    const result = await updateDocumentSharePermission(
      documentId.toString(),
      shareId.toString(),
      ownerId.toString(),
      "EDIT",
    );

    assert.equal(result.status, "PENDING");
    assert.equal(result.permission, "EDIT");
    assert.equal(emailPayload?.isInvitation, true);
  });

  it("revokes an existing share", async () => {
    let deleteFilter: unknown;

    StudyDocument.findOne = (async () => fakeDocument) as typeof StudyDocument.findOne;
    DocumentShare.deleteOne = (async (filter: unknown) => {
      deleteFilter = filter;
      return { acknowledged: true, deletedCount: 1 };
    }) as typeof DocumentShare.deleteOne;
    DocumentShareInvitation.deleteOne = (async () => ({
      acknowledged: true,
      deletedCount: 0,
    })) as typeof DocumentShareInvitation.deleteOne;

    await revokeDocumentShare(
      documentId.toString(),
      shareId.toString(),
      ownerId.toString(),
    );

    assert.deepEqual(deleteFilter, {
      _id: shareId.toString(),
      documentId: documentId.toString(),
    });
  });
});
