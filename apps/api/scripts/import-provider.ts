import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

import { ProviderGroupSchema } from "@roamlog/contracts";

import { PermissionService } from "../src/common/services/permission.service.js";
import { presentUser } from "../src/common/services/user-presenter.js";
import { WorkspaceAccessService } from "../src/common/services/workspace-access.service.js";
import type { AppConfigService } from "../src/config/app-config.service.js";
import { loadEnvironmentFiles } from "../src/config/load-environment.js";
import { validateEnvironment } from "../src/config/environment.js";
import { AuditService } from "../src/modules/audit/audit.service.js";
import { PrismaService } from "../src/modules/prisma/prisma.service.js";
import type { PinoLoggerService } from "../src/modules/observability/pino-logger.service.js";
import { ProviderConfigService } from "../src/modules/providers/provider-config.service.js";
import {
  assertProviderImportKeyring,
  buildProviderImportConfig,
  ProviderImportService,
} from "../src/modules/providers/provider-import.service.js";
import { ProviderSecretService } from "../src/modules/providers/provider-secret.service.js";

let secretForRedaction: string | null = null;

function fail(message: string): never {
  throw new Error(message);
}

async function readSecretFromStdin(): Promise<string> {
  const terminal = Boolean(process.stdin.isTTY);
  if (terminal) {
    fail("The API key must be piped through stdin; interactive input is not accepted.");
  }

  const chunks: string[] = [];
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of reader) {
    chunks.push(line);
  }
  const secret = chunks.join("\n").trim();
  if (!secret) {
    fail("No API key was received on stdin.");
  }
  if (secret.length > 4_096) {
    fail("The API key is longer than 4096 characters.");
  }
  return secret;
}

function parsePriority(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const priority = Number(value);
  if (!Number.isInteger(priority) || priority < 0) {
    fail("--priority must be a non-negative integer.");
  }
  return priority;
}

function redactError(error: unknown, secret: string | null): string {
  const message = error instanceof Error ? error.message : String(error);
  return (secret ? message.replaceAll(secret, "[redacted]") : message).slice(0, 500);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    allowPositionals: false,
    strict: true,
    options: {
      group: { type: "string" },
      adapter: { type: "string" },
      preset: { type: "string" },
      label: { type: "string" },
      priority: { type: "string" },
      "api-key-stdin": { type: "boolean", default: false },
      "replace-secret": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });

  if (!values["api-key-stdin"]) {
    fail("--api-key-stdin is required. The importer never accepts a key argument.");
  }
  const group = ProviderGroupSchema.safeParse(values.group);
  if (!group.success) {
    fail("--group must be one of ai, places, mail, storage.");
  }
  const adapter = values.adapter?.trim() ?? fail("--adapter is required.");
  const preset = values.preset?.trim() ?? fail("--preset is required.");
  const label = values.label?.trim() ?? fail("--label is required.");
  const priority = parsePriority(values.priority);
  const dryRun = values["dry-run"];
  const replaceSecret = values["replace-secret"];

  loadEnvironmentFiles();
  const environment = validateEnvironment(process.env);
  const secret = await readSecretFromStdin();
  secretForRedaction = secret;
  assertProviderImportKeyring(environment);
  buildProviderImportConfig(adapter, preset);

  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify({
        status: "dry_run",
        providerId: null,
        adapter,
        preset,
        label,
        last4: secret.slice(-4),
        priority: priority ?? null,
      })}\n`,
    );
    return;
  }

  const configView = {
    databaseUrl: environment.DATABASE_URL,
    configEncryptionKey: environment.CONFIG_ENCRYPTION_KEY,
    configEncryptionKeys: environment.CONFIG_ENCRYPTION_KEYS,
  } as AppConfigService;
  const logger = { warn: () => undefined } as unknown as PinoLoggerService;
  const prisma = new PrismaService(configView, logger);

  try {
    const actorRow = await prisma.client.user.findFirst({
      where: {
        platformRole: "super_admin",
        status: "active",
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        name: true,
        image: true,
        platformRole: true,
        status: true,
        locale: true,
        timezone: true,
        lastActiveAt: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });
    if (!actorRow) {
      fail("No active super_admin account is available for import attribution.");
    }
    const actor = {
      user: presentUser(actorRow),
      ip: null,
      userAgent: "provider-import-cli",
    };
    const audit = new AuditService(
      prisma,
      new WorkspaceAccessService(prisma),
      new PermissionService(),
    );
    const secrets = new ProviderSecretService(prisma, audit, configView);
    const providers = new ProviderConfigService(prisma, audit, secrets);
    const importer = new ProviderImportService(providers, secrets, audit);
    const result = await importer.importProvider(actor, {
      group: group.data,
      adapter,
      preset,
      label,
      ...(priority === undefined ? {} : { priority }),
      secret,
      replaceSecret,
      dryRun: false,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await prisma.client.$disconnect().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Provider import failed: ${redactError(error, secretForRedaction)}\n`);
  process.exitCode = 1;
});
