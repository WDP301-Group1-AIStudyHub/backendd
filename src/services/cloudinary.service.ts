import { UploadApiResponse } from "cloudinary";
import cloudinary from "../config/cloudinary";
import { generateSafeFileName, getFileExtension } from "../utils/fileName";

export type CloudinaryDocumentUpload = {
  result: UploadApiResponse;
  originalFileName: string;
  storedFileName: string;
  fileExtension: string;
  mimeType: string;
};

export const uploadDocumentToCloudinary = async (
  file: Express.Multer.File,
): Promise<CloudinaryDocumentUpload> => {
  const storedFileName = generateSafeFileName(file.originalname);

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "ai-study-hub/documents",
        resource_type: "raw",
        // Cloudinary raw assets need the extension in public_id. Removing it
        // makes downloaded files lose their OS-detectable type.
        public_id: storedFileName,
      },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error("Cloudinary upload failed"));
          return;
        }

        resolve({
          result,
          originalFileName: file.originalname,
          storedFileName,
          fileExtension: getFileExtension(file.originalname),
          mimeType: file.mimetype,
        });
      },
    );

    uploadStream.end(file.buffer);
  });
};

export const deleteCloudinaryFile = async (
  publicId: string,
): Promise<void> => {
  await cloudinary.uploader.destroy(publicId, {
    resource_type: "raw",
  });
};
