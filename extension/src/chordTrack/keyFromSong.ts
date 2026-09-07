import type { KeyContext } from "../analysis/keyContext.js";
import type { LiveSong } from "./liveTypes.js";

/** The Live Set's key as the analysis layer wants it. Falls back to C major. */
export function readKey(song: LiveSong): KeyContext {
  try {
    const intervals = song.scaleIntervals;
    return {
      rootPc: ((song.rootNote % 12) + 12) % 12,
      scaleName: song.scaleName,
      intervals: intervals.length ? intervals.map((i) => ((i % 12) + 12) % 12) : [0, 2, 4, 5, 7, 9, 11],
      scaleMode: song.scaleMode,
    };
  } catch (error) {
    console.warn("hyper-chord: could not read the Set's key, assuming C major:", error);
    return { rootPc: 0, scaleName: "Major", intervals: [0, 2, 4, 5, 7, 9, 11], scaleMode: false };
  }
}
