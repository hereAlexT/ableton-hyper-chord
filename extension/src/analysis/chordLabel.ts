// Harte chord labels: parsing, spelling, voicing.
//
// Internally every label is sharp-spelled Harte (`A#:min7/b3`), the same
// vocabulary crema uses. Display names (`Bbm7/Db`) are derived from that plus a
// spelling choice made from the Live Set's key (see keyContext.ts).

export const PC_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export const PC_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;

/** Harte scale-degree names by semitone above the root, as crema's decoder table uses them. */
export const DEGREE_BY_SEMITONE = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"] as const;

export type Spelling = "sharp" | "flat";

export interface QualityInfo {
  /** Semitones above the root. */
  intervals: readonly number[];
  /** Lead-sheet suffix, e.g. `m7`, `maj7`, `dim`. */
  suffix: string;
  /** Roman-numeral suffix (case already carries minor-ness). */
  roman: string;
  /** Lower-case roman numeral. */
  minorLike: boolean;
}

export const QUALITIES: Record<string, QualityInfo> = {
  maj: { intervals: [0, 4, 7], suffix: "", roman: "", minorLike: false },
  min: { intervals: [0, 3, 7], suffix: "m", roman: "", minorLike: true },
  dim: { intervals: [0, 3, 6], suffix: "dim", roman: "°", minorLike: true },
  aug: { intervals: [0, 4, 8], suffix: "aug", roman: "+", minorLike: false },
  sus2: { intervals: [0, 2, 7], suffix: "sus2", roman: "sus2", minorLike: false },
  sus4: { intervals: [0, 5, 7], suffix: "sus4", roman: "sus4", minorLike: false },
  "5": { intervals: [0, 7], suffix: "5", roman: "5", minorLike: false },
  maj7: { intervals: [0, 4, 7, 11], suffix: "maj7", roman: "maj7", minorLike: false },
  min7: { intervals: [0, 3, 7, 10], suffix: "m7", roman: "7", minorLike: true },
  "7": { intervals: [0, 4, 7, 10], suffix: "7", roman: "7", minorLike: false },
  dim7: { intervals: [0, 3, 6, 9], suffix: "dim7", roman: "°7", minorLike: true },
  hdim7: { intervals: [0, 3, 6, 10], suffix: "m7b5", roman: "ø7", minorLike: true },
  minmaj7: { intervals: [0, 3, 7, 11], suffix: "mMaj7", roman: "(maj7)", minorLike: true },
  maj6: { intervals: [0, 4, 7, 9], suffix: "6", roman: "6", minorLike: false },
  min6: { intervals: [0, 3, 7, 9], suffix: "m6", roman: "6", minorLike: true },
  "9": { intervals: [0, 4, 7, 10, 2], suffix: "9", roman: "9", minorLike: false },
  maj9: { intervals: [0, 4, 7, 11, 2], suffix: "maj9", roman: "maj9", minorLike: false },
  min9: { intervals: [0, 3, 7, 10, 2], suffix: "m9", roman: "9", minorLike: true },
  add9: { intervals: [0, 4, 7, 2], suffix: "add9", roman: "add9", minorLike: false },
  minadd9: { intervals: [0, 3, 7, 2], suffix: "madd9", roman: "add9", minorLike: true },
  "7sus4": { intervals: [0, 5, 7, 10], suffix: "7sus4", roman: "7sus4", minorLike: false },
  aug7: { intervals: [0, 4, 8, 10], suffix: "aug7", roman: "+7", minorLike: false },
  min11: { intervals: [0, 3, 7, 10, 5], suffix: "m11", roman: "11", minorLike: true },
  "13": { intervals: [0, 4, 7, 10, 2, 9], suffix: "13", roman: "13", minorLike: false },
};

/** Extension qualities → the plainer quality a chord track usually wants. */
const SIMPLER_QUALITY: Record<string, string> = {
  add9: "maj",
  minadd9: "min",
  "9": "7",
  maj9: "maj7",
  min9: "min7",
  "13": "7",
  min11: "min7",
  aug7: "aug",
};

/** `B:add9/2` → `B:maj`; `C#:9` → `C#:7`. Drops the slash when the bass is no longer a chord tone. */
export function simplifyLabel(label: string): string {
  const p = parseHarte(label);
  if (p.kind !== "chord") return label;
  const quality = SIMPLER_QUALITY[p.quality] ?? p.quality;
  const intervals = QUALITIES[quality]?.intervals ?? [0];
  const bass = p.bassSemitones && intervals.includes(p.bassSemitones) ? p.bassSemitones : 0;
  return formatHarte({ kind: "chord", rootPc: p.rootPc, quality, bassSemitones: bass });
}

/** `A:maj/5` → `A:maj`. */
export function stripInversion(label: string): string {
  const p = parseHarte(label);
  if (p.kind !== "chord" || !p.bassSemitones) return label;
  return formatHarte({ ...p, bassSemitones: 0 });
}

export interface ParsedChord {
  kind: "chord";
  rootPc: number;
  quality: string;
  /** Semitones of the bass above the root; 0 == root position. */
  bassSemitones: number;
}
export interface NoChord {
  kind: "N" | "X";
}
export type ParsedLabel = ParsedChord | NoChord;

export function noteNameToPc(name: string): number {
  const m = /^([A-Ga-g])([#b]*)$/.exec(name.trim());
  if (!m) throw new Error(`Bad note name: ${name}`);
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = base[m[1]!.toUpperCase()]!;
  for (const acc of m[2]!) pc += acc === "#" ? 1 : -1;
  return ((pc % 12) + 12) % 12;
}

export function degreeToSemitones(degree: string): number {
  const i = DEGREE_BY_SEMITONE.indexOf(degree as (typeof DEGREE_BY_SEMITONE)[number]);
  if (i >= 0) return i;
  // Accept Harte extensions like "9", "11", "#4" loosely.
  const m = /^([#b]*)(\d+)$/.exec(degree);
  if (!m) throw new Error(`Bad degree: ${degree}`);
  const majorDegree = [0, 2, 4, 5, 7, 9, 11];
  const n = parseInt(m[2]!, 10);
  let semis = majorDegree[(n - 1) % 7]! + 12 * Math.floor((n - 1) / 7);
  for (const acc of m[1]!) semis += acc === "#" ? 1 : -1;
  return ((semis % 12) + 12) % 12;
}

export function parseHarte(label: string): ParsedLabel {
  const s = label.trim();
  if (s === "N") return { kind: "N" };
  if (s === "X") return { kind: "X" };
  const slash = s.indexOf("/");
  const base = slash >= 0 ? s.slice(0, slash) : s;
  const bass = slash >= 0 ? s.slice(slash + 1) : "";
  const colon = base.indexOf(":");
  const root = colon >= 0 ? base.slice(0, colon) : base;
  const quality = colon >= 0 ? base.slice(colon + 1) : "maj";
  return {
    kind: "chord",
    rootPc: noteNameToPc(root),
    quality,
    bassSemitones: bass ? degreeToSemitones(bass) : 0,
  };
}

/** Sharp-spelled Harte label. */
export function formatHarte(c: ParsedChord): string {
  const bass = c.bassSemitones ? `/${DEGREE_BY_SEMITONE[c.bassSemitones]}` : "";
  return `${PC_NAMES_SHARP[c.rootPc]}:${c.quality}${bass}`;
}

export function pcName(pc: number, spelling: Spelling): string {
  const i = ((pc % 12) + 12) % 12;
  return spelling === "flat" ? PC_NAMES_FLAT[i]! : PC_NAMES_SHARP[i]!;
}

/** Lead-sheet display name: `Bbm7/Db`, `N.C.` for no-chord, `?` for out-of-gamut. */
export function displayName(label: string, spelling: Spelling = "sharp"): string {
  const p = parseHarte(label);
  if (p.kind !== "chord") return p.kind === "N" ? "N.C." : "?";
  const q = QUALITIES[p.quality];
  const suffix = q ? q.suffix : p.quality;
  const bass = p.bassSemitones ? `/${pcName(p.rootPc + p.bassSemitones, spelling)}` : "";
  return `${pcName(p.rootPc, spelling)}${suffix}${bass}`;
}

/** Absolute pitch classes of a label (empty for N/X). */
export function pitchClassesOf(label: string): number[] {
  const p = parseHarte(label);
  if (p.kind !== "chord") return [];
  const q = QUALITIES[p.quality];
  const intervals = q ? q.intervals : [0];
  return intervals.map((iv) => (p.rootPc + iv) % 12);
}

/**
 * MIDI pitches for a label: root placed in the octave starting at
 * `rootOctaveBase` (48 = the C Live labels C2), chord tones stacked above,
 * and the inversion's bass note one octave below the root when present.
 */
export function voicing(label: string, rootOctaveBase = 48): number[] {
  const p = parseHarte(label);
  if (p.kind !== "chord") return [];
  const q = QUALITIES[p.quality];
  const intervals = q ? q.intervals : [0];
  const root = rootOctaveBase + p.rootPc;
  const pitches = intervals.map((iv) => root + iv);
  if (p.bassSemitones) {
    let bass = root + p.bassSemitones - 12;
    while (bass >= root) bass -= 12;
    pitches.push(bass);
  }
  return [...new Set(pitches)].sort((a, b) => a - b);
}
