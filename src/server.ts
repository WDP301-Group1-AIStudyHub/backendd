import dotenv from "dotenv";
import { createServer } from "node:http";
import app from "./app";
import { connectDatabase } from "./config/db";
import { initializeUploadProgressSocket } from "./services/uploadProgress.socket";
import { validateProductionPublicUrls } from "./services/publicAppUrl.service";

dotenv.config();

const startServer = async (): Promise<void> => {
  try {
    validateProductionPublicUrls();
    await connectDatabase();

    const port = Number(process.env.PORT || 5000);
    const host = process.env.HOST || "0.0.0.0";
    const server = createServer(app);

    initializeUploadProgressSocket(server);

    server.listen(port, host, () => {
      console.log(`Server running at http://${host}:${port}`);
      console.log(`Local API available at http://localhost:${port}`);
      console.log(`Swagger docs available at http://localhost:${port}/api-docs`);
      console.log(`Socket.IO listening at ws://localhost:${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
