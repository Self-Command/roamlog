import type { Job } from "bullmq";
import { defineProcessor, type JobProcessor, type ProcessorContext } from "../processor.js";
import type { WorkerDependencies } from "./types.js";
import { createZip, type ZipFile } from "./zip.js";

export interface ExportJobData {
  exportId: string;
  workspaceId: string;
}

const EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function exportObjectKey(workspaceId: string, exportId: string, format: string): string {
  return `exports/${workspaceId}/${exportId}/export.${format}`;
}

export async function handleExportJob(
  data: ExportJobData,
  context: ProcessorContext,
  deps: WorkerDependencies,
): Promise<{ status: string; exportId: string }> {
  const record = await deps.db.export.findFirst({
    where: { id: data.exportId, workspaceId: data.workspaceId },
  });
  if (!record) {
    context.logger.warn({ jobId: context.jobId, exportId: data.exportId }, "export missing");
    return { status: "missing", exportId: data.exportId };
  }
  if (record.expiresAt && record.expiresAt.getTime() <= deps.now().getTime()) {
    await deps.db.export.updateMany({
      where: { id: record.id },
      data: { status: "expired", error: "Export expired." },
    });
    return { status: "expired", exportId: data.exportId };
  }
  if (record.status === "ready" || record.status === "expired") {
    return { status: record.status, exportId: data.exportId };
  }

  await deps.db.export.updateMany({
    where: { id: record.id },
    data: { status: "processing", error: null },
  });

  try {
    const bundle = await buildExportBundle(record, deps);
    const files: ZipFile[] =
      record.format === "json"
        ? [{ path: "export.json", data: JSON.stringify(bundle.data, null, 2) }]
        : bundle.files;
    if (record.format === "zip") {
      files.push({
        path: "README.txt",
        data:
          "Roamlog export\n\nGenerated from the Workspace at the request of its owner.\n" +
          "Comments are included only when requested; private member emails are never exported.\n",
      });
    }
    const bytes =
      record.format === "json"
        ? new Uint8Array(Buffer.from(JSON.stringify(bundle.data, null, 2), "utf8"))
        : createZip(files, deps.now());
    const storageKey = exportObjectKey(
      record.workspaceId,
      record.id,
      record.format === "json" ? "json" : "zip",
    );
    await deps.storage.putObject(
      storageKey,
      bytes,
      record.format === "json" ? "application/json" : "application/zip",
    );

    const completedAt = deps.now();
    await deps.db.export.updateMany({
      where: { id: record.id },
      data: {
        status: "ready",
        storageKey,
        completedAt,
        expiresAt: new Date(completedAt.getTime() + EXPORT_TTL_MS),
        error: null,
      },
    });
    await notifyExportReady(record, deps, context, storageKey);
    context.logger.info(
      { jobId: context.jobId, exportId: record.id, bytes: bytes.byteLength },
      "export ready",
    );
    return { status: "ready", exportId: record.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    await deps.db.export.updateMany({
      where: { id: record.id },
      data: { status: "failed", error: message.slice(0, 1000) },
    });
    context.logger.error(
      { jobId: context.jobId, exportId: record.id, error: message },
      "export failed",
    );
    throw error;
  }
}

async function buildExportBundle(
  record: any,
  deps: WorkerDependencies,
): Promise<{ data: Record<string, unknown>; files: ZipFile[] }> {
  const files: ZipFile[] = [];
  const includeComments = Boolean(record.includeComments);
  const includeExpenses = Boolean(record.includeExpenses);
  const includeMedia = Boolean(record.includeMedia);

  if (record.scope === "trip") {
    const trip = await deps.db.trip.findFirst({
      where: { id: record.tripId, workspaceId: record.workspaceId, deletedAt: null },
    });
    if (!trip) {
      throw new Error("Trip no longer exists");
    }
    const bundle = await tripBundle(trip, deps, {
      includeComments,
      includeExpenses,
      includeMedia,
    });
    files.push(
      { path: "trip.json", data: JSON.stringify(bundle.trip, null, 2) },
      { path: "journal.md", data: journalMarkdown(bundle.trip.title, bundle.entries) },
      { path: "itinerary.csv", data: toCsv(bundle.itinerary) },
      { path: "expenses.csv", data: toCsv(bundle.expenses) },
      { path: "packing.csv", data: toCsv(bundle.packing) },
      ...bundle.mediaFiles,
    );
    if (includeComments) {
      files.push({ path: "comments.json", data: JSON.stringify(bundle.comments, null, 2) });
    }
    return {
      data: {
        scope: "trip",
        generatedAt: deps.now().toISOString(),
        ...bundle,
        mediaFiles: undefined,
      },
      files,
    };
  }

  if (record.scope === "workspace") {
    const workspace = await deps.db.workspace.findFirst({
      where: { id: record.workspaceId, deletedAt: null },
    });
    if (!workspace) {
      throw new Error("Workspace no longer exists");
    }
    const members = await deps.db.workspaceMember.findMany({
      where: { workspaceId: workspace.id, status: "active" },
      select: { userId: true, role: true, joinedAt: true },
    });
    const trips = await deps.db.trip.findMany({
      where: { workspaceId: workspace.id, deletedAt: null },
      orderBy: { startDate: "asc" },
    });
    const workspaceBundle = {
      workspace,
      members,
      trips: [] as unknown[],
    };
    files.push(
      {
        path: "workspace.json",
        data: JSON.stringify({ workspace, members }, null, 2),
      },
      { path: "members.csv", data: toCsv(members) },
    );
    for (const trip of trips) {
      const bundle = await tripBundle(trip, deps, {
        includeComments,
        includeExpenses,
        includeMedia,
      });
      const prefix = `trips/${sanitizeSegment(trip.title)}-${trip.id}`;
      files.push(
        { path: `${prefix}/trip.json`, data: JSON.stringify(bundle.trip, null, 2) },
        { path: `${prefix}/journal.md`, data: journalMarkdown(trip.title, bundle.entries) },
        { path: `${prefix}/itinerary.csv`, data: toCsv(bundle.itinerary) },
        { path: `${prefix}/expenses.csv`, data: toCsv(bundle.expenses) },
        { path: `${prefix}/packing.csv`, data: toCsv(bundle.packing) },
        ...bundle.mediaFiles.map((file) => ({ ...file, path: `${prefix}/${file.path}` })),
      );
      workspaceBundle.trips.push({ ...bundle.trip, media: bundle.media });
    }
    return { data: workspaceBundle, files };
  }

  const user = await deps.db.user.findUnique({
    where: { id: record.requestedById },
    select: {
      id: true,
      email: true,
      name: true,
      locale: true,
      timezone: true,
      createdAt: true,
    },
  });
  const memberships = await deps.db.workspaceMember.findMany({
    where: { userId: record.requestedById, status: "active" },
    include: { workspace: true },
  });
  const workspaceIds = memberships.map((membership: any) => membership.workspaceId);
  const trips = await deps.db.trip.findMany({
    where: { workspaceId: { in: workspaceIds }, deletedAt: null },
  });
  const tripIds = trips.map((trip: any) => trip.id);
  const entries = await deps.db.journalEntry.findMany({
    where: { tripId: { in: tripIds }, deletedAt: null },
  });
  const comments = includeComments
    ? await deps.db.comment.findMany({
        where: { authorId: record.requestedById, deletedAt: null },
      })
    : [];
  const data = {
    profile: user,
    workspaces: memberships.map((membership: any) => membership.workspace),
    trips,
    entries,
    ...(includeMedia
      ? {
          media: await deps.db.media.findMany({
            where: { tripId: { in: tripIds }, status: "ready", deletedAt: null },
          }),
        }
      : {}),
    ...(includeComments ? { comments } : {}),
    generatedAt: deps.now().toISOString(),
  };
  files.push(
    { path: "profile.json", data: JSON.stringify(user, null, 2) },
    { path: "workspaces.json", data: JSON.stringify(data.workspaces, null, 2) },
    { path: "trips.json", data: JSON.stringify(trips, null, 2) },
    { path: "entries.json", data: JSON.stringify(entries, null, 2) },
  );
  if (includeComments) {
    files.push({ path: "comments.json", data: JSON.stringify(comments, null, 2) });
  }
  return { data, files };
}

async function tripBundle(
  trip: any,
  deps: WorkerDependencies,
  flags: { includeComments: boolean; includeExpenses: boolean; includeMedia: boolean },
): Promise<{
  trip: any;
  entries: any[];
  comments: unknown[];
  itinerary: any[];
  expenses: any[];
  packing: any[];
  media: any[];
  mediaFiles: ZipFile[];
}> {
  const entries = await deps.db.journalEntry.findMany({
    where: { tripId: trip.id, deletedAt: null },
    orderBy: { date: "asc" },
  });
  const comments = flags.includeComments
    ? await deps.db.comment.findMany({
        where: { tripId: trip.id, deletedAt: null },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const itinerary = await deps.db.itineraryItem.findMany({
    where: { tripId: trip.id, deletedAt: null },
    orderBy: [{ date: "asc" }, { order: "asc" }],
  });
  const expenses = flags.includeExpenses
    ? await deps.db.expense.findMany({
        where: { tripId: trip.id, deletedAt: null },
        include: { participants: true },
        orderBy: { date: "asc" },
      })
    : [];
  const packing = await deps.db.packingItem.findMany({
    where: { tripId: trip.id, deletedAt: null },
    orderBy: { order: "asc" },
  });
  const mediaFiles: ZipFile[] = [];
  const mediaRecords: any[] = [];
  if (flags.includeMedia) {
    const media = await deps.db.media.findMany({
      where: { tripId: trip.id, status: "ready", deletedAt: null },
    });
    mediaRecords.push(...media);
    for (const item of media) {
      try {
        const object = await deps.storage.getObject(item.key);
        mediaFiles.push({ path: `photos/${item.id}-${basename(item.key)}`, data: object.bytes });
      } catch {
        // One missing object must not fail the whole export.
      }
    }
  }
  return { trip, entries, comments, itinerary, expenses, packing, media: mediaRecords, mediaFiles };
}

const EMAIL_ERROR_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,47}$/u;

/**
 * Short, address-free code for the notification warn log. Provider messages are
 * never used: they can echo the recipient address into the log sink.
 */
function emailFailureCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const { code, name } = error as { code?: unknown; name?: unknown };
    if (typeof code === "string" && EMAIL_ERROR_CODE_PATTERN.test(code)) {
      return code;
    }
    if (typeof name === "string" && EMAIL_ERROR_CODE_PATTERN.test(name)) {
      return name;
    }
  }
  return "EMAIL_NOTIFICATION_FAILED";
}

async function notifyExportReady(
  record: any,
  deps: WorkerDependencies,
  context: ProcessorContext,
  storageKey: string,
): Promise<void> {
  const user = await deps.db.user.findUnique({
    where: { id: record.requestedById },
    select: { email: true, name: true },
  });

  // The archive is already stored and marked ready, so the notification email
  // is best effort: a mail failure is a warning and must never roll the export
  // job back to `failed`. Only this block is swallowed.
  if (user?.email) {
    try {
      await deps.email.send({
        to: user.email,
        subject: "你的 Roamlog 导出已准备好",
        text: `导出已准备好：${storageKey}。下载链接将在 7 天后过期。`,
        html: `<p>你的 Roamlog 导出已准备好。</p><p>下载链接将在 7 天后过期。</p>`,
        idempotencyKey: `export-ready-${record.id}`,
      });
    } catch (error) {
      context.logger.warn(
        {
          jobId: context.jobId,
          exportId: record.id,
          errorCode: emailFailureCode(error),
        },
        "export ready email failed",
      );
    }
  }

  // Database writes stay outside the email guard: a failed audit insert is a
  // real failure and must keep propagating to the job.
  await deps.db.auditLog.create({
    data: {
      actorId: record.requestedById,
      actorType: "user",
      action: "export.completed",
      targetType: "export",
      targetId: record.id,
      workspaceId: record.workspaceId,
      metadata: { format: record.format, scope: record.scope },
    },
  });
}

function journalMarkdown(title: string, entries: readonly any[]): string {
  const parts = [`# ${title}`, ""];
  for (const entry of entries) {
    parts.push(`## ${entry.date?.toISOString?.().slice(0, 10) ?? ""} · ${entry.title}`, "");
    if (entry.location) {
      parts.push(`_${entry.location}_`, "");
    }
    parts.push(stripHtml(entry.contentHtml ?? ""), "");
  }
  return parts.join("\n");
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toCsv(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return "";
  }
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) {
      return "";
    }
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(",")),
  ].join("\n");
}

function sanitizeSegment(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9\u4e00-\u9fa5_-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60) || "trip";
}

function basename(key: string): string {
  return key.split("/").pop() || "photo";
}

export function createExportProcessor(deps: WorkerDependencies): JobProcessor<ExportJobData> {
  return defineProcessor<ExportJobData>({
    name: "export",
    handle(job: Job<ExportJobData>, context: ProcessorContext) {
      return handleExportJob(job.data, context, deps);
    },
  });
}
