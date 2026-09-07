import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vm from "node:vm";
import { describe, expect, it } from "vitest";

import { DEFAULT_EXTRACT_OPTIONS, loadExtractOptions, sanitize, saveExtractOptions } from "../src/settingsStore.js";
import { parseOptionsResult, renderOptionsHtml } from "../src/ui/optionsDialog.js";

describe("extract options", () => {
  it("sanitizes dialog output and clamps nonsense", () => {
    expect(parseOptionsResult(JSON.stringify({ onsetTolerance: "0.5", snapBeats: 0, midiInversions: true }))).toEqual({
      ...DEFAULT_EXTRACT_OPTIONS,
      onsetTolerance: 0.5,
      snapBeats: 0,
      midiInversions: true,
    });
    expect(sanitize({ onsetTolerance: -3, minSegmentBeats: 999 })).toMatchObject({ onsetTolerance: 0, minSegmentBeats: 16 });
    expect(sanitize({ onsetTolerance: Number.NaN })).toMatchObject({ onsetTolerance: DEFAULT_EXTRACT_OPTIONS.onsetTolerance });
  });

  it("treats cancel, empty and garbage as null", () => {
    expect(parseOptionsResult(JSON.stringify({ cancelled: true }))).toBeNull();
    expect(parseOptionsResult("")).toBeNull();
    expect(parseOptionsResult("not json")).toBeNull();
  });

  it("round-trips through the storage directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyperchord-opts-"));
    expect(loadExtractOptions(dir)).toEqual(DEFAULT_EXTRACT_OPTIONS);
    saveExtractOptions(dir, { ...DEFAULT_EXTRACT_OPTIONS, onsetTolerance: 1, romanInClipName: false });
    expect(loadExtractOptions(dir)).toMatchObject({ onsetTolerance: 1, romanInClipName: false });
    expect(loadExtractOptions(undefined)).toEqual(DEFAULT_EXTRACT_OPTIONS);
  });

  it("renders a dialog whose script parses and carries the values", () => {
    const html = renderOptionsHtml({ title: "Extract", source: "midi", values: { ...DEFAULT_EXTRACT_OPTIONS, onsetTolerance: 0.5 } });
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    const sandbox: { window: Record<string, unknown> } = { window: {} };
    vm.runInNewContext(script, sandbox);
    expect(sandbox.window["__DATA__"]).toMatchObject({ source: "midi", values: { onsetTolerance: 0.5 } });
  });
});
