import { describe, expect, it } from "vitest";

import { detectChordsFromNotes, nameChordFromPitches, simplifySegments } from "../src/analysis/midiChords.js";
import type { MidiNote } from "../src/analysis/types.js";

const note = (pitch: number, startTime: number, duration: number): MidiNote => ({ pitch, startTime, duration });

describe("nameChordFromPitches", () => {
  it("names triads and sevenths", () => {
    expect(nameChordFromPitches([60, 64, 67]).label).toBe("C:maj");
    expect(nameChordFromPitches([57, 60, 64]).label).toBe("A:min");
    expect(nameChordFromPitches([55, 59, 62, 65]).label).toBe("G:7");
    expect(nameChordFromPitches([62, 65, 69, 72]).label).toBe("D:min7");
    expect(nameChordFromPitches([60, 64, 67, 71]).label).toBe("C:maj7");
    expect(nameChordFromPitches([59, 62, 65, 69]).label).toBe("B:hdim7");
    expect(nameChordFromPitches([60, 63, 66, 69]).label).toBe("C:dim7");
  });

  it("reports inversions from the lowest note, unless told not to", () => {
    expect(nameChordFromPitches([64, 67, 72]).label).toBe("C:maj/3");
    expect(nameChordFromPitches([67, 72, 76]).label).toBe("C:maj/5");
    expect(nameChordFromPitches([64, 67, 72], { inversions: false }).label).toBe("C:maj");
  });

  it("handles power chords, single notes and octaves", () => {
    expect(nameChordFromPitches([40, 47]).label).toBe("E:5");
    expect(nameChordFromPitches([60]).label).toBe("N");
    expect(nameChordFromPitches([60, 72]).label).toBe("N");
    expect(nameChordFromPitches([]).label).toBe("N");
  });

  it("prefers the simpler chord when a tone is ambiguous", () => {
    expect(nameChordFromPitches([60, 64, 67, 69]).label).toBe("C:maj6");
    expect(nameChordFromPitches([57, 60, 64, 67]).label).toBe("A:min7");
  });

  it("can simplify extensions", () => {
    expect(nameChordFromPitches([59, 63, 66, 61]).label).toBe("B:add9");
    expect(nameChordFromPitches([59, 63, 66, 61], { simplifyExtensions: true }).label).toBe("B:maj");
    expect(nameChordFromPitches([61, 65, 68, 71, 63], { simplifyExtensions: true }).label).toBe("C#:7");
  });
});

describe("detectChordsFromNotes", () => {
  it("segments a simple progression", () => {
    const notes = [
      ...[60, 64, 67].map((p) => note(p, 0, 4)),
      ...[57, 60, 64].map((p) => note(p, 4, 4)),
      ...[53, 57, 60].map((p) => note(p, 8, 4)),
      ...[55, 59, 62].map((p) => note(p, 12, 4)),
    ];
    const segs = detectChordsFromNotes(notes);
    expect(segs.map((s) => [s.start, s.end, s.label])).toEqual([
      [0, 4, "C:maj"],
      [4, 8, "A:min"],
      [8, 12, "F:maj"],
      [12, 16, "G:maj"],
    ]);
  });

  it("merges a strum into one onset and ignores muted notes", () => {
    const notes = [note(60, 0, 2), note(64, 0.03, 1.97), note(67, 0.06, 1.94), { ...note(61, 0.5, 0.2), muted: true }];
    const segs = detectChordsFromNotes(notes);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.label).toBe("C:maj");
  });

  it("keeps a sustained chord through a melody on top", () => {
    const notes = [
      ...[48, 52, 55].map((p) => note(p, 0, 4)),
      note(72, 1, 1),
      note(74, 2, 1),
      note(76, 3, 1),
    ];
    const segs = detectChordsFromNotes(notes);
    expect(segs.map((s) => s.label)).toEqual(["C:maj"]);
    expect(segs[0]!.end).toBe(4);
  });

  it("folds an arpeggio building up into the full chord", () => {
    // E (bass), then A a 16th later, then C# — a guitar-style A chord with the 5th on the bottom.
    const notes = [note(40, 0, 4), note(45, 0.25, 3.75), note(49, 0.5, 3.5), note(52, 0.75, 3.25)];
    const segs = detectChordsFromNotes(notes, { inversions: false });
    expect(segs.map((s) => [s.start, s.end, s.label])).toEqual([[0, 4, "A:maj"]]);
  });

  it("does not report guitar-voicing inversions when inversions are off", () => {
    const notes = [40, 45, 52, 57, 61, 64].map((p) => note(p, 0, 2)); // E A E A C# E
    expect(detectChordsFromNotes(notes, { inversions: false })[0]!.label).toBe("A:maj");
    expect(detectChordsFromNotes(notes)[0]!.label).toBe("A:maj/5");
  });

  it("returns N for a bare melody", () => {
    const segs = detectChordsFromNotes([note(60, 0, 1), note(62, 1, 1), note(64, 2, 1)]);
    expect(segs.every((s) => s.label === "N")).toBe(true);
  });
});

describe("simplifySegments", () => {
  it("relabels and re-merges", () => {
    const segs = simplifySegments(
      [
        { start: 0, end: 1, label: "B:add9/2", confidence: 1 },
        { start: 1, end: 2, label: "B:maj", confidence: 1 },
        { start: 2, end: 3, label: "C#:9", confidence: 1 },
      ],
      true,
    );
    expect(segs.map((s) => [s.start, s.end, s.label])).toEqual([
      [0, 2, "B:maj"],
      [2, 3, "C#:7"],
    ]);
  });
});
