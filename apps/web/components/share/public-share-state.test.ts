import { describe, expect, it } from "vitest";

import {
  SHARE_NETWORK_ERROR,
  shareScreenFromResponse,
} from "./public-share-state";

const VALID_PAYLOAD = {
  trip: {
    id: "019b7b6b-4658-769e-8153-9f88eba061c0",
    title: "京都",
    summary: "",
    status: "active",
    startDate: "2026-11-21",
    endDate: "2026-11-25",
    durationDays: 5,
    coverMediaId: null,
    cover: null,
    origin: "上海",
    originProvider: null,
    destinations: ["京都"],
    countryCodes: ["JP"],
    tags: [],
  },
  stops: [],
  entries: [],
  media: [],
  budget: null,
};

describe("shareScreenFromResponse", () => {
  it("maps a valid public payload to ready", () => {
    const screen = shareScreenFromResponse(200, VALID_PAYLOAD);

    expect(screen.kind).toBe("ready");
    if (screen.kind === "ready") expect(screen.data.trip.title).toBe("京都");
  });

  it("does not trust an invalid 200 payload", () => {
    const screen = shareScreenFromResponse(200, { trip: { title: "missing fields" } });

    expect(screen).toMatchObject({
      kind: "error",
      title: "暂时无法读取分享",
      retryable: true,
    });
  });

  it("distinguishes password required from password invalid", () => {
    expect(shareScreenFromResponse(401, { code: "SHARE_PASSWORD_REQUIRED" })).toEqual({
      kind: "password",
      invalid: false,
    });
    expect(shareScreenFromResponse(401, { code: "SHARE_PASSWORD_INVALID" })).toEqual({
      kind: "password",
      invalid: true,
    });
  });

  it("maps 404 and transient errors to the existing safe copy", () => {
    expect(shareScreenFromResponse(404, null)).toMatchObject({
      kind: "error",
      title: "这个分享链接已失效",
      retryable: undefined,
    });
    expect(shareScreenFromResponse(503, null)).toMatchObject({
      kind: "error",
      title: "暂时无法读取分享",
      retryable: true,
    });
    expect(SHARE_NETWORK_ERROR).toMatchObject({
      kind: "error",
      title: "网络连接中断",
      retryable: true,
    });
  });
});
