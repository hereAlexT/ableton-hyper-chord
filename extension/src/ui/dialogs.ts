import dialogHtml from "./dialog.html";

import type { Ctx } from "../chordTrack/liveTypes.js";

export interface ChordRow {
  start: string;
  end: string;
  chord: string;
  roman?: string | null;
  notes?: string;
}

export interface ChordListDialog {
  title: string;
  subtitle?: string;
  rows?: ChordRow[];
  /** Header labels, parallel to `keys`. */
  columns?: string[];
  /** Which ChordRow fields to render, in order. Default: start, end, chord, roman, notes. */
  keys?: string[];
  note?: string;
  message?: string;
}

export function renderDialogHtml(data: ChordListDialog): string {
  // `</script>` inside JSON would end the inline script early.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const token = "/*__HYPERCHORD_DATA__*/ null";
  if (!dialogHtml.includes(token)) throw new Error("dialog.html is missing the data placeholder");
  return dialogHtml.replace(token, json);
}

export async function showChordListDialog(context: Ctx, data: ChordListDialog, width = 620, height = 460): Promise<void> {
  const url = `data:text/html,${encodeURIComponent(renderDialogHtml(data))}`;
  try {
    await context.ui.showModalDialog(url, width, height);
  } catch (error) {
    console.error("hyper-chord: dialog failed:", error);
  }
}

export function showMessage(context: Ctx, title: string, message: string, note?: string): Promise<void> {
  return showChordListDialog(context, { title, message, note }, 480, 220);
}

export function fmtBeat(beat: number): string {
  return (Math.round(beat * 1000) / 1000).toString();
}

/** Bar.beat for a 4/4 grid, 1-based like Live's ruler. */
export function fmtBarBeat(beat: number, beatsPerBar = 4): string {
  const bar = Math.floor(beat / beatsPerBar) + 1;
  const b = beat - (bar - 1) * beatsPerBar;
  const whole = Math.floor(b) + 1;
  const frac = b - Math.floor(b);
  return frac > 1e-6 ? `${bar}.${whole}.${Math.round(frac * 4 + 1)}` : `${bar}.${whole}`;
}
