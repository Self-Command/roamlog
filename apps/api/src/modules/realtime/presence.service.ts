import { Inject, Injectable, Optional } from "@nestjs/common";
import type { PresenceUser } from "@roamlog/contracts";

import { RedisService } from "../redis/redis.service.js";

interface PresenceEntry extends PresenceUser {
  socketId: string;
}

@Injectable()
export class PresenceService {
  private readonly rooms = new Map<string, Map<string, PresenceEntry>>();

  constructor(
    @Optional()
    @Inject(RedisService)
    private readonly redis?: RedisService,
  ) {}

  join(room: string, user: PresenceUser, socketId: string): PresenceUser[] {
    let entries = this.rooms.get(room);
    if (!entries) {
      entries = new Map();
      this.rooms.set(room, entries);
    }
    entries.set(socketId, { ...user, socketId });
    void this.redis
      ?.set(this.redisKey(room, socketId), JSON.stringify(user), 60)
      .catch(() => undefined);
    return this.list(room);
  }

  leave(room: string, userId: string, socketId: string): PresenceUser[] {
    const entries = this.rooms.get(room);
    const entry = entries?.get(socketId);
    if (entry?.userId === userId) {
      entries?.delete(socketId);
      if (entries?.size === 0) {
        this.rooms.delete(room);
      }
    }
    void this.redis?.delete(this.redisKey(room, socketId)).catch(() => undefined);
    return this.list(room);
  }

  list(room: string): PresenceUser[] {
    const entries = this.rooms.get(room);
    if (!entries) {
      return [];
    }
    const users = new Map<string, PresenceUser>();
    for (const entry of entries.values()) {
      const current = users.get(entry.userId);
      if (!current || current.lastSeen < entry.lastSeen) {
        users.set(entry.userId, {
          userId: entry.userId,
          name: entry.name,
          image: entry.image,
          tripId: entry.tripId,
          lastSeen: entry.lastSeen,
        });
      }
    }
    return [...users.values()];
  }

  clear(): void {
    this.rooms.clear();
  }

  private redisKey(room: string, socketId: string): string {
    return `presence:${room}:${socketId}`;
  }
}
