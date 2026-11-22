import { HttpException, HttpStatus } from "@nestjs/common";
import type { ProviderProblemCode } from "@roamlog/contracts";

export interface ProviderProblemError {
  field?: string;
  code: string;
  message: string;
}

const STATUS: Readonly<Record<ProviderProblemCode, number>> = Object.freeze({
  PROVIDER_GROUP_NOT_FOUND: HttpStatus.NOT_FOUND,
  PROVIDER_NOT_FOUND: HttpStatus.NOT_FOUND,
  PROVIDER_VERSION_CONFLICT: HttpStatus.CONFLICT,
  PROVIDER_ORDER_CONFLICT: HttpStatus.CONFLICT,
  PROVIDER_ACTIVE_CONFLICT: HttpStatus.CONFLICT,
  PROVIDER_ADAPTER_UNSUPPORTED: HttpStatus.UNPROCESSABLE_ENTITY,
  PROVIDER_CONFIG_INVALID: HttpStatus.UNPROCESSABLE_ENTITY,
  PROVIDER_SECRET_FIELD_UNKNOWN: HttpStatus.UNPROCESSABLE_ENTITY,
  PROVIDER_MODELS_DISCOVERY_UNSUPPORTED: HttpStatus.UNPROCESSABLE_ENTITY,
  PROVIDER_MODEL_DEFAULT_REQUIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  PROVIDER_EGRESS_BLOCKED: HttpStatus.UNPROCESSABLE_ENTITY,
  PROVIDER_SECRETS_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  PROVIDER_PROBE_FAILED: HttpStatus.BAD_GATEWAY,
  PROVIDER_PROBE_TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
  PROVIDER_MODELS_DISCOVERY_FAILED: HttpStatus.BAD_GATEWAY,
  PROVIDER_MODELS_DISCOVERY_TIMEOUT: HttpStatus.GATEWAY_TIMEOUT,
  PROVIDER_MODELS_RESPONSE_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  PROVIDER_LIMIT_REACHED: HttpStatus.TOO_MANY_REQUESTS,
  AI_MODEL_NOT_ALLOWED: HttpStatus.BAD_REQUEST,
  AI_PROVIDERS_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
});

const MESSAGE: Readonly<Record<ProviderProblemCode, string>> = Object.freeze({
  PROVIDER_GROUP_NOT_FOUND: "The provider group was not found.",
  PROVIDER_NOT_FOUND: "The provider was not found.",
  PROVIDER_VERSION_CONFLICT: "The provider was changed by another operator.",
  PROVIDER_ORDER_CONFLICT: "The provider order was changed by another operator.",
  PROVIDER_ACTIVE_CONFLICT: "Only one provider may be active in this group.",
  PROVIDER_ADAPTER_UNSUPPORTED: "The provider adapter is not supported.",
  PROVIDER_CONFIG_INVALID: "The provider configuration is invalid.",
  PROVIDER_SECRET_FIELD_UNKNOWN: "The provider secret field is not supported.",
  PROVIDER_MODELS_DISCOVERY_UNSUPPORTED: "This provider does not expose a supported model catalog.",
  PROVIDER_MODEL_DEFAULT_REQUIRED: "A default model is required before enabling this provider.",
  PROVIDER_EGRESS_BLOCKED: "The provider endpoint is not allowed from this deployment.",
  PROVIDER_SECRETS_UNAVAILABLE: "Provider secret storage is not available.",
  PROVIDER_PROBE_FAILED: "The provider request failed.",
  PROVIDER_PROBE_TIMEOUT: "The provider did not answer in time.",
  PROVIDER_MODELS_DISCOVERY_FAILED: "The provider model catalog request failed.",
  PROVIDER_MODELS_DISCOVERY_TIMEOUT: "The provider model catalog request timed out.",
  PROVIDER_MODELS_RESPONSE_TOO_LARGE: "The provider response was too large.",
  PROVIDER_LIMIT_REACHED: "The provider request limit was reached.",
  AI_MODEL_NOT_ALLOWED: "The selected AI model is not allowed.",
  AI_PROVIDERS_UNAVAILABLE: "No healthy AI provider is available.",
});

const GENERIC_MESSAGE = "The provider request failed.";

function sanitizeMessage(value: string): string {
  return value
    .replace(/https?:\/\/\S+/giu, "[provider endpoint]")
    .replace(/\b(?:api[_-]?key|token|secret|password)=[^\s&]+/giu, "[redacted]")
    .trim()
    .slice(0, 300);
}

export class ProviderProblemException extends HttpException {
  readonly code: ProviderProblemCode;
  readonly safeMessage: string;

  constructor(
    code: ProviderProblemCode,
    message?: string,
    errors?: readonly ProviderProblemError[],
  ) {
    const safeMessage = message?.trim() ? sanitizeMessage(message) : MESSAGE[code];
    super(
      {
        code,
        message: safeMessage,
        ...(errors && errors.length > 0 ? { errors: [...errors] } : {}),
      },
      STATUS[code],
    );
    this.name = "ProviderProblemException";
    this.code = code;
    this.safeMessage = safeMessage;
  }
}

export function providerProblem(
  code: ProviderProblemCode,
  message?: string,
  errors?: readonly ProviderProblemError[],
): ProviderProblemException {
  return new ProviderProblemException(code, message, errors);
}

export function safeProviderProblem(
  error: unknown,
  fallbackCode: ProviderProblemCode,
): { code: ProviderProblemCode; message: string } {
  if (error instanceof ProviderProblemException) {
    return { code: error.code, message: error.safeMessage };
  }

  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === "object" && response !== null && !Array.isArray(response)) {
      const record = response as Record<string, unknown>;
      if (
        typeof record.code === "string" &&
        Object.prototype.hasOwnProperty.call(MESSAGE, record.code)
      ) {
        const code = record.code as ProviderProblemCode;
        const message =
          typeof record.message === "string" && record.message.trim()
            ? sanitizeMessage(record.message)
            : MESSAGE[code];
        return { code, message };
      }
    }
  }

  return { code: fallbackCode, message: GENERIC_MESSAGE };
}
