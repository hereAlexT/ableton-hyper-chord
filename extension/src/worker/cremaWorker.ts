// The crema runtime. Runs outside the Extension Host's vm sandbox because
// onnxruntime-node is a native addon and the HCQT is CPU-heavy.
//
// Two transports, decided by how we were launched (same scheme as pytheory):
//  - worker thread (dev host): messages over parentPort
//  - child process (Live's managed host denies worker_threads under Node's
//    permission model): newline-delimited JSON over stdin/stdout

import * as fs from "node:fs";
import { parentPort } from "node:worker_threads";

import { decodeAudioFile } from "../analysis/audioFile.js";
import { parseDecoderTable, type CremaDecoderJson, type CremaDecoderTable } from "../analysis/crema/decoderTable.js";
import { createOrtRunner } from "../analysis/crema/ortRunner.js";
import { analyzePcm } from "../analysis/crema/pipeline.js";
import type { AnalyzeRequest, WorkerReply } from "./protocol.js";

let send: (message: WorkerReply) => void;

if (parentPort) {
  const port = parentPort;
  send = (message) => port.postMessage(message);
  port.on("message", (m: AnalyzeRequest) => void handleRequest(m));
} else {
  // Child-process mode: stdout carries the protocol, so reroute all logging to stderr.
  const writeOut = process.stdout.write.bind(process.stdout);
  const log = (...args: unknown[]) => process.stderr.write(args.map(String).join(" ") + "\n");
  console.log = console.info = console.warn = log;
  send = (message) => {
    writeOut(JSON.stringify(message) + "\n");
  };
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.trim()) void handleRequest(JSON.parse(line) as AnalyzeRequest);
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

const tables = new Map<string, CremaDecoderTable>();
function tableFor(decoderPath: string): CremaDecoderTable {
  let t = tables.get(decoderPath);
  if (!t) {
    t = parseDecoderTable(JSON.parse(fs.readFileSync(decoderPath, "utf8")) as CremaDecoderJson);
    tables.set(decoderPath, t);
  }
  return t;
}

async function handleRequest(req: AnalyzeRequest): Promise<void> {
  const { id } = req;
  try {
    const table = tableFor(req.decoderPath);
    const runner = createOrtRunner(req.modelPath);
    const audio = decodeAudioFile(fs.readFileSync(req.audioPath));
    const result = await analyzePcm(audio.samples, audio.sampleRate, audio.channels, table, runner, (stage, percent) =>
      send({ id, progress: { stage, percent } }),
    );
    send({
      id,
      result: {
        segments: result.segments,
        frames: result.frames,
        sampleRate: audio.sampleRate,
        channels: audio.channels,
        durationSeconds: audio.samples.length / audio.channels / audio.sampleRate,
      },
    });
  } catch (error) {
    send({ id, error: describeError(error) });
  }
}

function describeError(error: unknown): string {
  const e = error as NodeJS.ErrnoException & { permission?: string; resource?: string };
  let message = e instanceof Error ? (e.stack ?? e.message) : String(error);
  if (e.permission) message += ` [permission: ${e.permission}]`;
  if (e.resource) message += ` [resource: ${e.resource}]`;
  return message;
}

const permission = (process as unknown as { permission?: { has(name: string): boolean } }).permission;
console.error(`hyper-chord crema runtime: ${parentPort ? "worker" : "child"} mode, permission model ${permission ? "ON" : "off"}`);
send({ ready: true });
