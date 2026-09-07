// Interleaved PCM -> mono at a target rate. The C++ side uses r8brain; this is
// a windowed-sinc (Lanczos) resampler with the cutoff scaled for downsampling,
// which is more than enough for a feature front-end that log-compresses and
// global-normalises everything anyway.

export function toMono(interleaved: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return interleaved;
  const frames = Math.floor(interleaved.length / channels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    const base = i * channels;
    for (let c = 0; c < channels; c++) sum += interleaved[base + c]!;
    mono[i] = sum / channels;
  }
  return mono;
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

/** Lanczos-windowed sinc resampling. `a` is the window half-width in output-side taps. */
export function resample(input: Float32Array, inRate: number, outRate: number, a = 16): Float32Array {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate; // input samples per output sample
  const outLen = Math.floor((input.length * outRate) / inRate);
  const out = new Float32Array(outLen);
  // When downsampling, widen the kernel so its cutoff sits at the new Nyquist.
  const scale = Math.min(1, 1 / ratio); // cutoff relative to input Nyquist
  const halfWidth = a / scale; // taps in input samples
  const n = input.length;

  for (let i = 0; i < outLen; i++) {
    const center = i * ratio;
    const lo = Math.max(0, Math.ceil(center - halfWidth));
    const hi = Math.min(n - 1, Math.floor(center + halfWidth));
    let acc = 0;
    let wsum = 0;
    for (let k = lo; k <= hi; k++) {
      const x = (k - center) * scale;
      const w = sinc(x) * sinc(x / a);
      acc += input[k]! * w;
      wsum += w;
    }
    out[i] = wsum !== 0 ? acc / wsum : 0;
  }
  return out;
}

/** toMono + resample in one step; returns the buffer the model should see. */
export function prepareAudio(
  interleaved: Float32Array,
  sampleRate: number,
  channels: number,
  targetRate: number,
): Float32Array {
  const mono = toMono(interleaved, channels);
  return sampleRate === targetRate ? mono : resample(mono, sampleRate, targetRate);
}
