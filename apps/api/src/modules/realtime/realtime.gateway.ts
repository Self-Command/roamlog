import { Inject, Injectable } from "@nestjs/common";
import type { OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import {
  RealtimeConnectionQuerySchema,
  UuidV7Schema,
  type PresenceUser,
} from "@roamlog/contracts";
import type { IncomingHttpHeaders } from "node:http";
import type { Server as HttpServer } from "node:http";

import { AppConfigService } from "../../config/app-config.service.js";
import { AuthService } from "../auth/auth.service.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { WorkspaceAccessService } from "../../common/services/workspace-access.service.js";
import { assertTripVisible } from "../trips/content-values.js";
import Redis from "ioredis";
import { PresenceService } from "./presence.service.js";
import { RealtimePublisher, type RealtimeTransport } from "./realtime.publisher.js";

interface SocketData {
  user?: {
    id: string;
    name: string;
    image: string | null;
  };
  tripId?: string;
  presenceRooms?: Set<string>;
}

interface RealtimeSocket {
  id: string;
  data: SocketData;
  handshake: {
    headers: Record<string, string | string[] | undefined>;
    query: Record<string, string | string[] | undefined>;
    auth?: Record<string, unknown>;
  };
  join(room: string): void | Promise<void>;
  leave(room: string): void | Promise<void>;
  on(event: string, handler: (...args: never[]) => void): void;
  disconnect(close?: boolean): void;
}

type SocketMiddleware = (
  socket: RealtimeSocket,
  next: (error?: Error) => void,
) => void | Promise<void>;

interface RealtimeNamespace extends RealtimeTransport {
  use(middleware: SocketMiddleware): void;
  on(event: "connection", handler: (socket: RealtimeSocket) => void): void;
}

interface SocketServer extends RealtimeTransport {
  of(namespace: string): RealtimeNamespace;
  adapter(adapter: unknown): void;
  close(callback?: () => void): void;
}

interface SocketIoModule {
  Server: new (
    httpServer: HttpServer,
    options: Record<string, unknown>,
  ) => SocketServer;
}

@Injectable()
export class RealtimeGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private server: SocketServer | undefined;
  private readonly tripWorkspaces = new Map<string, string>();
  private adapterClients: Redis[] = [];

  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Inject(PresenceService) private readonly presence: PresenceService,
    @Inject(RealtimePublisher) private readonly publisher: RealtimePublisher,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const packageName = "socket.io";
    let socketIo: SocketIoModule;
    try {
      socketIo = (await import(packageName)) as SocketIoModule;
    } catch {
      this.logger.warn(
        { packageName },
        "realtime.socket_io_unavailable",
      );
      return;
    }

    try {
      const httpServer = this.adapterHost.httpAdapter?.getHttpServer() as
        | HttpServer
        | undefined;
      if (!httpServer) {
        this.logger.warn("realtime.http_server_unavailable");
        return;
      }
      this.server = new socketIo.Server(httpServer, {
        cors: {
          credentials: true,
          origin: [...this.config.corsOrigins],
        },
        pingInterval: 25_000,
        pingTimeout: 20_000,
      });
      await this.attachRedisAdapter(this.server);
      const namespace = this.server.of("/v1/ws");
      namespace.use((socket, next) => {
        void this.authenticate(socket)
          .then(() => next())
          .catch((error: unknown) =>
            next(error instanceof Error ? error : new Error("Authentication failed")),
          );
      });
      namespace.on("connection", (socket) => {
        void this.onConnection(socket);
      });
      this.publisher.attach(this.server);
      this.logger.log({ namespace: "/v1/ws" }, "realtime.namespace_ready");
    } catch (error) {
      this.logger.warn({ err: error }, "realtime.bootstrap_failed");
    }
  }

  onModuleDestroy(): void {
    this.server?.close();
    this.server = undefined;
    for (const client of this.adapterClients) {
      client.disconnect();
    }
    this.adapterClients = [];
    this.tripWorkspaces.clear();
  }

  private async authenticate(socket: RealtimeSocket): Promise<void> {
    const session = await this.auth.resolveSession(
      socket.handshake.headers as unknown as IncomingHttpHeaders,
    );
    if (!session) {
      throw new Error("UNAUTHENTICATED");
    }
    const user = await this.prisma.client.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        name: true,
        image: true,
        status: true,
        deletedAt: true,
      },
    });
    if (!user || user.deletedAt !== null || user.status !== "active") {
      throw new Error("UNAUTHENTICATED");
    }
    socket.data.user = {
      id: user.id,
      name: user.name,
      image: user.image,
    };
    socket.data.presenceRooms = new Set();
  }

  private async onConnection(socket: RealtimeSocket): Promise<void> {
    const user = socket.data.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    await socket.join(`user:${user.id}`);
    const memberships = await this.prisma.client.workspaceMember.findMany({
      where: {
        userId: user.id,
        status: "active",
        workspace: { status: "active", deletedAt: null },
      },
      select: { workspaceId: true },
    });
    for (const membership of memberships) {
      await socket.join(`workspace:${membership.workspaceId}`);
    }

    socket.on("workspace.join", (payload: never) => {
      void this.joinWorkspace(socket, payload);
    });
    socket.on("workspace.leave", (payload: never) => {
      void this.leaveWorkspace(socket, payload);
    });
    socket.on("trip.join", (payload: never) => {
      void this.joinTrip(socket, payload);
    });
    socket.on("trip.leave", (payload: never) => {
      void this.leaveTrip(socket, payload);
    });
    socket.on("disconnect", () => {
      void this.cleanupPresence(socket);
    });

    const query = RealtimeConnectionQuerySchema.safeParse({
      tripId: firstString(socket.handshake.query.tripId),
    });
    const authTripId = firstString(socket.handshake.auth?.tripId);
    const tripId = authTripId ?? query.data?.tripId;
    if (tripId && UuidV7Schema.safeParse(tripId).success) {
      await this.joinTrip(socket, { tripId });
    }
  }

  private async joinWorkspace(socket: RealtimeSocket, payload: unknown): Promise<void> {
    const workspaceId = payloadValue(payload, "workspaceId");
    if (!workspaceId || !this.user(socket)) {
      return;
    }
    try {
      const membership = await this.access.requireMembership(this.user(socket).id, workspaceId);
      await socket.join(`workspace:${workspaceId}`);
      this.joinPresenceRoom(
        socket,
        `workspace:${workspaceId}`,
        workspaceId,
        null,
      );
      this.emitPresence("presence.joined", membership.workspaceId, null, this.user(socket));
    } catch {
      this.emitError(socket, "WORKSPACE_NOT_FOUND");
    }
  }

  private async leaveWorkspace(socket: RealtimeSocket, payload: unknown): Promise<void> {
    const workspaceId = payloadValue(payload, "workspaceId");
    const user = this.user(socket);
    if (!workspaceId || !user) {
      return;
    }
    await socket.leave(`workspace:${workspaceId}`);
    const departure = this.leavePresenceRoom(socket, `workspace:${workspaceId}`, user.id);
    if (departure) {
      this.publisher.publish({
        type: "presence.updated",
        workspaceId: departure.workspaceId,
        payload: { users: this.presence.list(`workspace:${workspaceId}`) },
      });
    }
    this.emitPresence("presence.left", workspaceId, null, user);
  }

  private async joinTrip(socket: RealtimeSocket, payload: unknown): Promise<void> {
    const tripId = payloadValue(payload, "tripId");
    const user = this.user(socket);
    if (!tripId || !user) {
      return;
    }
    try {
      const trip = await this.prisma.client.trip.findFirst({
        where: { id: tripId, deletedAt: null, workspace: { deletedAt: null } },
        select: {
          id: true,
          workspaceId: true,
          visibility: true,
          createdById: true,
          participants: { select: { userId: true, status: true } },
          accessGrants: { select: { workspaceId: true, userId: true } },
        },
      });
      if (!trip) {
        throw new Error("TRIP_NOT_FOUND");
      }
      const membership = await this.access.requireMembership(user.id, trip.workspaceId);
      assertTripVisible(membership, trip);
      await socket.join(`workspace:${trip.workspaceId}`);
      await socket.join(`trip:${trip.id}`);
      socket.data.tripId = trip.id;
      this.tripWorkspaces.set(trip.id, trip.workspaceId);
      this.joinPresenceRoom(socket, `trip:${trip.id}`, trip.workspaceId, trip.id);
      this.emitPresence("presence.joined", trip.workspaceId, trip.id, user);
    } catch {
      this.emitError(socket, "TRIP_NOT_FOUND");
    }
  }

  private async leaveTrip(socket: RealtimeSocket, payload: unknown): Promise<void> {
    const tripId = payloadValue(payload, "tripId");
    const user = this.user(socket);
    if (!tripId || !user) {
      return;
    }
    await socket.leave(`trip:${tripId}`);
    const departure = this.leavePresenceRoom(socket, `trip:${tripId}`, user.id);
    if (socket.data.tripId === tripId) {
      socket.data.tripId = undefined;
    }
    if (departure) {
      this.publisher.publish({
        type: "presence.left",
        workspaceId: departure.workspaceId,
        tripId: tripId,
        payload: { user: this.presenceUser(user, tripId) },
      });
      this.publisher.publish({
        type: "presence.updated",
        workspaceId: departure.workspaceId,
        tripId: tripId,
        payload: { users: this.presence.list(`trip:${tripId}`) },
      });
    }
  }

  private joinPresenceRoom(
    socket: RealtimeSocket,
    room: string,
    workspaceId: string,
    tripId: string | null,
  ): void {
    const user = this.user(socket);
    if (!user) {
      return;
    }
    socket.data.presenceRooms?.add(room);
    this.presence.join(room, this.presenceUser(user, tripId), socket.id);
    const users = this.presence.list(room);
    this.publisher.publish({
      type: "presence.updated",
      workspaceId,
      ...(tripId ? { tripId } : {}),
      payload: { users },
    });
  }

  private leavePresenceRoom(
    socket: RealtimeSocket,
    room: string,
    userId: string,
  ): { workspaceId: string; tripId: string | null } | null {
    const [kind, roomId] = room.split(":", 2);
    this.presence.leave(room, userId, socket.id);
    socket.data.presenceRooms?.delete(room);
    if (!roomId) {
      return null;
    }
    if (kind === "trip") {
      const workspaceId = this.tripWorkspaces.get(roomId);
      return workspaceId ? { workspaceId, tripId: roomId } : null;
    }
    return { workspaceId: roomId, tripId: null };
  }

  private async cleanupPresence(socket: RealtimeSocket): Promise<void> {
    const user = this.user(socket);
    if (!user) {
      return;
    }
    for (const room of [...(socket.data.presenceRooms ?? [])]) {
      const departure = this.leavePresenceRoom(socket, room, user.id);
      if (!departure) {
        continue;
      }
      this.publisher.publish({
        type: "presence.left",
        workspaceId: departure.workspaceId,
        ...(departure.tripId ? { tripId: departure.tripId } : {}),
        payload: { user: this.presenceUser(user, departure.tripId) },
      });
      this.publisher.publish({
        type: "presence.updated",
        workspaceId: departure.workspaceId,
        ...(departure.tripId ? { tripId: departure.tripId } : {}),
        payload: { users: this.presence.list(room) },
      });
    }
  }

  private emitPresence(
    type: "presence.joined" | "presence.left",
    workspaceId: string,
    tripId: string | null,
    user: SocketData["user"],
  ): void {
    if (!user) {
      return;
    }
    this.publisher.publish({
      type,
      workspaceId,
      ...(tripId ? { tripId } : {}),
      payload: { user: this.presenceUser(user, tripId) },
    });
  }

  private emitError(socket: RealtimeSocket, code: string): void {
    const target = socket as unknown as {
      emit?: (event: string, payload: unknown) => void;
    };
    target.emit?.("realtime.error", { code });
  }

  private presenceUser(
    user: NonNullable<SocketData["user"]>,
    tripId: string | null,
  ): PresenceUser {
    return {
      userId: user.id,
      name: user.name,
      image: user.image,
      tripId,
      lastSeen: new Date().toISOString(),
    };
  }

  private user(socket: RealtimeSocket): NonNullable<SocketData["user"]> {
    if (!socket.data.user) {
      throw new Error("Socket is not authenticated.");
    }
    return socket.data.user;
  }

  private async attachRedisAdapter(server: SocketServer): Promise<void> {
    const packageName = "@socket.io/redis-adapter";
    try {
      const module = (await import(packageName)) as {
        createAdapter: (publisher: Redis, subscriber: Redis) => unknown;
      };
      const publisher = new Redis(this.config.redisUrl, {
        connectionName: "roamlog-realtime-pub",
      });
      const subscriber = publisher.duplicate({
        connectionName: "roamlog-realtime-sub",
      });
      this.adapterClients = [publisher, subscriber];
      server.adapter(module.createAdapter(publisher, subscriber));
      this.logger.log("realtime.redis_adapter_ready");
    } catch {
      this.logger.warn(
        { packageName },
        "realtime.redis_adapter_unavailable",
      );
    }
  }
}

function firstString(value: unknown): string | undefined {
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
}

function payloadValue(payload: unknown, key: string): string | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && UuidV7Schema.safeParse(value).success
    ? value
    : undefined;
}
