"use client";

import { FlaskConical, Radio } from "lucide-react";

import { Badge } from "@roamlog/ui";

import { getAdminDataMode } from "../../lib/admin-data-mode";

export function AdminModeBanner() {
  const mode = getAdminDataMode();
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-2 rounded-control border border-hairline bg-surface-1/70 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.08em] text-muted"
    >
      {mode === "api" ? (
        <>
          <Radio aria-hidden="true" className="size-3 text-accent-green" />
          <span className="text-body">LIVE API</span>
          <span>同源 /v1 代理 · 平台角色与 2FA 由后端判定</span>
          <Badge tone="green" className="ml-auto">
            api
          </Badge>
        </>
      ) : (
        <>
          <FlaskConical aria-hidden="true" className="size-3 text-accent-yellow" />
          <span className="text-body">FIXTURE DATA</span>
          <span>3001 演示预览 · 不发送后台数据请求</span>
          <Badge tone="yellow" className="ml-auto">
            fixture
          </Badge>
        </>
      )}
    </div>
  );
}
