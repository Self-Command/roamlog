import { Global, Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module.js";
import { ProvidersModule } from "../providers/providers.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { MailSettingsConsumer } from "../settings/mail-settings.consumer.js";
import { MailTestRateLimitGuard } from "./mail-test-rate-limit.guard.js";
import { MailTestController } from "./mail-test.controller.js";
import { MailService } from "./mail.service.js";

/**
 * Transactional mail for the API.
 *
 * Global because the auth module (which owns the templates and the `EmailLog`
 * record) must not import this module: `SettingsModule` already reaches back to
 * `AuthModule` through `AccessControlModule`, so a direct import would be a
 * module cycle. Every consumer resolves `MailService` from this global export.
 */
@Global()
@Module({
  imports: [SettingsModule, AuditModule, ProvidersModule],
  controllers: [MailTestController],
  providers: [MailSettingsConsumer, MailService, MailTestRateLimitGuard],
  exports: [MailSettingsConsumer, MailService],
})
export class EmailModule {}
