/** Behavioural defaults. No UI for these yet; edit and rebuild. */
export const SETTINGS = {
  /** The singleton chord track F1 updates in place. Found by exact name. */
  masterTrackName: "Master Chord Track",
  /** F2 names new tracks `${newTrackPrefix}${source track name}`. */
  newTrackPrefix: "Chords: ",
  /** Chord boundaries are snapped to this grid (beats). 0 disables. */
  snapBeats: 0.25,
  /** Chords shorter than this (beats) are folded into a neighbour. */
  minSegmentBeats: 0.5,
  /** Append the Roman-numeral function to clip names, e.g. `Am7 (vi7)`. */
  romanInClipName: true,
  /**
   * MIDI extraction: report slash chords from the lowest note. (Audio always
   * keeps crema's inversions — they come from a dedicated bass head.)
   */
  midiInversions: true,
  /** MIDI extraction: write `B` rather than `Badd9`, `C#7` rather than `C#9`. */
  simplifyExtensions: false,
  /** Onsets within this many beats are one strum. */
  onsetTolerance: 0.25,
  /** Also drop a named cue point (locator) at every chord change. */
  cuePoints: false,
  /** MIDI pitch of the octave chord roots are voiced in (48 = Live's C2). */
  voicingBase: 48,
  /** Local port for the browser panel (SSE). */
  panelPort: 46321,
} as const;

export type Settings = typeof SETTINGS;
