import { createServer, type Socket } from "node:net";

type RespValue = string | null;

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

function commandResponse(command: string, args: readonly RespValue[]): string {
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
    case "GET":
    case "HGET":
      return nil();
    case "LLEN":
    case "ZCARD":
    case "SCARD":
    case "HLEN":
    case "EXISTS":
    case "DEL":
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
): Promise<void> {
  const port = input.port ?? Number(process.env.ROAMLOG_LIVE_REDIS_PORT ?? "46379");
  const host = input.host ?? "127.0.0.1";

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
          socket.write(commandResponse(command, args));
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
      console.log(`Live E2E Redis stub listening on redis://${host}:${port}`);
      resolve();
    });
  });
}
