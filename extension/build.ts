import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const production = process.argv.includes("--production");

const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  sourcesContent: false,
  logLevel: "info",
  minify: production,
  sourcemap: !production,
  loader: { ".html": "text" },
} satisfies esbuild.BuildOptions;

// The extension entry runs inside the Extension Host (CJS, vm sandbox).
await esbuild.build({
  ...shared,
  entryPoints: ["src/extension.ts"],
  outfile: manifest.entry,
});

// The crema worker runs out-of-context (worker thread, or a child process
// under Live's managed host). onnxruntime-node loads a native addon, so it
// stays external and is resolved from node_modules next to dist/.
await esbuild.build({
  ...shared,
  entryPoints: ["src/worker/cremaWorker.ts"],
  outfile: "dist/crema-worker.cjs",
  external: ["onnxruntime-node"],
});

// Ship the model + decoder table next to the bundle: dist/assets/models/crema.
const assetsSrc = path.join("assets", "models", "crema");
const assetsDest = path.join("dist", "assets", "models", "crema");
fs.rmSync(path.join("dist", "assets"), { recursive: true, force: true });
fs.mkdirSync(assetsDest, { recursive: true });
for (const f of fs.readdirSync(assetsSrc)) {
  fs.copyFileSync(path.join(assetsSrc, f), path.join(assetsDest, f));
}

// Local stand-ins for the host-provided storage/temp directories, passed to
// extensions-cli run by npm start (the dev host provides none by default).
fs.mkdirSync(".dev/storage", { recursive: true });
fs.mkdirSync(".dev/tmp", { recursive: true });

console.log("Built dist/extension.js, dist/crema-worker.cjs and copied model assets.");
