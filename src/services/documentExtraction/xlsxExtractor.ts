import * as XLSX from "xlsx";
import { ExtractedDocument } from "./types";

export const extractXlsxDocument = async (
  buffer: Buffer,
): Promise<ExtractedDocument> => {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetTexts = workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(worksheet, {
      header: 1,
      raw: false,
      defval: "",
    });
    const rowTexts = rows
      .map((row) =>
        row
          .map((cell) => String(cell).trim())
          .filter(Boolean)
          .join(" | "),
      )
      .filter(Boolean);

    return [`Sheet: ${sheetName}`, ...rowTexts].join("\n");
  });

  return {
    extractedText: sheetTexts.filter(Boolean).join("\n\n"),
    metadata: {
      parser: "xlsx",
      sheetNames: workbook.SheetNames,
    },
  };
};
