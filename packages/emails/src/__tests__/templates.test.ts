import { describe, expect, it } from "vitest";
import {
  EMAIL_TEMPLATE_IDS,
  emailTemplateSamples,
  renderEmailTemplate,
  renderSampleEmails,
} from "../render.js";

describe("transactional email templates", () => {
  it("renders every Wave 0 template to HTML and plain text with a subject", async () => {
    const rendered = await renderSampleEmails();

    expect(rendered.map((email) => email.id)).toEqual([...EMAIL_TEMPLATE_IDS]);
    for (const email of rendered) {
      expect(email.subject.length).toBeGreaterThan(0);
      expect(email.html).toContain("<!DOCTYPE html");
      expect(email.html).not.toContain("undefined");
      expect(email.text.length).toBeGreaterThan(80);
      expect(email.text).not.toContain("<html");
      expect(email.text).not.toContain("<!DOCTYPE");
    }
  });

  it("includes the invitation workspace and role in the rendered message", async () => {
    const email = await renderEmailTemplate(
      "workspace-invite",
      emailTemplateSamples["workspace-invite"],
    );

    expect(email.subject).toContain("North Star Studio");
    expect(email.text).toContain("编辑者");
    expect(email.html).toContain("接受邀请");
  });

  it("uses the verification expiry window in the fallback copy", async () => {
    const email = await renderEmailTemplate("verify-email", emailTemplateSamples["verify-email"]);

    expect(email.text).toContain("24 小时");
    expect(email.text).toContain("verify-email?token=sample-token");
  });
});
