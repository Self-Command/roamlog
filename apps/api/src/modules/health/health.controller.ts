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
    // Only a hard dependency outage is 503. A Redis outage is `degraded` + 200:
    // the API still serves, so the instance must stay in the load balancer.
    response.status(result.status === "unavailable" ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK);
    return result;
  }
}
