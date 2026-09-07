/** A chord over a time span. Times are in whatever unit the producer states (seconds or beats). */
export interface ChordSegment {
  start: number;
  end: number;
  /** Harte-style label from a sharp-spelled vocabulary: `C:maj`, `A:min7`, `F:maj/3`, `N`, `X`. */
  label: string;
  /** 0..1 where available (crema posterior mean); 1 for symbolic detection. */
  confidence: number;
}

/** A MIDI note in beats. Compatible with the SDK's NoteDescription. */
export interface MidiNote {
  pitch: number;
  startTime: number;
  duration: number;
  velocity?: number;
  muted?: boolean;
  selected?: boolean;
}
