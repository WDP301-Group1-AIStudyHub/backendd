import multer from "multer";
import { AppError } from "./error.middleware";

const storage = multer.memoryStorage();

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      cb(new AppError("Only PDF files are allowed", 400));
      return;
    }

    cb(null, true);
  },
});
