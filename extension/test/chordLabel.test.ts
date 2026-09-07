import { describe, expect, it } from "vitest";

import { displayName, formatHarte, parseHarte, pitchClassesOf, voicing } from "../src/analysis/chordLabel.js";

describe("chordLabel", () => {
  it("parses Harte labels", () => {
    expect(parseHarte("A#:min7/b3")).toEqual({ kind: "chord", rootPc: 10, quality: "min7", bassSemitones: 3 });
    expect(parseHarte("C")).toEqual({ kind: "chord", rootPc: 0, quality: "maj", bassSemitones: 0 });
    expect(parseHarte("N")).toEqual({ kind: "N" });
    expect(parseHarte("X")).toEqual({ kind: "X" });
    expect(parseHarte("Db:maj")).toEqual({ kind: "chord", rootPc: 1, quality: "maj", bassSemitones: 0 });
  });

  it("formats back to sharp-spelled Harte", () => {
    expect(formatHarte({ kind: "chord", rootPc: 10, quality: "min7", bassSemitones: 3 })).toBe("A#:min7/b3");
    expect(formatHarte({ kind: "chord", rootPc: 5, quality: "maj", bassSemitones: 0 })).toBe("F:maj");
  });

  it("spells display names by key preference", () => {
    expect(displayName("A#:min7", "flat")).toBe("Bbm7");
    expect(displayName("A#:min7", "sharp")).toBe("A#m7");
    expect(displayName("F:maj/3", "flat")).toBe("F/A");
    expect(displayName("G:hdim7", "sharp")).toBe("Gm7b5");
    expect(displayName("C:maj7", "sharp")).toBe("Cmaj7");
    expect(displayName("N")).toBe("N.C.");
    expect(displayName("X")).toBe("?");
  });

  it("derives pitch classes and voicings", () => {
    expect(pitchClassesOf("A:min")).toEqual([9, 0, 4]);
    expect(voicing("C:maj", 48)).toEqual([48, 52, 55]);
    // First inversion: bass E below the root.
    expect(voicing("C:maj/3", 48)).toEqual([40, 48, 52, 55]);
    expect(voicing("N")).toEqual([]);
  });
});
