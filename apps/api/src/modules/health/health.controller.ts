import { Controller, Get, HttpStatus, Inject, Res } from "@nestjs/common";
import type { Response } from "express";

import { ReadinessService, type ReadinessResult } from "./readiness.service.js";

export interface LivenessResponse {
  status: "ok";
}

@Controller()
export class HealthController {
  constructor(@Inject(ReadinessService) private readonly readiness: ReadinessService) {}

  @Get("health")
  health(): LivenessResponse {
    return { status: "ok" };
  }

  @Get("ready")
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessResult> {
    const result = await this.readiness.check();
    response.status(result.status === "ok" ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
