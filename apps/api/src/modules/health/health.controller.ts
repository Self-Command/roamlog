import { readFileSync } from "node:fs";

import type { HealthResponse } from "@roamlog/contracts";
import { Controller, Get, HttpStatus, Inject, Res } from "@nestjs/common";
import type { Response } from "express";

import { ReadinessService, type ReadinessResult } from "./readiness.service.js";

/**
 * The service version reported by liveness. Resolved from the API package
 * manifest next to the running file, so it works in `src` (tsx/vitest) and in
 * `dist` (`node dist/main.js`): both are three levels below `apps/api`.
 * A build-time constant would drift; a failed read only loses the version.
 */
function readPackageVersion(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    if (typeof manifest.version === "string" && manifest.version.trim() !== "") {
      return manifest.version;
    }
  } catch {
    // Fall through: liveness must never depend on the filesystem.
  }
  return "0.0.0";
}

const PACKAGE_VERSION = readPackageVersion();

@Controller()
export class HealthController {
  constructor(@Inject(ReadinessService) private readonly readiness: ReadinessService) {}

  /**
   * `HealthResponseSchema` is `.strict()` and requires all three fields; the
   * body is returned as `HealthResponse`, so the contract and the handler
   * cannot drift silently again.
   */
  @Get("health")
  health(): HealthResponse {
    return {
      status: "ok",
      version: PACKAGE_VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
    };
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