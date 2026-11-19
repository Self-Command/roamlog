import { NextResponse, type NextRequest } from "next/server";

const API_ORIGIN = (
  process.env.ROAMLOG_API_ORIGIN ??
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000"
).replace(/\/+$/, "");

const REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "content-type",
  "cookie",
  "origin",
  "referer",
  "user-agent",
  "x-request-id",
]);

const RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-type",
  "location",
  "retry-after",
  "set-cookie",
  "x-request-id",
  "x-roamlog-degraded",
]);

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const target = new URL(`/v1/${path.join("/")}`, API_ORIGIN);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });
  headers.set("x-forwarded-host", request.nextUrl.host);
  headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      {
        type: "https://roamlog.app/errors/api-unavailable",
        title: "后台 API 不可用",
        status: 503,
        detail: "无法连接后台 API，请检查 API 是否正在运行。",
        code: "ADMIN_API_UNAVAILABLE",
      },
      { status: 503 },
    );
  }

  const response = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
  });
  upstream.headers.forEach((value, key) => {
    if (RESPONSE_HEADERS.has(key.toLowerCase()) && key.toLowerCase() !== "set-cookie") {
      response.headers.append(key, value);
    }
  });
  for (const cookie of upstream.headers.getSetCookie()) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
