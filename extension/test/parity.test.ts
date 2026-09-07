// Diff the TypeScript port against music_app's C++ (built by
// `npm run parity:build` into .parity/cqt_parity). The C++ was validated
// against the Python reference, so agreement here is agreement with crema.
//
// Features are compared with a tolerance (both sides use the same algorithm,
// so it should be float noise); decoder output must match exactly.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { cremaModelInput } from "../src/analysis/crema/cremaFeatures.js";
import { segmentStates, viterbiDiscriminative } from "../src/analysis/crema/cremaDecoder.js";
import { parseDecoderTable, type CremaDecoderJson } from "../src/analysis/crema/decoderTable.js";

const BIN = path.resolve(".parity/cqt_parity");
const have = fs.existsSync(BIN);
const d = have ? describe : describe.skip;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** ~4 s of "music": a few chords of harmonically rich tones plus a little noise. */
function synthSignal(sr = 44100, secs = 4): Float32Array {
  const y = new Float32Array(sr * secs);
  const r = rng(42);
  const chords = [
    [130.81, 164.81, 196.0], // C
    [110.0, 130.81, 164.81], // Am
    [87.31, 110.0, 130.81], // F
    [98.0, 123.47, 146.83], // G
  ];
  for (let i = 0; i < y.length; i++) {
    const t = i / sr;
    const chord = chords[Math.min(chords.length - 1, Math.floor(t))]!;
    let v = 0;
    for (const f of chord) for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * f * h * t) / (h * h);
    y[i] = 0.3 * v + 0.01 * (r() - 0.5);
  }
  return y;
}

function tmp(name: string): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hyperchord-parity-")), name);
}

/** Exact-length ArrayBuffer of a file (Buffer.buffer may be a shared pool slab). */
function readRaw(file: string): ArrayBuffer {
  const b = fs.readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

d("parity with the C++ reference", () => {
  it("HCQT log-magnitude features agree", () => {
    const y = synthSignal();
    const inPath = tmp("y.f32");
    const outPath = inPath.replace(/y\.f32$/, "out.f32");
    fs.writeFileSync(inPath, Buffer.from(y.buffer));
    const log = execFileSync(BIN, ["crema", inPath, outPath], { encoding: "utf8" });
    const ref = new Float32Array(readRaw(outPath));

    const { input, frames } = cremaModelInput(y);
    expect(log).toContain(`crema: ${frames} frames`);
    expect(input.length).toBe(ref.length);

    let maxAbs = 0;
    let sumAbs = 0;
    for (let i = 0; i < ref.length; i++) {
      const dlt = Math.abs(ref[i]! - input[i]!);
      maxAbs = Math.max(maxAbs, dlt);
      sumAbs += dlt;
    }
    const meanAbs = sumAbs / ref.length;
    // Same algorithm on both sides: only FFT rounding separates them. Values are dB in [-80, 0].
    expect(meanAbs).toBeLessThan(1e-3);
    expect(maxAbs).toBeLessThan(0.05);
  }, 120_000);

  it("Viterbi + inversion decode matches exactly", () => {
    const table = parseDecoderTable(
      JSON.parse(fs.readFileSync("assets/models/crema/crema_decoder.json", "utf8")) as CremaDecoderJson,
    );
    const n = table.nStates;
    const frames = 300;
    const r = rng(7);
    // Softmax-like posteriors with a slowly wandering favourite state and
    // occasional exact zeros (log(0) paths must agree).
    const tag = new Float32Array(frames * n);
    const bass = new Float32Array(frames * 13);
    let fav = 61;
    for (let t = 0; t < frames; t++) {
      if (r() < 0.08) fav = Math.floor(r() * n);
      let sum = 0;
      for (let s = 0; s < n; s++) {
        let v = r() * 0.02;
        if (s === fav) v += 0.5 + r() * 0.5;
        if (r() < 0.02) v = 0;
        tag[t * n + s] = v;
        sum += v;
      }
      for (let s = 0; s < n; s++) tag[t * n + s] = Math.fround(tag[t * n + s]! / sum);
      let bsum = 0;
      for (let c = 0; c < 13; c++) {
        let v = r();
        if (r() < 0.05) v = 0;
        bass[t * 13 + c] = v;
        bsum += v;
      }
      for (let c = 0; c < 13; c++) bass[t * 13 + c] = Math.fround(bass[t * 13 + c]! / (bsum || 1));
    }

    const tagPath = tmp("tag.f32");
    const dir = path.dirname(tagPath);
    const p = (f: string) => path.join(dir, f);
    fs.writeFileSync(tagPath, Buffer.from(tag.buffer));
    fs.writeFileSync(p("bass.f32"), Buffer.from(bass.buffer));
    fs.writeFileSync(p("root.i32"), Buffer.from(table.rootPc.buffer));
    fs.writeFileSync(p("mask.i32"), Buffer.from(table.relMask.buffer));
    fs.writeFileSync(p("skip.i32"), Buffer.from(table.skipTags.buffer));
    execFileSync(BIN, [
      "crema-decode", tagPath, p("bass.f32"), String(frames), String(n), String(table.pSelf),
      p("root.i32"), p("mask.i32"), p("skip.i32"), p("out.f64"), p("out.i32"),
    ]);
    const nums = new Float64Array(readRaw(p("out.f64")));
    const labs = new Int32Array(readRaw(p("out.i32")));

    const states = viterbiDiscriminative(tag, frames, n, table.pSelf);
    const segs = segmentStates(states, tag, bass, frames, table, 44100, 4096, table.skipTags);

    expect(segs.length).toBe(labs.length / 2);
    for (let i = 0; i < segs.length; i++) {
      expect(segs[i]!.tag).toBe(labs[2 * i]);
      expect(segs[i]!.bassDegree).toBe(labs[2 * i + 1]);
      expect(segs[i]!.start).toBeCloseTo(nums[3 * i]!, 9);
      expect(segs[i]!.end).toBeCloseTo(nums[3 * i + 1]!, 9);
      expect(segs[i]!.confidence).toBeCloseTo(nums[3 * i + 2]!, 9);
    }
  }, 60_000);
});
