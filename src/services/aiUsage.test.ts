import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getCurrentPeriod, getPeriodResetAt } from "./aiUsage.service";

const utc = (iso: string): Date => new Date(`${iso}T12:00:00.000Z`);

describe("weekly quota period", () => {
  it("gives every day of one ISO week the same key", () => {
    // Monday 2026-08-03 through Sunday 2026-08-09.
    const monday = getCurrentPeriod(utc("2026-08-03"));
    const days = [
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ];

    for (const day of days) {
      assert.equal(getCurrentPeriod(utc(day)), monday, `${day} should be in ${monday}`);
    }
  });

  it("rolls over to a new key on Monday", () => {
    const sunday = getCurrentPeriod(utc("2026-08-09"));
    const nextMonday = getCurrentPeriod(utc("2026-08-10"));

    assert.notEqual(sunday, nextMonday);
  });

  it("numbers the week containing the first Thursday as week 1", () => {
    // 2026-01-01 is a Thursday, so it belongs to week 1 of 2026.
    assert.equal(getCurrentPeriod(utc("2026-01-01")), "2026-W01");
  });

  it("keeps a year-straddling week with the year owning its Thursday", () => {
    // 2026 starts on a Thursday, so it has 53 ISO weeks; the week of
    // 2026-12-28 runs into January but its Thursday (2026-12-31) is in 2026.
    assert.equal(getCurrentPeriod(utc("2026-12-31")), "2026-W53");
    assert.equal(getCurrentPeriod(utc("2027-01-01")), "2026-W53");
  });

  it("resets on the next Monday at midnight UTC", () => {
    const resetAt = getPeriodResetAt(utc("2026-08-05"));

    assert.equal(resetAt.toISOString(), "2026-08-10T00:00:00.000Z");
    assert.equal(resetAt.getUTCDay(), 1, "reset lands on a Monday");
  });

  it("gives Sunday a reset one day out, not eight", () => {
    // Off-by-one here would tell a user on Sunday that their quota resets a
    // week later than it does.
    const resetAt = getPeriodResetAt(utc("2026-08-09"));

    assert.equal(resetAt.toISOString(), "2026-08-10T00:00:00.000Z");
  });

  it("always resets into the period after the current one", () => {
    for (const day of ["2026-08-03", "2026-08-06", "2026-08-09", "2026-12-31"]) {
      const now = utc(day);
      assert.notEqual(
        getCurrentPeriod(getPeriodResetAt(now)),
        getCurrentPeriod(now),
        `reset from ${day} should start a new period`,
      );
    }
  });
});
