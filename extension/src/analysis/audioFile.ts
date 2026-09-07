// Minimal WAV / AIFF decoder: enough for what Live's "Record File Type"
// setting can produce (PCM 16/24/32-bit, IEEE float 32/64), returning
// interleaved float32 in [-1, 1].

export interface DecodedAudio {
  sampleRate: number;
  channels: number;
  /** Interleaved samples, length = frames * channels. */
  samples: Float32Array;
}

export function decodeAudioFile(bytes: Uint8Array): DecodedAudio {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = ascii(bytes, 0, 4);
  if (tag === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return decodeWav(bytes, dv);
  if (tag === "FORM") {
    const kind = ascii(bytes, 8, 4);
    if (kind === "AIFF" || kind === "AIFC") return decodeAiff(bytes, dv, kind === "AIFC");
  }
  throw new Error("Unsupported audio file: expected WAV or AIFF");
}

function ascii(bytes: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[off + i]!);
  return s;
}

// ------------------------------------------------------------------- WAV ---

function decodeWav(bytes: Uint8Array, dv: DataView): DecodedAudio {
  let pos = 12;
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let data: Uint8Array | null = null;
  while (pos + 8 <= bytes.length) {
    const id = ascii(bytes, pos, 4);
    const size = dv.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === "fmt ") {
      format = dv.getUint16(body, true);
      channels = dv.getUint16(body + 2, true);
      sampleRate = dv.getUint32(body + 4, true);
      bits = dv.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 26) {
        // WAVE_FORMAT_EXTENSIBLE: the sub-format GUID's first two bytes.
        format = dv.getUint16(body + 24, true);
      }
    } else if (id === "data") {
      data = bytes.subarray(body, Math.min(bytes.length, body + size));
    }
    pos = body + size + (size & 1);
  }
  if (!data || channels === 0 || sampleRate === 0) throw new Error("Malformed WAV: missing fmt/data chunk");
  const samples = pcmToFloat(data, format === 3 ? "float" : "pcm", bits, true);
  return { sampleRate, channels, samples };
}

// ------------------------------------------------------------------ AIFF ---

function decodeAiff(bytes: Uint8Array, dv: DataView, aifc: boolean): DecodedAudio {
  let pos = 12;
  let channels = 0;
  let bits = 0;
  let sampleRate = 0;
  let compression = "NONE";
  let data: Uint8Array | null = null;
  while (pos + 8 <= bytes.length) {
    const id = ascii(bytes, pos, 4);
    const size = dv.getUint32(pos + 4, false);
    const body = pos + 8;
    if (id === "COMM") {
      channels = dv.getInt16(body, false);
      bits = dv.getInt16(body + 6, false);
      sampleRate = readExtended80(dv, body + 8);
      if (aifc && size >= 22) compression = ascii(bytes, body + 18, 4);
    } else if (id === "SSND") {
      const offset = dv.getUint32(body, false);
      data = bytes.subarray(body + 8 + offset, Math.min(bytes.length, body + size));
    }
    pos = body + size + (size & 1);
  }
  if (!data || channels === 0 || sampleRate === 0) throw new Error("Malformed AIFF: missing COMM/SSND chunk");
  let kind: "pcm" | "float" = "pcm";
  let little = false;
  switch (compression) {
    case "NONE":
      break;
    case "sowt":
      little = true;
      break;
    case "fl32":
    case "FL32":
      kind = "float";
      bits = 32;
      break;
    case "fl64":
    case "FL64":
      kind = "float";
      bits = 64;
      break;
    default:
      throw new Error(`Unsupported AIFF-C compression: ${compression}`);
  }
  return { sampleRate: Math.round(sampleRate), channels, samples: pcmToFloat(data, kind, bits, little) };
}

/** IEEE 754 80-bit extended, as used by AIFF's sample rate. */
function readExtended80(dv: DataView, off: number): number {
  const b0 = dv.getUint8(off);
  const b1 = dv.getUint8(off + 1);
  const sign = b0 & 0x80 ? -1 : 1;
  const exponent = ((b0 & 0x7f) << 8) | b1;
  const hi = dv.getUint32(off + 2, false);
  const lo = dv.getUint32(off + 6, false);
  if (exponent === 0 && hi === 0 && lo === 0) return 0;
  const mantissa = hi * 2 ** 32 + lo;
  return sign * mantissa * 2 ** (exponent - 16383 - 63);
}

// ----------------------------------------------------------- conversion ---

function pcmToFloat(data: Uint8Array, kind: "pcm" | "float", bits: number, little: boolean): Float32Array {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const bytesPer = bits / 8;
  const n = Math.floor(data.byteLength / bytesPer);
  const out = new Float32Array(n);
  if (kind === "float") {
    if (bits === 32) for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, little);
    else if (bits === 64) for (let i = 0; i < n; i++) out[i] = dv.getFloat64(i * 8, little);
    else throw new Error(`Unsupported float bit depth ${bits}`);
    return out;
  }
  switch (bits) {
    case 8:
      for (let i = 0; i < n; i++) out[i] = (data[i]! - 128) / 128;
      break;
    case 16:
      for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, little) / 32768;
      break;
    case 24:
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        let v = little
          ? data[o]! | (data[o + 1]! << 8) | (data[o + 2]! << 16)
          : data[o + 2]! | (data[o + 1]! << 8) | (data[o]! << 16);
        if (v & 0x800000) v -= 0x1000000;
        out[i] = v / 8388608;
      }
      break;
    case 32:
      for (let i = 0; i < n; i++) out[i] = dv.getInt32(i * 4, little) / 2147483648;
      break;
    default:
      throw new Error(`Unsupported PCM bit depth ${bits}`);
  }
  return out;
}

/** Encode interleaved float32 as a 16-bit PCM or 32-bit float WAV (tests + tools). */
export function encodeWav(samples: Float32Array, sampleRate: number, channels: number, float = false): Uint8Array {
  const bytesPer = float ? 4 : 2;
  const dataSize = samples.length * bytesPer;
  const buf = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const put = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i);
  };
  put(0, "RIFF");
  dv.setUint32(4, 36 + dataSize, true);
  put(8, "WAVE");
  put(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, float ? 3 : 1, true);
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * channels * bytesPer, true);
  dv.setUint16(32, channels * bytesPer, true);
  dv.setUint16(34, bytesPer * 8, true);
  put(36, "data");
  dv.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    if (float) dv.setFloat32(44 + i * 4, v, true);
    else dv.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return bytes;
}
