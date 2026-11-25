import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  ProviderCatalog,
  ProviderCatalogGroup,
  ProviderConnection,
  ProviderGroupResponse,
} from "@roamlog/contracts";

import { AdminMutationError } from "../../lib/admin-api-error";
import type { ProviderSettingsApi } from "../../lib/provider-settings-api";
import { ProviderEditor } from "./provider-editor";
import { ProviderGroupPage } from "./provider-group-page";

const ACTIVE_MAIL_ID = "0199b0c1-2200-7000-8000-000000000011";
const DISABLED_MAIL_ID = "0199b0c1-2200-7000-8000-000000000012";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const mailCatalogGroup: ProviderCatalogGroup = {
  group: "mail",
  label: "发信服务",
  routingModes: ["single"],
  adapters: [
    {
      adapter: "resend",
      label: "Resend",
      capabilities: ["probe"],
      configFields: [{ key: "from", type: "text", label: "发件地址", required: true }],
      secretFields: [{ key: "apiKey", label: "Resend API Key", required: true }],
      presets: [],
    },
    {
      adapter: "smtp",
      label: "SMTP",
      capabilities: ["probe"],
      configFields: [
        { key: "from", type: "text", label: "发件地址", required: true },
        { key: "host", type: "text", label: "SMTP 主机", required: true },
        { key: "port", type: "integer", label: "SMTP 端口", required: true, min: 1, max: 65535 },
        { key: "secure", type: "boolean", label: "使用 TLS", required: false },
      ],
      secretFields: [{ key: "password", label: "SMTP 密码", required: true }],
      presets: [],
    },
  ],
};

const storageCatalogGroup: ProviderCatalogGroup = {
  group: "storage",
  label: "存储服务",
  routingModes: ["single"],
  adapters: [
    {
      adapter: "s3",
      label: "S3 / MinIO",
      capabilities: ["probe"],
      configFields: [
        { key: "endpoint", type: "url", label: "S3 Endpoint", required: true },
        { key: "bucket", type: "text", label: "Bucket", required: true },
      ],
      secretFields: [
        { key: "accessKey", label: "Access Key", required: true },
        { key: "secretKey", label: "Secret Key", required: true },
      ],
      presets: [],
    },
  ],
};

const catalog: ProviderCatalog = {
  version: 1,
  groups: [mailCatalogGroup, storageCatalogGroup],
};

function mailProvider(
  id: string,
  label: string,
  adapter: "resend" | "smtp",
  enabled: boolean,
  priority: number,
): ProviderConnection {
  return {
    id,
    group: "mail",
    adapter,
    preset: null,
    label,
    enabled,
    priority,
    config:
      adapter === "resend"
        ? { from: "no-reply@example.com" }
        : { from: "no-reply@example.com", host: "smtp.example.com", port: 587, secure: true },
    version: 1,
    secrets: [
      {
        field: adapter === "resend" ? "apiKey" : "password",
        hasValue: true,
        last4: "1234",
        version: 1,
      },
    ],
    health: {
      status: "unknown",
      lastCheckedAt: null,
      lastErrorCode: null,
      cooldownUntil: null,
    },
    createdAt: "2026-11-22T12:00:00.000Z",
    updatedAt: "2026-11-22T12:00:00.000Z",
  };
}

const activeMail = mailProvider(ACTIVE_MAIL_ID, "Resend 主账号", "resend", true, 10);
const disabledMail = mailProvider(DISABLED_MAIL_ID, "SMTP 备用", "smtp", false, 20);

function mailGroup(providers: ProviderConnection[]): ProviderGroupResponse {
  return {
    group: "mail",
    label: "发信服务",
    routingMode: "single",
    maxAttempts: 1,
    cooldownSeconds: 0,
    version: 3,
    providers,
  };
}

function fakeApi(groupResponse = mailGroup([activeMail, disabledMail])): ProviderSettingsApi {
  return {
    catalog: vi.fn(async () => catalog),
    group: vi.fn(async () => groupResponse),
    updatePolicy: vi.fn(),
    reorder: vi.fn(),
    create: vi.fn(),
    update: vi.fn(async () => ({ ...activeMail, enabled: false, version: 2 })),
    remove: vi.fn(),
    probe: vi.fn(),
    probeDraft: vi.fn(),
    discoverModels: vi.fn(),
    refreshModels: vi.fn(),
    replaceSecret: vi.fn(),
    revealSecret: vi.fn(),
  } as unknown as ProviderSettingsApi;
}

function renderEditor(
  group: "mail" | "storage",
  catalogGroup: ProviderCatalogGroup,
  activeProvider: ProviderConnection | null,
) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn(async () => undefined);
  render(
    <ProviderEditor
      open
      group={group}
      catalogGroup={catalogGroup}
      provider={null}
      groupVersion={3}
      api={fakeApi()}
      singleActive
      activeProvider={activeProvider}
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />,
  );
  return { onOpenChange, onSaved };
}

describe("single-active mail and storage providers", () => {
  it("shows single-active guidance and defaults a new mail provider to disabled", async () => {
    const user = userEvent.setup();
    render(<ProviderGroupPage group="mail" role="super_admin" api={fakeApi()} />);

    await screen.findByTestId("provider-table");
    expect(screen.getByRole("note")).toHaveTextContent(/当前启用的是「Resend 主账号」/);

    await user.click(screen.getByRole("button", { name: "添加服务商" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/当前已有启用的「Resend 主账号」/)).toBeInTheDocument();
    expect(within(dialog).getByRole("switch", { name: "启用服务商" })).not.toBeChecked();
  });

  it("keeps conditional mail fields and secret drafts when switching adapters", async () => {
    const user = userEvent.setup();
    renderEditor("mail", mailCatalogGroup, activeMail);

    expect(screen.getByLabelText(/发件地址/)).toBeInTheDocument();
    expect(screen.getByLabelText(/接口密钥/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/SMTP 主机/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/接口密钥/), "re_test_key");
    await user.selectOptions(screen.getByLabelText(/类型/), "smtp::");

    expect(screen.getByLabelText(/服务器地址/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/接口密钥/)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/类型/), "resend::");
    expect(screen.getByLabelText(/接口密钥/)).toHaveValue("re_test_key");
  });

  it("renders storage-only fields for the S3 adapter", () => {
    renderEditor("storage", storageCatalogGroup, null);

    expect(screen.getByLabelText(/存储服务地址/)).toBeInTheDocument();
    expect(screen.getByLabelText(/存储桶/)).toBeInTheDocument();
    expect(screen.getByLabelText(/访问密钥/)).toBeInTheDocument();
    expect(screen.getByLabelText(/私有密钥/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/发件地址/)).not.toBeInTheDocument();
  });

  it("maps PROVIDER_ACTIVE_CONFLICT to an explicit disable action", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    vi.mocked(api.update).mockImplementation(async (id, input) => {
      if (id === DISABLED_MAIL_ID) {
        throw new AdminMutationError({
          code: "PROVIDER_ACTIVE_CONFLICT",
          status: 409,
          title: "已有启用的服务商",
          detail: "邮件和存储服务只允许一个启用的服务商。",
          degraded: [],
        });
      }
      return { ...activeMail, enabled: Boolean(input.enabled), version: 2 };
    });

    render(<ProviderGroupPage group="mail" role="super_admin" api={api} />);
    const table = await screen.findByTestId("provider-table");
    await user.click(within(table).getByRole("switch", { name: "启用 SMTP 备用" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/当前「Resend 主账号」正在启用/)).toBeInTheDocument();
    expect(api.update).toHaveBeenCalledWith(DISABLED_MAIL_ID, {
      enabled: true,
      expectedVersion: 1,
    });

    await user.click(within(dialog).getByRole("button", { name: "停用当前实例" }));

    await waitFor(() => {
      expect(api.update).toHaveBeenLastCalledWith(ACTIVE_MAIL_ID, {
        enabled: false,
        expectedVersion: 1,
      });
    });
  });
});
