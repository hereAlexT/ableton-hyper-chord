// End-to-end crema run on an audio file, in-process (no worker), printing the
// chord segments and stage timings.
//
//   npx tsx tools/smoke-crema.ts path/to/audio.wav [--key C:maj]

import * as fs from "node:fs";
import * as path from "node:path";

import { decodeAudioFile } from "../src/analysis/audioFile.js";
import { parseDecoderTable, type CremaDecoderJson } from "../src/analysis/crema/decoderTable.js";
import { createOrtRunner } from "../src/analysis/crema/ortRunner.js";
import { analyzePcm, type CremaStage } from "../src/analysis/crema/pipeline.js";
import { displayName } from "../src/analysis/chordLabel.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: tsx tools/smoke-crema.ts <audio.wav>");
  process.exit(1);
}

const assets = path.resolve("assets/models/crema");
const table = parseDecoderTable(JSON.parse(fs.readFileSync(path.join(assets, "crema_decoder.json"), "utf8")) as CremaDecoderJson);
const runner = createOrtRunner(path.join(assets, "crema_chord.onnx"));

const t0 = performance.now();
const audio = decodeAudioFile(fs.readFileSync(file));
console.log(`${file}: ${audio.sampleRate} Hz, ${audio.channels} ch, ${(audio.samples.length / audio.channels / audio.sampleRate).toFixed(2)} s`);

const stageStart = new Map<CremaStage, number>();
let lastStage: CremaStage | null = null;
const result = await analyzePcm(audio.samples, audio.sampleRate, audio.channels, table, runner, (stage, pct) => {
  if (stage !== lastStage) {
    if (lastStage) console.log(`  ${lastStage}: ${((performance.now() - stageStart.get(lastStage)!) / 1000).toFixed(2)} s`);
    stageStart.set(stage, performance.now());
    lastStage = stage;
  }
  if (pct % 25 === 0) process.stdout.write(`\r  ${stage} ${pct}%   `);
});
if (lastStage) console.log(`\n  ${lastStage}: ${((performance.now() - stageStart.get(lastStage)!) / 1000).toFixed(2)} s`);
console.log(`total ${((performance.now() - t0) / 1000).toFixed(2)} s, ${result.frames} frames, ${result.segments.length} segments\n`);

for (const s of result.segments) {
  console.log(`${s.start.toFixed(3).padStart(8)} – ${s.end.toFixed(3).padStart(8)}  ${s.label.padEnd(12)} ${displayName(s.label).padEnd(8)} conf ${s.confidence.toFixed(2)}`);
}
