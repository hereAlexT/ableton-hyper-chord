// Chord decoder for crema. Port of music_app's CremaDecoder.cpp.
//
// crema does NOT argmax its 170-way chord_tag head. pumpp's
// ChordTagTransformer.inverse -> BaseTaskTransformer.decode_intervals runs
//     librosa.sequence.viterbi_discriminative(prob.T, transition,
//                                             p_init=None, p_state=None)
// and only then merges runs into intervals.
//
// Three simplifications, each asserted by crema/tools/export_decoder_table.py:
//  * `transition` is exactly librosa.sequence.transition_loop(170, p_self).
//  * p_init and p_state are both None, i.e. uniform; the constants cancel in
//    the argmax, so this runs a plain Viterbi over log(prob + eps).
//  * eps is librosa.util.tiny(prob) with prob float32, i.e. ~1.1754944e-38.

/** librosa.util.tiny(float32). */
export const EPS_FLOAT32 = 1.1754943508222875e-38;

export interface CremaRawSegment {
  startFrame: number;
  endFrame: number; // exclusive
  start: number; // seconds
  end: number;
  tag: number; // index into the 170-name table
  bassDegree: number; // 0 == no inversion, else 1..11 (semitones above root)
  confidence: number;
}

export interface DecoderTables {
  rootPc: Int32Array; // [nStates], -1 for N and X
  relMask: Int32Array; // [nStates], 12-bit root-relative pitch set
  nStates: number;
  pSelf: number;
}

/** numpy argmax: the FIRST maximal index. */
function argmaxFirst(v: Float64Array): number {
  let best = 0;
  for (let i = 1; i < v.length; i++) if (v[i]! > v[best]!) best = i;
  return best;
}

/**
 * viterbi_discriminative with uniform p_init/p_state, over prob[frame][state].
 *
 * Deliberately the plain O(n_states^2) recursion: it reproduces numpy's
 * argmax tie-breaking (first maximal index) without having to reason about
 * which ties a shortcut would resolve differently.
 */
export function viterbiDiscriminative(
  prob: Float32Array,
  nFrames: number,
  nStates: number,
  pSelf: number,
  onProgress?: (t: number, total: number) => void,
): Int32Array {
  if (nFrames <= 0 || nStates <= 0) return new Int32Array(0);

  const logSelf = Math.log(pSelf + EPS_FLOAT32);
  const logOff = Math.log((1 - pSelf) / (nStates - 1) + EPS_FLOAT32);

  let value = new Float64Array(nStates);
  let prev = new Float64Array(nStates);
  const transOut = new Float64Array(nStates);
  const ptr = new Uint16Array(nFrames * nStates);

  const logp = (t: number, s: number) => Math.log(prob[t * nStates + s]! + EPS_FLOAT32);

  for (let s = 0; s < nStates; s++) value[s] = logp(0, s);

  for (let t = 1; t < nFrames; t++) {
    if (onProgress) onProgress(t, nFrames);
    const tmp = prev;
    prev = value;
    value = tmp;
    for (let j = 0; j < nStates; j++) {
      for (let i = 0; i < nStates; i++) transOut[i] = prev[i]! + (i === j ? logSelf : logOff);
      const best = argmaxFirst(transOut);
      ptr[t * nStates + j] = best;
      value[j] = logp(t, j) + transOut[best]!;
    }
  }

  const states = new Int32Array(nFrames);
  states[nFrames - 1] = argmaxFirst(value);
  for (let t = nFrames - 2; t >= 0; t--) states[t] = ptr[(t + 1) * nStates + states[t + 1]!]!;
  return states;
}

/**
 * Run-length merge of a state sequence into timed segments, then crema's bass
 * inversion (crema/models/chord.py:80-97).
 *
 * `bassProb` is [nFrames][13]. The frame range used for both the confidence
 * and the bass geometric mean is [startFrame, endFrame] INCLUSIVE of endFrame
 * (pumpp slices `[f_start:f_end+1]`), clamped at the last frame.
 */
export function segmentStates(
  states: Int32Array,
  prob: Float32Array | null,
  bassProb: Float32Array | null,
  nFrames: number,
  tables: DecoderTables,
  sr: number,
  hopLength: number,
  skipTags: Int32Array,
): CremaRawSegment[] {
  const out: CremaRawSegment[] = [];
  if (states.length === 0 || nFrames <= 0) return out;

  const frameSeconds = hopLength / sr;
  const nStates = tables.nStates;
  const skip = new Set<number>(skipTags);

  let start = 0;
  for (let i = 1; i <= nFrames; i++) {
    if (i !== nFrames && states[i] === states[start]) continue;

    // pumpp/task/base.py:379-392 -- the LAST segment is one frame longer than
    // its run: a faithful reproduction of pumpp appending encoded.shape[0]
    // rather than shape[0] - 1 to the change-point list.
    const last = i === nFrames;
    const endFrame = last ? i + 1 : i;
    const tag = states[start]!;
    const s: CremaRawSegment = {
      startFrame: start,
      endFrame,
      start: start * frameSeconds,
      end: endFrame * frameSeconds,
      tag,
      bassDegree: 0,
      confidence: 0,
    };

    const lo = start;
    const hi = Math.min(i, nFrames - 1); // inclusive

    if (prob) {
      let acc = 0;
      let n = 0;
      for (let t = lo; t <= hi; t++) {
        acc += prob[t * nStates + tag]!;
        n++;
      }
      s.confidence = n > 0 ? acc / n : 0;
    }

    if (bassProb && !skip.has(tag)) {
      // scipy.stats.gmean over the 13 bass classes: compare mean(log x),
      // which is monotonically equivalent and avoids exp() underflow.
      let bestPc = 0;
      let bestVal = -Infinity;
      for (let c = 0; c < 13; c++) {
        let sumLog = 0;
        let n = 0;
        for (let t = lo; t <= hi; t++) {
          sumLog += Math.log(bassProb[t * 13 + c]!); // log(0) == -inf, as scipy
          n++;
        }
        const meanLog = n > 0 ? sumLog / n : -Infinity;
        if (meanLog > bestVal) {
          bestVal = meanLog;
          bestPc = c;
        }
      }
      const rootPc = tables.rootPc[tag]!;
      if (bestPc < 12 && rootPc >= 0) {
        const bassRel = (((bestPc - rootPc) % 12) + 12) % 12;
        if (bassRel !== 0 && ((tables.relMask[tag]! >> bassRel) & 1) === 1) s.bassDegree = bassRel;
      }
    }

    out.push(s);
    start = i;
  }
  return out;
}
