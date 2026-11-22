import { describe, expect, it } from "vitest";

import { SanitizeService } from "../../common/services/sanitize.service.js";

function sanitize(html: string): string {
  return new SanitizeService().sanitizeHtml(html);
}

function sanitizeWithMediaUrls(html: string, mediaUrlById: ReadonlyMap<string, string>): string {
  return new SanitizeService().sanitizeHtmlWithSignedMediaUrls(html, mediaUrlById);
}

describe("SanitizeService — rich journal media", () => {
  it("keeps a legitimate image and its presentation attributes", () => {
    const output = sanitize(
      '<p>清晨</p><img src="https://media.example.test/tenant/photo.jpg?X-Amz-Signature=sig" alt="山" title="清晨" width="800" height="600">',
    );

    expect(output).toContain("<img");
    expect(output).toContain(
      'src="https://media.example.test/tenant/photo.jpg?X-Amz-Signature=sig"',
    );
    expect(output).toContain('alt="山"');
    expect(output).toContain('title="清晨"');
    expect(output).toContain('width="800"');
    expect(output).toContain('height="600"');
    expect(output).toContain('loading="lazy"');
    expect(output).toContain('decoding="async"');
  });

  it("keeps a figure image with layout data and forces safe loading attributes", () => {
    const mediaId = "0193f6a0-7c00-7000-8000-000000000001";
    const output = sanitize(
      `<figure data-type="image" data-align="right" class="photo" style="color:red" onclick="alert(1)"><img src="https://media.example.test/photo.jpg" alt="照片" title="京都" width="480" height="320" loading="eager" decoding="sync" data-media-id="${mediaId}" class="photo" style="width:99999px" onerror="alert(2)"><figcaption class="caption">鸭川边的清晨</figcaption></figure>`,
    );

    expect(output).toContain('data-type="image"');
    expect(output).toContain('data-align="right"');
    expect(output).toContain('src="https://media.example.test/photo.jpg"');
    expect(output).toContain(`data-media-id="${mediaId}"`);
    expect(output).toContain('loading="lazy"');
    expect(output).toContain('decoding="async"');
    expect(output).toContain("<figcaption>鸭川边的清晨</figcaption>");
    expect(output).not.toMatch(/class=|style=|onclick|onerror/i);
  });

  it("re-signs an inline image from a valid media id and keeps the media id", () => {
    const mediaId = "0193f6a0-7c00-7000-8000-000000000010";
    const freshSrc = "https://media.example.test/tenant/fresh.jpg?X-Amz-Signature=new";
    const output = sanitizeWithMediaUrls(
      `<p>清晨</p><img src="https://media.example.test/tenant/old.jpg?X-Amz-Signature=expired" alt="山" data-media-id="${mediaId}" onerror="alert(1)">`,
      new Map([[mediaId, freshSrc]]),
    );

    expect(output).toContain(`src="${freshSrc}"`);
    expect(output).not.toContain("expired");
    expect(output).toContain(`data-media-id="${mediaId}"`);
    expect(output).not.toMatch(/onerror/i);
  });

  it("keeps an old image without a media id unchanged", () => {
    const oldSrc = "https://media.example.test/tenant/legacy.jpg?X-Amz-Signature=expired";
    const output = sanitizeWithMediaUrls(
      `<img src="${oldSrc}" alt="旧图">`,
      new Map([["0193f6a0-7c00-7000-8000-000000000011", "https://media.example.test/fresh.jpg"]]),
    );

    expect(output).toContain(`src="${oldSrc}"`);
  });

  it("keeps the stored src when the media id is malformed", () => {
    const oldSrc = "https://media.example.test/tenant/legacy.jpg?X-Amz-Signature=expired";
    const output = sanitizeWithMediaUrls(
      `<img src="${oldSrc}" data-media-id="not-a-uuid">`,
      new Map([["not-a-uuid", "https://media.example.test/should-not-be-used.jpg"]]),
    );

    expect(output).toContain(`src="${oldSrc}"`);
    expect(output).not.toContain("not-a-uuid");
    expect(output).not.toContain("should-not-be-used");
  });

  it("keeps the stored src when the media map has no matching entry", () => {
    const mediaId = "0193f6a0-7c00-7000-8000-000000000012";
    const oldSrc = "https://media.example.test/tenant/legacy.jpg?X-Amz-Signature=expired";
    const output = sanitizeWithMediaUrls(
      `<img src="${oldSrc}" data-media-id="${mediaId}">`,
      new Map([["0193f6a0-7c00-7000-8000-000000000013", "https://media.example.test/other.jpg"]]),
    );

    expect(output).toContain(`src="${oldSrc}"`);
    expect(output).toContain(`data-media-id="${mediaId}"`);
  });

  it("still strips malicious src, handlers and styles after re-signing", () => {
    const mediaId = "0193f6a0-7c00-7000-8000-000000000014";
    const freshSrc = "https://media.example.test/tenant/fresh.jpg";
    const output = sanitizeWithMediaUrls(
      `<img src="javascript:alert(1)" srcset="javascript:alert(2) 1x" style="width:99999px" onerror="alert(3)" data-media-id="${mediaId}">`,
      new Map([[mediaId, freshSrc]]),
    );

    expect(output).toContain(`src="${freshSrc}"`);
    expect(output).not.toMatch(/javascript:|onerror|style=|srcset/i);
  });

  it("drops an image whose src remains unsafe when the map has no entry", () => {
    const output = sanitizeWithMediaUrls(
      '<img src="javascript:alert(1)" onerror="alert(2)">',
      new Map(),
    );

    expect(output).not.toContain("<img");
    expect(output).not.toMatch(/javascript:|onerror/i);
  });

  it("keeps a gallery wrapper when a mapped image replaces an unsafe stored src", () => {
    const mediaId = "0193f6a0-7c00-7000-8000-000000000015";
    const freshSrc = "https://media.example.test/tenant/fresh.jpg";
    const output = sanitizeWithMediaUrls(
      `<div data-type="gallery"><figure data-type="gallery-item"><img src="javascript:alert(1)" data-media-id="${mediaId}" onerror="alert(2)"><figcaption>图注</figcaption></figure></div>`,
      new Map([[mediaId, freshSrc]]),
    );

    expect(output).toContain('data-type="gallery"');
    expect(output).toContain(`src="${freshSrc}"`);
    expect(output).not.toMatch(/javascript:|onerror/i);
  });

  it("does not rewrite inline media for non-share callers", () => {
    const mediaId = "0193f6a0-7c00-7000-8000-000000000016";
    const oldSrc = "https://media.example.test/tenant/legacy.jpg?X-Amz-Signature=expired";
    const output = sanitize(`<img src="${oldSrc}" data-media-id="${mediaId}">`);

    expect(output).toContain(`src="${oldSrc}"`);
    expect(output).toContain(`data-media-id="${mediaId}"`);
  });

  it("keeps gallery and columns layout structures", () => {
    const mediaId = "0193f6a0-7c00-7000-8000-000000000002";
    const output = sanitize(
      `<div data-type="gallery" data-columns="3"><figure data-type="gallery-item"><img src="https://media.example.test/a.jpg" alt="锦市场" width="1200" height="800" data-media-id="${mediaId}"><figcaption>锦市场的一碗热汤</figcaption></figure></div><div data-type="columns" data-columns="2"><div data-type="column" data-column-index="0"><p>左栏</p></div><div data-type="column" data-column-index="1"><p>右栏</p></div></div>`,
    );

    expect(output).toContain('data-type="gallery"');
    expect(output).toContain('data-columns="3"');
    expect(output).toContain('data-type="gallery-item"');
    expect(output).toContain('data-type="columns"');
    expect(output).toContain('data-columns="2"');
    expect(output).toContain('data-type="column"');
    expect(output).toContain('data-column-index="0"');
    expect(output).toContain('data-column-index="1"');
    expect(output).toContain("左栏");
    expect(output).toContain("右栏");
  });

  it("normalizes layout enumerations and drops tag-incompatible data attributes", () => {
    const image = sanitize(
      '<figure data-type="IMAGE" data-align=" RIGHT " data-columns="9"><img src="https://media.example.test/a.jpg"></figure>',
    );
    expect(image).toContain('data-type="image"');
    expect(image).toContain('data-align="right"');
    expect(image).not.toContain("data-columns=");

    const invalidAlignment = sanitize(
      '<figure data-type="image" data-align="wide"><img src="https://media.example.test/a.jpg"></figure>',
    );
    expect(invalidAlignment).not.toContain("data-align=");

    const gallery = sanitize(
      '<div data-type="gallery" data-columns="9"><figure data-type="gallery-item"><img src="https://media.example.test/a.jpg"></figure></div>',
    );
    expect(gallery).toContain('data-columns="3"');

    const columns = sanitize(
      '<div data-type="columns" data-columns="9"><div data-type="column" data-column-index="9"><p>left</p></div><div data-type="column" data-column-index="1"><p>right</p></div></div>',
    );
    expect(columns).toContain('data-columns="2"');
    expect(columns).toContain('data-column-index="0"');
    expect(columns).toContain('data-column-index="1"');

    const unknown = sanitize(
      '<div data-type="callout" data-columns="4" data-column-index="2"><p>kept text</p></div>',
    );
    expect(unknown).toContain("kept text");
    expect(unknown).not.toMatch(/data-type=|data-columns=|data-column-index=/);
  });

  it("strips layout XSS, unsafe media ids and arbitrary data attributes", () => {
    const output = sanitize(
      `<div data-type="gallery" data-extra="x" class="evil" style="display:none"><figure data-type="gallery-item" onclick="alert(1)"><img src="https://media.example.test/a.jpg" srcset="javascript:alert(2) 1x" data-media-id="not-a-uuid" class="photo" style="width:99999px" onerror="alert(3)"><figcaption class="caption">图注</figcaption></figure></div><script>alert(4)</script><img src="javascript:alert(5)"><img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E">`,
    );

    expect(output).toContain('src="https://media.example.test/a.jpg"');
    expect(output).toContain('data-type="gallery"');
    expect(output).not.toMatch(
      /script|onerror|onclick|style=|class=|srcset|javascript:|data:image|data-extra|not-a-uuid/i,
    );
  });

  it("drops gallery and columns wrappers that have no usable children", () => {
    const gallery = sanitize(
      '<div data-type="gallery"><figure data-type="gallery-item"><img src="javascript:alert(1)"></figure></div>',
    );
    const imageFigure = sanitize(
      '<figure data-type="image"><figcaption>空图不该留下</figcaption></figure>',
    );
    const galleryItem = sanitize(
      '<figure data-type="gallery-item"><figcaption>空图不该留下</figcaption></figure>',
    );
    const columns = sanitize('<div data-type="columns"><p>没有栏</p></div>');

    expect(gallery).not.toContain('data-type="gallery"');
    expect(imageFigure).not.toContain('data-type="image"');
    expect(imageFigure).not.toContain("空图不该留下");
    expect(galleryItem).not.toContain('data-type="gallery-item"');
    expect(columns).not.toContain('data-type="columns"');
    expect(columns).not.toContain("没有栏");
  });

  it("keeps a normal figure and an image figure with a safe image", () => {
    const normal = sanitize("<figure><figcaption>普通图注</figcaption></figure>");
    const image = sanitize(
      '<figure data-type="image"><img src="https://media.example.test/photo.jpg" alt="照片"><figcaption>图注</figcaption></figure>',
    );

    expect(normal).toContain("<figure>");
    expect(normal).toContain("普通图注");
    expect(image).toContain('data-type="image"');
    expect(image).toContain("照片");
    expect(image).toContain("图注");
  });

  it("keeps same-site image paths", () => {
    const output = sanitize('<img src="/v1/media/0193d3a0-0000-7000-8000-000000000001">');

    expect(output).toContain('src="/v1/media/0193d3a0-0000-7000-8000-000000000001"');
  });

  it("strips onerror and onload from an otherwise valid image", () => {
    const output = sanitize(
      '<img src="https://media.example.test/photo.jpg" onerror="alert(1)" onload="alert(2)">',
    );

    expect(output).toContain('src="https://media.example.test/photo.jpg"');
    expect(output).not.toMatch(/onerror|onload/i);
  });

  it("rejects javascript: and data: image sources", () => {
    const output = sanitize(
      [
        '<img src="javascript:alert(1)">',
        '<img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E">',
        '<img src="//evil.example/photo.jpg">',
        '<img src="/\\evil.example/photo.jpg">',
        '<img src="relative-without-slash.jpg">',
      ].join(""),
    );

    expect(output).not.toContain("<img");
    expect(output).not.toMatch(/javascript:|data:image/i);
  });

  it("keeps only the _blank target and enforces opener protection", () => {
    const output = sanitize(
      [
        '<a href="https://example.com/new" target="_BLANK" rel="opener">new window</a>',
        '<a href="https://example.com/self" target="_self">same window</a>',
        '<a href="https://example.com/named" target="evil">named window</a>',
      ].join(""),
    );

    expect(output.match(/target="_blank"/g)).toHaveLength(1);
    expect(output).toContain('href="https://example.com/new"');
    expect(output).toContain('rel="noopener noreferrer"');
    expect(output).not.toMatch(/target="_self"|target="evil"|rel="opener"/i);
  });

  it("unwraps anchors without a safe href while preserving their content", () => {
    const output = sanitize(
      [
        '<p><a href="javascript:alert(1)"><strong>危险内容</strong></a></p>',
        '<p><a>没有链接的内容</a></p>',
        '<p><a href="data:text/html,x"><img src="https://media.example.test/nested.jpg" alt="嵌套图片"></a></p>',
        '<p><a href="https://example.com/safe">安全链接</a></p>',
        '<p><a href="mailto:hi@example.com">邮件</a></p>',
        '<p><a href="/trips/kyoto">站内</a></p>',
      ].join(""),
    );

    expect(output).toContain("<strong>危险内容</strong>");
    expect(output).toContain("没有链接的内容");
    expect(output).toContain('src="https://media.example.test/nested.jpg"');
    expect(output).toContain('alt="嵌套图片"');
    expect(output).not.toMatch(/<a[^>]*>\s*<strong>危险内容/);
    expect(output).not.toMatch(/<a>\s*没有链接的内容\s*<\/a>/);
    expect(output.match(/<a /g)).toHaveLength(3);
    expect(output).toContain('href="https://example.com/safe"');
    expect(output).toContain('href="mailto:hi@example.com"');
    expect(output).toContain('href="/trips/kyoto"');
  });

  it("strips a non-checkbox input", () => {
    const output = sanitize('<p>name</p><input type="text" value="secret">');

    expect(output).not.toContain("<input");
    expect(output).not.toContain("secret");
    expect(output).toContain("<p>name</p>");
  });

  it("keeps a read-only checkbox with checked and disabled state", () => {
    const output = sanitize('<input type="checkbox" checked disabled>');

    expect(output).toContain("<input");
    expect(output).toContain('type="checkbox"');
    expect(output).toContain("checked");
    expect(output).toContain("disabled");
  });

  it("keeps the Tiptap task-list structure and normalizes its checkbox to disabled", () => {
    const output = sanitize(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>带帐篷</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>买车票</p></div></li></ul>',
    );

    expect(output).toContain('data-type="taskList"');
    expect(output).toContain('data-type="taskItem"');
    expect(output).toContain('data-checked="true"');
    expect(output).toContain('data-checked="false"');
    expect(output).toContain("带帐篷");
    expect(output).toContain("买车票");
    expect(output.match(/<input/g)).toHaveLength(2);
    expect(output).toContain("disabled");
  });

  it("still strips script, style, iframe and event attributes", () => {
    const output = sanitize(
      '<script>alert(1)</script><style>body{display:none}</style><iframe src="https://evil.example"></iframe><p onclick="alert(2)">正文</p>',
    );

    expect(output).not.toMatch(/script|style|iframe|display:none|onclick/i);
    expect(output).toContain("<p>正文</p>");
  });
});
