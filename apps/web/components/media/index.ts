export { CoverUploader } from "./cover-uploader";
export type { CoverChange, CoverUploaderProps } from "./cover-uploader";

export {
  COVER_POLL_INTERVAL_MS,
  COVER_PROCESS_TIMEOUT_MS,
  useCoverUpload,
} from "./use-cover-upload";
export type {
  CoverTransition,
  CoverUploadState,
  UseCoverUploadOptions,
  UseCoverUploadResult,
} from "./use-cover-upload";

export { formatBytes, resolveCoverMimeType, validateCoverFile } from "./cover-upload-validation";
export type { CoverValidationResult, ValidateCoverFileOptions } from "./cover-upload-validation";

export {
  coverValidationError,
  mapCoverFailure,
  processingFailure,
  signatureExpiredError,
  type CoverUploadError,
  type CoverUploadErrorCode,
  type CoverUploadOperation,
  type CoverUploadPhase,
} from "./cover-upload-error";