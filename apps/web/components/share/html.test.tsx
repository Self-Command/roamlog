import { afterEach, describe, expect, it, vi } from "vitest";

import { sanitizePublicHtml } from "./html";

describe("sanitizePublicHtml", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves the already server-sanitized HTML when no DOM is available during SSR", () => {
    vi.stubGlobal("document", undefined);

    const html =
      '<p>SSR 正文</p><figure data-type="image"><img src="https://media.example.test/a.jpg" alt="鸭川" data-media-id="0193f6a0-7c00-7000-8000-000000000001"></figure>';

    expect(sanitizePublicHtml(html)).toBe(html);
  });

  it("keeps a safe image with presentation attributes", () => {
    const html = sanitizePublicHtml(
      '<img src="https://media.example.test/photo.jpg" alt="山" title="清晨" width="800" height="600">',
    );

    expect(html).toContain("<img");
    expect(html).toContain('src="https://media.example.test/photo.jpg"');
    expect(html).toContain('alt="山"');
    expect(html).toContain('width="800"');
  });

  it("removes event handlers and non-whitelisted image attributes", () => {
    const html = sanitizePublicHtml(
      '<img src="https://media.example.test/photo.jpg" onerror="alert(1)" onload="alert(2)" style="width:99999px" class="x">',
    );

    expect(html).toContain('src="https://media.example.test/photo.jpg"');
    expect(html).not.toMatch(/onerror|onload|style=|class=/i);
  });

  it("keeps figure, gallery and columns layout attributes", () => {
    const mediaId = "0193f6a0-7c00-7000-8000-000000000001";
    const html = sanitizePublicHtml(
      `<figure data-type="image" data-align="right" class="photo"><img src="https://media.example.test/photo.jpg" alt="照片" loading="eager" decoding="sync" data-media-id="${mediaId}" class="x" style="width:99999px" srcset="javascript:alert(1) 1x" onerror="alert(2)"><figcaption>鸭川边的清晨</figcaption></figure><div data-type="gallery" data-columns="3" data-extra="x" class="evil"><figure data-type="gallery-item"><img src="https://media.example.test/a.jpg" alt="锦市场"></figure></div><div data-type="columns" data-columns="2"><div data-type="column" data-column-index="0"><p>左栏</p></div></div>`,
    );

    expect(html).toContain('data-type="image"');
    expect(html).toContain('data-align="right"');
    expect(html).toContain('src="https://media.example.test/photo.jpg"');
    expect(html).toContain(`data-media-id="${mediaId}"`);
    expect(html).toContain('loading="eager"');
    expect(html).toContain('decoding="sync"');
    expect(html).toContain("<figcaption>鸭川边的清晨</figcaption>");
    expect(html).toContain('data-type="gallery"');
    expect(html).toContain('data-columns="3"');
    expect(html).toContain('data-type="gallery-item"');
    expect(html).toContain('data-type="columns"');
    expect(html).toContain('data-type="column"');
    expect(html).toContain('data-column-index="0"');
    expect(html).toContain("左栏");
    expect(html).not.toMatch(/class=|style=|onerror|srcset|data-extra/i);
  });

  it("normalizes layout enumerations and removes tag-incompatible attributes", () => {
    const html = sanitizePublicHtml(
      `<figure data-type="IMAGE" data-align=" RIGHT " data-columns="9"><img src="https://media.example.test/a.jpg"></figure>
       <div data-type="gallery" data-columns="9"><figure data-type="gallery-item" data-align="right"><img src="https://media.example.test/b.jpg"></figure></div>
       <div data-type="columns" data-columns="9"><div data-type="column" data-column-index="9"><p>left</p></div><div data-type="column" data-column-index="1"><p>right</p></div></div>
       <div data-type="callout" data-columns="4"><p>kept text</p></div>`,
    );
    const template = document.createElement("template");
    template.innerHTML = html;
    const image = template.content.querySelector('figure[data-type="image"]')!;
    const gallery = template.content.querySelector('div[data-type="gallery"]')!;
    const galleryItem = template.content.querySelector("figure[data-type='gallery-item']")!;
    const columns = template.content.querySelector('div[data-type="columns"]')!;
    const [firstColumn, secondColumn] = [
      ...template.content.querySelectorAll('div[data-type="column"]'),
    ];

    expect(image.getAttribute("data-align")).toBe("right");
    expect(image.hasAttribute("data-columns")).toBe(false);
    expect(gallery.getAttribute("data-columns")).toBe("3");
    expect(galleryItem.hasAttribute("data-align")).toBe(false);
    expect(columns.getAttribute("data-columns")).toBe("2");
    expect(firstColumn?.getAttribute("data-column-index")).toBe("0");
    expect(secondColumn?.getAttribute("data-column-index")).toBe("1");
    expect(template.content.querySelector('[data-type="callout"]')).toBeNull();
    expect(template.content.textContent).toContain("kept text");
  });

  it("strips forged media ids and unsafe layout attributes", () => {
    const html = sanitizePublicHtml(
      '<div data-type="gallery" data-extra="x" class="evil"><figure data-type="gallery-item" onclick="alert(1)"><img src="https://media.example.test/a.jpg" data-media-id="not-a-uuid" class="photo" style="display:none" onerror="alert(2)"><figcaption>图注</figcaption></figure></div><script>alert(3)</script><img src="javascript:alert(4)"><img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E">',
    );

    expect(html).toContain('src="https://media.example.test/a.jpg"');
    expect(html).toContain('data-type="gallery"');
    expect(html).not.toMatch(
      /script|onclick|onerror|style=|class=|srcset|javascript:|data:image|data-extra|not-a-uuid/i,
    );
  });

  it("rejects javascript:, data: and protocol-relative image sources", () => {
    const html = sanitizePublicHtml(
      '<img src="javascript:alert(1)"><img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E"><img src="//evil.example/a.jpg"><img src="/\\evil.example/a.jpg">',
    );

    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/javascript:|data:image/i);
  });

  it("removes empty image figures and gallery items after stripping bad images", () => {
    const html = sanitizePublicHtml(
      '<figure data-type="image"><figcaption>空图不该留下</figcaption></figure>' +
        '<figure data-type="gallery-item"><figcaption>空项不该留下</figcaption></figure>' +
        '<figure data-type="image"><img src="javascript:alert(1)"><figcaption>危险图</figcaption></figure>',
    );

    expect(html).not.toContain('data-type="image"');
    expect(html).not.toContain('data-type="gallery-item"');
    expect(html).not.toContain("空图不该留下");
    expect(html).not.toContain("空项不该留下");
    expect(html).not.toContain("危险图");
  });

  it("keeps a normal figure and an image figure with a safe image", () => {
    const html = sanitizePublicHtml(
      '<figure><figcaption>普通图注</figcaption></figure>' +
        '<figure data-type="image"><img src="https://media.example.test/photo.jpg" alt="照片"><figcaption>图注</figcaption></figure>',
    );

    expect(html).toContain("<figure>");
    expect(html).toContain("普通图注");
    expect(html).toContain('data-type="image"');
    expect(html).toContain("照片");
    expect(html).toContain("图注");
  });

  it("strips a non-checkbox input and keeps a read-only checkbox", () => {
    const html = sanitizePublicHtml(
      '<p>清单</p><input type="text" value="secret"><input type="checkbox" checked disabled>',
    );

    expect(html).not.toContain('type="text"');
    expect(html).not.toContain("secret");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
    expect(html).toContain("disabled");
  });

  it("preserves the Tiptap task-list structure", () => {
    const html = sanitizePublicHtml(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>带帐篷</p></div></li></ul>',
    );

    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-checked="true"');
    expect(html).toContain("带帐篷");
    expect(html).toContain('type="checkbox"');
  });

  it("still strips script, style and iframe", () => {
    const html = sanitizePublicHtml(
      '<script>alert(1)</script><style>body{display:none}</style><iframe src="https://evil.example"></iframe><p>正文</p>',
    );

    expect(html).not.toMatch(/script|style|iframe|display:none/i);
    expect(html).toContain("<p>正文</p>");
  });

  it("normalizes link targets and rel attributes", () => {
    const html = sanitizePublicHtml(
      '<p><a href="https://example.com/plain">普通链接</a><a href="https://example.com/new" target="_blank" rel="opener">新窗口</a></p>',
    );
    const template = document.createElement("template");
    template.innerHTML = html;
    const links = [...template.content.querySelectorAll("a")];
    const plain = links[0]!;
    const blank = links[1]!;

    expect(plain.getAttribute("target")).toBeNull();
    expect(plain.getAttribute("rel")).toBe("noopener noreferrer");
    expect(blank.getAttribute("target")).toBe("_blank");
    expect(blank.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("unwraps anchors without a safe href while keeping text and images", () => {
    const html = sanitizePublicHtml(
      '<p><a href="javascript:alert(1)"><strong>危险内容</strong></a></p><p><a><img src="https://media.example.test/a.jpg" alt="图片"></a></p><p><a href="mailto:hi@example.com">邮件</a><a href="/trips/kyoto">站内</a></p>',
    );
    const template = document.createElement("template");
    template.innerHTML = html;
    const links = [...template.content.querySelectorAll("a")];

    expect(links).toHaveLength(2);
    expect(template.content.textContent).toContain("危险内容");
    expect(template.content.querySelector("strong")).not.toBeNull();
    expect(template.content.querySelector("img")?.getAttribute("src")).toBe(
      "https://media.example.test/a.jpg",
    );
    expect(template.content.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(template.content.querySelector("a:not([href])")).toBeNull();
  });
});
