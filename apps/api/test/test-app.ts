import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { vi } from "vitest";

import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/bootstrap/configure-app.js";
import { PrismaService } from "../src/modules/prisma/prisma.service.js";
import { RealtimeGateway } from "../src/modules/realtime/realtime.gateway.js";
import { RedisService } from "../src/modules/redis/redis.service.js";
import { StorageService } from "../src/modules/storage/storage.service.js";

export interface TestDependencyMocks {
  prisma: {
    healthCheck: ReturnType<typeof vi.fn>;
  };
  redis: {
    ping: ReturnType<typeof vi.fn>;
  };
  storage: {
    checkHealth: ReturnType<typeof vi.fn>;
  };
}

export async function createTestApp(): Promise<{
  app: INestApplication;
  mocks: TestDependencyMocks;
}> {
  const mocks: TestDependencyMocks = {
    prisma: {
      healthCheck: vi.fn().mockResolvedValue(undefined),
    },
    redis: {
      ping: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      checkHealth: vi.fn().mockResolvedValue(undefined),
    },
  };

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue(mocks.prisma)
    .overrideProvider(RedisService)
    .useValue(mocks.redis)
    // RealtimeGateway opens two real ioredis connections for the Socket.IO
    // adapter even when RedisService is stubbed. These e2e apps do not exercise
    // websockets, and Node's shared process can otherwise surface ioredis
    // "Connection is closed" rejections while another worker tears down its
    // app. Keep the provider inert so the test job owns no background sockets.
    .overrideProvider(RealtimeGateway)
    .useValue({
      onApplicationBootstrap: async () => undefined,
      onModuleDestroy: () => undefined,
    })
    .overrideProvider(StorageService)
    .useValue(mocks.storage)
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();

  return { app, mocks };
}
