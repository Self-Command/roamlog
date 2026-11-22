import { createServer } from "node:http";
import { once } from "node:events";

export interface ProviderStubRequest {
  method: string;
  path: string;
  authorization: string | null;
}

export interface ProviderStub {
  readonly baseUrl: string;
  readonly requests: ProviderStubRequest[];
  close(): Promise<void>;
}

const MODELS = [
  {
    id: "stub-model-1",
    display_name: "Stub Model 1",
    owned_by: "roamlog-e2e",
  },
  {
    id: "stub-model-2",
    display_name: "Stub Model 2",
    owned_by: "roamlog-e2e",
  },
];

function respondJson(
  response: import("node:http").ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

/**
 * Local OpenAI-compatible stub for the Provider Admin E2E.
 *
 * The API process must run with `PROVIDER_EGRESS_ALLOW_PRIVATE=true` in a
 * non-production/test environment so its SSRF guard permits `127.0.0.1`.
 * This server is started by the test worker, not by the product runtime.
 */
export async function startProviderStub(): Promise<ProviderStub> {
  const requests: ProviderStubRequest[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push({
      method: request.method ?? "GET",
      path: url.pathname,
      authorization: request.headers.authorization ?? null,
    });

    if (request.method === "GET" && url.pathname === "/v1/models") {
      respondJson(response, 200, { data: MODELS });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      respondJson(response, 200, {
        id: "chatcmpl-roamlog-e2e",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
      });
      return;
    }

    respondJson(response, 404, {
      error: { message: "The Provider E2E stub does not implement this route." },
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The Provider E2E stub did not bind a TCP port.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
