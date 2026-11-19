import { describe, expect, it } from "vitest";

import { SanitizeService } from "../../common/services/sanitize.service.js";

function sanitize(html: string): string {
  return new SanitizeService().sanitizeHtml(html);
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
