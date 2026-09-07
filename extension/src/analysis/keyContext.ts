// The Live Set's key (Song.rootNote / scaleName / scaleIntervals) decides how
// chords are written: sharps or flats, and the Roman-numeral function.

import { QUALITIES, parseHarte, pcName, type Spelling } from "./chordLabel.js";

export interface KeyContext {
  /** 0 (C) .. 11 (B). */
  rootPc: number;
  scaleName: string;
  /** Semitone offsets from the root, e.g. [0,2,4,5,7,9,11]. */
  intervals: number[];
  /** Whether Live's Scale Mode toggle is on. Informational only. */
  scaleMode: boolean;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];
/** Major keys conventionally written with flats: F, Bb, Eb, Ab, Db. (Gb/F# is decided by context.) */
const FLAT_MAJORS = new Set([5, 10, 3, 8, 1]);

/** Whether the scale reads as minor: has a minor third and no major third. */
export function isMinorLike(key: KeyContext): boolean {
  return key.intervals.includes(3) && !key.intervals.includes(4);
}

/** Sharps or flats, from the key's relative major on the circle of fifths. */
export function spellingForKey(key: KeyContext): Spelling {
  const minor = isMinorLike(key);
  const majorRoot = ((minor ? key.rootPc + 3 : key.rootPc) % 12 + 12) % 12;
  if (FLAT_MAJORS.has(majorRoot)) return "flat";
  if (majorRoot === 6) return minor ? "flat" : "sharp"; // Eb minor vs F# major
  return "sharp";
}

export function describeKey(key: KeyContext): string {
  return `${pcName(key.rootPc, spellingForKey(key))} ${key.scaleName || (isMinorLike(key) ? "Minor" : "Major")}`;
}

/**
 * Roman-numeral function of a Harte label in the key, e.g. `vi7`, `bVII`,
 * `V7/3`. Non-diatonic roots get a `b`/`#` prefix relative to the nearest
 * scale degree. Returns null for N/X.
 */
export function romanNumeral(label: string, key: KeyContext): string | null {
  const p = parseHarte(label);
  if (p.kind !== "chord") return null;
  const ref = key.intervals.length === 7 ? key.intervals : MAJOR;
  const degree = ((p.rootPc - key.rootPc) % 12 + 12) % 12;

  let numeral: string;
  const idx = ref.indexOf(degree);
  if (idx >= 0) numeral = NUMERALS[idx]!;
  else {
    // Chromatic root. A note that belongs to the parallel major is a raised
    // scale degree (#III, #VI, #VII in minor); the tritone is #IV; everything
    // else is a lowered upper neighbour (bII, bIII, bVI, bVII).
    const up = ref.indexOf((degree + 1) % 12);
    const down = ref.indexOf((degree + 11) % 12);
    const raised = MAJOR.includes(degree) && ref !== MAJOR;
    if (down >= 0 && (raised || up === 4)) numeral = `#${NUMERALS[down]}`;
    else if (up >= 0) numeral = `b${NUMERALS[up]}`;
    else if (down >= 0) numeral = `#${NUMERALS[down]}`;
    else numeral = `?${degree}`;
  }

  const q = QUALITIES[p.quality];
  const minorLike = q ? q.minorLike : false;
  const body = minorLike ? numeral.toLowerCase() : numeral;
  const suffix = q ? q.roman : p.quality;
  const bass = p.bassSemitones ? `/${degreeName(p.bassSemitones)}` : "";
  return `${body}${suffix}${bass}`;
}

function degreeName(semitones: number): string {
  const names = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"];
  return names[semitones] ?? String(semitones);
}
