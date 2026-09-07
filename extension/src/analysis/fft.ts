// Radix-2 FFT, double precision, no dependencies.
//
// Forward transform uses the e^{-2πi k n / N} convention (numpy / pocketfft),
// which is what the CQT filter design and the STFT both assume.

export interface ComplexArray {
  re: Float64Array;
  im: Float64Array;
}

interface Plan {
  n: number;
  cos: Float64Array; // cos(2πk/n), k < n/2
  sin: Float64Array; // sin(2πk/n)
  rev: Uint32Array; // bit-reversal permutation
}

const plans = new Map<number, Plan>();

function planFor(n: number): Plan {
  let p = plans.get(n);
  if (p) return p;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`fft: size must be a power of two, got ${n}`);
  const half = n >>> 1;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    const a = (2 * Math.PI * k) / n;
    cos[k] = Math.cos(a);
    sin[k] = Math.sin(a);
  }
  const bits = Math.log2(n) | 0;
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    let x = i;
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1);
      x >>>= 1;
    }
    rev[i] = r >>> 0;
  }
  p = { n, cos, sin, rev };
  plans.set(n, p);
  return p;
}

/** In-place forward complex FFT of length re.length (power of two). */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  const { cos, sin, rev } = planFor(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i]!;
    if (j > i) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >>> 1;
    const step = n / size; // twiddle stride
    for (let start = 0; start < n; start += size) {
      let k = 0;
      for (let j = start; j < start + half; j++) {
        const wr = cos[k]!;
        const wi = -sin[k]!; // e^{-iθ}
        const l = j + half;
        const xr = re[l]!;
        const xi = im[l]!;
        const tr = xr * wr - xi * wi;
        const ti = xr * wi + xi * wr;
        re[l] = re[j]! - tr;
        im[l] = im[j]! - ti;
        re[j] = re[j]! + tr;
        im[j] = im[j]! + ti;
        k += step;
      }
    }
  }
}

/**
 * Forward FFT of a real sequence of even length n (power of two), returning
 * bins 0..n/2 inclusive. Computed through an n/2-point complex FFT.
 */
export class RealFFT {
  readonly n: number;
  private readonly zr: Float64Array;
  private readonly zi: Float64Array;
  private readonly wr: Float64Array;
  private readonly wi: Float64Array;

  constructor(n: number) {
    if (n < 4 || (n & (n - 1)) !== 0) throw new Error(`RealFFT: size must be a power of two ≥ 4, got ${n}`);
    this.n = n;
    const half = n >>> 1;
    this.zr = new Float64Array(half);
    this.zi = new Float64Array(half);
    this.wr = new Float64Array(half + 1);
    this.wi = new Float64Array(half + 1);
    for (let k = 0; k <= half; k++) {
      const a = (-2 * Math.PI * k) / n;
      this.wr[k] = Math.cos(a);
      this.wi[k] = Math.sin(a);
    }
  }

  /** x has length n; outRe/outIm have length n/2+1. */
  forward(x: Float64Array, outRe: Float64Array, outIm: Float64Array): void {
    const n = this.n;
    const half = n >>> 1;
    const zr = this.zr;
    const zi = this.zi;
    for (let k = 0; k < half; k++) {
      zr[k] = x[2 * k]!;
      zi[k] = x[2 * k + 1]!;
    }
    fftInPlace(zr, zi);
    // X[k] = Fe[k] + W^k Fo[k]
    //   Fe = (Z[k] + conj(Z[half-k])) / 2
    //   Fo = -i (Z[k] - conj(Z[half-k])) / 2
    for (let k = 0; k <= half; k++) {
      const a = k === half ? 0 : k;
      const b = k === 0 ? 0 : half - k;
      const ar = zr[a]!;
      const ai = zi[a]!;
      const br = zr[b]!;
      const bi = -zi[b]!; // conj
      const fer = 0.5 * (ar + br);
      const fei = 0.5 * (ai + bi);
      // -i * (a - b) / 2 = ( (ai - bi)/2 , -(ar - br)/2 )
      const forr = 0.5 * (ai - bi);
      const foi = -0.5 * (ar - br);
      const wr = this.wr[k]!;
      const wi = this.wi[k]!;
      outRe[k] = fer + (forr * wr - foi * wi);
      outIm[k] = fei + (forr * wi + foi * wr);
    }
  }
}

/** Naive DFT, for tests only. */
export function naiveDft(re: Float64Array, im: Float64Array): ComplexArray {
  const n = re.length;
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * k * t) / n;
      const c = Math.cos(a);
      const s = Math.sin(a);
      sr += re[t]! * c - im[t]! * s;
      si += re[t]! * s + im[t]! * c;
    }
    outRe[k] = sr;
    outIm[k] = si;
  }
  return { re: outRe, im: outIm };
}
