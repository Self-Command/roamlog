"use client";

import { Plus, ServerCog } from "lucide-react";

import { Button, EmptyState } from "@roamlog/ui";

interface ProviderEmptyStateProps {
  groupLabel: string;
  canWrite: boolean;
  onAdd: () => void;
}

export function ProviderEmptyState({ groupLabel, canWrite, onAdd }: ProviderEmptyStateProps) {
  return (
    <EmptyState
      icon={ServerCog}
      title={`还没有配置 ${groupLabel}`}
      description="添加第一个服务商，填写连接信息并完成测试后，它会参与平台的优先级与回退策略。"
      className="rounded-card border-hairline-strong bg-surface-1 py-12"
      action={
        <Button variant="outline" size="sm" disabled={!canWrite} onClick={onAdd}>
          <Plus aria-hidden="true" />
          添加服务商
        </Button>
      }
    />
  );
}
