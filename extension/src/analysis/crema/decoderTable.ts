// crema's decoder, precomputed from pumpp's ChordTagTransformer and
// crema/models/chord.py by music_app's tools/export_decoder_table.py.
//
// Everything the decoder needs is data: the 170 chord names, each tag's root
// pitch class and root-relative pitch set (for the slash-chord inversions),
// the HMM self-loop probability, and the two tags that never take an
// inversion. That keeps pumpp, librosa and mir_eval out of the extension.

import type { DecoderTables } from "./cremaDecoder.js";

export interface CremaDecoderJson {
  n_states: number;
  names: string[];
  viterbi: { p_self: number };
  inversion: {
    root_pc: number[];
    relative_pitch_mask: number[];
    semitone_to_scale_degree: string[];
    skip_labels: string[];
  };
  frames?: { sr: number; hop_length: number };
}

export interface CremaDecoderTable extends DecoderTables {
  names: string[];
  /** Semitone -> scale degree, e.g. index 4 is `3`. Used for `/3`-style inversions. */
  scaleDegrees: string[];
  /** Tags that never take an inversion: `N` and `X`. */
  skipTags: Int32Array;
}

export function parseDecoderTable(json: CremaDecoderJson): CremaDecoderTable {
  const n = json.n_states;
  if (json.names.length !== n) throw new Error(`n_states is ${n} but ${json.names.length} names were given`);
  const inv = json.inversion;
  if (inv.root_pc.length !== n || inv.relative_pitch_mask.length !== n) {
    throw new Error(`root_pc/relative_pitch_mask must both have ${n} entries`);
  }
  const skip: number[] = [];
  for (const l of inv.skip_labels) {
    const i = json.names.indexOf(l);
    if (i < 0) throw new Error(`skip label ${l} is not in the name table`);
    skip.push(i);
  }
  return {
    names: json.names,
    rootPc: Int32Array.from(inv.root_pc),
    relMask: Int32Array.from(inv.relative_pitch_mask),
    nStates: n,
    pSelf: json.viterbi.p_self,
    scaleDegrees: inv.semitone_to_scale_degree,
    skipTags: Int32Array.from(skip),
  };
}

/** Compose the Harte label a `(tag, bassDegree)` pair stands for. */
export function labelFor(table: CremaDecoderTable, tag: number, bassDegree: number): string {
  if (tag < 0 || tag >= table.names.length) return "N";
  const base = table.names[tag]!;
  if (bassDegree <= 0 || bassDegree >= table.scaleDegrees.length) return base;
  return `${base}/${table.scaleDegrees[bassDegree]}`;
}
