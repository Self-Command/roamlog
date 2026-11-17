import { Global, Module } from "@nestjs/common";

import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { EmailDeliveryService } from "./email-delivery.service.js";

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, EmailDeliveryService],
  exports: [AuthService, EmailDeliveryService],
})
export class AuthModule {}
