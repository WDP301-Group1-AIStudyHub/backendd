import multer from "multer";
import { AppError } from "./error.middleware";
import {
  getSupportedDocumentTypesLabel,
  isSupportedDocument,
} from "../services/documentExtraction/extractDocumentText";

const storage = multer.memoryStorage();

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!isSupportedDocument(file.mimetype, file.originalname)) {
      cb(
        new AppError(
          `Only ${getSupportedDocumentTypesLabel()} files are allowed`,
          400,
        ),
      );
      return;
    }

    cb(null, true);
  },
});
