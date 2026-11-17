import { ConflictException } from "@nestjs/common";

export class VersionConflictException extends ConflictException {
  constructor(current: unknown) {
    super({
      code: "VERSION_CONFLICT",
      message: "The entity changed since it was loaded. Refresh before saving again.",
      current,
    });
  }
}
