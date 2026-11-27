import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PublicTripResponseSchema } from "@roamlog/contracts";

import { PublicSharePage } from "./public-share-page";

function publicTrip() {
  return PublicTripResponseSchema.parse({
    trip: {
      id: "019b7b6b-4658-769e-8153-9f88eba061c0",
      title: "SSR 京都之旅",
      summary: "首屏就应可读",
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
    entries: [
      {
        id: "019b7b6b-4658-769e-8153-9f88eba061c1",
        title: "抵达京都",
        date: "2026-11-22",
        location: "京都",
        lat: null,
        lng: null,
        mood: null,
        weather: null,
        contentHtml:
          '<p>SSR 正文就应可读。</p><figure data-type="image"><img src="https://media.example.test/a.jpg" alt="鸭川" data-media-id="019b7b6b-4658-769e-8153-9f88eba061d1"></figure>',
        excerpt: "SSR 摘要",
        tags: [],
        media: [],
      },
    ],
    media: [],
    budget: null,
  });
}

describe("PublicSharePage SSR", () => {
  it("renders a disabled POST password gate before hydration", () => {
    const html = renderToStaticMarkup(
      <PublicSharePage
        token="password-token"
        initialScreen={{ kind: "password", invalid: false }}
      />,
    );
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(document.querySelector("form")?.getAttribute("method")).toBe("post");
    expect(document.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(true);
  });

  it("renders the article in the first server HTML instead of a loading shell", () => {
    const html = renderToStaticMarkup(
      <PublicSharePage
        token="ssr-token"
        initialScreen={{ kind: "ready", data: publicTrip() }}
      />,
    );

    expect(html).toContain("SSR 京都之旅");
    expect(html).toContain("旅行日志");
    expect(html).toContain("SSR 正文就应可读");
    expect(html).toContain('data-type="image"');
    expect(html).toContain('data-media-id="019b7b6b-4658-769e-8153-9f88eba061d1"');
    expect(html).not.toContain("正在读取分享");
  });
});
