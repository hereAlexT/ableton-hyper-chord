import { MidiClip } from "@ableton-extensions/sdk";

import type { MidiNote } from "../analysis/types.js";
import type { BeatRange, LiveMidiTrack, LiveTrack } from "./liveTypes.js";

/** The span covered by a track's arrangement clips, or null if it has none. */
export function wholeTrackRange(track: LiveTrack): BeatRange | null {
  let start = Infinity;
  let end = -Infinity;
  for (const clip of track.arrangementClips) {
    start = Math.min(start, clip.startTime);
    end = Math.max(end, clip.endTime);
  }
  if (!Number.isFinite(start) || end <= start) return null;
  return { start, end };
}

/**
 * Notes of a MIDI track's arrangement clips as absolute arrangement beats,
 * optionally restricted to `range`.
 *
 * Note times inside a clip are clip-relative, with the clip's start marker
 * sitting at the clip's arrangement start; loops are not unrolled (a looped
 * clip contributes its first pass only).
 */
export function collectTrackNotes(track: LiveMidiTrack, range?: BeatRange): MidiNote[] {
  const out: MidiNote[] = [];
  for (const clip of track.arrangementClips) {
    if (!(clip instanceof MidiClip)) continue;
    const clipStart = clip.startTime;
    const clipEnd = clip.endTime;
    const offset = clipStart - clip.startMarker;
    for (const n of clip.notes) {
      if (n.muted) continue;
      const abs = n.startTime + offset;
      const absEnd = Math.min(abs + n.duration, clipEnd);
      if (abs < clipStart || abs >= clipEnd || absEnd <= abs) continue;
      if (range && (absEnd <= range.start || abs >= range.end)) continue;
      out.push({ pitch: n.pitch, startTime: abs, duration: absEnd - abs, velocity: n.velocity });
    }
  }
  return out;
}
