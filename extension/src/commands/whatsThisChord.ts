// F3: name the chord(s) formed by the selected notes of a MIDI clip.
//
// Two entry points, because Live's piano-roll context menu does not carry
// extension actions:
//  - right-click a MIDI clip: uses the clip's selected notes (falls back to
//    the whole clip when nothing is selected);
//  - make a time selection over a MIDI track and right-click: uses the notes
//    inside that time range.

import { DataModelObject, MidiClip, MidiTrack, type ArrangementSelection, type Handle } from "@ableton-extensions/sdk";

import { pcName } from "../analysis/chordLabel.js";
import { describeKey, spellingForKey, type KeyContext } from "../analysis/keyContext.js";
import { detectChordsFromNotes } from "../analysis/midiChords.js";
import type { MidiNote } from "../analysis/types.js";
import { readKey } from "../chordTrack/keyFromSong.js";
import type { Ctx, LiveMidiTrack } from "../chordTrack/liveTypes.js";
import { collectTrackNotes } from "../chordTrack/trackRange.js";
import { chordText } from "../chordTrack/writeChords.js";
import { SETTINGS } from "../settings.js";
import { fmtBarBeat, fmtBeat, showChordListDialog, showMessage, type ChordListDialog } from "../ui/dialogs.js";
import type { Panel } from "../ui/panelServer.js";

export function registerWhatsThisChord(context: Ctx, deps: { panel: Panel }): void {
  context.commands.registerCommand("hyperchord.whatsThisChord", (arg: unknown) => {
    void guarded(context, "What's This Chord?", async () => {
      const clip = context.getObjectFromHandle(arg as Handle, DataModelObject);
      if (!(clip instanceof MidiClip)) throw new Error("Right-click a MIDI clip.");
      const notes = clip.notes;
      const selected = notes.filter((n) => n.selected).length;
      console.log(`hyper-chord: What's This Chord on "${clip.name}": ${notes.length} notes, ${selected} selected`);
      const result = whatsThisChord(readKey(context.application.song), clip.name, notes, fmtBeat);
      console.log(`hyper-chord: → ${result.title}${result.rows?.length ? " · " + result.rows.map((r) => r.chord).join(" ") : ""}`);
      deps.panel.publish(result);
      await showChordListDialog(context, result, 560, 380);
    });
  });

  context.commands.registerCommand("hyperchord.whatsThisChordSelection", (arg: unknown) => {
    void guarded(context, "What's This Chord?", async () => {
      const sel = arg as ArrangementSelection;
      const tracks = sel.selected_lanes
        .map((h) => context.getObjectFromHandle(h, DataModelObject))
        .filter((o): o is LiveMidiTrack => o instanceof MidiTrack);
      const range = { start: sel.time_selection_start, end: sel.time_selection_end };
      if (tracks.length === 0) throw new Error("Select a MIDI track in the Arrangement first.");
      if (range.end - range.start <= 0) throw new Error("Make a time selection in the Arrangement first.");
      const notes = tracks.flatMap((t) => collectTrackNotes(t, range));
      const label = `${tracks.map((t) => t.name).join(", ")} · bars ${fmtBarBeat(range.start)}–${fmtBarBeat(range.end)}`;
      console.log(`hyper-chord: What's This Chord (selection) on ${label}: ${notes.length} notes`);
      const result = whatsThisChord(readKey(context.application.song), label, notes, fmtBarBeat, true);
      console.log(`hyper-chord: → ${result.title}${result.rows?.length ? " · " + result.rows.map((r) => r.chord).join(" ") : ""}`);
      deps.panel.publish(result);
      await showChordListDialog(context, result, 560, 380);
    });
  });

  context.ui
    .registerContextMenuAction("MidiClip", "What's This Chord?", "hyperchord.whatsThisChord")
    .catch((e) => console.error("hyper-chord: could not register What's This Chord:", e));
  context.ui
    .registerContextMenuAction("MidiTrack.ArrangementSelection", "What's This Chord? (Selection)", "hyperchord.whatsThisChordSelection")
    .catch((e) => console.error("hyper-chord: could not register What's This Chord (Selection):", e));
}

async function guarded(context: Ctx, title: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.error(`hyper-chord: ${title} failed:`, error);
    await showMessage(context, title, error instanceof Error ? error.message : String(error));
  }
}

/** Pure part, so it can be unit-tested without Live. */
export function whatsThisChord(
  key: KeyContext,
  sourceName: string,
  notes: MidiNote[],
  fmtTime: (t: number) => string = fmtBeat,
  ignoreSelection = false,
): ChordListDialog {
  const spelling = spellingForKey(key);
  const selected = ignoreSelection ? [] : notes.filter((n) => n.selected);
  const used = selected.length > 0 ? selected : notes;
  // Asking about a chord wants the honest answer: inversions and extensions stay.
  const segments = detectChordsFromNotes(used, { onsetTolerance: SETTINGS.onsetTolerance, inversions: true, simplifyExtensions: false });
  const nameOpts = { spelling, key, romanInClipName: true };

  const rows = segments
    .filter((s) => s.label !== "N")
    .map((s) => {
      const pcs = new Set<number>();
      for (const n of used) {
        if (n.muted) continue;
        if (n.startTime < s.end && n.startTime + n.duration > s.start) pcs.add(((n.pitch % 12) + 12) % 12);
      }
      return {
        start: fmtTime(s.start),
        end: fmtTime(s.end),
        chord: chordText(s.label, nameOpts),
        notes: [...pcs].sort((a, b) => a - b).map((pc) => pcName(pc, spelling)).join(" "),
      };
    });

  const noteWord = `${used.length} note${used.length === 1 ? "" : "s"}${selected.length ? " selected" : ""}`;
  return {
    title: rows.length === 1 ? rows[0]!.chord : `${rows.length} chords`,
    subtitle: `${sourceName || "MIDI"} · ${describeKey(key)} · ${noteWord}`,
    columns: ["Start", "End", "Chord", "Pitch classes"],
    keys: ["start", "end", "chord", "notes"],
    rows,
    note:
      !ignoreSelection && selected.length === 0 && notes.length > 0
        ? "No notes were selected, so the whole clip was analysed. Tip: make a time selection in the Arrangement and use “What's This Chord? (Selection)”."
        : undefined,
    message: notes.length === 0 ? "No notes here." : undefined,
  };
}
