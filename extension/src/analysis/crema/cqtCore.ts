// Plain librosa.cqt magnitude. Port of music_app's CqtCore.cpp, which
// reproduces
//     librosa.cqt(y, sr, hop_length, fmin, n_bins, bins_per_octave,
//                 tuning=0.0, filter_scale=1, norm=1, sparsity=0.01,
//                 scale=True, pad_mode='constant')
// and returns |CQT| as row-major [frame][n_bins].
//
// ONE deliberate deviation from librosa (same as the C++): librosa evaluates
// each octave on a downsampled copy of the signal (res_type='soxr_hq'), which
// needs resampy's filter bank. Here every octave is evaluated at the full
// sample rate, with its own FFT size chosen from that octave's longest filter.
// The residual error was measured by music_app's cqt_parity tool (~0.07 dB
// mean on the log features); test/parity.test.ts checks this port against
// that C++ instead.

import { RealFFT, fftInPlace } from "../fft.js";

export interface CqtParams {
  sampleRate: number;
  hopLength: number;
  binsPerOctave: number;
  nBins: number;
  fmin: number;
  filterScale: number;
  sparsity: number;
}

export const NOTE_C1_HZ = 32.70319566257483;

export type ProgressFn = (done: number, total: number) => void;

function nextPow2(v: number): number {
  return Math.pow(2, Math.ceil(Math.log2(v)));
}

/** scipy.signal.get_window('hann', n, fftbins=True) -- periodic, not symmetric. */
function hannPeriodic(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** librosa constantq.py: alpha from bins_per_octave. */
function bpoToAlpha(binsPerOctave: number): number {
  const r = Math.pow(2, 1 / binsPerOctave);
  return (r * r - 1) / (r * r + 1);
}

/** librosa.filters.wavelet_lengths with gamma=0: Q*sr/f, Q = filter_scale/alpha. */
function waveletLengths(freqs: Float64Array, sr: number, filterScale: number, alpha: number): Float64Array {
  const Q = filterScale / alpha;
  const L = new Float64Array(freqs.length);
  for (let i = 0; i < freqs.length; i++) L[i] = (Q * sr) / freqs[i]!;
  return L;
}

function cqtFrequencies(nBins: number, fmin: number, binsPerOctave: number): Float64Array {
  const f = new Float64Array(nBins);
  for (let i = 0; i < nBins; i++) f[i] = fmin * Math.pow(2, i / binsPerOctave);
  return f;
}

/** CSR-ish sparse basis: one row per CQT bin, columns index rfft bins. */
interface SparseBasis {
  rows: number;
  cols: number;
  nFft: number;
  rowStart: Int32Array; // rows + 1
  col: Int32Array; // nnz
  valRe: Float64Array; // nnz
  valIm: Float64Array; // nnz
}

/** librosa __vqt_filter_fft = filters.wavelet -> fft -> util.sparsify_rows. */
function buildFilterFft(
  freqs: Float64Array,
  lengths: Float64Array,
  sr: number,
  hopLength: number,
  sparsity: number,
): SparseBasis {
  let maxLen = 0;
  for (const l of lengths) maxLen = Math.max(maxLen, l);
  let nFft = nextPow2(maxLen); // pad_fft=True
  const hopFloor = nextPow2(hopLength) * 2; // 2^(1+ceil(log2(hop)))
  if (nFft < hopFloor) nFft = hopFloor;

  const rows = freqs.length;
  const cols = nFft / 2 + 1;
  const rowStart = new Int32Array(rows + 1);
  const col: number[] = [];
  const valRe: number[] = [];
  const valIm: number[] = [];

  const bufRe = new Float64Array(nFft);
  const bufIm = new Float64Array(nFft);
  const mags = new Float64Array(cols);

  for (let b = 0; b < rows; b++) {
    const ilen = lengths[b]!;
    // filters.py: np.arange(-ilen//2, ilen//2), Python floor division.
    const lo = Math.floor(-ilen / 2);
    const hi = Math.floor(ilen / 2);
    const n = hi - lo;

    bufRe.fill(0);
    bufIm.fill(0);
    const win = hannPeriodic(n);
    const sigRe = new Float64Array(n);
    const sigIm = new Float64Array(n);
    let l1 = 0;
    const f = freqs[b]!;
    for (let i = 0; i < n; i++) {
      const t = lo + i;
      const ang = (t * 2 * Math.PI * f) / sr;
      const w = win[i]!;
      const re = Math.cos(ang) * w;
      const im = Math.sin(ang) * w;
      sigRe[i] = re;
      sigIm[i] = im;
      l1 += Math.hypot(re, im);
    }
    // util.pad_center to n_fft, plus __vqt_filter_fft's lengths/n_fft rescale.
    const scale = (l1 > 0 ? 1 / l1 : 1) * (ilen / nFft);
    const lpad = Math.floor((nFft - n) / 2);
    for (let i = 0; i < n; i++) {
      bufRe[lpad + i] = sigRe[i]! * scale;
      bufIm[lpad + i] = sigIm[i]! * scale;
    }

    fftInPlace(bufRe, bufIm);

    // util.sparsify_rows(quantile): keep the largest entries carrying
    // (1 - quantile) of the row's L1 mass.
    let norm = 0;
    for (let c = 0; c < cols; c++) {
      const m = Math.hypot(bufRe[c]!, bufIm[c]!);
      mags[c] = m;
      norm += m;
    }
    const sorted = Float64Array.from(mags).sort();
    let cum = 0;
    let j = cols - 1;
    for (let c = 0; c < cols; c++) {
      cum += norm > 0 ? sorted[c]! / norm : 0;
      if (!(cum < sparsity)) {
        j = c;
        break;
      }
    }
    const thr = sorted[j]!;
    for (let c = 0; c < cols; c++) {
      if (mags[c]! >= thr) {
        col.push(c);
        valRe.push(bufRe[c]!);
        valIm.push(bufIm[c]!);
      }
    }
    rowStart[b + 1] = col.length;
  }
  return {
    rows,
    cols,
    nFft,
    rowStart,
    col: Int32Array.from(col),
    valRe: Float64Array.from(valRe),
    valIm: Float64Array.from(valIm),
  };
}

/** librosa's frame count for center=True: 1 + len(y) // hop_length. */
export function cqtFrameCount(nSamples: number, hopLength: number): number {
  return 1 + Math.floor(nSamples / hopLength);
}

/** How many octave passes magnitude() will make, for progress budgeting. */
export function octaveCount(p: CqtParams): number {
  if (p.binsPerOctave <= 0) return 1;
  return Math.floor((p.nBins + p.binsPerOctave - 1) / p.binsPerOctave);
}

/**
 * |CQT|, row-major [frame][p.nBins] as Float32Array.
 *
 * onProgress(done, total) is called once per (octave, frame); a caller that
 * wants a smooth bar can size `total` by octaveCount(p) * frames.
 */
export function cqtMagnitude(
  y: Float32Array,
  p: CqtParams,
  onProgress?: ProgressFn,
  progBase = 0,
  progTotal = 0,
): { out: Float32Array; frames: number } {
  if (y.length === 0 || p.nBins <= 0 || p.hopLength <= 0) return { out: new Float32Array(0), frames: 0 };

  const nFrames = cqtFrameCount(y.length, p.hopLength);
  const alpha = bpoToAlpha(p.binsPerOctave);
  const freqs = cqtFrequencies(p.nBins, p.fmin, p.binsPerOctave);
  const lens = waveletLengths(freqs, p.sampleRate, p.filterScale, alpha);

  const out = new Float32Array(nFrames * p.nBins);
  const nOct = octaveCount(p);
  const ny = y.length;

  // One pass per octave, each with its own FFT size taken from that octave's
  // longest filter. Bin 0 is fmin, so the FIRST group is the lowest octave
  // and gets the largest FFT.
  for (let o = 0; o < nOct; o++) {
    const lo = o * p.binsPerOctave;
    const hi = Math.min(p.nBins, lo + p.binsPerOctave);
    if (hi <= lo) continue;

    const f = freqs.subarray(lo, hi);
    const L = lens.subarray(lo, hi);
    const B = buildFilterFft(f, L, p.sampleRate, p.hopLength, p.sparsity);

    // vqt scale=True: C /= sqrt(lengths).
    const invSqrtLen = new Float64Array(hi - lo);
    for (let i = 0; i < hi - lo; i++) invSqrtLen[i] = 1 / Math.sqrt(L[i]!);

    // librosa.stft(y, n_fft, hop_length, window='ones', center=True,
    // pad_mode='constant'), streamed frame by frame.
    const nFft = B.nFft;
    const pad = nFft / 2;
    const frame = new Float64Array(nFft);
    const specRe = new Float64Array(nFft / 2 + 1);
    const specIm = new Float64Array(nFft / 2 + 1);
    const rfft = new RealFFT(nFft);

    for (let t = 0; t < nFrames; t++) {
      if (onProgress && progTotal > 0) onProgress(progBase + o * nFrames + t, progTotal);
      const start = t * p.hopLength - pad;
      // Fill the frame; zero outside the signal.
      const k0 = Math.max(0, -start);
      const k1 = Math.min(nFft, ny - start);
      if (k0 > 0) frame.fill(0, 0, Math.min(k0, nFft));
      for (let i = Math.max(k0, 0); i < k1; i++) frame[i] = y[start + i]!;
      if (k1 < nFft) frame.fill(0, Math.max(k1, 0));
      rfft.forward(frame, specRe, specIm);

      const rowBase = t * p.nBins + lo;
      for (let r = 0; r < B.rows; r++) {
        let accRe = 0;
        let accIm = 0;
        const kEnd = B.rowStart[r + 1]!;
        for (let k = B.rowStart[r]!; k < kEnd; k++) {
          const c = B.col[k]!;
          const vr = B.valRe[k]!;
          const vi = B.valIm[k]!;
          const sr = specRe[c]!;
          const si = specIm[c]!;
          accRe += vr * sr - vi * si;
          accIm += vr * si + vi * sr;
        }
        out[rowBase + r] = Math.hypot(accRe, accIm) * invSqrtLen[r]!;
      }
    }
  }
  return { out, frames: nFrames };
}
