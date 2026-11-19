import { describe, expect, it } from "vitest";

import { sanitizePublicHtml } from "./html";

describe("sanitizePublicHtml", () => {
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

  it("rejects javascript:, data: and protocol-relative image sources", () => {
    const html = sanitizePublicHtml(
      '<img src="javascript:alert(1)"><img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E"><img src="//evil.example/a.jpg"><img src="/\\evil.example/a.jpg">',
    );

    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/javascript:|data:image/i);
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
});
