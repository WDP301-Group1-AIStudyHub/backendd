import cors from "cors";
import express, { Request, Response } from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./config/swagger";
import authRoutes from "./routes/auth.routes";
import benchmarkRoutes from "./routes/benchmark.routes";
import chatRoutes from "./routes/chat.routes";
import debugRoutes from "./routes/debug.routes";
import documentRoutes from "./routes/document.routes";
import evaluationRoutes from "./routes/evaluation.routes";
import subjectRoutes from "./routes/subject.routes";
import studyMaterialRoutes from "./routes/studyMaterial.routes";
import adminRoutes from "./routes/admin.routes";
import { uploadSessionRouter } from "./modules/uploadSessions/uploadSession.routes";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware";

const app = express();

app.set("trust proxy", true); // Enable trusting proxy to get real IP

const allowedOrigins = new Set(
  [
    process.env.CLIENT_URL,
    process.env.FRONTEND_URL,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://localhost:19006",
    "http://127.0.0.1:19006",
  ].filter(Boolean),
);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "AI Study Hub API is running",
    endpoints: {
      health: "/health",
      docs: "/api-docs",
      api: "/api",
    },
  });
});

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "AI Study Hub API is running",
  });
});

app.get("/api-docs.json", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json");
  res.status(200).json(swaggerSpec);
});
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use("/api/auth", authRoutes);
app.use("/api/benchmark", benchmarkRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/debug", debugRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/evaluation", evaluationRoutes);
app.use("/api/subjects", subjectRoutes);
app.use("/api/upload-sessions", uploadSessionRouter);
app.use("/api/study-materials", studyMaterialRoutes);
app.use("/api/admin", adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
