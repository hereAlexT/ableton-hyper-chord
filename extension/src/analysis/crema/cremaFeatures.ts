// Feature front-end for crema (Brian McFee, "structured chord recognition",
// ISMIR 2017). Port of music_app's CremaFeatures.cpp, which mirrors pumpp's
// HCQTMag exactly with the parameters read out of the shipped pump.pkl:
//   sr 44100, hop 4096, n_octaves 6, over_sample 3 (=> 36 bins/octave,
//   216 bins), fmin = note_to_hz('C1'), harmonics [1, 2], log = True.
//
// The chain, in order:
//   1. decode + resample to 44100 mono                        (resample.ts)
//   2. n_frames = floor(len(y) / hop)                         FeatureExtractor.n_frames
//   3. for each harmonic h: |librosa.cqt(y, fmin = fmin * h)| 216 bins
//   4. trim the time axis to n_frames                         librosa.util.fix_length
//   5. amplitude_to_db(C, ref=np.max) per harmonic            log=True
//   6. interleave to [time][bin][harmonic]                    conv='tf'
//
// Two details that are easy to get wrong:
// * Step 2 is FLOOR, while librosa.cqt returns 1 + len(y)//hop frames, so step
//   4 always drops exactly one frame off the end.
// * Step 5's reference is np.max over the WHOLE trimmed CQT of that harmonic,
//   so the feature is global-normalised and NOT chunk-invariant.

import { NOTE_C1_HZ, cqtMagnitude, octaveCount, type CqtParams, type ProgressFn } from "./cqtCore.js";

export interface CremaParams {
  sampleRate: number; // pump['cqt'].sr
  hopLength: number; // pump['cqt'].hop_length
  nOctaves: number; // pump['cqt'].n_octaves
  overSample: number; // pump['cqt'].over_sample
  fmin: number; // note_to_hz('C1')
  filterScale: number; // librosa default
  sparsity: number; // librosa default
  amin: number; // librosa.amplitude_to_db defaults, as pumpp calls it
  topDb: number;
}

export const CREMA_PARAMS: CremaParams = {
  sampleRate: 44100,
  hopLength: 4096,
  nOctaves: 6,
  overSample: 3,
  fmin: NOTE_C1_HZ,
  filterScale: 1,
  sparsity: 0.01,
  amin: 1e-5,
  topDb: 80,
};

/** pump['cqt'].harmonics == [1, 2]. */
export const HARMONICS = [1, 2] as const;
export const NUM_HARMONICS = HARMONICS.length;

export function binsPerOctave(p: CremaParams): number {
  return p.overSample * 12;
}
export function nBins(p: CremaParams): number {
  return p.nOctaves * 12 * p.overSample;
}

/** FeatureExtractor.n_frames: floor(len(y) / hop). */
export function cremaFrameCount(nSamples: number, hopLength: number): number {
  return Math.floor(nSamples / hopLength);
}

function toCqt(p: CremaParams, harmonic: number): CqtParams {
  return {
    sampleRate: p.sampleRate,
    hopLength: p.hopLength,
    binsPerOctave: binsPerOctave(p),
    nBins: nBins(p),
    fmin: p.fmin * harmonic,
    filterScale: p.filterScale,
    sparsity: p.sparsity,
  };
}

/**
 * librosa.amplitude_to_db(S, ref=np.max, amin=1e-5, top_db=80), in place.
 *
 * In amplitude terms: db = 20*log10(max(amin, S)) - 20*log10(max(amin, max(S)))
 * floored at (max(db) - top_db). Kept in the max(db) form so a degenerate
 * all-zero harmonic behaves as librosa does.
 */
export function amplitudeToDbRefMax(s: Float32Array, p: CremaParams): void {
  if (s.length === 0) return;
  let peak = 0;
  for (let i = 0; i < s.length; i++) peak = Math.max(peak, s[i]!);
  const logRef = 20 * Math.log10(Math.max(p.amin, peak));
  let top = -Infinity;
  for (let i = 0; i < s.length; i++) {
    const db = 20 * Math.log10(Math.max(p.amin, s[i]!)) - logRef;
    const v = Math.fround(db);
    s[i] = v;
    top = Math.max(top, v);
  }
  if (p.topDb > 0) {
    const floorDb = Math.fround(top - Math.fround(p.topDb));
    for (let i = 0; i < s.length; i++) s[i] = Math.max(s[i]!, floorDb);
  }
}

/** STFT sweeps modelInput() makes, for progress budgeting: one per octave per harmonic. */
export function sweeps(p: CremaParams): number {
  return octaveCount(toCqt(p, 1)) * NUM_HARMONICS;
}

/**
 * Build the ONNX input for the whole track: steps 2-6 above.
 * Returns frames * nBins(p) * NUM_HARMONICS floats laid out
 * [time][bin][harmonic] -- channels_last, matching the graph's
 * [batch, time, 216, 2] input.
 */
export function cremaModelInput(
  y: Float32Array,
  p: CremaParams = CREMA_PARAMS,
  onProgress?: ProgressFn,
): { input: Float32Array; frames: number } {
  const bins = nBins(p);
  const frames = cremaFrameCount(y.length, p.hopLength);
  if (y.length === 0 || frames <= 0) return { input: new Float32Array(0), frames: 0 };

  const perHarmonicSweeps = octaveCount(toCqt(p, 1));
  const cqtFrames = 1 + Math.floor(y.length / p.hopLength);
  const progTotal = perHarmonicSweeps * NUM_HARMONICS * cqtFrames;
  const out = new Float32Array(frames * bins * NUM_HARMONICS);

  for (let hi = 0; hi < NUM_HARMONICS; hi++) {
    const { out: cqt, frames: got } = cqtMagnitude(
      y,
      toCqt(p, HARMONICS[hi]!),
      onProgress,
      hi * perHarmonicSweeps * cqtFrames,
      progTotal,
    );
    if (got <= 0) continue;

    // fix_length to `frames` (trim, or zero-pad if ever short).
    let c: Float32Array;
    if (got !== frames) {
      c = new Float32Array(frames * bins);
      const keep = Math.min(got, frames);
      c.set(cqt.subarray(0, keep * bins));
    } else {
      c = cqt;
    }

    // amplitude_to_db(ref=np.max), AFTER the trim.
    amplitudeToDbRefMax(c, p);

    // interleave into [time][bin][harmonic]
    for (let t = 0; t < frames; t++) {
      const srcBase = t * bins;
      const dstBase = t * bins * NUM_HARMONICS;
      for (let b = 0; b < bins; b++) out[dstBase + b * NUM_HARMONICS + hi] = c[srcBase + b]!;
    }
  }
  return { input: out, frames };
}
