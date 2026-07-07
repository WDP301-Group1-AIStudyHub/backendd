/**
 * Helper to call the self-hosted MarkItDown FastAPI microservice.
 * Forwards the file buffer as multipart/form-data and returns the converted markdown text.
 */
export async function convertToMarkdown(fileBuffer: Buffer, fileName: string): Promise<string> {
  const parserUrl = process.env.PARSER_SERVICE_URL || "http://localhost:8000";

  console.log(`[markitdownService] Initiating document conversion request to: ${parserUrl}/convert`, {
    fileName,
    bufferSize: fileBuffer.length
  });

  // Create form data using Node.js global FormData / Blob
  const formData = new FormData();
  const blob = new Blob([fileBuffer as any]);
  formData.append("file", blob as any, fileName);

  const startTime = Date.now();
  const response = await fetch(`${parserUrl}/convert`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[markitdownService] Microservice returned error response`, {
      status: response.status,
      errorBody
    });
    throw new Error(`MarkItDown microservice error (status ${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as { markdown: string };
  console.log(`[markitdownService] Microservice conversion completed successfully in ${Date.now() - startTime}ms`, {
    markdownLength: data.markdown.length
  });
  return data.markdown;
}
