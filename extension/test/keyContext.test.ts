import { describe, expect, it } from "vitest";

import { describeKey, romanNumeral, spellingForKey, type KeyContext } from "../src/analysis/keyContext.js";

const major = (rootPc: number, name = "Major"): KeyContext => ({ rootPc, scaleName: name, intervals: [0, 2, 4, 5, 7, 9, 11], scaleMode: true });
const minor = (rootPc: number): KeyContext => ({ rootPc, scaleName: "Minor", intervals: [0, 2, 3, 5, 7, 8, 10], scaleMode: true });

describe("keyContext", () => {
  it("picks flats for flat keys and sharps otherwise", () => {
    expect(spellingForKey(major(0))).toBe("sharp"); // C
    expect(spellingForKey(major(7))).toBe("sharp"); // G
    expect(spellingForKey(major(5))).toBe("flat"); // F
    expect(spellingForKey(major(10))).toBe("flat"); // Bb
    expect(spellingForKey(major(6))).toBe("sharp"); // F#
    expect(spellingForKey(minor(3))).toBe("flat"); // Eb minor
    expect(spellingForKey(minor(9))).toBe("sharp"); // A minor
    expect(spellingForKey(minor(2))).toBe("flat"); // D minor (rel. F)
  });

  it("describes keys", () => {
    expect(describeKey(major(10))).toBe("Bb Major");
    expect(describeKey(minor(6))).toBe("F# Minor");
  });

  it("gives roman numerals in a major key", () => {
    const c = major(0);
    expect(romanNumeral("C:maj", c)).toBe("I");
    expect(romanNumeral("A:min7", c)).toBe("vi7");
    expect(romanNumeral("G:7", c)).toBe("V7");
    expect(romanNumeral("B:hdim7", c)).toBe("viiø7");
    expect(romanNumeral("F:maj/3", c)).toBe("IV/3");
    expect(romanNumeral("A#:maj", c)).toBe("bVII");
    expect(romanNumeral("F#:dim", c)).toBe("#iv°");
    expect(romanNumeral("N", c)).toBeNull();
  });

  it("gives roman numerals in a minor key", () => {
    const a = minor(9);
    expect(romanNumeral("A:min", a)).toBe("i");
    expect(romanNumeral("C:maj", a)).toBe("III");
    expect(romanNumeral("E:7", a)).toBe("V7");
    expect(romanNumeral("G:maj", a)).toBe("VII");
  });
});
