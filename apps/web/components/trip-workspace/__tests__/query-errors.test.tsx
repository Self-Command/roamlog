import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QueryPanel } from "../panel";
import { failureFrom, toApiError } from "../queries";

const MEDIA_PATH = "/v1/trips/0198f000-0000-7000-8000-0000000000a1/media";

describe("trip workspace query errors", () => {
  it.each([400, 503])(
    "hides the API path and HTTP status when a %i has no problem detail",
    (status) => {
      const error = failureFrom(status, undefined, MEDIA_PATH);

      expect(error.message).toBe("读取失败，请稍后重试。");
      expect(error.message).not.toContain("/v1/");
      expect(error.message).not.toContain("HTTP");
      expect(error.message).not.toContain(MEDIA_PATH);
      expect(error.status).toBe(status);
      expect(error.code).toBe("API_REQUEST_FAILED");
    },
  );

  it("keeps a user-readable problem detail", () => {
    const error = failureFrom(
      503,
      {
        type: "https://roamlog.app/errors/media-unavailable",
        title: "照片暂时不可用",
        status: 503,
        detail: "照片暂时无法读取，请稍后重试。",
        code: "MEDIA_UNAVAILABLE",
      },
      MEDIA_PATH,
    );

    expect(error.message).toBe("照片暂时无法读取，请稍后重试。");
    expect(error.status).toBe(503);
    expect(error.code).toBe("MEDIA_UNAVAILABLE");
  });

  it("uses user language for network failures without exposing the path", () => {
    const error = toApiError(new Error(`Failed to fetch ${MEDIA_PATH}`), MEDIA_PATH);

    expect(error.message).toBe("网络连接失败，请稍后重试。");
    expect(error.message).not.toContain(MEDIA_PATH);
    expect(error.message).not.toContain("/v1/");
    expect(error.status).toBe(0);
    expect(error.code).toBe("NETWORK_ERROR");
  });

  it("renders a query failure without API paths or HTTP status codes", () => {
    const retry = vi.fn();
    const error = failureFrom(503, undefined, MEDIA_PATH);

    render(
      <QueryPanel<string>
        title="照片"
        result={{ state: "error", error, retry }}
        errorTitle="照片读取失败"
      >
        {() => null}
      </QueryPanel>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("照片读取失败");
    expect(alert).toHaveTextContent("读取失败，请稍后重试。");
    expect(alert).not.toHaveTextContent(/\/v1\/|HTTP 503/);
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});
