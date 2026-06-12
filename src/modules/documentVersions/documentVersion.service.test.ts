import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { StudyDocument } from "../documents/document.model";
import { Subject } from "../subjects/subject.model";
import { UploadSession } from "../uploadSessions/uploadSession.model";
import { DocumentVersion } from "./documentVersion.model";
import {
  activateDocumentVersion,
  deleteDocumentVersion,
  getDocumentVersions,
  reindexDocumentVersion,
  uploadDocumentVersion,
} from "./documentVersion.service";

const originalDocumentFindOne = StudyDocument.findOne;
const originalDocumentUpdateOne = StudyDocument.updateOne;
const originalSubjectFindOne = Subject.findOne;
const originalVersionFindOne = DocumentVersion.findOne;
const originalVersionCreate = DocumentVersion.create;
const originalVersionUpdateMany = DocumentVersion.updateMany;
const originalVersionFind = DocumentVersion.find;
const originalVersionCountDocuments = DocumentVersion.countDocuments;
const originalSessionCreate = UploadSession.create;
const originalSessionUpdateOne = UploadSession.updateOne;

const ownerId = new Types.ObjectId();
const otherUserId = new Types.ObjectId();
const documentId = new Types.ObjectId();

type FakeDocument = {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  subjectId: Types.ObjectId;
  visibility: "PUBLIC" | "PRIVATE";
  status: "ACTIVE" | "ARCHIVED" | "DELETED";
  currentVersionId?: Types.ObjectId;
  totalVersions: number;
  totalChunks: number;
  [key: string]: unknown;
};

type FakeVersion = {
  _id: Types.ObjectId;
  documentId: Types.ObjectId | string;
  versionNumber: number;
  uploadMode: "OVERRIDE" | "APPEND";
  fileUrl: string;
  filePublicId: string;
  fileName: string;
  originalFileName: string;
  storedFileName: string;
  fileType: string;
  mimeType: string;
  fileSize: number;
  fileExtension: string;
  extractedText: string;
  extractionStatus: "PENDING" | "COMPLETED" | "FAILED";
  extractionError: string;
  processingStatus: "PENDING" | "PROCESSING" | "INDEXED" | "FAILED";
  processingStage: string;
  processingProgress: number;
  uploadSessionId?: Types.ObjectId;
  totalChunks: number;
  uploadedBy: Types.ObjectId;
  isActive: boolean;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  save: () => Promise<void>;
  [key: string]: unknown;
};

type FakeSession = {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  documentId: Types.ObjectId | string;
  versionId: Types.ObjectId;
  status: string;
  stage: string;
  progress: number;
  message?: string;
  save: () => Promise<void>;
};

const makeFile = (): Express.Multer.File =>
  ({
    originalname: "lecture.pdf",
    mimetype: "application/pdf",
    size: 1234,
    buffer: Buffer.from("content"),
  }) as Express.Multer.File;

const baseDocument = (): FakeDocument => ({
  _id: documentId,
  ownerId,
  subjectId: new Types.ObjectId(),
  visibility: "PRIVATE",
  status: "ACTIVE",
  totalVersions: 0,
  totalChunks: 0,
});

let documents: FakeDocument[];
let versions: FakeVersion[];
let sessions: FakeSession[];
let emittedEvents: Array<{ event: string; progress: number }> = [];
let upsertedChunks = 0;
let deletedChunks = 0;

const matches = (
  record: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean =>
  Object.entries(filter).every(([key, value]) => {
    if (key === "$or") {
      return (value as Record<string, unknown>[]).some((orFilter) =>
        matches(record, orFilter),
      );
    }

    if (key === "status" && typeof value === "object" && value && "$ne" in value) {
      return record.status !== (value as { $ne: unknown }).$ne;
    }

    if (key === "deletedAt") {
      return (record.deletedAt ?? null) === value;
    }

    return record[key]?.toString() === value?.toString();
  });

const makeVersion = (payload: Record<string, unknown>): FakeVersion => ({
  _id: new Types.ObjectId(),
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
  extractedText: "",
  extractionStatus: "PENDING",
  extractionError: "",
  processingStatus: "PENDING",
  processingStage: "UPLOADED",
  processingProgress: 0,
  totalChunks: 0,
  save: async () => undefined,
  ...payload,
}) as FakeVersion;

const installMocks = (): void => {
  StudyDocument.findOne = (async (filter: Record<string, unknown>) =>
    documents.find((document) => matches(document, filter)) || null) as typeof StudyDocument.findOne;
  StudyDocument.updateOne = (async (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ) => {
    const document = documents.find((item) => matches(item, filter));

    if (document) {
      Object.assign(document, update.$set || {});

      if (update.$inc) {
        Object.entries(update.$inc as Record<string, number>).forEach(
          ([key, increment]) => {
            document[key] = Number(document[key] || 0) + increment;
          },
        );
      }
    }

    return { modifiedCount: document ? 1 : 0 };
  }) as typeof StudyDocument.updateOne;
  Subject.findOne = (() => {
    const query = {
      select: () => Promise.resolve({ name: "PRM392" }),
    };

    return query;
  }) as unknown as typeof Subject.findOne;
  DocumentVersion.create = (async (payload: Record<string, unknown>) => {
    const version = makeVersion(payload);

    versions.push(version);

    return version;
  }) as typeof DocumentVersion.create;
  DocumentVersion.updateMany = (async (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ) => {
    versions
      .filter((version) => matches(version, filter))
      .forEach((version) => Object.assign(version, update.$set || {}));

    return { modifiedCount: versions.length };
  }) as typeof DocumentVersion.updateMany;
  DocumentVersion.findOne = ((filter: Record<string, unknown>) => {
    const query = {
      sort: (sort: Record<string, number>) => {
        const matched = versions.filter((version) => matches(version, filter));
        const direction = sort.versionNumber || -1;

        return Promise.resolve(
          matched.sort((a, b) =>
            direction < 0
              ? b.versionNumber - a.versionNumber
              : a.versionNumber - b.versionNumber,
          )[0] || null,
        );
      },
      select: () => query,
      then: (
        resolve: (value: FakeVersion | null) => void,
        reject: (reason?: unknown) => void,
      ) =>
        Promise.resolve(
          versions.find((version) => matches(version, filter)) || null,
        ).then(resolve, reject),
    };

    return query;
  }) as unknown as typeof DocumentVersion.findOne;
  DocumentVersion.find = ((filter: Record<string, unknown>) => {
    const query = {
      select: () => query,
      sort: () => query,
      skip: () => query,
      limit: () =>
        Promise.resolve(versions.filter((version) => matches(version, filter))),
    };

    return query;
  }) as unknown as typeof DocumentVersion.find;
  DocumentVersion.countDocuments = (async (filter: Record<string, unknown>) =>
    versions.filter((version) => matches(version, filter)).length) as typeof DocumentVersion.countDocuments;
  UploadSession.create = (async (payload: Record<string, unknown>) => {
    const session = {
      _id: new Types.ObjectId(),
      save: async () => undefined,
      ...payload,
    } as FakeSession;

    sessions.push(session);

    return session;
  }) as typeof UploadSession.create;
  UploadSession.updateOne = (async (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ) => {
    const session = sessions.find((item) => matches(item, filter));

    if (session) {
      Object.assign(session, update.$set || {});
    }

    return { modifiedCount: session ? 1 : 0 };
  }) as typeof UploadSession.updateOne;
};

const dependencies = {
  uploadFile: async () => ({
    result: {
      secure_url: "https://cdn.test/lecture.pdf",
      public_id: "documents/lecture.pdf",
    },
    originalFileName: "lecture.pdf",
    storedFileName: "lecture.pdf",
    fileExtension: ".pdf",
    mimeType: "application/pdf",
  }),
  reindexDocument: async () => ({
    documentId: documentId.toString(),
    deletedVectorCount: 0,
    chunksCreated: 2,
    detectedSections: [],
    upsertedVectorCount: 2,
  }),
  extractText: async () => ({ extractedText: "Introduction\nReact hooks" }),
  chunkText: async (text: string) => ({
    chunkingStrategy: "heading",
    chunks: [
      {
        chunkIndex: 0,
        content: text,
        metadata: {
          heading: "Introduction",
          sectionTitle: "Introduction",
          sectionIndex: 0,
          contentLength: text.length,
          chunkingStrategy: "heading",
          textLength: text.length,
          section: "Introduction",
          inferredSection: "",
          semanticSectionLabel: "",
        },
      },
    ],
  }),
  upsertChunks: async (chunks: unknown[]) => {
    upsertedChunks += chunks.length;

    return chunks.length;
  },
  deleteChunks: async () => {
    deletedChunks += 1;

    return { deletedVectorCount: 1 };
  },
  emitProgress: (event: string, payload: { progress: number }) => {
    emittedEvents.push({ event, progress: payload.progress });
  },
} as never;

beforeEach(() => {
  documents = [baseDocument()];
  versions = [];
  sessions = [];
  emittedEvents = [];
  upsertedChunks = 0;
  deletedChunks = 0;
  installMocks();
});

afterEach(() => {
  StudyDocument.findOne = originalDocumentFindOne;
  StudyDocument.updateOne = originalDocumentUpdateOne;
  Subject.findOne = originalSubjectFindOne;
  DocumentVersion.findOne = originalVersionFindOne;
  DocumentVersion.create = originalVersionCreate;
  DocumentVersion.updateMany = originalVersionUpdateMany;
  DocumentVersion.find = originalVersionFind;
  DocumentVersion.countDocuments = originalVersionCountDocuments;
  UploadSession.create = originalSessionCreate;
  UploadSession.updateOne = originalSessionUpdateOne;
});

describe("document version service", () => {
  it("upload version processes synchronously and returns INDEXED", async () => {
    const result = await uploadDocumentVersion(
      documentId.toString(),
      ownerId.toString(),
      { uploadMode: "OVERRIDE" },
      makeFile(),
      { dependencies },
    );

    assert.equal(result.versionNumber, 1);
    assert.equal(result.processingStatus, "INDEXED");
    assert.equal(result.processingProgress, 100);
    assert.equal(result.extractionStatus, "COMPLETED");
    assert.equal(upsertedChunks, 1);
  });

  it("creates upload session", async () => {
    await uploadDocumentVersion(documentId.toString(), ownerId.toString(), { uploadMode: "OVERRIDE" }, makeFile(), { dependencies });

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].status, "COMPLETED");
    assert.equal(sessions[0].progress, 100);
  });

  it("emits websocket progress events", async () => {
    await uploadDocumentVersion(documentId.toString(), ownerId.toString(), { uploadMode: "OVERRIDE" }, makeFile(), { dependencies });

    assert.deepEqual(
      emittedEvents.map((item) => item.event),
      [
        "upload:started",
        "upload:processing",
        "upload:extracting_text",
        "upload:chunking",
        "upload:embedding",
        "upload:indexing",
        "upload:completed",
      ],
    );
  });

  it("uploads append version with makeActive false", async () => {
    await uploadDocumentVersion(documentId.toString(), ownerId.toString(), { uploadMode: "OVERRIDE" }, makeFile(), { dependencies });
    const result = await uploadDocumentVersion(documentId.toString(), ownerId.toString(), { uploadMode: "APPEND", makeActive: false }, makeFile(), { dependencies });

    assert.equal(result.versionNumber, 2);
    assert.equal(result.isActive, false);
    assert.equal(versions[0].isActive, true);
  });

  it("gets version list", async () => {
    await uploadDocumentVersion(documentId.toString(), ownerId.toString(), { uploadMode: "OVERRIDE" }, makeFile(), { dependencies });
    const result = await getDocumentVersions(documentId.toString(), ownerId.toString());

    assert.equal(result.data.length, 1);
    assert.equal(result.pagination.totalItems, 1);
  });

  it("activates an old version", async () => {
    const first = await uploadDocumentVersion(documentId.toString(), ownerId.toString(), { uploadMode: "OVERRIDE" }, makeFile(), { dependencies });
    await uploadDocumentVersion(documentId.toString(), ownerId.toString(), { uploadMode: "OVERRIDE" }, makeFile(), { dependencies });
    versions[0].processingStatus = "INDEXED";
    versions[0].extractedText = "ready";
    const result = await activateDocumentVersion(documentId.toString(), first.id, ownerId.toString(), { skipReindex: true });

    assert.equal(result.id, first.id);
    assert.equal(result.isActive, true);
  });

  it("does not delete active version", async () => {
    const uploaded = await uploadDocumentVersion(documentId.toString(), ownerId.toString(), { uploadMode: "OVERRIDE" }, makeFile(), { dependencies });

    await assert.rejects(
      () => deleteDocumentVersion(documentId.toString(), uploaded.id, ownerId.toString()),
      /CANNOT_DELETE_ACTIVE_VERSION/,
    );
  });

  it("does not upload to archived documents", async () => {
    documents[0].status = "ARCHIVED";

    await assert.rejects(
      () => uploadDocumentVersion(documentId.toString(), ownerId.toString(), { uploadMode: "OVERRIDE" }, makeFile(), { dependencies }),
      /CANNOT_UPLOAD_TO_ARCHIVED_DOCUMENT/,
    );
  });

  it("denies private document version access for non-owner", async () => {
    await uploadDocumentVersion(documentId.toString(), ownerId.toString(), { uploadMode: "OVERRIDE" }, makeFile(), { dependencies });

    await assert.rejects(
      () => getDocumentVersions(documentId.toString(), otherUserId.toString()),
      /DOCUMENT_NOT_FOUND/,
    );
  });

  it("allows public viewers to see active version metadata only", async () => {
    documents[0].visibility = "PUBLIC";
    await uploadDocumentVersion(documentId.toString(), ownerId.toString(), { uploadMode: "OVERRIDE" }, makeFile(), { dependencies });
    await uploadDocumentVersion(documentId.toString(), ownerId.toString(), { uploadMode: "APPEND", makeActive: false }, makeFile(), { dependencies });
    const result = await getDocumentVersions(documentId.toString(), otherUserId.toString());

    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].isActive, true);
  });

  it("reindex endpoint processes synchronously", async () => {
    const uploaded = await uploadDocumentVersion(documentId.toString(), ownerId.toString(), { uploadMode: "OVERRIDE" }, makeFile(), { dependencies });
    const result = await reindexDocumentVersion(documentId.toString(), uploaded.id, ownerId.toString(), { dependencies });

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.progress, 100);
    assert.equal(deletedChunks, 1);
  });

  it("marks version failed and emits failed when extraction fails", async () => {
    const failingDependencies = {
      ...(dependencies as Record<string, unknown>),
      extractText: async () => {
        throw new Error("Cannot parse file");
      },
    } as never;

    await assert.rejects(
      () => uploadDocumentVersion(documentId.toString(), ownerId.toString(), { uploadMode: "OVERRIDE" }, makeFile(), { dependencies: failingDependencies }),
      /DOCUMENT_PROCESSING_FAILED/,
    );
    assert.equal(versions[0].processingStatus, "FAILED");
    assert.equal(emittedEvents[emittedEvents.length - 1]?.event, "upload:failed");
  });
});
