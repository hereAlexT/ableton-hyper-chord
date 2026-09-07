// F1 / F2: extract chords from an audio or MIDI track (whole track or an
// arrangement selection) into the master chord track or a fresh one.

import { AudioTrack, DataModelObject, MidiTrack, type ArrangementSelection, type Handle } from "@ableton-extensions/sdk";

import type { CremaClient } from "../analysis/crema/cremaClient.js";
import type { CremaStage } from "../analysis/crema/pipeline.js";
import { describeKey, spellingForKey, type KeyContext } from "../analysis/keyContext.js";
import { detectChordsFromNotes } from "../analysis/midiChords.js";
import type { ChordSegment } from "../analysis/types.js";
import { readKey } from "../chordTrack/keyFromSong.js";
import type { BeatRange, Ctx, LiveAudioTrack, LiveMidiTrack, LiveTrack } from "../chordTrack/liveTypes.js";
import { createChordTrack, findMasterChordTrack, getOrCreateMasterChordTrack } from "../chordTrack/masterTrack.js";
import { collectTrackNotes, wholeTrackRange } from "../chordTrack/trackRange.js";
import { chordText, prepareSegments, writeChordClips, writeCuePoints } from "../chordTrack/writeChords.js";
import { SETTINGS } from "../settings.js";
import { loadExtractOptions, saveExtractOptions } from "../settingsStore.js";
import { fmtBarBeat, showChordListDialog, showMessage, type ChordListDialog } from "../ui/dialogs.js";
import { askExtractOptions } from "../ui/optionsDialog.js";
import type { Panel } from "../ui/panelServer.js";

export interface ExtractDeps {
  crema: CremaClient;
  panel: Panel;
}

type Target = "master" | "new";

export function registerExtractCommands(context: Ctx, deps: ExtractDeps): void {
  const { commands, ui } = context;

  const trackCommand = (target: Target) => (arg: unknown) => {
    void run(context, deps, () => {
      const track = context.getObjectFromHandle(arg as Handle, DataModelObject);
      if (!(track instanceof AudioTrack || track instanceof MidiTrack)) throw new Error("Right-click an audio or MIDI track.");
      const range = wholeTrackRange(track);
      if (!range) throw new Error(`"${track.name}" has no clips in the Arrangement.`);
      return { track, range };
    }, target);
  };

  const selectionCommand = (target: Target) => (arg: unknown) => {
    void run(context, deps, () => {
      const sel = arg as ArrangementSelection;
      const tracks = sel.selected_lanes
        .map((h) => context.getObjectFromHandle(h, DataModelObject))
        .filter((o): o is LiveAudioTrack | LiveMidiTrack => o instanceof AudioTrack || o instanceof MidiTrack);
      const track = tracks[0];
      if (!track) throw new Error("Select an audio or MIDI track in the Arrangement first.");
      const range = { start: sel.time_selection_start, end: sel.time_selection_end };
      if (range.end - range.start <= 0) throw new Error("Make a time selection in the Arrangement first.");
      return { track, range };
    }, target);
  };

  commands.registerCommand("hyperchord.track.toMaster", trackCommand("master"));
  commands.registerCommand("hyperchord.track.toNew", trackCommand("new"));
  commands.registerCommand("hyperchord.selection.toMaster", selectionCommand("master"));
  commands.registerCommand("hyperchord.selection.toNew", selectionCommand("new"));

  const register = (scope: Parameters<typeof ui.registerContextMenuAction>[0], title: string, id: string) =>
    ui.registerContextMenuAction(scope, title, id).catch((e) => console.error(`hyper-chord: could not register "${title}" on ${scope}:`, e));

  for (const scope of ["AudioTrack", "MidiTrack"] as const) {
    void register(scope, "Extract Chords to Main Chord Track", "hyperchord.track.toMaster");
    void register(scope, "Extract Chords to New Chord Track", "hyperchord.track.toNew");
  }
  for (const scope of ["AudioTrack.ArrangementSelection", "MidiTrack.ArrangementSelection"] as const) {
    void register(scope, "Extract Chords (Selection) to Main Chord Track", "hyperchord.selection.toMaster");
    void register(scope, "Extract Chords (Selection) to New Chord Track", "hyperchord.selection.toNew");
  }
}

async function run(
  context: Ctx,
  deps: ExtractDeps,
  resolve: () => { track: LiveAudioTrack | LiveMidiTrack; range: BeatRange },
  target: Target,
): Promise<void> {
  try {
    const { track, range } = resolve();
    await extractChords(context, deps, track, range, target);
  } catch (error) {
    console.error("hyper-chord: extract failed:", error);
    await showMessage(context, "Hyper Chord", error instanceof Error ? error.message : String(error));
  }
}

export async function extractChords(
  context: Ctx,
  deps: ExtractDeps,
  source: LiveAudioTrack | LiveMidiTrack,
  range: BeatRange,
  target: Target,
): Promise<void> {
  const song = context.application.song;
  const key = readKey(song);
  const spelling = spellingForKey(key);

  const master = findMasterChordTrack(context);
  if (target === "master" && master && master.handle.id === source.handle.id) {
    throw new Error("That is the Master Chord Track itself — pick a source track.");
  }

  const isAudio = source instanceof AudioTrack;
  const storage = context.environment.storageDirectory;
  const opts = await askExtractOptions(context, {
    title: target === "master" ? "Extract Chords to Main Chord Track" : "Extract Chords to New Chord Track",
    subtitle: `${source.name} · ${describeKey(key)} · bars ${fmtBarBeat(range.start)}–${fmtBarBeat(range.end)}`,
    source: isAudio ? "audio" : "midi",
    values: loadExtractOptions(storage),
  });
  if (!opts) {
    console.log("hyper-chord: extraction cancelled");
    return;
  }
  saveExtractOptions(storage, opts);

  console.log(
    `hyper-chord: extracting from "${source.name}" (${isAudio ? "audio" : "MIDI"}) beats ${range.start}–${range.end} → ${target} · ${JSON.stringify(opts)}`,
  );
  let segments: ChordSegment[];
  if (source instanceof AudioTrack) {
    segments = await analyzeAudioTrack(context, deps.crema, source, range);
  } else {
    const notes = collectTrackNotes(source, range);
    console.log(`hyper-chord: ${notes.length} notes collected from ${source.arrangementClips.length} clips`);
    segments = detectChordsFromNotes(notes, {
      onsetTolerance: opts.onsetTolerance,
      inversions: opts.midiInversions,
      simplifyExtensions: opts.simplifyExtensions,
    });
  }
  console.log(`hyper-chord: ${segments.length} raw segments: ${segments.map((s) => s.label).join(" ")}`);

  const dest = target === "master" ? await getOrCreateMasterChordTrack(context) : await createChordTrack(context, `${SETTINGS.newTrackPrefix}${source.name}`);
  const writeOpts = {
    spelling,
    key,
    clearRange: target === "master" ? range : undefined,
    snapBeats: opts.snapBeats,
    minSegmentBeats: opts.minSegmentBeats,
    romanInClipName: opts.romanInClipName,
    voicingBase: SETTINGS.voicingBase,
  };
  const written = await writeChordClips(context, dest, segments, writeOpts);
  if (SETTINGS.cuePoints && written > 0) await writeCuePoints(context, segments, writeOpts);

  const summary = summarize(
    `${written} chord${written === 1 ? "" : "s"} → ${dest.name}`,
    `${source.name} · ${describeKey(key)} · bars ${fmtBarBeat(range.start)}–${fmtBarBeat(range.end)}`,
    prepareSegments(segments, opts.snapBeats, opts.minSegmentBeats),
    key,
    opts.romanInClipName,
  );
  if (written === 0) summary.note = "No chords were detected in that range, so nothing was written.";
  deps.panel.publish(summary);
  await showChordListDialog(context, summary);
}

/** Render pre-FX audio, run crema, and convert seconds to arrangement beats (constant tempo). */
async function analyzeAudioTrack(context: Ctx, crema: CremaClient, track: LiveAudioTrack, range: BeatRange): Promise<ChordSegment[]> {
  const tempo = context.application.song.tempo;
  const beatsPerSecond = tempo / 60;

  const result = (await context.ui.withinProgressDialog("Extracting chords…", { progress: 0 }, async (update, signal) => {
    await update(`Rendering "${track.name}"…`, 2);
    const audioPath = await context.resources.renderPreFxAudio(track, range.start, range.end);
    if (signal.aborted) return null;

    const weights: Record<CremaStage, [number, number]> = {
      resample: [10, 12],
      features: [12, 82],
      inference: [82, 92],
      decode: [92, 100],
    };
    const labels: Record<CremaStage, string> = {
      resample: "Preparing audio",
      features: "Computing harmonic CQT",
      inference: "Running chord model",
      decode: "Decoding chord sequence",
    };
    let pendingUpdate: Promise<void> = Promise.resolve();
    return crema.analyze(audioPath, {
      signal,
      onProgress: (stage, pct) => {
        const [lo, hi] = weights[stage];
        const overall = lo + ((hi - lo) * pct) / 100;
        pendingUpdate = pendingUpdate.then(() => update(`${labels[stage]}… ${pct}%`, Math.round(overall))).catch(() => {});
      },
    });
  })) as Awaited<ReturnType<CremaClient["analyze"]>> | null;

  if (!result) throw new Error("Cancelled.");

  return result.segments.map((s) => ({
    start: range.start + s.start * beatsPerSecond,
    end: Math.min(range.end, range.start + s.end * beatsPerSecond),
    label: s.label,
    confidence: s.confidence,
  }));
}

function summarize(title: string, subtitle: string, segments: ChordSegment[], key: KeyContext, roman = true): ChordListDialog {
  const spelling = spellingForKey(key);
  const nameOpts = { spelling, key, romanInClipName: roman };
  return {
    title,
    subtitle,
    columns: ["Start", "End", "Chord", "Confidence"],
    keys: ["start", "end", "chord", "notes"],
    rows: segments.map((s) => ({
      start: fmtBarBeat(s.start),
      end: fmtBarBeat(s.end),
      chord: chordText(s.label, nameOpts),
      notes: s.confidence < 1 ? `${Math.round(s.confidence * 100)}%` : "",
    })),
  };
}

export type { LiveTrack };
