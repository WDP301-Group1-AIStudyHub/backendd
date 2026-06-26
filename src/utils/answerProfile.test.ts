import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectAnswerProfile,
  extractSectionReference,
  shouldTreatAsSummaryIntent,
} from "./answerProfile";

describe("answer profile detection", () => {
  it("treats Vietnamese chapter content requests as detailed answers", () => {
    const profile = detectAnswerProfile("Nội dung chương 2", "qa");

    assert.equal(profile.profile, "detailed");
    assert.equal(profile.wantsDetailedAnswer, true);
    assert.equal(profile.sectionReference?.keyword, "chuong");
    assert.equal(profile.sectionReference?.numericValue, 2);
    assert.equal(shouldTreatAsSummaryIntent("qa", profile), true);
  });

  it("recognizes Roman-numbered Vietnamese chapter summaries", () => {
    const reference = extractSectionReference("Tóm tắt Chương II");
    const profile = detectAnswerProfile("Tóm tắt Chương II", "unknown");

    assert.equal(reference?.numericValue, 2);
    assert.equal(profile.profile, "detailed");
    assert.equal(shouldTreatAsSummaryIntent("unknown", profile), true);
  });

  it("keeps specific fact questions in standard mode", () => {
    const profile = detectAnswerProfile("Ai là tác giả?", "qa");

    assert.equal(profile.profile, "standard");
    assert.equal(profile.wantsDetailedAnswer, false);
    assert.equal(shouldTreatAsSummaryIntent("qa", profile), false);
  });

  it("honors explicit short-answer requests", () => {
    const profile = detectAnswerProfile("Trả lời ngắn gọn nội dung chương 2", "summary");

    assert.equal(profile.profile, "brief");
    assert.equal(profile.wantsShortAnswer, true);
    assert.equal(profile.wantsDetailedAnswer, false);
  });
});
