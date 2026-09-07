import { describe, expect, it } from "vitest";

import { chordText, notesFor, prepareSegments } from "../src/chordTrack/writeChords.js";
import { whatsThisChord } from "../src/commands/whatsThisChord.js";
import type { KeyContext } from "../src/analysis/keyContext.js";

const seg = (start: number, end: number, label: string, confidence = 1) => ({ start, end, label, confidence });
const cMajor: KeyContext = { rootPc: 0, scaleName: "Major", intervals: [0, 2, 4, 5, 7, 9, 11], scaleMode: true };
const bbMajor: KeyContext = { rootPc: 10, scaleName: "Major", intervals: [0, 2, 4, 5, 7, 9, 11], scaleMode: true };

describe("prepareSegments", () => {
  it("snaps to the grid, folds slivers, merges equal neighbours, drops N", () => {
    const out = prepareSegments(
      [seg(0, 3.9, "C:maj"), seg(3.9, 4.1, "G:maj"), seg(4.1, 8.02, "A:min"), seg(8.02, 8.9, "N"), seg(8.9, 12, "F:maj")],
      0.25,
      0.25,
    );
    expect(out.map((s) => [s.start, s.end, s.label])).toEqual([
      [0, 4, "C:maj"],
      [4, 8, "A:min"],
      [9, 12, "F:maj"],
    ]);
  });

  it("hands a leading sliver to the next chord instead of leaving a hole", () => {
    const out = prepareSegments([seg(16, 16.25, "A:5"), seg(16.25, 20, "A:maj")], 0.25, 0.5);
    expect(out.map((s) => [s.start, s.end, s.label])).toEqual([[16, 20, "A:maj"]]);
  });

  it("never lets clips overlap after snapping", () => {
    const out = prepareSegments([seg(0, 1.13, "C:maj"), seg(1.13, 1.37, "D:min"), seg(1.37, 2, "E:min")], 0.25, 0.25);
    for (let i = 1; i < out.length; i++) expect(out[i]!.start).toBeGreaterThanOrEqual(out[i - 1]!.end);
  });

  it("leaves times alone when snapping is off", () => {
    const out = prepareSegments([seg(0.3, 1.7, "C:maj")], 0, 0);
    expect(out).toEqual([seg(0.3, 1.7, "C:maj")]);
  });
});

describe("clip naming and voicing", () => {
  it("spells by key and appends the function in brackets", () => {
    expect(chordText("A#:min7", { spelling: "flat", key: bbMajor, romanInClipName: false })).toBe("Bbm7");
    expect(chordText("A#:min7", { spelling: "flat", key: bbMajor, romanInClipName: true })).toBe("Bbm7 (i7)");
    expect(chordText("A:min7", { spelling: "sharp", key: cMajor, romanInClipName: true })).toBe("Am7 (vi7)");
    expect(chordText("F:maj/3", { spelling: "sharp", key: cMajor, romanInClipName: true })).toBe("F/A (IV/3)");
  });

  it("writes clip-relative notes spanning the clip", () => {
    const notes = notesFor("C:maj/3", 2, 48);
    expect(notes.map((n) => n.pitch)).toEqual([40, 48, 52, 55]);
    expect(notes.every((n) => n.startTime === 0 && n.duration === 2 && n.velocity === 100)).toBe(true);
  });
});

describe("whatsThisChord", () => {
  it("uses only the selected notes and names one chord", () => {
    const notes = [
      { pitch: 60, startTime: 0, duration: 1, selected: true },
      { pitch: 64, startTime: 0, duration: 1, selected: true },
      { pitch: 67, startTime: 0, duration: 1, selected: true },
      { pitch: 62, startTime: 1, duration: 1, selected: false },
    ];
    const r = whatsThisChord(cMajor, "Piano", notes);
    expect(r.title).toBe("C (I)");
    expect(r.rows?.[0]?.notes).toBe("C E G");
    expect(r.note).toBeUndefined();
  });

  it("falls back to the whole clip and reports each chord in the key's spelling", () => {
    const notes = [
      ...[58, 62, 65].map((p) => ({ pitch: p, startTime: 0, duration: 2 })),
      ...[55, 58, 62].map((p) => ({ pitch: p, startTime: 2, duration: 2 })),
    ];
    const r = whatsThisChord(bbMajor, "Keys", notes);
    expect(r.title).toBe("2 chords");
    expect(r.rows?.map((x) => x.chord)).toEqual(["Bb (I)", "Gm (vi)"]);
    expect(r.note).toMatch(/whole clip/);
  });

  it("ignores the selection flags in selection mode", () => {
    const notes = [60, 64, 67].map((p) => ({ pitch: p, startTime: 0, duration: 1, selected: false }));
    const r = whatsThisChord(cMajor, "Keys · bars 1–2", notes, String, true);
    expect(r.title).toBe("C (I)");
    expect(r.note).toBeUndefined();
  });

  it("explains an empty clip", () => {
    expect(whatsThisChord(cMajor, "Empty", []).message).toMatch(/No notes/);
  });
});
