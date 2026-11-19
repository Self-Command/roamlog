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

// Live Photo (D2): playback surface plus the paired and motion-aware uploader.
// The cover uploader above is untouched; these are additive exports.
export { LivePhoto } from "./live-photo";
export type { LivePhotoProps } from "./live-photo";

export {
  createLivePhotoUploadClient,
  stillMimeType,
  useLivePhotoUpload,
} from "./use-live-photo-upload";
export type {
  LivePhotoUploadClient,
  LivePhotoUploadItem,
  LivePhotoUploadPhase,
  UseLivePhotoUploadOptions,
  UseLivePhotoUploadResult,
} from "./use-live-photo-upload";

export {
  LIVE_PHOTO_MOTION_MAX_BYTES,
  LIVE_PHOTO_MOTION_MAX_DURATION_MS,
  probeMotionDuration,
  resolveMotionMimeType,
  validateMotionFile,
} from "@/lib/image/live-photo-motion";
export {
  fileBasename,
  isMotionFile,
  isStillFile,
  pairLivePhotos,
} from "@/lib/image/live-photo-pair";
export type { LivePhotoPair, LivePhotoPairing } from "@/lib/image/live-photo-pair";