import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module.js";
import { FeatureFlagsService } from "./feature-flags.service.js";

@Module({
  imports: [AuditModule],
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
