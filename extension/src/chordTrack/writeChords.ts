// Chord segments (in beats) -> one named MidiClip per chord on a MIDI track.
// The clip name is the label; the notes are a playable voicing.

import type { NoteDescription } from "@ableton-extensions/sdk";

import { displayName, voicing, type Spelling } from "../analysis/chordLabel.js";
import { romanNumeral, type KeyContext } from "../analysis/keyContext.js";
import type { ChordSegment } from "../analysis/types.js";
import { SETTINGS } from "../settings.js";
import type { BeatRange, Ctx, LiveMidiTrack } from "./liveTypes.js";

export interface WriteOptions {
  spelling: Spelling;
  key: KeyContext | null;
  /** Clear existing clips in this range first (the "update master" case). */
  clearRange?: BeatRange;
  snapBeats?: number;
  minSegmentBeats?: number;
  romanInClipName?: boolean;
  voicingBase?: number;
}

/**
 * Snap boundaries, fold tiny chords into a neighbour (the previous one, or
 * the next one at the very start), drop N/X.
 */
export function prepareSegments(
  segments: ChordSegment[],
  snapBeats: number = SETTINGS.snapBeats,
  minSegmentBeats: number = SETTINGS.minSegmentBeats,
): ChordSegment[] {
  const snap = (t: number) => (snapBeats > 0 ? Math.round(t / snapBeats) * snapBeats : t);
  const out: ChordSegment[] = [];
  let carryStart: number | null = null; // a leading sliver hands its start to the next chord
  for (const s of segments) {
    const start = snap(s.start);
    const end = snap(s.end);
    const last = out[out.length - 1];
    let startAt = last ? Math.max(start, last.end) : start;
    if (carryStart !== null && Math.abs(start - carryStart) < 1e-6) startAt = Math.min(startAt, start);
    if (end - startAt < Math.max(minSegmentBeats, 1e-6)) {
      if (last) last.end = Math.max(last.end, end);
      else carryStart = startAt;
      continue;
    }
    if (carryStart !== null && !last) {
      startAt = Math.min(startAt, carryStart);
      carryStart = null;
    }
    if (last && last.label === s.label && Math.abs(last.end - startAt) < 1e-6) {
      last.end = end;
      continue;
    }
    out.push({ start: startAt, end, label: s.label, confidence: s.confidence });
  }
  return out.filter((s) => s.label !== "N" && s.label !== "X");
}

/** `Am7 (vi7)` — the display name plus, when asked, the function in brackets. */
export function chordText(label: string, opts: Pick<WriteOptions, "spelling" | "key" | "romanInClipName">): string {
  const name = displayName(label, opts.spelling);
  if (opts.romanInClipName && opts.key) {
    const rn = romanNumeral(label, opts.key);
    if (rn) return `${name} (${rn})`;
  }
  return name;
}

export const clipNameFor = chordText;

export function notesFor(label: string, lengthBeats: number, voicingBase: number = SETTINGS.voicingBase): NoteDescription[] {
  return voicing(label, voicingBase).map((pitch) => ({ pitch, startTime: 0, duration: lengthBeats, velocity: 100 }));
}

/**
 * Write chord clips. Three undo steps: clear (if asked), create clips,
 * name + fill them — withinTransaction can't span the awaits between them.
 * Returns the number of clips written.
 */
export async function writeChordClips(
  context: Ctx,
  track: LiveMidiTrack,
  segments: ChordSegment[],
  opts: WriteOptions,
): Promise<number> {
  const prepared = prepareSegments(segments, opts.snapBeats, opts.minSegmentBeats);
  if (opts.clearRange) await track.clearClipsInRange(opts.clearRange.start, opts.clearRange.end);
  if (prepared.length === 0) return 0;

  const clips = await context.withinTransaction(() =>
    Promise.all(prepared.map((s) => track.createMidiClip(s.start, s.end - s.start))),
  );

  context.withinTransaction(() => {
    clips.forEach((clip, i) => {
      const s = prepared[i]!;
      clip.name = clipNameFor(s.label, opts);
      clip.notes = notesFor(s.label, s.end - s.start, opts.voicingBase);
    });
  });
  return clips.length;
}

/** Optional locators at every chord change. */
export async function writeCuePoints(context: Ctx, segments: ChordSegment[], opts: WriteOptions): Promise<void> {
  const prepared = prepareSegments(segments, opts.snapBeats, opts.minSegmentBeats);
  const song = context.application.song;
  const cues = await context.withinTransaction(() => Promise.all(prepared.map((s) => song.createCuePoint(s.start))));
  context.withinTransaction(() => {
    cues.forEach((cue, i) => {
      cue.name = clipNameFor(prepared[i]!.label, opts);
    });
  });
}
