import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

export interface DocumentChunk {
  chunkIndex: number;
  content: string;
  metadata: {
    textLength: number;
  };
}

export const splitTextIntoChunks = async (
  text: string,
): Promise<DocumentChunk[]> => {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const chunks = await splitter.splitText(text);

  return chunks
    .map((content, index) => ({
      chunkIndex: index,
      content: content.trim(),
      metadata: {
        textLength: content.trim().length,
      },
    }))
    .filter((chunk) => chunk.content.length > 0);
};
