import { isApiError } from "@/lib/api/errors";
import { isSignedUrlUploadError, type SignedUrlUploadError } from "@/lib/api/media";

/** Phases of the cover pipeline, mirroring `useCoverUpload`'s state machine. */
export type CoverUploadPhase =
  | "idle"
  | "validating"
  | "compressing"
  | "presigning"
  | "uploading"
  | "completing"
  | "processing"
  | "applying"
  | "ready"
  | "error";

export type CoverUploadOperation = "upload" | "clear";

export type CoverUploadErrorCode =
  | "COVER_TYPE_UNSUPPORTED"
  | "COVER_TOO_LARGE"
  | "COVER_EMPTY_FILE"
  | "COVER_FILE_NAME_INVALID"
  | "DECODE_FAILED"
  | "ENCODE_FAILED"
  | "TOO_LARGE_AFTER_COMPRESSION"
  | "NETWORK_ERROR"
  | "UPLOAD_CANCELLED"
  | "UPLOAD_TOO_LARGE"
  | "UPLOAD_UNSUPPORTED_TYPE"
  | "UPLOAD_HTTP_ERROR"
  | "STORAGE_UNAVAILABLE"
  | "SIGNED_URL_EXPIRED"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "REQUEST_FAILED"
  | "MEDIA_NOT_READY"
  | "PROCESSING_FAILED"
  | "PROCESSING_TIMEOUT"
  | "VERSION_CONFLICT"
  | "UNKNOWN";

/**
 * A classified, user-presentable upload failure.
 *
 * `code` is the stable client classification, `serverCode` keeps the API problem
 * code (for example `MEDIA_NOT_READY`) and `detail` keeps the server detail, so
 * the UI can explain exactly what happened instead of swallowing the error.
 * `resumeAt` tells the state machine which step a retry must continue from.
 */
export interface CoverUploadError {
  code: CoverUploadErrorCode;
  message: string;
  detail?: string;
  serverCode?: string;
  status?: number;
  retryable: boolean;
  resumeAt: CoverUploadPhase;
}

export function coverValidationError(
  code: Extract<
    CoverUploadErrorCode,
    | "COVER_TYPE_UNSUPPORTED"
    | "COVER_TOO_LARGE"
    | "COVER_EMPTY_FILE"
    | "COVER_FILE_NAME_INVALID"
  >,
  message: string,
): CoverUploadError {
  return { code, message, retryable: false, resumeAt: "validating" };
}

/**
 * Compression failures leave the selected source file intact, so retrying from
 * `compressing` re-runs the Worker/fallback instead of restarting the upload.
 */
export function compressionFailure(
  code: Extract<
    CoverUploadErrorCode,
    "DECODE_FAILED" | "ENCODE_FAILED" | "TOO_LARGE_AFTER_COMPRESSION"
  >,
  message: string,
  detail?: string,
): CoverUploadError {
  return {
    code,
    message,
    ...(detail ? { detail } : {}),
    retryable: true,
    resumeAt: "compressing",
  };
}

export function signatureExpiredError(): CoverUploadError {
  return {
    code: "SIGNED_URL_EXPIRED",
    message: "上传链接已过期，请重试。",
    retryable: true,
    resumeAt: "presigning",
  };
}

export function processingFailure(
  code: "PROCESSING_FAILED" | "PROCESSING_TIMEOUT",
  detail?: string,
): CoverUploadError {
  if (code === "PROCESSING_TIMEOUT") {
    return {
      code,
      message: "图片处理超时，可以重试继续查询处理结果。",
      ...(detail ? { detail } : {}),
      retryable: true,
      resumeAt: "processing",
    };
  }
  return {
    code,
    message: "图片处理失败，可以重试重新处理这张图片。",
    ...(detail ? { detail } : {}),
    retryable: true,
    resumeAt: "completing",
  };
}

function isAbortError(value: unknown): boolean {
  return (
    typeof DOMException !== "undefined" &&
    value instanceof DOMException &&
    value.name === "AbortError"
  );
}

/**
 * Maps a rejection from the generated API client, a signed-URL PUT, or an
 * unexpected runtime error to a classified {@link CoverUploadError}.
 */
export function mapCoverFailure(error: unknown, phase: CoverUploadPhase): CoverUploadError {
  if (isSignedUrlUploadError(error)) {
    return mapStorageFailure(error, phase);
  }

  if (isAbortError(error)) {
    return {
      code: "UPLOAD_CANCELLED",
      message: "上传已取消。",
      retryable: false,
      resumeAt: phase,
    };
  }

  if (!isApiError(error)) {
    return {
      code: "UNKNOWN",
      message: "上传失败，请重试。",
      ...(error instanceof Error ? { detail: error.message } : {}),
      retryable: true,
      resumeAt: phase,
    };
  }

  const status = error.status;
  const serverCode = error.code;
  const detail = error.problem?.detail ?? error.message;
  const base = { detail, serverCode, status, resumeAt: phase };

  if (serverCode === "MEDIA_NOT_READY") {
    return {
      ...base,
      code: "MEDIA_NOT_READY",
      message: "图片仍在处理中，稍后会自动重试。",
      retryable: true,
      resumeAt: "processing",
    };
  }
  if (serverCode === "VERSION_CONFLICT" || status === 409) {
    return {
      ...base,
      code: "VERSION_CONFLICT",
      message: "这趟旅行已被其他人更新，请刷新页面后重试。",
      retryable: true,
      resumeAt: phase,
    };
  }
  if (status === 401) {
    return {
      ...base,
      code: "AUTH_REQUIRED",
      message: "登录状态已失效，请重新登录后再试。",
      retryable: false,
    };
  }
  if (status === 403) {
    return {
      ...base,
      code: "FORBIDDEN",
      message: "你没有修改封面的权限。请联系工作区所有者或管理员。",
      retryable: false,
    };
  }
  if (status === 404) {
    return {
      ...base,
      code: "NOT_FOUND",
      message: "找不到对应的旅行或图片。",
      retryable: false,
    };
  }
  if (status === 413) {
    return {
      ...base,
      code: "UPLOAD_TOO_LARGE",
      message: "文件超过 25 MB 上限，请压缩后重试。",
      retryable: false,
    };
  }
  if (status === 415) {
    return {
      ...base,
      code: "UPLOAD_UNSUPPORTED_TYPE",
      message: "不支持这种图片格式，请改用 JPEG、PNG 或 WebP。",
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      ...base,
      code: "RATE_LIMITED",
      message: "操作太频繁，请稍后再试。",
      retryable: true,
    };
  }
  if (status >= 500) {
    return {
      ...base,
      code: "SERVER_ERROR",
      message: "图片服务暂时不可用，请重试。",
      retryable: true,
    };
  }

  return {
    ...base,
    code: "REQUEST_FAILED",
    message: "请求失败，请重试。",
    retryable: true,
  };
}

function mapStorageFailure(
  error: SignedUrlUploadError,
  phase: CoverUploadPhase,
): CoverUploadError {
  const detail = error.message;

  if (error.code === "aborted") {
    return { code: "UPLOAD_CANCELLED", message: "上传已取消。", detail, retryable: false, resumeAt: phase };
  }
  if (error.code === "network") {
    return {
      code: "NETWORK_ERROR",
      message: "网络连接中断，请检查网络后重试。",
      detail,
      retryable: true,
      resumeAt: phase,
    };
  }

  const status = error.status;
  if (status === 403) {
    // A signed PUT carries no user credentials: 403 here means the SigV4
    // signature (or its expiry) no longer matches, so a fresh presign is needed.
    return {
      code: "SIGNED_URL_EXPIRED",
      message: "上传链接已过期，请重试。",
      detail,
      status: 403,
      retryable: true,
      resumeAt: "presigning",
    };
  }
  if (status === 413) {
    return {
      code: "UPLOAD_TOO_LARGE",
      message: "文件超过 25 MB 上限，请压缩后重试。",
      detail,
      status,
      retryable: false,
      resumeAt: phase,
    };
  }
  if (status === 415) {
    return {
      code: "UPLOAD_UNSUPPORTED_TYPE",
      message: "不支持这种图片格式，请改用 JPEG、PNG 或 WebP。",
      detail,
      status,
      retryable: false,
      resumeAt: phase,
    };
  }
  if (status !== null && status >= 500) {
    return {
      code: "STORAGE_UNAVAILABLE",
      message: "图片服务暂时不可用，请重试。",
      detail,
      status,
      retryable: true,
      resumeAt: phase,
    };
  }

  return {
    code: "UPLOAD_HTTP_ERROR",
    message: "图片上传失败，请稍后重试。",
    detail,
    ...(status === null ? {} : { status }),
    retryable: true,
    resumeAt: phase,
  };
}
