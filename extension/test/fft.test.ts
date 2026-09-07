import { describe, expect, it } from "vitest";

import { RealFFT, fftInPlace, naiveDft } from "../src/analysis/fft.js";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

describe("fft", () => {
  for (const n of [4, 16, 128, 1024]) {
    it(`complex FFT matches naive DFT for n=${n}`, () => {
      const r = rng(n);
      const re = Float64Array.from({ length: n }, () => r());
      const im = Float64Array.from({ length: n }, () => r());
      const ref = naiveDft(re, im);
      fftInPlace(re, im);
      for (let k = 0; k < n; k++) {
        expect(re[k]).toBeCloseTo(ref.re[k]!, 9);
        expect(im[k]).toBeCloseTo(ref.im[k]!, 9);
      }
    });

    it(`real FFT matches naive DFT for n=${n}`, () => {
      const r = rng(n + 7);
      const x = Float64Array.from({ length: n }, () => r());
      const ref = naiveDft(x, new Float64Array(n));
      const outRe = new Float64Array(n / 2 + 1);
      const outIm = new Float64Array(n / 2 + 1);
      new RealFFT(n).forward(x, outRe, outIm);
      for (let k = 0; k <= n / 2; k++) {
        expect(outRe[k]).toBeCloseTo(ref.re[k]!, 9);
        expect(outIm[k]).toBeCloseTo(ref.im[k]!, 9);
      }
    });
  }

  it("rejects non power-of-two sizes", () => {
    expect(() => new RealFFT(12)).toThrow();
  });
});
