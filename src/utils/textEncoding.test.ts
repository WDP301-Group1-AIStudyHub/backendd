import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { repairUtf8Mojibake } from "./textEncoding";

describe("text encoding repair", () => {
  it("repairs common UTF-8 mojibake from PDF extraction", () => {
    const result = repairUtf8Mojibake(
      "Tri\u00e1\u00ba\u00bft h\u00e1\u00bb\u008dc M\u00e1\u00ba\u00afc - L\u00c3\u00aanin",
    );

    assert.equal(result.repaired, true);
    assert.equal(result.text, "Tri\u1ebft h\u1ecdc M\u1eafc - L\u00eanin");
    assert.equal(result.mojibakeScoreAfter < result.mojibakeScoreBefore, true);
  });

  it("repairs Windows-1252 decoded Vietnamese mojibake", () => {
    const result = repairUtf8Mojibake(
      "B\u00e1\u00bb\u2122 gi\u00c3\u00a1o d\u00e1\u00bb\u00a5c v\u00c3\u00a0 \u00c4\u2018\u00c3\u00a0o t\u00e1\u00ba\u00a1o",
    );

    assert.equal(result.repaired, true);
    assert.equal(result.text, "B\u1ed9 gi\u00e1o d\u1ee5c v\u00e0 \u0111\u00e0o t\u1ea1o");
  });

  it("leaves valid Vietnamese text unchanged", () => {
    const text = "Tri\u1ebft h\u1ecdc M\u1eafc - L\u00eanin";
    const result = repairUtf8Mojibake(text);

    assert.equal(result.repaired, false);
    assert.equal(result.text, text);
  });

  it("leaves ordinary English text unchanged", () => {
    const text = "Introduction to philosophy";
    const result = repairUtf8Mojibake(text);

    assert.equal(result.repaired, false);
    assert.equal(result.text, text);
  });
});
