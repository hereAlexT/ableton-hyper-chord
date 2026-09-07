import { describe, expect, it } from "vitest";

import { decodeAudioFile, encodeWav } from "../src/analysis/audioFile.js";

describe("audioFile", () => {
  const stereo = new Float32Array(400);
  for (let i = 0; i < 200; i++) {
    stereo[2 * i] = Math.sin(i / 7);
    stereo[2 * i + 1] = -0.5 * Math.cos(i / 5);
  }

  it("round-trips 16-bit PCM WAV", () => {
    const d = decodeAudioFile(encodeWav(stereo, 48000, 2, false));
    expect(d.sampleRate).toBe(48000);
    expect(d.channels).toBe(2);
    expect(d.samples.length).toBe(400);
    for (let i = 0; i < 400; i++) expect(d.samples[i]).toBeCloseTo(stereo[i]!, 3);
  });

  it("round-trips float32 WAV exactly", () => {
    const d = decodeAudioFile(encodeWav(stereo, 44100, 2, true));
    expect(d.sampleRate).toBe(44100);
    for (let i = 0; i < 400; i++) expect(d.samples[i]).toBe(stereo[i]);
  });

  it("decodes a minimal AIFF", () => {
    // COMM: 1 ch, 4 frames, 16 bit, 44100 Hz (80-bit extended 0x400EAC44000000000000)
    const frames = [1000, -1000, 32767, -32768];
    const ssndSize = 8 + frames.length * 2;
    const buf = new Uint8Array(12 + 8 + 18 + 8 + ssndSize);
    const dv = new DataView(buf.buffer);
    const put = (o: number, s: string) => {
      for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i);
    };
    put(0, "FORM");
    dv.setUint32(4, buf.length - 8, false);
    put(8, "AIFF");
    put(12, "COMM");
    dv.setUint32(16, 18, false);
    dv.setInt16(20, 1, false);
    dv.setUint32(22, frames.length, false);
    dv.setInt16(26, 16, false);
    const ext = [0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0];
    ext.forEach((b, i) => (buf[28 + i] = b));
    put(38, "SSND");
    dv.setUint32(42, ssndSize, false);
    dv.setUint32(46, 0, false);
    dv.setUint32(50, 0, false);
    frames.forEach((v, i) => dv.setInt16(54 + i * 2, v, false));

    const d = decodeAudioFile(buf);
    expect(d.sampleRate).toBe(44100);
    expect(d.channels).toBe(1);
    expect(Array.from(d.samples).map((v) => Math.round(v * 32768))).toEqual(frames);
  });

  it("rejects unknown containers", () => {
    expect(() => decodeAudioFile(new Uint8Array(64))).toThrow(/Unsupported/);
  });
});
