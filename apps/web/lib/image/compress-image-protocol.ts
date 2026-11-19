import type {
  CompressionResult,
  ImageCompressionFailureCode,
  ImageCompressionProgress,
} from "./compress-image";

export interface CompressWorkerRequest {
  id: number;
  file: File;
  maxEdge: number;
  targetBytes: number;
}

export interface CompressWorkerError {
  code: ImageCompressionFailureCode;
  message: string;
  detail?: string;
}

export type CompressWorkerResponse =
  | { type: "progress"; id: number; progress: ImageCompressionProgress }
  | { type: "result"; id: number; result: CompressionResult }
  | { type: "error"; id: number; error: CompressWorkerError };