import { createServer, type Socket } from "node:net";

type RespValue = string | null;
type RedisStore = Map<string, { value: string; expiresAt: number | null }>;

function parseRespArray(
  buffer: Buffer,
  offset: number,
): { values: RespValue[]; next: number } | null {
  if (buffer[offset] !== 0x2a) {
    const inlineEnd = buffer.indexOf("\r\n", offset);
    if (inlineEnd < 0) return null;
    const line = buffer.subarray(offset, inlineEnd).toString("utf8").trim();
    if (!line) return { values: [], next: inlineEnd + 2 };
    return { values: line.split(/\s+/), next: inlineEnd + 2 };
  }
  const headerEnd = buffer.indexOf("\r\n", offset);
  if (headerEnd < 0) return null;
  const count = Number(buffer.subarray(offset + 1, headerEnd).toString("utf8"));
  let cursor = headerEnd + 2;
  const values: RespValue[] = [];

  for (let index = 0; index < count; index += 1) {
    if (cursor >= buffer.length) return null;
    if (buffer[cursor] === 0x24) {
      const lengthEnd = buffer.indexOf("\r\n", cursor);
      if (lengthEnd < 0) return null;
      const length = Number(buffer.subarray(cursor + 1, lengthEnd).toString("utf8"));
      cursor = lengthEnd + 2;
      if (length < 0) {
        values.push(null);
        continue;
      }
      const valueEnd = cursor + length;
      if (buffer.length < valueEnd + 2) return null;
      values.push(buffer.subarray(cursor, valueEnd).toString("utf8"));
      cursor = valueEnd + 2;
      continue;
    }

    const inlineEnd = buffer.indexOf("\r\n", cursor);
    if (inlineEnd < 0) return null;
    values.push(buffer.subarray(cursor, inlineEnd).toString("utf8"));
    cursor = inlineEnd + 2;
  }

  return { values, next: cursor };
}

function simple(value: string): string {
  return `+${value}\r\n`;
}

function integer(value: number): string {
  return `:${Math.trunc(value)}\r\n`;
}

function bulk(value: string): string {
  return `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
}

function nil(): string {
  return "$-1\r\n";
}

function array(values: readonly string[]): string {
  return `*${values.length}\r\n${values.map((value) => bulk(value)).join("")}`;
}

function activeValue(
  store: RedisStore,
  key: string,
): { value: string; expiresAt: number | null } | undefined {
  const stored = store.get(key);
  if (
    stored?.expiresAt !== null &&
    stored?.expiresAt !== undefined &&
    stored.expiresAt <= Date.now()
  ) {
    store.delete(key);
    return undefined;
  }
  return stored;
}

function commandResponse(command: string, args: readonly RespValue[], store: RedisStore): string {
  switch (command) {
    case "PING":
      return simple("PONG");
    case "CLIENT":
      return args[0]?.toUpperCase() === "LIST" ? bulk("") : simple("OK");
    case "INFO":
      return bulk(
        [
          "redis_version:7.2.0",
          "redis_mode:standalone",
          "connected_clients:1",
          "role:master",
          "",
        ].join("\r\n"),
      );
    case "SELECT":
    case "SETNAME":
    case "READONLY":
    case "RENAME":
      return simple("OK");
    case "SET": {
      const key = args[0];
      const value = args[1];
      if (typeof key !== "string" || typeof value !== "string") {
        return simple("ERR invalid SET arguments");
      }
      const options = args.slice(2).map((option) => option?.toUpperCase());
      const existing = activeValue(store, key);
      if (options.includes("NX") && existing) {
        return nil();
      }
      const exIndex = options.indexOf("EX");
      const ttlSeconds = exIndex >= 0 ? Number(args[2 + exIndex + 1] ?? NaN) : null;
      store.set(key, {
        value,
        expiresAt:
          ttlSeconds !== null && Number.isFinite(ttlSeconds) && ttlSeconds > 0
            ? Date.now() + ttlSeconds * 1_000
            : null,
      });
      return simple("OK");
    }
    case "GET": {
      const key = args[0];
      const value = typeof key === "string" ? activeValue(store, key)?.value : undefined;
      return value === undefined ? nil() : bulk(value);
    }
    case "HGET":
      return nil();
    case "INCR": {
      const key = args[0];
      if (typeof key !== "string") {
        return simple("ERR invalid INCR arguments");
      }
      const current = activeValue(store, key);
      const parsed = Number(current?.value ?? "0");
      if (!Number.isInteger(parsed)) {
        return simple("ERR value is not an integer or out of range");
      }
      const next = parsed + 1;
      store.set(key, {
        value: String(next),
        expiresAt: current?.expiresAt ?? null,
      });
      return integer(next);
    }
    case "TTL": {
      const key = args[0];
      const stored = typeof key === "string" ? activeValue(store, key) : undefined;
      if (!stored) {
        return integer(-2);
      }
      if (stored.expiresAt === null) {
        return integer(-1);
      }
      return integer(Math.max(1, Math.ceil((stored.expiresAt - Date.now()) / 1_000)));
    }
    case "EXPIRE": {
      const key = args[0];
      const seconds = Number(args[1] ?? NaN);
      const stored = typeof key === "string" ? activeValue(store, key) : undefined;
      if (!stored) {
        return integer(0);
      }
      if (!Number.isFinite(seconds) || seconds <= 0) {
        return simple("ERR invalid expire time in 'expire' command");
      }
      stored.expiresAt = Date.now() + seconds * 1_000;
      return integer(1);
    }
    case "DEL": {
      let deleted = 0;
      for (const key of args) {
        if (typeof key === "string" && activeValue(store, key)) {
          store.delete(key);
          deleted += 1;
        }
      }
      return integer(deleted);
    }
    case "EXISTS": {
      let existing = 0;
      for (const key of args) {
        if (typeof key === "string" && activeValue(store, key)) {
          existing += 1;
        }
      }
      return integer(existing);
    }
    case "LLEN":
    case "ZCARD":
    case "SCARD":
    case "HLEN":
    case "HDEL":
    case "ZREM":
    case "LPUSH":
    case "RPUSH":
    case "HSET":
    case "SADD":
    case "ZADD":
    case "EVAL":
    case "EVALSHA":
    case "PUBLISH":
      return integer(0);
    case "LRANGE":
    case "ZRANGE":
    case "HGETALL":
    case "SMEMBERS":
    case "KEYS":
    case "CONFIG":
      return "*0\r\n";
    case "SUBSCRIBE":
    case "PSUBSCRIBE":
      return args
        .map(
          (channel, index) =>
            `*3\r\n${bulk(command.toLowerCase())}${bulk(channel ?? "")}${integer(index + 1)}`,
        )
        .join("");
    case "UNSUBSCRIBE":
    case "PUNSUBSCRIBE":
      return `*3\r\n${bulk(command.toLowerCase())}${bulk("")}${integer(0)}`;
    case "ROLE":
      return `*3\r\n${bulk("master")}${integer(0)}${array([])}`;
    case "QUIT":
      return simple("OK");
    default:
      return simple("OK");
  }
}

export function startRedisStub(
  input: {
    port?: number;
    host?: string;
  } = {},
): Promise<{ port: number; close: () => Promise<void> }> {
  const port = input.port ?? Number(process.env.ROAMLOG_LIVE_REDIS_PORT ?? "46379");
  const host = input.host ?? "127.0.0.1";
  const store: RedisStore = new Map();

  return new Promise((resolve, reject) => {
    const server = createServer((socket: Socket) => {
      let pending = Buffer.alloc(0);

      socket.on("data", (chunk) => {
        pending = Buffer.concat([pending, chunk]);

        for (;;) {
          let parsed: ReturnType<typeof parseRespArray>;
          try {
            parsed = parseRespArray(pending, 0);
          } catch {
            socket.destroy();
            return;
          }
          if (!parsed) return;
          pending = pending.subarray(parsed.next);
          const [rawCommand, ...args] = parsed.values;
          if (typeof rawCommand !== "string") continue;
          const command = rawCommand.toUpperCase();
          socket.write(commandResponse(command, args, store));
          if (command === "QUIT") {
            socket.end();
            return;
          }
        }
      });

      socket.on("error", () => undefined);
    });

    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const listeningPort = typeof address === "object" && address !== null ? address.port : port;
      console.log(`Live E2E Redis stub listening on redis://${host}:${listeningPort}`);
      resolve({
        port: listeningPort,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          }),
      });
    });
  });
}
