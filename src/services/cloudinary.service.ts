import { UploadApiResponse } from "cloudinary";
import cloudinary from "../config/cloudinary";

export const uploadPdfToCloudinary = async (
  file: Express.Multer.File,
): Promise<UploadApiResponse> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "ai-study-hub/documents",
        resource_type: "raw",
        public_id: `${Date.now()}-${file.originalname.replace(/\.[^/.]+$/, "")}`,
      },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error("Cloudinary upload failed"));
          return;
        }

        resolve(result);
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
