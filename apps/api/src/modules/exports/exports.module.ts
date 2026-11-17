import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { JobQueueModule } from "./job-queue.module.js";
import { ExportsController } from "./exports.controller.js";
import { ExportsRepository } from "./exports.repository.js";
import { ExportsService } from "./exports.service.js";

@Module({
  imports: [AccessControlModule, AuditModule, IdempotencyModule, JobQueueModule],
  controllers: [ExportsController],
  providers: [ExportsRepository, ExportsService],
  exports: [ExportsService, JobQueueModule],
})
export class ExportsModule {}
