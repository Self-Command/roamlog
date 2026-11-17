import { Injectable } from "@nestjs/common";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly httpRequests = new Counter({
    name: "roamlog_http_requests_total",
    help: "Total HTTP requests handled by the Roamlog API",
    labelNames: ["method", "route", "status_code"],
    registers: [this.registry],
  });
  private readonly httpDuration = new Histogram({
    name: "roamlog_http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });
  private readonly dependencyUp = new Gauge({
    name: "roamlog_dependency_up",
    help: "Whether a critical platform dependency is available",
    labelNames: ["dependency"],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  observeHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    const labels = {
      method,
      route,
      status_code: String(statusCode),
    };
    this.httpRequests.inc(labels);
    this.httpDuration.observe(labels, durationSeconds);
  }

  setDependencyHealth(dependency: string, healthy: boolean): void {
    this.dependencyUp.set({ dependency }, healthy ? 1 : 0);
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }
}
