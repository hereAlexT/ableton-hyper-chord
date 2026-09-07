// Host-side bridge to the crema runtime (src/worker/cremaWorker.ts).
//
// Preferred transport is a worker thread; Live's managed host runs Node's
// permission model without --allow-worker, so we fall back to a child process
// (newline-delimited JSON over stdio) there — the same dance pytheory does.

import { spawn } from "node:child_process";
import { Worker } from "node:worker_threads";

import type { AnalyzeRequest, AnalyzeResultPayload, WorkerReply } from "../../worker/protocol.js";
import type { CremaStage } from "./pipeline.js";

export interface CremaClientOptions {
  /** Absolute path to dist/crema-worker.cjs. */
  workerPath: string;
  modelPath: string;
  decoderPath: string;
}

export interface AnalyzeOptions {
  onProgress?: (stage: CremaStage, percentInStage: number) => void;
  signal?: AbortSignal;
}

interface Bridge {
  post(message: AnalyzeRequest): void;
  kill(): void;
}

interface Pending {
  resolve: (r: AnalyzeResultPayload) => void;
  reject: (e: Error) => void;
  onProgress?: (stage: CremaStage, percent: number) => void;
}

export class CremaClient {
  private bridge: Bridge | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly opts: CremaClientOptions) {}

  analyze(audioPath: string, options: AnalyzeOptions = {}): Promise<AnalyzeResultPayload> {
    const id = this.nextId++;
    const bridge = this.getBridge();
    return new Promise<AnalyzeResultPayload>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress: options.onProgress });
      options.signal?.addEventListener("abort", () => {
        if (this.pending.delete(id)) {
          reject(new Error("cancelled"));
          // The runtime has no cancel; drop it and let the next call restart it.
          this.shutdown();
        }
      });
      bridge.post({ id, audioPath, modelPath: this.opts.modelPath, decoderPath: this.opts.decoderPath });
    });
  }

  shutdown(): void {
    this.stopping = true;
    this.bridge?.kill();
    this.bridge = null;
  }

  private stopping = false;

  private getBridge(): Bridge {
    if (this.bridge) return this.bridge;
    this.stopping = false;
    if (process.env["HYPERCHORD_FORCE_CHILD"]) {
      this.bridge = this.startChildProcess();
      console.log("hyper-chord: crema runtime started in a child process (forced).");
      return this.bridge;
    }
    try {
      this.bridge = this.startWorker();
      console.log("hyper-chord: crema runtime started in a worker thread.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ERR_ACCESS_DENIED") throw error;
      this.bridge = this.startChildProcess();
      console.log("hyper-chord: crema runtime started in a child process.");
    }
    return this.bridge;
  }

  private onReply(reply: WorkerReply): void {
    if ("bootError" in reply) {
      console.error("hyper-chord: crema runtime failed to boot:", reply.bootError);
      return;
    }
    if ("ready" in reply) return;
    const entry = this.pending.get(reply.id);
    if (!entry) return;
    if ("progress" in reply) {
      entry.onProgress?.(reply.progress.stage, reply.progress.percent);
      return;
    }
    this.pending.delete(reply.id);
    if ("error" in reply) entry.reject(new Error(reply.error));
    else entry.resolve(reply.result);
  }

  private onCrash(error: Error): void {
    if (this.stopping) {
      this.stopping = false;
      return; // we asked it to stop
    }
    console.error("hyper-chord: crema runtime crashed:", error);
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    this.bridge = null;
  }

  private startWorker(): Bridge {
    const worker = new Worker(this.opts.workerPath);
    worker.unref();
    worker.on("message", (m: WorkerReply) => this.onReply(m));
    worker.on("error", (e) => this.onCrash(e));
    worker.on("exit", (code) => {
      if (code !== 0) this.onCrash(new Error(`crema worker exited with code ${code}`));
    });
    return {
      post: (message) => worker.postMessage(message),
      kill: () => void worker.terminate(),
    };
  }

  private startChildProcess(): Bridge {
    // The host enables Node's permission model, which propagates to child node
    // processes — but without the parent's allow-lists. Re-enable it with
    // explicit wide-open scopes (the child is our own code) plus --allow-addons
    // for onnxruntime-node, and scrub NODE_OPTIONS.
    const env = { ...process.env };
    delete env["NODE_OPTIONS"];
    const args: string[] = [];
    if ((process as unknown as { permission?: unknown }).permission) {
      args.push("--permission", "--allow-fs-read=*", "--allow-fs-write=*", "--allow-child-process", "--allow-addons");
    }
    args.push(this.opts.workerPath);
    const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"], env });
    child.unref();

    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim()) this.onReply(JSON.parse(line) as WorkerReply);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) if (line.trim()) console.error(`hyper-chord[crema]: ${line}`);
    });
    child.on("error", (e) => this.onCrash(e));
    child.on("exit", (code) => {
      if (code !== 0 && code !== null) this.onCrash(new Error(`crema runtime exited with code ${code}`));
    });
    return {
      post: (message) => void child.stdin.write(JSON.stringify(message) + "\n"),
      kill: () => void child.kill(),
    };
  }
}
