import { describe, it, expect } from "vitest";
import {
  isOpen, nextOpening, pickupSlots, earliestReady, readyFitsBeforeClose,
  closeHourFor, formatTime, describeOpening, SLOT_MINUTES,
} from "../lib/hours.js";

/* Prep time is no longer a constant — it depends on what is in the cart — so
   every slot query names one. 15 is an ordinary plate, 30 is cooked to order. */
const PLATE = 15;
const SEAFOOD = 30;

// Local time, explicit — the whole point of hours.js taking `now` as an argument.
const at = (y, m, d, hh, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0);

// 2026-07-27 is a Monday, 2026-07-31 a Friday, 2026-08-01 a Saturday.
const MON = (hh, mm) => at(2026, 7, 27, hh, mm);
const FRI = (hh, mm) => at(2026, 7, 31, hh, mm);
const SAT = (hh, mm) => at(2026, 8, 1, hh, mm);

describe("closing time", () => {
  it("is 10PM Sunday through Thursday", () => {
    for (const d of [0, 1, 2, 3, 4]) expect(closeHourFor(d)).toBe(22);
  });
  it("runs to 11PM on Friday and Saturday", () => {
    expect(closeHourFor(5)).toBe(23);
    expect(closeHourFor(6)).toBe(23);
  });
});

describe("isOpen", () => {
  it("is shut before 11AM", () => expect(isOpen(MON(10, 59))).toBe(false));
  it("opens at 11AM sharp", () => expect(isOpen(MON(11, 0))).toBe(true));
  it("is open mid-afternoon", () => expect(isOpen(MON(15, 30))).toBe(true));
  it("shuts at 10PM on a Monday", () => expect(isOpen(MON(22, 0))).toBe(false));
  it("is still open at 10:30PM on a Friday", () => expect(isOpen(FRI(22, 30))).toBe(true));
  it("shuts at 11PM on a Saturday", () => expect(isOpen(SAT(23, 0))).toBe(false));
});

describe("nextOpening", () => {
  it("is later today when it hasn't opened yet", () => {
    const n = nextOpening(MON(7, 0));
    expect(n.getDate()).toBe(27);
    expect(n.getHours()).toBe(11);
  });
  it("rolls to tomorrow once the day is done", () => {
    const n = nextOpening(MON(23, 0));
    expect(n.getDate()).toBe(28);
    expect(n.getHours()).toBe(11);
  });
});

describe("pickupSlots", () => {
  it("is empty when closed, so nothing can be ordered", () => {
    expect(pickupSlots(MON(3, 0), PLATE)).toEqual([]);
    expect(pickupSlots(MON(22, 30), PLATE)).toEqual([]);
  });

  it("starts at the next quarter hour after prep time", () => {
    // 12:02 + 15 min prep = 12:17 -> rounds up to 12:30
    const [first] = pickupSlots(MON(12, 2), PLATE);
    expect(first.getHours()).toBe(12);
    expect(first.getMinutes()).toBe(30);
  });

  it("does not round away a slot that already lands on the quarter", () => {
    // 12:00 + 15 = 12:15 exactly, so 12:15 should be offered
    const [first] = pickupSlots(MON(12, 0), PLATE);
    expect(first.getMinutes()).toBe(15);
  });

  it("steps in 15-minute increments", () => {
    const s = pickupSlots(MON(12, 0), PLATE);
    for (let i = 1; i < s.length; i++) {
      expect(s[i] - s[i - 1]).toBe(SLOT_MINUTES * 60_000);
    }
  });

  it("never offers a time past close", () => {
    const s = pickupSlots(MON(20, 0), PLATE);
    const last = s[s.length - 1];
    expect(last.getHours()).toBe(22);
    expect(last.getMinutes()).toBe(0);
  });

  it("runs an hour later on a Friday", () => {
    const s = pickupSlots(FRI(20, 0), PLATE);
    const last = s[s.length - 1];
    expect(last.getHours()).toBe(23);
    expect(last.getMinutes()).toBe(0);
  });

  it("gives no slots in the last quarter hour before close", () => {
    // 9:50PM Monday + 15 min prep is past the 10PM close
    expect(pickupSlots(MON(21, 50), PLATE)).toEqual([]);
  });
});

describe("earliestReady", () => {
  it("is the cart's own prep time out, not a fixed fifteen", () => {
    expect(earliestReady(MON(12, 0), PLATE).getMinutes()).toBe(15);
    expect(earliestReady(MON(12, 0), SEAFOOD).getMinutes()).toBe(30);
  });

  it("refuses to guess when nobody worked out the prep time", () => {
    // A default here would quietly promise a salmon plate in fifteen minutes.
    expect(() => earliestReady(MON(12, 0), undefined)).toThrow(/prepMinutes/);
    expect(() => pickupSlots(MON(12, 0), null)).toThrow(/prepMinutes/);
  });
});

describe("readyFitsBeforeClose", () => {
  /* The hours check that matters is about the READY time, not the order time.
     At 9:50PM on a Monday the door is open, but a 30-minute plate would come
     out of the fryer twenty minutes after close. */
  it("allows a plate that just fits", () => {
    const now = MON(21, 40);
    expect(readyFitsBeforeClose(earliestReady(now, PLATE), now)).toBe(true);
  });

  it("refuses a cooked-to-order plate that would land after close", () => {
    const now = MON(21, 50);
    expect(readyFitsBeforeClose(earliestReady(now, SEAFOOD), now)).toBe(false);
  });

  it("gives a seafood plate the extra hour on a Friday", () => {
    const now = FRI(22, 20);
    expect(readyFitsBeforeClose(earliestReady(now, SEAFOOD), now)).toBe(true);
    // ...but not on a Monday, when the door shuts at ten.
    const mon = MON(22, 20);
    expect(readyFitsBeforeClose(earliestReady(mon, SEAFOOD), mon)).toBe(false);
  });
});

describe("pickupSlots with a cooked-to-order cart", () => {
  it("starts half an hour out, not fifteen minutes", () => {
    const [first] = pickupSlots(MON(12, 0), SEAFOOD);
    expect(first.getHours()).toBe(12);
    expect(first.getMinutes()).toBe(30);
  });

  it("runs out of slots earlier in the evening than a fast plate does", () => {
    expect(pickupSlots(MON(21, 40), SEAFOOD)).toEqual([]);
    expect(pickupSlots(MON(21, 40), PLATE).length).toBeGreaterThan(0);
  });
});

describe("describeOpening", () => {
  it("says today when it is today", () => {
    expect(describeOpening(at(2026, 7, 27, 11, 0), MON(7, 0))).toBe("today at 11:00 AM");
  });
  it("says tomorrow when it is the next day", () => {
    expect(describeOpening(at(2026, 7, 28, 11, 0), MON(23, 0))).toBe("tomorrow at 11:00 AM");
  });
});

describe("formatTime", () => {
  it("reads like a clock", () => {
    expect(formatTime(MON(19, 5))).toBe("7:05 PM");
  });
});
