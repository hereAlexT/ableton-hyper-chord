# 🎹 HyperChord

**Chord detection for Ableton Live — audio or MIDI in, a labelled chord track out.**

Right-click a track, and HyperChord writes every chord it hears as a named clip on a
dedicated chord track: `Amaj7 (VImaj7)`, `F#m7 (iv7)`, `B/D# (VII/3)`… spelled in the key of
your Set, with the Roman-numeral function right there in the name. Ask it what any passage is,
and it tells you.

> Built on Ableton's new **Extensions SDK** (Live 12 beta). Runs entirely on your machine —
> no accounts, no uploads, no Python.

---

## ✨ What it does

- 🎚️ **Extract Chords to Main Chord Track** — right-click any audio or MIDI track (or a
  time selection on it). Chords land on a single `Master Chord Track`, replacing whatever was
  in that range. Run it on the piano, then the guitar, then the vocal bounce — they all
  accumulate into one chord map of your song.
- ➕ **Extract Chords to New Chord Track** — same analysis, into a fresh `Chords: <track>`
  track every time. Handy for comparing takes or instruments side by side.
- ❓ **What's This Chord?** — right-click a MIDI clip, or select a time range on a MIDI
  track in the Arrangement and right-click. You get each chord in that span, its function
  in the current key, and the pitch classes that make it up.
- 🖥️ **Panel** — open `Open HyperChord Panel…` once and every result is pushed to a local
  browser page you can park on a second screen. No modal to dismiss.

Every chord is a real MIDI clip: the **name** is the chord symbol, the **notes** are a
playable voicing. Loop it, transpose it, drag it onto an instrument — it's just MIDI.

## 🎼 Key-aware, by design

HyperChord reads the key you set in Live (`Root` / `Scale` in the Set) and uses it for:

- ♯ / ♭ spelling — `Bbm7` in F major, `A#m7` in F# major, never a guess
- Roman-numeral functions — `vi7`, `bVII`, `V7/3`, `#iv°`
- both are shown in every result and (optionally) in the clip names

## 🧠 How it hears chords

| Source | Engine |
|---|---|
| 🎧 Audio tracks | [**crema**](https://github.com/bmcfee/crema) — Brian McFee's structured chord recogniser (ISMIR 2017), 170-chord vocabulary with inversions, running on ONNX Runtime with a from-scratch TypeScript front end |
| 🎹 MIDI tracks | Symbolic analysis — onset clustering, template matching over 24 chord qualities, strum/arpeggio folding |

Before each extraction you choose the **strum window**, **minimum chord length**, **snap
grid**, whether to keep **slash chords** and **extensions** — and HyperChord remembers your
choices.

## ⬇️ Download & install

1. Grab **`HyperChord.ablx`** from the [latest release](https://github.com/hereAlexT/ableton-hyper-chord/releases/latest).
2. In Live: **Settings → Extensions**, make sure *Developer Mode* is **off**, and drop the
   `.ablx` onto that page.
3. Right-click a track. That's it.

**Requirements**

- Ableton Live 12 with Extensions support (currently the Live 12 **beta** from Ableton's
  beta program)
- macOS on Apple Silicon (the release bundles the arm64 ONNX Runtime; Intel / Windows builds
  are a `package` script tweak away — see below)
- Record File Type may be WAV or AIFF

## ⚠️ Good to know

- Audio timing assumes a **constant tempo**; tempo automation will drift.
- crema is trained on full mixes. On a lone pad or a single guitar it can confuse close
  relatives (`Emaj7` ↔ `G#m7`) and smooths over fast changes. If a part exists as MIDI,
  analyse the MIDI — it's exact.
- The SDK does not expose the piano-roll note selection, so "What's This Chord?" works on a
  **clip** or an **Arrangement time selection**, not on notes you've highlighted in the
  piano roll.
- Looped MIDI clips contribute their first pass only. Session-view clip slots aren't
  handled yet.

## 🛠️ Build it yourself

```sh
cd extension
# copy ableton-extensions-sdk-*.tgz and ableton-extensions-cli-*.tgz from the SDK zip into vendor/
npm install
npm start          # Developer Mode on in Live → builds and loads the extension
npm test           # 57 tests, incl. parity against the C++ reference when .parity/cqt_parity exists
npm run package    # → HyperChord.ablx
```

The SDK tarballs are not in this repo (Ableton's licence doesn't allow redistributing
them). To ship for another platform, add `node_modules/onnxruntime-node/bin/napi-v6/<platform>`
to the `package` script in `extension/package.json`.

```
extension/src/analysis/    pure TypeScript — CQT, crema decoder, chord naming, key logic
extension/src/worker/      the crema runtime (worker thread, or child process under Live's host)
extension/src/chordTrack/  Live glue: master track, ranges, clip writing
extension/src/commands/    the context-menu commands
extension/src/ui/          dialogs, options form, browser panel
```

## 🙏 Credits

- [crema](https://github.com/bmcfee/crema) by Brian McFee — the chord model
- [ableton-pytheory](https://github.com/kennethreitz/ableton-pytheory) — for showing how to
  run heavy code beside Live's Extension Host
- Ableton — for opening Live up

MIT © hereAlexT
