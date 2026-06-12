import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";

type UploadProgressStatus = "processing" | "completed" | "failed";

export interface UploadProgressPayload {
  documentId: string;
  uploadSessionId?: string;
  versionId?: string;
  status: UploadProgressStatus;
  step: string;
  progress: number;
  message: string;
}

let io: Server | null = null;

const buildRoomNames = (
  documentId: string,
  uploadSessionId?: string,
): string[] => [
  `document:${documentId}`,
  ...(uploadSessionId ? [`upload-session:${uploadSessionId}`] : []),
];

export const initializeUploadProgressSocket = (
  server: HttpServer,
): Server => {
  io = new Server(server, {
    cors: {
      origin:
        process.env.CLIENT_URL ||
        process.env.FRONTEND_URL ||
        "http://localhost:5173",
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    socket.on("join:document", (documentId: string) => {
      if (documentId) {
        socket.join(`document:${documentId}`);
      }
    });

    socket.on("join:upload-session", (uploadSessionId: string) => {
      if (uploadSessionId) {
        socket.join(`upload-session:${uploadSessionId}`);
      }
    });
  });

  return io;
};

export const emitUploadProgress = (
  event: string,
  payload: UploadProgressPayload,
): void => {
  if (!io) {
    return;
  }

  buildRoomNames(payload.documentId, payload.uploadSessionId).forEach((room) => {
    io?.to(room).emit(event, payload);
  });
};
