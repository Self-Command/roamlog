import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";

import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { createHttpLogger } from "../src/modules/observability/http-logger.middleware.js";

describe("HTTP request log token redaction", () => {
  it("never emits auth or invitation tokens in real pino request logs", async () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = pino({ level: "info" }, destination);
    const middleware = createHttpLogger(logger);
    const server = createServer((request, response) => {
      middleware(request as never, response as never, () => {
        response.statusCode = 200;
        response.end("ok");
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const authToken = "AUTH_TOKEN_MUST_NOT_APPEAR";
    const oauthCode = "OAUTH_CODE_MUST_NOT_APPEAR";
    const invitationToken = "INVITATION_TOKEN_MUST_NOT_APPEAR";

    try {
      await fetch(`${baseUrl}/v1/auth/verify-email?token=${authToken}&code=${oauthCode}`);
      await fetch(`${baseUrl}/v1/invitations/${invitationToken}/accept`, {
        method: "POST",
      });
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      logger.flush();
    }

    const emitted = lines.join("");
    expect(emitted).toContain("/v1/auth/verify-email");
    expect(emitted).toContain("/v1/invitations/[redacted]/accept");
    expect(emitted).not.toContain(authToken);
    expect(emitted).not.toContain(oauthCode);
    expect(emitted).not.toContain(invitationToken);
  });
});
