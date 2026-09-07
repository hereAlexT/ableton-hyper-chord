import { describe, expect, it } from "vitest";

import { prepareAudio, resample, toMono } from "../src/analysis/crema/resample.js";

function zeroCrossings(x: Float32Array): number {
  let n = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1]! < 0) !== (x[i]! < 0)) n++;
  return n;
}

describe("resample", () => {
  it("downmixes interleaved stereo", () => {
    const m = toMono(new Float32Array([1, 0, 0.5, -0.5, -1, 1]), 2);
    expect(Array.from(m)).toEqual([0.5, 0, 0]);
  });

  it("keeps a 440 Hz tone at 440 Hz from 48k to 44.1k", () => {
    const inRate = 48000;
    const secs = 1;
    const x = new Float32Array(inRate * secs);
    for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * 440 * i) / inRate);
    const y = resample(x, inRate, 44100);
    expect(y.length).toBe(44100);
    // 440 Hz -> 880 zero crossings per second (allow edge effects).
    expect(Math.abs(zeroCrossings(y) - 880)).toBeLessThanOrEqual(2);
    // Amplitude preserved away from the edges.
    let peak = 0;
    for (let i = 1000; i < y.length - 1000; i++) peak = Math.max(peak, Math.abs(y[i]!));
    expect(peak).toBeGreaterThan(0.98);
    expect(peak).toBeLessThan(1.02);
  });

  it("is a no-op at the target rate", () => {
    const x = new Float32Array([0.1, 0.2, 0.3]);
    expect(prepareAudio(x, 44100, 1, 44100)).toBe(x);
  });
});
