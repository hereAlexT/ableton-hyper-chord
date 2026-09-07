// Symbolic chord detection from MIDI notes.
//
// 1. Chord-change candidates are the note onsets, clustered within a small
//    tolerance so a strummed or slightly loose chord counts as one onset.
// 2. Between consecutive candidates, every note that overlaps the span is
//    "sounding"; each pitch class is weighted by how long it sounds there.
// 3. The weighted pitch-class set is matched against chord templates over all
//    twelve roots; the lowest sounding pitch decides the inversion (optional).
// 4. Spans are cleaned up: equal neighbours merge, and a span whose notes are
//    a subset (an arpeggio still building up) or a same-root superset (a
//    passing tone over a held chord) of a longer neighbour folds into it.
//
// Times stay in the caller's units (beats for Live clips).

import { DEGREE_BY_SEMITONE, PC_NAMES_SHARP, QUALITIES, parseHarte, pitchClassesOf, simplifyLabel, stripInversion } from "./chordLabel.js";
import type { ChordSegment, MidiNote } from "./types.js";

export interface DetectOptions {
  /** Onsets closer than this (in the notes' time unit) are one chord change. Default 0.25 beats (a 16th). */
  onsetTolerance?: number;
  /** Pitch classes lighter than this fraction of the heaviest are treated as passing tones. Default 0.25. */
  minRelativeWeight?: number;
  /** Fewer distinct (significant) pitch classes than this is "N". Default 2. */
  minPitchClasses?: number;
  /** Report slash chords from the lowest sounding note. Default true. */
  inversions?: boolean;
  /** Reduce add9/9/13/… to the plain triad or seventh. Default false. */
  simplifyExtensions?: boolean;
  /** Spans no longer than this fold into a related longer neighbour. Default 1 beat. */
  foldMaxLength?: number;
}

const DEFAULTS: Required<DetectOptions> = {
  onsetTolerance: 0.25,
  minRelativeWeight: 0.25,
  minPitchClasses: 2,
  inversions: true,
  simplifyExtensions: false,
  foldMaxLength: 1,
};

/** Template qualities tried, in preference order (earlier wins ties). */
const TEMPLATE_ORDER = [
  "maj", "min", "7", "min7", "maj7", "dim", "aug", "sus4", "sus2", "hdim7", "dim7", "minmaj7",
  "maj6", "min6", "9", "min9", "maj9", "add9", "minadd9", "7sus4", "aug7", "min11", "13", "5",
];

export interface NamedChord {
  /** Sharp-spelled Harte label, or `N`. */
  label: string;
  rootPc: number;
  quality: string;
  bassSemitones: number;
  score: number;
}

/**
 * Name a weighted pitch-class set. `weights` is 12 entries (any scale);
 * `bassPc` is the lowest sounding pitch class, or -1 if unknown.
 */
export function nameChordFromWeights(
  weights: ArrayLike<number>,
  bassPc: number,
  opts: DetectOptions = {},
): NamedChord {
  const o = { ...DEFAULTS, ...opts };
  let wmax = 0;
  for (let i = 0; i < 12; i++) wmax = Math.max(wmax, weights[i] ?? 0);
  const none: NamedChord = { label: "N", rootPc: -1, quality: "N", bassSemitones: 0, score: -Infinity };
  if (wmax <= 0) return none;

  const rel = new Float64Array(12);
  const present: number[] = [];
  for (let i = 0; i < 12; i++) {
    rel[i] = (weights[i] ?? 0) / wmax;
    if (rel[i]! >= o.minRelativeWeight) present.push(i);
  }
  if (present.length < o.minPitchClasses) return none;
  const presentSet = new Set(present);

  let best: NamedChord | null = null;
  for (let root = 0; root < 12; root++) {
    for (let qi = 0; qi < TEMPLATE_ORDER.length; qi++) {
      const quality = TEMPLATE_ORDER[qi]!;
      const tpl = QUALITIES[quality]!.intervals;
      // Dyads only ever match the power-chord template.
      if (present.length === 2 && quality !== "5") continue;
      if (present.length > 2 && quality === "5") continue;

      let matched = 0;
      let missing = 0;
      const tplSet = new Set<number>();
      for (const iv of tpl) {
        const pc = (root + iv) % 12;
        tplSet.add(pc);
        if (presentSet.has(pc)) matched += 1;
        else missing += iv === 0 ? 3 : iv === 7 ? 0.7 : 1.5;
      }
      let extra = 0;
      for (let pc = 0; pc < 12; pc++) if (!tplSet.has(pc) && rel[pc]! > 0) extra += rel[pc]!;
      let score = matched * 2 - missing - extra - 0.05 * tpl.length - 0.001 * qi;
      if (bassPc === root) score += 0.5;
      if (matched < 2) continue;
      if (!best || score > best.score) {
        const bassIn = o.inversions && bassPc >= 0 && tplSet.has(bassPc) && bassPc !== root;
        best = {
          label: "",
          rootPc: root,
          quality,
          bassSemitones: bassIn ? (bassPc - root + 12) % 12 : 0,
          score,
        };
      }
    }
  }
  if (!best) return none;
  best.label = `${PC_NAMES_SHARP[best.rootPc]}:${best.quality}${best.bassSemitones ? "/" + DEGREE_BY_SEMITONE[best.bassSemitones] : ""}`;
  if (o.simplifyExtensions) {
    best.label = simplifyLabel(best.label);
    const p = parseHarte(best.label);
    if (p.kind === "chord") {
      best.quality = p.quality;
      best.bassSemitones = p.bassSemitones;
    }
  }
  return best;
}

/** Convenience for tests and "What's This Chord?": name a set of MIDI pitches sounding together. */
export function nameChordFromPitches(pitches: number[], opts: DetectOptions = {}): NamedChord {
  const w = new Float64Array(12);
  let lowest = Infinity;
  for (const p of pitches) {
    const pc = ((p % 12) + 12) % 12;
    w[pc] = (w[pc] ?? 0) + 1;
    lowest = Math.min(lowest, p);
  }
  return nameChordFromWeights(w, Number.isFinite(lowest) ? ((lowest % 12) + 12) % 12 : -1, opts);
}

/** Detect chord segments from notes (any consistent time unit). */
export function detectChordsFromNotes(notes: MidiNote[], opts: DetectOptions = {}): ChordSegment[] {
  const o = { ...DEFAULTS, ...opts };
  const active = notes.filter((n) => !n.muted && n.duration > 0).sort((a, b) => a.startTime - b.startTime);
  if (active.length === 0) return [];

  // Onset clusters -> change points.
  const changes: number[] = [];
  for (const n of active) {
    const last = changes[changes.length - 1];
    if (last === undefined || n.startTime - last > o.onsetTolerance) changes.push(n.startTime);
  }
  let endTime = 0;
  for (const n of active) endTime = Math.max(endTime, n.startTime + n.duration);
  changes.push(endTime);

  const eps = 1e-6;
  const raw: ChordSegment[] = [];
  for (let i = 0; i + 1 < changes.length; i++) {
    const s = changes[i]!;
    const e = changes[i + 1]!;
    if (e - s <= eps) continue;
    const w = new Float64Array(12);
    let lowest = Infinity;
    for (const n of active) {
      const ns = n.startTime;
      const ne = n.startTime + n.duration;
      if (ns >= e - eps) break; // sorted by start
      const overlap = Math.min(ne, e) - Math.max(ns, s);
      if (overlap <= eps) continue;
      const pc = ((n.pitch % 12) + 12) % 12;
      w[pc] = (w[pc] ?? 0) + overlap;
      lowest = Math.min(lowest, n.pitch);
    }
    const named = nameChordFromWeights(w, Number.isFinite(lowest) ? ((lowest % 12) + 12) % 12 : -1, o);
    raw.push({ start: s, end: e, label: named.label, confidence: 1 });
  }

  return foldRelatedNeighbours(mergeRuns(raw), o.foldMaxLength);
}

/** Merge consecutive spans with the same label. */
export function mergeRuns(segs: ChordSegment[]): ChordSegment[] {
  const eps = 1e-6;
  const out: ChordSegment[] = [];
  for (const seg of segs) {
    const last = out[out.length - 1];
    if (last && last.label === seg.label && Math.abs(last.end - seg.start) <= eps) last.end = seg.end;
    else out.push({ ...seg });
  }
  return out;
}

/**
 * Fold short spans into a longer neighbour they are musically part of:
 *  - the span's notes are a subset of the neighbour's (an arpeggio or strum
 *    still building up — `A:5` before `A:maj`, `E:5` before `A:maj/5`);
 *  - the span extends the neighbour on the same root (a passing tone over a
 *    held chord — `C:add9` inside `C:maj`).
 * Only spans no longer than `maxLength` and no longer than the neighbour move.
 */
export function foldRelatedNeighbours(segs: ChordSegment[], maxLength = 1): ChordSegment[] {
  let cur = segs;
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let i = 0; i < cur.length; i++) {
      const seg = cur[i]!;
      const mine = pitchClassesOf(seg.label);
      if (mine.length === 0) continue;
      const myLen = seg.end - seg.start;
      if (myLen > maxLength + 1e-9) continue;
      // Prefer the longer neighbour.
      const candidates = [i - 1, i + 1]
        .map((j) => cur[j])
        .filter((nb): nb is ChordSegment => !!nb && nb.label !== seg.label && nb.end - nb.start >= myLen)
        .sort((a, b) => b.end - b.start - (a.end - a.start));
      for (const nb of candidates) {
        const theirs = pitchClassesOf(nb.label);
        if (theirs.length === 0) continue;
        const subset = mine.every((pc) => theirs.includes(pc));
        const superset = theirs.every((pc) => mine.includes(pc)) && parseRoot(nb.label) === parseRoot(seg.label);
        if (!subset && !superset) continue;
        seg.label = nb.label;
        changed = true;
        break;
      }
    }
    if (!changed) break;
    cur = mergeRuns(cur);
  }
  return cur;
}

/** Relabel segments with plainer qualities (see simplifyLabel) and re-merge. */
export function simplifySegments(segs: ChordSegment[], stripInversions = false): ChordSegment[] {
  return mergeRuns(
    segs.map((s) => {
      let label = simplifyLabel(s.label);
      if (stripInversions) label = stripInversion(label);
      return { ...s, label };
    }),
  );
}

function parseRoot(label: string): number {
  const p = parseHarte(label);
  return p.kind === "chord" ? p.rootPc : -1;
}
