import { cookies } from "next/headers";

import {
  SHARE_NETWORK_ERROR,
  shareScreenFromResponse,
  type ShareScreen,
} from "./public-share-state";

const DEFAULT_API_ORIGIN = "http://localhost:4000";

function apiOrigin(): string {
  return (
    process.env.API_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    DEFAULT_API_ORIGIN
  ).replace(/\/+$/, "");
}

/**
 * Loads the public share projection on the server so the first HTML response
 * already contains the article. The bearer of a password-protected share is
 * forwarded through the request cookie if one exists.
 *
 * The public endpoint returns schema-validated, server-sanitized HTML. The
 * server never renders private database rows directly.
 */
export async function loadPublicShareScreen(token: string): Promise<ShareScreen> {
  const cookieHeader = (await cookies()).toString();
  const url = new URL(`/v1/public/trips/${encodeURIComponent(token)}`, apiOrigin());

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
    });
    const data = await response.json().catch(() => null);
    return shareScreenFromResponse(response.status, data);
  } catch {
    return SHARE_NETWORK_ERROR;
  }
}
