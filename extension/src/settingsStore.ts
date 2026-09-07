// User-adjustable extraction options, remembered in the extension's storage
// directory between runs.

import * as fs from "node:fs";
import * as path from "node:path";

import { SETTINGS } from "./settings.js";

export interface ExtractOptions {
  /** Onsets within this many beats are one strum (MIDI). */
  onsetTolerance: number;
  /** Chords shorter than this (beats) fold into a neighbour. */
  minSegmentBeats: number;
  /** Chord boundaries snap to this grid (beats); 0 = off. */
  snapBeats: number;
  /** MIDI: report slash chords from the lowest note. */
  midiInversions: boolean;
  /** MIDI: Badd9 → B, C#9 → C#7. */
  simplifyExtensions: boolean;
  /** Clip names carry the Roman-numeral function. */
  romanInClipName: boolean;
}

export const DEFAULT_EXTRACT_OPTIONS: ExtractOptions = {
  onsetTolerance: SETTINGS.onsetTolerance,
  minSegmentBeats: SETTINGS.minSegmentBeats,
  snapBeats: SETTINGS.snapBeats,
  midiInversions: SETTINGS.midiInversions,
  simplifyExtensions: SETTINGS.simplifyExtensions,
  romanInClipName: SETTINGS.romanInClipName,
};

const FILE = "extract-options.json";

export function loadExtractOptions(storageDirectory: string | undefined): ExtractOptions {
  if (!storageDirectory) return { ...DEFAULT_EXTRACT_OPTIONS };
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(storageDirectory, FILE), "utf8")) as Partial<ExtractOptions>;
    return sanitize(raw);
  } catch {
    return { ...DEFAULT_EXTRACT_OPTIONS };
  }
}

export function saveExtractOptions(storageDirectory: string | undefined, opts: ExtractOptions): void {
  if (!storageDirectory) return;
  try {
    fs.mkdirSync(storageDirectory, { recursive: true });
    fs.writeFileSync(path.join(storageDirectory, FILE), JSON.stringify(opts, null, 2));
  } catch (error) {
    console.warn("hyper-chord: could not save options:", error);
  }
}

/** Coerce whatever came back from the dialog / disk into valid options. */
export function sanitize(raw: Partial<ExtractOptions> | null | undefined): ExtractOptions {
  const num = (v: unknown, dflt: number, min: number, max: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
  };
  const bool = (v: unknown, dflt: boolean) => (typeof v === "boolean" ? v : dflt);
  const d = DEFAULT_EXTRACT_OPTIONS;
  return {
    onsetTolerance: num(raw?.onsetTolerance, d.onsetTolerance, 0, 4),
    minSegmentBeats: num(raw?.minSegmentBeats, d.minSegmentBeats, 0, 16),
    snapBeats: num(raw?.snapBeats, d.snapBeats, 0, 4),
    midiInversions: bool(raw?.midiInversions, d.midiInversions),
    simplifyExtensions: bool(raw?.simplifyExtensions, d.simplifyExtensions),
    romanInClipName: bool(raw?.romanInClipName, d.romanInClipName),
  };
}
