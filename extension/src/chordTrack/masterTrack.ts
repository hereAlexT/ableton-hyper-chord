import { MidiTrack } from "@ableton-extensions/sdk";

import { SETTINGS } from "../settings.js";
import type { Ctx, LiveMidiTrack } from "./liveTypes.js";

/** The singleton chord track, found by name; created (and named) if missing. */
export async function getOrCreateMasterChordTrack(context: Ctx): Promise<LiveMidiTrack> {
  const existing = findMasterChordTrack(context);
  if (existing) return existing;
  return createChordTrack(context, SETTINGS.masterTrackName);
}

export function findMasterChordTrack(context: Ctx): LiveMidiTrack | null {
  for (const t of context.application.song.tracks) {
    if (t instanceof MidiTrack && t.name === SETTINGS.masterTrackName) return t;
  }
  return null;
}

export async function createChordTrack(context: Ctx, name: string): Promise<LiveMidiTrack> {
  const track = await context.application.song.createMidiTrack();
  track.name = name;
  return track;
}
