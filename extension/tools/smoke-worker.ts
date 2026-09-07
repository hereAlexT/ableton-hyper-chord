// Exercise the host<->runtime bridge exactly as the extension does: spawn
// dist/crema-worker.cjs via CremaClient and analyse a file. Set
// HYPERCHORD_FORCE_CHILD=1 to test the child-process transport.
//
//   npm run build:dev && npx tsx tools/smoke-worker.ts path/to/audio.wav

import * as path from "node:path";

import { displayName } from "../src/analysis/chordLabel.js";
import { CremaClient } from "../src/analysis/crema/cremaClient.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: tsx tools/smoke-worker.ts <audio.wav>");
  process.exit(1);
}
const dist = path.resolve("dist");
const client = new CremaClient({
  workerPath: path.join(dist, "crema-worker.cjs"),
  modelPath: path.join(dist, "assets/models/crema/crema_chord.onnx"),
  decoderPath: path.join(dist, "assets/models/crema/crema_decoder.json"),
});

const t0 = performance.now();
let last = "";
const result = await client.analyze(path.resolve(file), {
  onProgress: (stage, pct) => {
    const line = `${stage} ${pct}%`;
    if (line !== last && pct % 20 === 0) console.log("  " + line);
    last = line;
  },
});
console.log(`done in ${((performance.now() - t0) / 1000).toFixed(2)} s: ${result.frames} frames, ${result.segments.length} segments, ${result.durationSeconds.toFixed(1)} s audio`);
for (const s of result.segments.slice(0, 12)) console.log(`  ${s.start.toFixed(2)}–${s.end.toFixed(2)} ${displayName(s.label)}`);
client.shutdown();
