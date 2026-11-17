export interface WorkerLoggerLike {
  debug(context: Record<string, unknown>, message: string): void;
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

/** Loose Prisma surface so jobs can be unit tested with plain fakes. */
export type WorkerDatabase = Record<string, any>;

export interface WorkerObject {
  bytes: Uint8Array;
  contentType: string;
}

export interface WorkerStorage {
  getObject(key: string): Promise<WorkerObject>;
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
}

export interface ProcessedVariant {
  name: string;
  key: string;
  mimeType: string;
  size: number;
  width: number;
  bytes: Uint8Array;
}

export interface ImageProcessingResult {
  width: number;
  height: number;
  blurhash: string | null;
  variants: ProcessedVariant[];
}

export interface ImageProcessor {
  process(input: {
    bytes: Uint8Array;
    mimeType: string;
    mediaKey: string;
  }): Promise<ImageProcessingResult>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

export type EmailSender = (message: EmailMessage) => Promise<{ providerId: string }>;

export type EmailRenderer = (
  template: string,
  data: Record<string, unknown>,
) => Promise<{ subject: string; html: string; text: string }>;

export interface WorkerDependencies {
  db: WorkerDatabase;
  storage: WorkerStorage;
  images: ImageProcessor;
  email: {
    send: EmailSender;
    render: EmailRenderer;
  };
  now(): Date;
  logger: WorkerLoggerLike;
}
