import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import * as c from "../../src/index";
import { registerOperation } from "./helpers";

export function registerSettingsPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/settings",
    operationId: "listAdminSettings",
    tag: "Admin",
    summary: "List platform settings grouped by section",
    description:
      "Secrets are returned as `{ hasValue, last4 }`; plaintext is never part of this response. Requires super_admin.",
    response: c.AdminSettingsResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/admin/settings/{key}",
    operationId: "getAdminSetting",
    tag: "Admin",
    summary: "Get one platform setting",
    params: c.AdminSettingKeyParamsSchema,
    response: c.AdminSettingItemSchema,
  });
  registerOperation(registry, {
    method: "patch",
    path: "/v1/admin/settings",
    operationId: "updateAdminSettings",
    tag: "Admin",
    summary: "Update one or more platform settings",
    description:
      "Validates every key before writing. Unknown keys and invalid values return 422 SETTINGS_INVALID with errors[] that name the key and rule but never echo the value.",
    body: c.UpdateAdminSettingsRequestSchema,
    response: c.UpdateAdminSettingsResponseSchema,
    errors: [400, 401, 403, 422, 500, 503],
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/admin/settings/{key}/reveal",
    operationId: "revealAdminSetting",
    tag: "Admin",
    summary: "Reveal one secret setting",
    description:
      "Only a super_admin with verified TOTP 2FA and an explicit `{ confirm: true }` body may reveal plaintext. Every reveal is audited.",
    params: c.AdminSettingKeyParamsSchema,
    body: c.RevealAdminSettingRequestSchema,
    status: 200,
    response: c.RevealAdminSettingResponseSchema,
    errors: [400, 401, 403, 404, 422, 500],
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/public/settings",
    operationId: "getPublicSettings",
    tag: "Settings",
    summary: "Get public site settings",
    description: "Anonymous projection containing only isPublic, non-secret values.",
    response: c.PublicSettingsResponseSchema,
    public: true,
  });
}
