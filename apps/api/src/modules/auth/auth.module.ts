import { Global, Module } from "@nestjs/common";

import { SecurityModule } from "../../common/security/security.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { EmailDeliveryService } from "./email-delivery.service.js";

@Global()
@Module({
  imports: [SecurityModule],
  controllers: [AuthController],
  providers: [AuthService, EmailDeliveryService],
  exports: [AuthService, EmailDeliveryService],
})
export class AuthModule {}
