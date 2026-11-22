"use client";

import type { ProviderCatalog } from "@roamlog/contracts";

import type { AdminConsoleRole } from "../../lib/admin-types";
import type { AdminProviderSummary } from "../../lib/provider-settings-api";
import { ProviderMobileCard, ProviderTableRow } from "./provider-row";

interface ProviderListProps {
  providers: readonly AdminProviderSummary[];
  catalog: ProviderCatalog;
  role: AdminConsoleRole;
  onEdit: (provider: AdminProviderSummary) => void;
  onProbe: (provider: AdminProviderSummary) => void;
  onToggle: (provider: AdminProviderSummary, enabled: boolean) => void;
  onDelete: (provider: AdminProviderSummary) => void;
}

export function ProviderList({
  providers,
  catalog,
  role,
  onEdit,
  onProbe,
  onToggle,
  onDelete,
}: ProviderListProps) {
  return (
    <section aria-label="已配置服务商">
      <div
        className="hidden overflow-x-auto rounded-card border border-hairline-strong bg-surface-1 lg:block"
        data-testid="provider-table"
      >
        <table className="w-full min-w-[860px] border-collapse text-left">
          <caption className="sr-only">服务商优先级、健康状态、凭据和操作</caption>
          <thead>
            <tr className="bg-surface-2/60 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
              <th scope="col" className="px-3 py-2.5 font-normal">
                顺序
              </th>
              <th scope="col" className="px-3 py-2.5 font-normal">
                服务商
              </th>
              <th scope="col" className="px-3 py-2.5 font-normal">
                状态
              </th>
              <th scope="col" className="px-3 py-2.5 font-normal">
                凭据
              </th>
              <th scope="col" className="px-3 py-2.5 font-normal">
                最近验证
              </th>
              <th scope="col" className="px-3 py-2.5 font-normal">
                启用
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-normal">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {providers.map((provider) => (
              <ProviderTableRow
                key={provider.id}
                provider={provider}
                catalog={catalog}
                role={role}
                onEdit={onEdit}
                onProbe={onProbe}
                onToggle={onToggle}
                onDelete={onDelete}
              />
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-3 lg:hidden" data-testid="provider-cards">
        {providers.map((provider) => (
          <ProviderMobileCard
            key={provider.id}
            provider={provider}
            catalog={catalog}
            role={role}
            onEdit={onEdit}
            onProbe={onProbe}
            onToggle={onToggle}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </section>
  );
}
