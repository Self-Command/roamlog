import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedRequest } from "../../../common/guards/actor-context.js";
import { ProblemDetailsFilter } from "../../../common/filters/problem-details.filter.js";
import { PermissionService } from "../../../common/services/permission.service.js";
import { RolesGuard } from "../../../common/guards/roles.guard.js";
import { SessionGuard } from "../../../common/guards/session.guard.js";
import { TenantGuard } from "../../../common/guards/tenant.guard.js";
import { VerifiedEmailGuard } from "../../../common/guards/verified-email.guard.js";
import { WorkspaceAccessService } from "../../../common/services/workspace-access.service.js";
import { AiController } from "../ai.controller.js";
import { AiExecuteService } from "../ai-execute.service.js";
import { AiPlanService } from "../ai-plan.service.js";
import { AiToolbox } from "../ai-tools.js";
import { AI_ADAPTER_FACTORY } from "../adapters/index.js";
import { AI_CLOCK, AI_SETTINGS_SOURCE, staticAiSettingsSource } from "../ai.settings.js";
import { PinoLoggerService } from "../../observability/pino-logger.service.js";
import {
  actorStub,
  aiSettings,
  fixedClock,
  loggerStub,
  membershipStub,
  quotaStub,
  runStoreStub,
  scriptedAdapter,
  toolServiceMocks,
  WORKSPACE_ID,
} from "./ai-fixtures.js";

const apps: INestApplication[] = [];

async function createApp(options: {
  role?: "viewer" | "editor";
  settings?: ReturnType<typeof aiSettings>;
  quotaAllowed?: boolean;
  turns?: Parameters<typeof scriptedAdapter>[0];
} = {}) {
  const tools = toolServiceMocks();
  const toolbox = new AiToolbox(
    tools.places as never,
    tools.trips as never,
    tools.stops as never,
    tools.itinerary as never,
    tools.packing as never,
  );
  const logger = loggerStub();
  const adapter = scriptedAdapter(
    options.turns ?? [
      {
        text: "Here is a plan.",
        toolCalls: [
          { id: "c1", name: "trips.create", input: { title: "Kyoto week" } },
        ],
        usage: { inputTokens: 12, outputTokens: 6 },
      },
    ],
  );

  const settings = options.settings ?? aiSettings();
  const clock = fixedClock();
  const moduleRef = await Test.createTestingModule({
    controllers: [AiController],
    providers: [
      { provide: AI_SETTINGS_SOURCE, useValue: staticAiSettingsSource(settings) },
      {
        provide: AI_ADAPTER_FACTORY,
        useValue: () => (settings.configured ? adapter : undefined),
      },
      { provide: AI_CLOCK, useValue: clock },
      { provide: PinoLoggerService, useValue: logger },
      PermissionService,
      RolesGuard,
      TenantGuard,
      { provide: SessionGuard, useValue: { canActivate: () => true } },
      { provide: VerifiedEmailGuard, useValue: { canActivate: () => true } },
      { provide: WorkspaceAccessService, useValue: {} },
      { provide: AiToolbox, useValue: toolbox },
      {
        provide: AiPlanService,
        useFactory: () =>
          new AiPlanService(
            staticAiSettingsSource(settings),
            () => (settings.configured ? adapter : undefined),
            toolbox,
            quotaStub(
              options.quotaAllowed === false ? { allowed: false, remaining: 0 } : {},
            ) as never,
            runStoreStub() as never,
            logger as never,
            clock,
          ),
      },
      { provide: AiExecuteService, useValue: { execute: vi.fn() } },
    ],
  })
    .overrideGuard(TenantGuard)
    .useValue({
      canActivate: (context: { switchToHttp: () => { getRequest: () => AuthenticatedRequest } }) => {
        const request = context.switchToHttp().getRequest();
        request.user = actorStub().user as never;
        request.workspaceMembership = membershipStub(options.role ?? "editor") as never;
        return true;
      },
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(
    new ProblemDetailsFilter(asLogger(logger), { captureException: vi.fn() } as never),
  );
  await app.init();
  apps.push(app);
  return { app, logger };
}

function asLogger(stub: ReturnType<typeof loggerStub>) {
  return stub as never;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("POST /v1/workspaces/:workspaceId/ai/chat", () => {
  it("returns 503 AI_NOT_CONFIGURED when the gateway is not configured", async () => {
    const { app } = await createApp({
      settings: aiSettings({ configured: false, baseUrl: null }),
    });

    const response = await request(app.getHttpServer())
      .post(`/v1/workspaces/${WORKSPACE_ID}/ai/chat`)
      .send({ message: "I want Kyoto for a week." })
      .expect(503);
    expect(response.body).toMatchObject({ code: "AI_NOT_CONFIGURED" });
  });

  it("returns 429 AI_QUOTA when the daily quota is exhausted", async () => {
    const { app } = await createApp({ quotaAllowed: false });

    const response = await request(app.getHttpServer())
      .post(`/v1/workspaces/${WORKSPACE_ID}/ai/chat`)
      .send({ message: "I want Kyoto for a week." })
      .expect(429);

    expect(response.body).toMatchObject({ code: "AI_QUOTA" });
  });

  it("rejects a viewer with 403 before any planning happens", async () => {
    const { app } = await createApp({ role: "viewer" });

    const response = await request(app.getHttpServer())
      .post(`/v1/workspaces/${WORKSPACE_ID}/ai/chat`)
      .send({ message: "I want Kyoto for a week." })
      .expect(403);

    expect(response.body).toMatchObject({ code: "WORKSPACE_ROLE_FORBIDDEN" });
  });

  it("plans for an editor and returns the run envelope", async () => {
    const { app } = await createApp({ role: "editor" });

    const response = await request(app.getHttpServer())
      .post(`/v1/workspaces/${WORKSPACE_ID}/ai/chat`)
      .send({ message: "I want Kyoto for a week, budget 8000 CNY." })
      .expect(201);

    expect(response.body).toMatchObject({
      plannedCalls: [{ tool: "trips.create", args: { title: "Kyoto week" } }],
      readOnlyTrace: [],
      message: "Done.",
      provider: { protocol: "openai-chat" },
      usage: { inputTokens: 12, outputTokens: 6 },
    });
    expect(response.body.runId).toMatch(/^[0-9a-f]{32}$/u);
  });

  it("rejects a message that is too long with 400 VALIDATION_ERROR", async () => {
    const { app } = await createApp();

    const response = await request(app.getHttpServer())
      .post(`/v1/workspaces/${WORKSPACE_ID}/ai/chat`)
      .send({ message: "x".repeat(2_001) })
      .expect(400);

    expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("POST /v1/workspaces/:workspaceId/ai/runs/:runId/execute", () => {
  it("validates the run id format", async () => {
    const { app } = await createApp();

    const response = await request(app.getHttpServer())
      .post(`/v1/workspaces/${WORKSPACE_ID}/ai/runs/not-a-run/execute`)
      .send({
        calls: [{ tool: "trips.create", args: { title: "Kyoto" } }],
        idempotencyKey: "execute-once-1",
      })
      .expect(400);

    expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});