import dotenv from "dotenv";
import app from "./app";
import { connectDatabase } from "./config/db";

dotenv.config();

const startServer = async (): Promise<void> => {
  try {
    await connectDatabase();

    const port = process.env.PORT || "5000";

    app.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
      console.log(`Swagger docs available at http://localhost:${port}/api-docs`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
