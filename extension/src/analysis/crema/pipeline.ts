// PCM in, chord segments out. Pure except for the injected model runner, so
// the same code serves the worker, the child process and the smoke tool.

import type { ChordSegment } from "../types.js";
import { CREMA_PARAMS, NUM_HARMONICS, cremaModelInput, nBins } from "./cremaFeatures.js";
import { segmentStates, viterbiDiscriminative } from "./cremaDecoder.js";
import { labelFor, type CremaDecoderTable } from "./decoderTable.js";
import { prepareAudio } from "./resample.js";

export type CremaStage = "resample" | "features" | "inference" | "decode";
export const CREMA_STAGES: CremaStage[] = ["resample", "features", "inference", "decode"];

export interface ModelOutputs {
  /** [frames][170] chord_tag posteriors. */
  tag: Float32Array;
  /** [frames][13] chord_bass posteriors. */
  bass: Float32Array;
}

export interface ModelRunner {
  /** input is [frames][216][2] channels-last float32. */
  run(input: Float32Array, frames: number): Promise<ModelOutputs>;
}

export interface CremaResult {
  /** Times in seconds from sample 0 of the audio passed in; labels are Harte. */
  segments: ChordSegment[];
  frames: number;
}

export type StageProgress = (stage: CremaStage, percentInStage: number) => void;

export async function analyzePcm(
  pcm: Float32Array,
  sampleRate: number,
  channels: number,
  table: CremaDecoderTable,
  runner: ModelRunner,
  onProgress?: StageProgress,
): Promise<CremaResult> {
  const p = CREMA_PARAMS;
  const report = throttled(onProgress);

  report("resample", 0);
  const y = prepareAudio(pcm, sampleRate, channels, p.sampleRate);
  if (y.length === 0) throw new Error("no audio after resampling");

  report("features", 0);
  const { input, frames } = cremaModelInput(y, p, (done, total) => report("features", (100 * done) / total));
  if (frames <= 0) throw new Error("audio too short for a crema frame (needs ≥ 4096 samples at 44.1 kHz)");
  if (input.length !== frames * nBins(p) * NUM_HARMONICS) throw new Error("feature size mismatch");

  report("inference", 0);
  const { tag, bass } = await runner.run(input, frames);
  if (tag.length !== frames * table.nStates) throw new Error(`chord_tag has ${tag.length} values, expected ${frames * table.nStates}`);
  if (bass.length !== frames * 13) throw new Error(`chord_bass has ${bass.length} values, expected ${frames * 13}`);

  report("decode", 0);
  const states = viterbiDiscriminative(tag, frames, table.nStates, table.pSelf, (t, n) => report("decode", (100 * t) / n));
  const raw = segmentStates(states, tag, bass, frames, table, p.sampleRate, p.hopLength, table.skipTags);
  report("decode", 100);

  return {
    frames,
    segments: raw.map((s) => ({
      start: s.start,
      end: s.end,
      label: labelFor(table, s.tag, s.bassDegree),
      confidence: s.confidence,
    })),
  };
}

/** Whole-percent throttle per stage, so progress callbacks stay cheap. */
function throttled(cb?: StageProgress): StageProgress {
  if (!cb) return () => {};
  let lastStage: CremaStage | null = null;
  let lastPct = -1;
  return (stage, pct) => {
    const p = Math.max(0, Math.min(100, Math.floor(pct)));
    if (stage === lastStage && p === lastPct) return;
    lastStage = stage;
    lastPct = p;
    cb(stage, p);
  };
}
