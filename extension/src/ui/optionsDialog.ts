import optionsHtml from "./options.html";

import type { Ctx } from "../chordTrack/liveTypes.js";
import { sanitize, type ExtractOptions } from "../settingsStore.js";

export interface OptionsDialogData {
  title: string;
  subtitle?: string;
  source: "midi" | "audio";
  values: ExtractOptions;
}

export function renderOptionsHtml(data: OptionsDialogData): string {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const token = "/*__HYPERCHORD_DATA__*/ null";
  if (!optionsHtml.includes(token)) throw new Error("options.html is missing the data placeholder");
  return optionsHtml.replace(token, json);
}

/** Returns the chosen options, or null if the user cancelled / closed the window. */
export async function askExtractOptions(context: Ctx, data: OptionsDialogData): Promise<ExtractOptions | null> {
  const url = `data:text/html,${encodeURIComponent(renderOptionsHtml(data))}`;
  let raw: string;
  try {
    raw = await context.ui.showModalDialog(url, 560, data.source === "audio" ? 330 : 450);
  } catch (error) {
    console.warn("hyper-chord: options dialog closed without a result:", error);
    return null;
  }
  return parseOptionsResult(raw);
}

export function parseOptionsResult(raw: string): ExtractOptions | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if ((parsed as { cancelled?: boolean }).cancelled) return null;
  return sanitize(parsed as Partial<ExtractOptions>);
}
