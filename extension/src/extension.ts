import * as path from "node:path";

import { initialize, type ActivationContext } from "@ableton-extensions/sdk";

import { CremaClient } from "./analysis/crema/cremaClient.js";
import { registerExtractCommands } from "./commands/extract.js";
import { registerPanelCommands } from "./commands/panelCommands.js";
import { registerWhatsThisChord } from "./commands/whatsThisChord.js";
import { SETTINGS } from "./settings.js";
import { Panel } from "./ui/panelServer.js";

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  // build.ts places the worker bundle and the model next to this file in dist/.
  const distDir = __dirname;
  const models = path.join(distDir, "assets", "models", "crema");
  const crema = new CremaClient({
    workerPath: path.join(distDir, "crema-worker.cjs"),
    modelPath: path.join(models, "crema_chord.onnx"),
    decoderPath: path.join(models, "crema_decoder.json"),
  });
  const panel = new Panel(SETTINGS.panelPort);

  registerExtractCommands(context, { crema, panel });
  registerWhatsThisChord(context, { panel });
  registerPanelCommands(context, { panel });

  const song = context.application.song;
  console.log(`hyper-chord ready · ${song.tempo} bpm · key root ${song.rootNote} ${song.scaleName}`);
}
