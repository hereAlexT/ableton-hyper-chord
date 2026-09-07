# ableton-hyper-chord

An Ableton Live Extension that turns any audio or MIDI track into a labelled
chord track, and names whatever chord you have selected in the piano roll.

- **Extract Chords to Main Chord Track** — right-click an audio or MIDI track
  (or a time selection on one). Chords land on a single `Master Chord Track`,
  replacing whatever was there in that range. Run it again on other tracks or
  sections and it keeps accumulating into the same track.
- **Extract Chords to New Chord Track** — same, but into a fresh
  `Chords: <track name>` track every time.
- **What's This Chord?** — right-click a MIDI clip with some notes selected.
- **Open Hyper Chord Panel…** — a local browser page that receives every
  result (no modal to dismiss; park it on a second screen).

Every chord is one MIDI clip: the clip **name** is the chord symbol
(`Bbm7`, `F/A`, `G7sus4`), spelled with sharps or flats according to the
Set's key, and the clip **notes** are a playable voicing. Roman-numeral
functions (`vi7`, `bVII`) are shown in the result dialogs and can be added to
clip names via `src/settings.ts`.

Audio is analysed with [crema](https://github.com/bmcfee/crema) (Brian
McFee's structured chord recogniser) running on `onnxruntime-node`; the HCQT
front end and the Viterbi decoder are a TypeScript port of the C++ in
`music_app/packages/audio_ml_ffi`, checked against it by `test/parity.test.ts`.
MIDI is analysed symbolically (onset clustering + template matching), no
model needed.

## Requirements

- Ableton Live 12 with Extensions support (currently the Live 12 beta from the
  SDK's Centercode portal). Record File Type may be WAV or AIFF.
- Node.js ≥ 24.14.
- The Extensions SDK zip: copy `ableton-extensions-sdk-<v>.tgz` and
  `ableton-extensions-cli-<v>.tgz` into `vendor/` (the SDK licence does not
  allow committing them).

## Develop

```sh
npm install
# .env: EXTENSION_HOST_PATH=/Applications/Ableton Live 12 Beta.app/Contents/Helpers/ExtensionHost/ExtensionHostNodeModule.node
npm start          # build + run in Live (enable Settings → Extensions → Developer Mode first)
npm test           # unit tests + parity against the C++ reference (if .parity/cqt_parity exists)
npm run parity:build   # build that reference from ../../music_app (needs clang++)
npm run smoke:crema -- path/to/song.wav   # full pipeline in-process, prints chords
npx tsx tools/smoke-worker.ts song.wav    # same, through the worker bridge the extension uses
```

Layout:

```
src/analysis/    pure TypeScript, no SDK imports — unit-testable without Live
  crema/         cqtCore, cremaFeatures, cremaDecoder, resample, pipeline, ortRunner, cremaClient
  midiChords.ts  chordLabel.ts  keyContext.ts  audioFile.ts  fft.ts
src/worker/      crema runtime (worker thread, or child process under Live's managed host)
src/chordTrack/  Live glue: master track, ranges, note collection, clip writing
src/commands/    the context-menu commands
src/ui/          modal dialog HTML, browser panel (SSE)
```

## Package

```sh
npm run package    # -> ableton-hyper-chord-<version>.ablx
```

The archive bundles `dist/`, the model (2.1 MB) and the macOS
`onnxruntime-node` binaries. For a Windows build, add
`node_modules/onnxruntime-node/bin/napi-v6/win32` to the `package` script.

## Known limits

- Seconds → beats assumes a constant tempo; tempo automation will drift.
- Chord boundaries are snapped to a 16th-note grid and chords shorter than a
  16th are folded into the previous one (`src/settings.ts`).
- Looped MIDI clips contribute their first pass only.
- The SDK has no selection-change events, so the panel updates on each
  right-click, not as you click around the piano roll.
- Only Arrangement clips are handled (no Session clip slots yet).
