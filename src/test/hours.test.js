import { describe, it, expect } from "vitest";
import {
  isOpen, nextOpening, pickupSlots, earliestReady, readyFitsBeforeClose,
  CLOSE_HOUR, closingOn, HOURS_LINE, formatTime, describeOpening, SLOT_MINUTES,
} from "../lib/hours.js";
/* A namespace import as well, so the ABSENCE of the old day-varying closing
   hour is assertable — a named import of something gone is a build error, not
   a test failure. */
import * as hoursModule from "../lib/hours.js";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

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
  /* One closing time, every day. There used to be a `closeHourFor(dow)`
     returning 23 on Friday and Saturday — a rule that was simply wrong, and
     while it stood the app took orders for an hour after the kitchen had gone
     home on the two busiest nights of the week.

     The function is gone rather than returning 22 for every day: a day-varying
     closing hour with no day that varies is somewhere for the rule to drift
     back to. */
  it("is 10PM, and the same on every day of the week", () => {
    expect(CLOSE_HOUR).toBe(22);
    for (let d = 0; d <= 6; d++) {
      const day = at(2026, 7, 26 + d, 12, 0);       // a full week
      expect(closingOn(day).getHours(), `day ${day.getDay()}`).toBe(22);
      expect(closingOn(day).getMinutes()).toBe(0);
    }
  });

  it("has no day-varying closing hour left to drift", () => {
    // If this import ever comes back, so has the special case.
    expect(hoursModule.closeHourFor).toBeUndefined();
  });
});

describe("isOpen", () => {
  it("is shut before 11AM", () => expect(isOpen(MON(10, 59))).toBe(false));
  it("opens at 11AM sharp", () => expect(isOpen(MON(11, 0))).toBe(true));
  it("is open mid-afternoon", () => expect(isOpen(MON(15, 30))).toBe(true));
  it("shuts at 10PM on a Monday", () => expect(isOpen(MON(22, 0))).toBe(false));
  /* The hour that used to be open and should never have been: at 10:30PM on a
     Friday the kitchen is shut, and the app now says so. */
  it("is shut at 10:30PM on a Friday", () => expect(isOpen(FRI(22, 30))).toBe(false));
  it("shuts at 10PM sharp on a Saturday", () => {
    expect(isOpen(SAT(21, 59))).toBe(true);
    expect(isOpen(SAT(22, 0))).toBe(false);
  });
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

  it("stops at 10PM on a Friday, like every other day", () => {
    const s = pickupSlots(FRI(20, 0), PLATE);
    const last = s[s.length - 1];
    expect(last.getHours()).toBe(22);
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

  it("refuses a cooked-to-order plate on a Friday night, same as any night", () => {
    /* THE CASE THAT MATTERED. A 30-minute plate ordered at 9:40 cannot be ready
       before a 10PM close, and the old Friday exception let it through — the
       customer was promised food from a kitchen that had shut. */
    for (const day of [FRI, SAT, MON]) {
      const now = day(21, 40);
      expect(readyFitsBeforeClose(earliestReady(now, SEAFOOD), now), `${now}`).toBe(false);
    }
  });

  it("still takes a cooked-to-order plate with time to cook it", () => {
    for (const day of [FRI, SAT, MON]) {
      const now = day(21, 0);
      expect(readyFitsBeforeClose(earliestReady(now, SEAFOOD), now), `${now}`).toBe(true);
    }
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

/* ============================================================================
   ONE SOURCE, AND EVERYTHING READS IT

   The closing time is the same shape as every price divergence in this
   project: a rule in several places where one moved and the others did not.
   It survived a change precisely because there is one constant and every
   screen, the server guard and the banner derive from it.

   These assertions are about that property, not about the number — so they
   keep their value the next time the hours change.
   ============================================================================ */

describe("the closing time has exactly one source", () => {
  const src = readFileSync(resolve(process.cwd(), "src/lib/hours.js"), "utf8");

  it("defines the hour once, and never as a second value", () => {
    /* Counting every "22" in the file was too crude — comments and slot maths
       contain them. What matters is that the constant is declared once and no
       alternative closing hour is declared beside it. */
    const decls = [...src.matchAll(/export const CLOSE_HOUR\s*=/g)].length;
    expect(decls, "CLOSE_HOUR declared more than once").toBe(1);
    expect(src).not.toMatch(/CLOSE_HOUR\w*\s*=\s*23/);
    expect(src).not.toMatch(/LATE_CLOSE|WEEKEND_CLOSE/);
  });

  it("has no caller of the old day-varying closing hour left", () => {
    /* hours.js explains in prose why `closeHourFor` was removed, and that
       explanation is worth keeping — so the check is for a CALL or an import,
       not for the word. Anywhere else mentioning it at all is a rebuild of the
       special case by hand. */
    for (const dir of ["src", "server"]) {
      for (const f of walk(resolve(process.cwd(), dir))) {
        if (f.includes("/test/")) continue;
        const text = readFileSync(f, "utf8");
        if (f.endsWith("lib/hours.js")) {
          // Its own prose may name it; it must not define or call it.
          expect(text, "hours.js still defines closeHourFor").not.toMatch(/export const closeHourFor/);
          continue;
        }
        expect(text, `${f} still uses closeHourFor`).not.toMatch(/closeHourFor/);
      }
    }
  });

  it("states the hours to a customer in one string", () => {
    expect(HOURS_LINE).toBe("Open daily 11AM–10PM");
    expect(HOURS_LINE).not.toMatch(/Fri|Sat|11PM/);
  });

  it("derives the customer-facing close from the same constant", () => {
    /* The cart copy, the checkout slot list and the server's 409 all call
       closingOn(). If that ever stops agreeing with CLOSE_HOUR, every one of
       them is wrong at once and none of them would say so. */
    for (let d = 0; d <= 6; d++) {
      const day = at(2026, 7, 26 + d, 15, 0);
      expect(closingOn(day).getHours()).toBe(CLOSE_HOUR);
    }
  });
});

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("the public support page agrees with the code", () => {
  /* A static HTML page is exactly where a rule drifts: nothing imports it,
     nothing renders it in a test, and it is linked from the App Store listing
     so a customer reads it. It listed 11PM on Friday and Saturday for as long
     as the code did — and would have kept listing it. */
  const page = readFileSync(resolve(process.cwd(), "docs/support.html"), "utf8");

  it("lists the same closing time on all seven days", () => {
    const closes = [...page.matchAll(/11:00 AM &ndash; (\d{1,2}):00 (AM|PM)/g)]
      .map((m) => `${m[1]} ${m[2]}`);
    expect(closes, "seven days should be listed").toHaveLength(7);
    for (const c of closes) expect(c).toBe("10 PM");
  });

  it("closes at the hour the code closes at", () => {
    const hour = CLOSE_HOUR > 12 ? CLOSE_HOUR - 12 : CLOSE_HOUR;
    expect(page).toContain(`${hour}:00 PM`);
  });
});
