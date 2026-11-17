import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { configureApp } from "./bootstrap/configure-app.js";
import { AppConfigService } from "./config/app-config.service.js";
import { loadEnvironmentFiles } from "./config/load-environment.js";
import { PinoLoggerService } from "./modules/observability/pino-logger.service.js";

async function bootstrap(): Promise<void> {
  const environmentFile = loadEnvironmentFiles();
  const { AppModule } = await import("./app.module.js");
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  configureApp(app);

  const config = app.get(AppConfigService);
  const logger = app.get(PinoLoggerService);
  await app.listen(config.apiPort);
  logger.log(
    {
      port: config.apiPort,
      apiUrl: config.apiUrl,
      environmentFile,
    },
    "api.started",
  );
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(`Roamlog API failed to start: ${message}`);
  process.exitCode = 1;
});
