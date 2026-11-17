import { Global, Module } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { StorageService } from "./storage.service.js";

@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      useFactory: (config: AppConfigService, logger: PinoLoggerService) =>
        new StorageService(config.storageSettings, logger),
      inject: [AppConfigService, PinoLoggerService],
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
