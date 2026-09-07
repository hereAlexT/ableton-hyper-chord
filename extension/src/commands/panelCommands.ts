// Browser panel: start the local server and hand the user its URL.

import type { Ctx } from "../chordTrack/liveTypes.js";
import { showMessage } from "../ui/dialogs.js";
import type { Panel } from "../ui/panelServer.js";

export function registerPanelCommands(context: Ctx, deps: { panel: Panel }): void {
  context.commands.registerCommand("hyperchord.openPanel", () => {
    void (async () => {
      try {
        const url = await deps.panel.start();
        deps.panel.openInBrowser();
        await showMessage(
          context,
          "Hyper Chord Panel",
          `Open ${url} in a browser and leave it open.`,
          "Every “What's This Chord?” and “Extract Chords” result is pushed there as it happens.",
        );
      } catch (error) {
        console.error("hyper-chord: panel failed:", error);
        await showMessage(context, "Hyper Chord Panel", error instanceof Error ? error.message : String(error));
      }
    })();
  });

  for (const scope of ["MidiClip", "MidiTrack", "AudioTrack"] as const) {
    context.ui
      .registerContextMenuAction(scope, "Open Hyper Chord Panel…", "hyperchord.openPanel")
      .catch((e) => console.error(`hyper-chord: could not register panel action on ${scope}:`, e));
  }
}
