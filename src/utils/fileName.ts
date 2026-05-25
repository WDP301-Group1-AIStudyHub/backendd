const getBaseName = (fileName: string): string => {
  const normalized = fileName.split(/[\\/]/).pop() ?? "document";
  const extensionIndex = normalized.lastIndexOf(".");

  if (extensionIndex <= 0) {
    return normalized;
  }

  return normalized.slice(0, extensionIndex);
};

export const getFileExtension = (fileName: string): string => {
  const normalized = fileName.split(/[\\/]/).pop() ?? "";
  const extensionIndex = normalized.lastIndexOf(".");

  if (extensionIndex <= 0 || extensionIndex === normalized.length - 1) {
    return "";
  }

  return normalized.slice(extensionIndex).toLowerCase();
};

const sanitizeFileNamePart = (value: string, fallback: string): string => {
  const safeValue = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .replace(/^-+|-+$/g, "");

  return safeValue || fallback;
};

export const generateSafeFileName = (originalName: string): string => {
  const baseName = sanitizeFileNamePart(getBaseName(originalName), "document");
  const extension = sanitizeFileNamePart(
    getFileExtension(originalName).replace(/^\./, ""),
    "",
  );
  const safeExtension = extension ? `.${extension}` : "";

  // Keep the original extension in the Cloudinary public id so raw download
  // URLs preserve the file type, while sanitizing the user-provided name.
  return `${Date.now()}-${baseName}${safeExtension}`;
};
