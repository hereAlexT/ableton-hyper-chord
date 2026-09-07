import type {
  AudioTrack,
  ExtensionContext,
  MidiClip,
  MidiTrack,
  Song,
  Track,
} from "@ableton-extensions/sdk";

export type V = "1.0.0";
export type Ctx = ExtensionContext<V>;
export type LiveSong = Song<V>;
export type LiveTrack = Track<V>;
export type LiveAudioTrack = AudioTrack<V>;
export type LiveMidiTrack = MidiTrack<V>;
export type LiveMidiClip = MidiClip<V>;

export interface BeatRange {
  start: number;
  end: number;
}
