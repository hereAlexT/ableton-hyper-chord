// Build music_app's C++ crema front-end + decoder as a standalone reference
// binary (.parity/cqt_parity). test/parity.test.ts diffs the TypeScript port
// against it. The C++ was itself validated against the Python reference
// (see music_app/packages/audio_ml_ffi/tool/cqt_parity/parity_report.json).
//
//   MUSIC_APP=/path/to/music_app npm run parity:build

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const musicApp = process.env["MUSIC_APP"] ?? path.resolve("..", "..", "music_app");
const pkg = path.join(musicApp, "packages", "audio_ml_ffi");
if (!fs.existsSync(path.join(pkg, "src", "crema", "CremaFeatures.cpp"))) {
  console.error(`music_app sources not found under ${pkg} — set MUSIC_APP.`);
  process.exit(1);
}
fs.mkdirSync(".parity", { recursive: true });
const out = path.join(".parity", "cqt_parity");
const args = [
  "-std=c++20",
  "-O2",
  path.join(pkg, "tool/cqt_parity/main.cpp"),
  path.join(pkg, "src/common/CqtCore.cpp"),
  path.join(pkg, "src/ace/AceFeatures.cpp"),
  path.join(pkg, "src/ace/AceDecoder.cpp"),
  path.join(pkg, "src/crema/CremaFeatures.cpp"),
  path.join(pkg, "src/crema/CremaDecoder.cpp"),
  `-I${path.join(pkg, "src/common")}`,
  `-I${path.join(pkg, "src/ace")}`,
  `-I${path.join(pkg, "src/crema")}`,
  `-I${path.join(pkg, "src/pocketfft")}`,
  "-o",
  out,
];
console.log("clang++", args.join(" "));
execFileSync("clang++", args, { stdio: "inherit" });
console.log(`built ${out}`);
