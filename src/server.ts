import dotenv from "dotenv";
import { createServer } from "node:http";
import app from "./app";
import { connectDatabase } from "./config/db";
import { initializeUploadProgressSocket } from "./services/uploadProgress.socket";

dotenv.config();

const startServer = async (): Promise<void> => {
  try {
    await connectDatabase();

    const port = process.env.PORT || "5000";
    const server = createServer(app);

    initializeUploadProgressSocket(server);

    server.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
      console.log(`Swagger docs available at http://localhost:${port}/api-docs`);
      console.log(`Socket.IO listening at ws://localhost:${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
