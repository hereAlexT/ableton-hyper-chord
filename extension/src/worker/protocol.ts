import type { CremaStage } from "../analysis/crema/pipeline.js";
import type { ChordSegment } from "../analysis/types.js";

export interface AnalyzeRequest {
  id: number;
  /** WAV/AIFF file to analyse (must be readable by the worker). */
  audioPath: string;
  modelPath: string;
  decoderPath: string;
}

export interface AnalyzeResultPayload {
  segments: ChordSegment[];
  frames: number;
  sampleRate: number;
  channels: number;
  durationSeconds: number;
}

export type WorkerReply =
  | { ready: true }
  | { bootError: string }
  | { id: number; progress: { stage: CremaStage; percent: number } }
  | { id: number; result: AnalyzeResultPayload }
  | { id: number; error: string };
