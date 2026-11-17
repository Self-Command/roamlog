import { Controller, Get, Inject, Res } from "@nestjs/common";
import type { Response } from "express";

import { MetricsService } from "./metrics.service.js";

@Controller("metrics")
export class MetricsController {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService) {}

  @Get()
  async scrape(@Res() response: Response): Promise<void> {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", this.metrics.contentType);
    response.send(await this.metrics.render());
  }
}
