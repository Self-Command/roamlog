export { CoverUploader } from "./cover-uploader";
export type { CoverChange, CoverUploaderProps } from "./cover-uploader";

// Photo EXIF (0014): the read happens in the browser before compression, and
// these two components are the display layers that consume it.
export {
  MediaExifDetail,
  MediaExifSummary,
  formatAperture,
  formatCameraName,
  formatCaptureDate,
  formatCaptureTime,
  formatExposureSummary,
  formatExposureTime,
  formatFocalLength,
  formatLensName,
  hasExactLocation,
} from "./media-exif";
export type { MediaExifDetailProps, MediaExifSummaryProps } from "./media-exif";
export {
  PHOTO_EXIF_MAX_BYTES,
  PHOTO_EXIF_TIMEOUT_MS,
  readPhotoExif,
  readPhotoExifSafely,
} from "@/lib/image/read-photo-exif";
export type {
  PhotoExifParser,
  PhotoExifRead,
  PhotoExifReader,
  ReadPhotoExifOptions,
} from "@/lib/image/read-photo-exif";

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