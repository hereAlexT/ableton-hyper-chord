import * as fs from "node:fs";
import { describe, expect, it } from "vitest";

import { segmentStates, viterbiDiscriminative } from "../src/analysis/crema/cremaDecoder.js";
import { labelFor, parseDecoderTable, type CremaDecoderJson } from "../src/analysis/crema/decoderTable.js";

const table = parseDecoderTable(JSON.parse(fs.readFileSync("assets/models/crema/crema_decoder.json", "utf8")) as CremaDecoderJson);

describe("decoder table", () => {
  it("loads crema's 170-state table", () => {
    expect(table.nStates).toBe(170);
    expect(table.names[table.names.indexOf("C:maj")]).toBe("C:maj");
    expect(Array.from(table.skipTags).map((i) => table.names[i])).toEqual(["N", "X"]);
    expect(labelFor(table, table.names.indexOf("F:maj"), 4)).toBe("F:maj/3");
    expect(labelFor(table, table.names.indexOf("N"), 0)).toBe("N");
  });
});

describe("viterbi + segmentation", () => {
  it("smooths a noisy state sequence into runs and times them like pumpp", () => {
    const n = table.nStates;
    const frames = 40;
    const cmaj = table.names.indexOf("C:maj");
    const amin = table.names.indexOf("A:min");
    const prob = new Float32Array(frames * n).fill(0.001);
    for (let t = 0; t < frames; t++) {
      const want = t < 20 ? cmaj : amin;
      // A single-frame glitch that the self-loop should absorb.
      const glitch = t === 10 ? amin : want;
      prob[t * n + glitch] = 0.9;
    }
    // Bass head says "no bass" (class 12), so no inversions get appended.
    const bass = new Float32Array(frames * 13).fill(0.005);
    for (let t = 0; t < frames; t++) bass[t * 13 + 12] = 0.94;
    const states = viterbiDiscriminative(prob, frames, n, table.pSelf);
    expect(states[10]).toBe(cmaj);
    const segs = segmentStates(states, prob, bass, frames, table, 44100, 4096, table.skipTags);
    expect(segs.map((s) => labelFor(table, s.tag, s.bassDegree))).toEqual(["C:maj", "A:min"]);
    expect(segs[0]!.start).toBe(0);
    expect(segs[0]!.end).toBeCloseTo((20 * 4096) / 44100, 9);
    // The last segment closes one frame late, as pumpp does.
    expect(segs[1]!.end).toBeCloseTo(((frames + 1) * 4096) / 44100, 9);
  });

  it("applies the bass inversion when the bass head favours a chord tone", () => {
    const n = table.nStates;
    const frames = 10;
    const cmaj = table.names.indexOf("C:maj");
    const prob = new Float32Array(frames * n).fill(0.0001);
    for (let t = 0; t < frames; t++) prob[t * n + cmaj] = 0.95;
    const bass = new Float32Array(frames * 13).fill(0.01);
    for (let t = 0; t < frames; t++) bass[t * 13 + 4] = 0.8; // E
    const states = viterbiDiscriminative(prob, frames, n, table.pSelf);
    const segs = segmentStates(states, prob, bass, frames, table, 44100, 4096, table.skipTags);
    expect(labelFor(table, segs[0]!.tag, segs[0]!.bassDegree)).toBe("C:maj/3");
    expect(segs[0]!.confidence).toBeCloseTo(0.95, 5);
  });
});
