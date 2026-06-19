import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeDocumentStructure,
  detectStructuralQuestion,
  getStructureNotFoundAnswer,
} from "./documentStructure";
import { splitTextForRag } from "./textSplitter";

describe("document structure utilities", () => {
  it("detects Vietnamese chapter count questions", () => {
    assert.deepEqual(detectStructuralQuestion("Tài liệu này có mấy chương?"), {
      unit: "chapter",
    });
    assert.deepEqual(detectStructuralQuestion("Có bao nhiêu phần trong tài liệu?"), {
      unit: "part",
    });
    assert.deepEqual(detectStructuralQuestion("How many sections are in this document?"), {
      unit: "section",
    });
  });

  it("does not treat specific chapter content questions as structure counts", () => {
    assert.equal(detectStructuralQuestion("Nội dung chương 2 là gì?"), null);
    assert.equal(detectStructuralQuestion("Tóm tắt phần III"), null);
  });

  it("counts detected chapters, parts, and sections", async () => {
    const chunkingResult = await splitTextForRag(`
Chương 1 Tổng quan
Nội dung chương một.

Chương 2 Cơ sở lý thuyết
Nội dung chương hai.

Phần I Bài tập
Nội dung phần bài tập.

Section 3 Appendix
Nội dung phụ lục.
`);

    const structure = analyzeDocumentStructure(chunkingResult);

    assert.equal(structure.chapterCount, 2);
    assert.equal(structure.partCount, 1);
    assert.equal(structure.sectionCount, 1);
    assert.deepEqual(structure.chapterSections, [
      "Chương 1 Tổng quan",
      "Chương 2 Cơ sở lý thuyết",
    ]);
  });

  it("deduplicates table-of-contents chapter labels and real chapter headings", async () => {
    const chunkingResult = await splitTextForRag(`
Chuong I
Muc luc tom tat.

Chuong II
Muc luc tom tat.

Chuong III
Muc luc tom tat.

Chuong IV
Muc luc tom tat.

Chuong V
Muc luc tom tat.

Chuong VI
Muc luc tom tat.

Chuong VII
Muc luc tom tat.

Chuong VIII
Muc luc tom tat.

Chuong IX
Muc luc tom tat.

Chuong X
Muc luc tom tat.

Chuong XI
Muc luc tom tat.

Chuong XII
Muc luc tom tat.

Chuong XIII
Muc luc tom tat.

Chuong XIV
Muc luc tom tat.

Chuong I: Khai luoc ve triet hoc
Noi dung chuong mot.

Chuong II: Khai luoc ve lich su triet hoc truoc Mac
Noi dung chuong hai.

Chuong III: Su ra doi va phat trien cua triet hoc Mac - Lenin
Noi dung chuong ba.

Chuong IV: Mot so trao luu triet hoc phuong Tay hien dai
Noi dung chuong bon.

Chuong V: Vat chat va y thuc
Noi dung chuong nam.

Chuong VI: Hai nguyen ly cua phep bien chung duy vat
Noi dung chuong sau.

Chuong VII: Nhung cap pham tru co ban cua phep bien chung duy vat
Noi dung chuong bay.

Chuong VIII: Nhung quy luat co ban cua phep bien chung duy vat
Noi dung chuong tam.

Chuong IX: Ly luan nhan thuc
Noi dung chuong chin.

Chuong X: Hinh thai kinh te - xa hoi
Noi dung chuong muoi.

Chuong XI: Giai cap va dan toc
Noi dung chuong muoi mot.

Chuong XII: Nha nuoc va cach mang xa hoi
Noi dung chuong muoi hai.

Chuong XIII: y thuc xa hoi
Noi dung chuong muoi ba.
`);

    const structure = analyzeDocumentStructure(chunkingResult);

    assert.equal(structure.chapterCount, 14);
    assert.equal(structure.chapterSections[0], "Chuong I: Khai luoc ve triet hoc");
    assert.equal(structure.chapterSections[13], "Chuong XIV");
  });

  it("does not count General Content as a real section", async () => {
    const chunkingResult = await splitTextForRag(
      "Đây là một đoạn văn bình thường không có heading rõ ràng.",
    );
    const structure = analyzeDocumentStructure(chunkingResult);

    assert.equal(structure.chunkingStrategy, "fixed-size-fallback");
    assert.equal(structure.chapterCount, 0);
    assert.equal(structure.partCount, 0);
    assert.equal(structure.sectionCount, 0);
    assert.equal(
      getStructureNotFoundAnswer("chapter"),
      "Không tìm thấy thông tin về số chương trong tài liệu này. Có thể tài liệu chưa chứa thông tin này hoặc câu hỏi quá chung chung. Bạn có thể thử hỏi cụ thể hơn về nội dung của tài liệu hoặc kiểm tra lại tài liệu để đảm bảo thông tin cần thiết đã được cập nhật.",
    );
  });
});
