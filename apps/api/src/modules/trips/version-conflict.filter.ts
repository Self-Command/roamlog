import { Catch, HttpStatus } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { problemDetails } from "@roamlog/contracts";
import type { Request, Response } from "express";

import { VersionConflictException } from "./version-conflict.exception.js";

@Catch(VersionConflictException)
export class VersionConflictFilter implements ExceptionFilter {
  catch(exception: VersionConflictException, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const payload = exception.getResponse() as { current?: unknown; message?: string | string[] };

    response
      .status(HttpStatus.CONFLICT)
      .type("application/problem+json")
      .send({
        ...problemDetails({
          status: HttpStatus.CONFLICT,
          code: "VERSION_CONFLICT",
          detail:
            typeof payload.message === "string"
              ? payload.message
              : "The entity changed since it was loaded.",
          instance: request.originalUrl.split("?")[0] ?? request.path,
        }),
        current: payload.current ?? null,
      });
  }
}
