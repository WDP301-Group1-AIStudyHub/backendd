const MOJIBAKE_MARKER_REGEX =
  /[\u00c2\u00c3\u00c4\u00c5\u00c6]|\u00e1[\u00ba\u00bb]/g;
const REPLACEMENT_CHARACTER_REGEX = /\uFFFD/g;
const VIETNAMESE_DIACRITIC_REGEX =
  /[\u00c0-\u1ef9\u0102\u0103\u0110\u0111\u0128\u0129\u0168\u0169\u01a0\u01a1\u01af\u01b0]/g;
const WINDOWS_1252_REVERSE_MAP = new Map<string, number>([
  ["\u20ac", 0x80],
  ["\u201a", 0x82],
  ["\u0192", 0x83],
  ["\u201e", 0x84],
  ["\u2026", 0x85],
  ["\u2020", 0x86],
  ["\u2021", 0x87],
  ["\u02c6", 0x88],
  ["\u2030", 0x89],
  ["\u0160", 0x8a],
  ["\u2039", 0x8b],
  ["\u0152", 0x8c],
  ["\u017d", 0x8e],
  ["\u2018", 0x91],
  ["\u2019", 0x92],
  ["\u201c", 0x93],
  ["\u201d", 0x94],
  ["\u2022", 0x95],
  ["\u2013", 0x96],
  ["\u2014", 0x97],
  ["\u02dc", 0x98],
  ["\u2122", 0x99],
  ["\u0161", 0x9a],
  ["\u203a", 0x9b],
  ["\u0153", 0x9c],
  ["\u017e", 0x9e],
  ["\u0178", 0x9f],
]);

export interface TextEncodingRepairResult {
  text: string;
  repaired: boolean;
  mojibakeScoreBefore: number;
  mojibakeScoreAfter: number;
}

const countMatches = (text: string, regex: RegExp): number =>
  text.match(regex)?.length ?? 0;

const scoreMojibake = (text: string): number =>
  countMatches(text, MOJIBAKE_MARKER_REGEX) +
  countMatches(text, REPLACEMENT_CHARACTER_REGEX) * 3;

const countVietnameseDiacritics = (text: string): number =>
  countMatches(text, VIETNAMESE_DIACRITIC_REGEX);

const decodeAsUtf8FromWindows1252 = (text: string): string | null => {
  const bytes: number[] = [];

  for (const character of text) {
    const codePoint = character.codePointAt(0);

    if (codePoint === undefined) {
      continue;
    }

    if (codePoint <= 0xff) {
      bytes.push(codePoint);
      continue;
    }

    const mappedByte = WINDOWS_1252_REVERSE_MAP.get(character);

    if (mappedByte === undefined) {
      return null;
    }

    bytes.push(mappedByte);
  }

  return Buffer.from(bytes).toString("utf8");
};

export const repairUtf8Mojibake = (
  text: string,
): TextEncodingRepairResult => {
  const mojibakeScoreBefore = scoreMojibake(text);

  if (mojibakeScoreBefore === 0) {
    return {
      text,
      repaired: false,
      mojibakeScoreBefore,
      mojibakeScoreAfter: mojibakeScoreBefore,
    };
  }

  const repairedText =
    decodeAsUtf8FromWindows1252(text) ??
    Buffer.from(text, "latin1").toString("utf8");
  const mojibakeScoreAfter = scoreMojibake(repairedText);
  const vietnameseGain =
    countVietnameseDiacritics(repairedText) - countVietnameseDiacritics(text);

  if (
    mojibakeScoreAfter < mojibakeScoreBefore &&
    (vietnameseGain > 0 || mojibakeScoreAfter === 0)
  ) {
    return {
      text: repairedText,
      repaired: true,
      mojibakeScoreBefore,
      mojibakeScoreAfter,
    };
  }

  return {
    text,
    repaired: false,
    mojibakeScoreBefore,
    mojibakeScoreAfter: mojibakeScoreBefore,
  };
};
