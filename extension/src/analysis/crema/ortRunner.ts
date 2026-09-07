// onnxruntime-node backed ModelRunner. Only ever imported out-of-context
// (worker / child process / tools): it loads a native addon.

import * as ort from "onnxruntime-node";

import { NUM_HARMONICS, nBins, CREMA_PARAMS } from "./cremaFeatures.js";
import type { ModelOutputs, ModelRunner } from "./pipeline.js";

const sessions = new Map<string, Promise<ort.InferenceSession>>();

function sessionFor(modelPath: string): Promise<ort.InferenceSession> {
  let s = sessions.get(modelPath);
  if (!s) {
    s = ort.InferenceSession.create(modelPath, {
      executionProviders: ["cpu"],
      intraOpNumThreads: 4,
      interOpNumThreads: 1,
      graphOptimizationLevel: "all",
    });
    sessions.set(modelPath, s);
  }
  return s;
}

export function createOrtRunner(modelPath: string): ModelRunner {
  return {
    async run(input: Float32Array, frames: number): Promise<ModelOutputs> {
      const session = await sessionFor(modelPath);
      const bins = nBins(CREMA_PARAMS);
      const tensor = new ort.Tensor("float32", input, [1, frames, bins, NUM_HARMONICS]);
      const inputName = session.inputNames[0] ?? "cqt_mag";
      const out = await session.run({ [inputName]: tensor }, ["chord_tag", "chord_bass"]);
      const tag = out["chord_tag"];
      const bass = out["chord_bass"];
      if (!tag || !bass) throw new Error("model did not return chord_tag / chord_bass");
      return { tag: tag.data as Float32Array, bass: bass.data as Float32Array };
    },
  };
}
