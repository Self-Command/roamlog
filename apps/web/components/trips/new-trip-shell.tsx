"use client";

import { Badge, Button, FormField, Input, PageHeader, Select, Textarea } from "@roamlog/ui";
import { CalendarDays, Save, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { validateRequired } from "@/lib/validation";

interface NewTripShellProps {
  workspaceSlug: string;
  workspaceName: string;
}

export function NewTripShell({ workspaceSlug, workspaceName }: NewTripShellProps) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [titleError, setTitleError] = useState<string>();
  const [dateError, setDateError] = useState<string>();
  const [notice, setNotice] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitleError = validateRequired(title, "请输入旅行标题");
    const nextDateError =
      !startDate || !endDate
        ? "请选择完整的出发与返回日期"
        : endDate < startDate
          ? "返回日期不能早于出发日期"
          : undefined;
    setTitleError(nextTitleError);
    setDateError(nextDateError);
    setNotice(
      nextTitleError || nextDateError
        ? null
        : "表单骨架已通过本地校验。真实旅行创建、停靠点和封面写入将在 Wave 1 接入。",
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={`${workspaceName.toUpperCase()} / NEW TRIP`}
        title="新建旅行"
        description="先填写最小信息，右侧预览会随输入更新。当前不会写入数据库。"
        actions={
          <Button asChild variant="outline">
            <Link href={`/w/${workspaceSlug}/trips`}>返回旅行库</Link>
          </Button>
        }
      />

      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)]">
        <form
          noValidate
          onSubmit={handleSubmit}
          className="rounded-card border border-hairline-strong bg-surface-1 p-5"
        >
          <div className="flex items-center justify-between gap-3 border-b border-hairline pb-4">
            <div>
              <p className="type-eyebrow">BASICS</p>
              <h2 className="mt-1.5 font-serif text-2xl tracking-[-0.025em] text-ink">旅行信息</h2>
            </div>
            <Badge tone="slate">FORM SKELETON</Badge>
          </div>

          <div className="mt-5 space-y-5">
            <FormField label="标题" error={titleError}>
              <Input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  if (titleError) setTitleError(undefined);
                }}
                placeholder="例如：京都红叶慢行"
                maxLength={160}
              />
            </FormField>
            <FormField label="摘要" hint="一句话说明路线、季节和同行者。">
              <Textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="这趟旅行想留下什么？"
                maxLength={1000}
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="出发日期">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(event) => {
                    setStartDate(event.target.value);
                    if (dateError) setDateError(undefined);
                  }}
                />
              </FormField>
              <FormField label="返回日期" error={dateError}>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(event) => {
                    setEndDate(event.target.value);
                    if (dateError) setDateError(undefined);
                  }}
                />
              </FormField>
            </div>
            <FormField label="可见性">
              <Select defaultValue="workspace">
                <option value="workspace">Workspace 成员</option>
                <option value="private">仅自己与管理员</option>
                <option value="public_link">允许公开只读链接</option>
              </Select>
            </FormField>
          </div>

          {notice ? (
            <p
              role="status"
              className="mt-5 rounded-control border border-accent-green/20 bg-accent-green/5 px-3 py-2.5 text-xs leading-5 text-accent-green"
            >
              {notice}
            </p>
          ) : null}

          <div className="mt-6 flex flex-col gap-2 border-t border-hairline pt-4 sm:flex-row sm:justify-end">
            <Button asChild variant="ghost">
              <Link href={`/w/${workspaceSlug}/trips`}>取消</Link>
            </Button>
            <Button type="submit" variant="primary">
              <Save aria-hidden="true" />
              创建旅行
            </Button>
          </div>
        </form>

        <aside className="rounded-card border border-hairline-strong bg-surface-1 p-5">
          <p className="type-eyebrow">LIVE PREVIEW</p>
          <div className="trip-cover trip-cover--amber mt-4 aspect-[16/9] rounded-card border border-hairline">
            <div className="flex h-full flex-col justify-end p-4">
              <Badge tone="yellow" className="w-fit">
                愿望
              </Badge>
              <p className="mt-3 font-serif text-2xl leading-tight tracking-[-0.025em] text-ink">
                {title || "未命名旅行"}
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-[10px] text-white/60">
                <CalendarDays aria-hidden="true" className="size-3" />
                {startDate && endDate ? `${startDate} → ${endDate}` : "日期待定"}
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs leading-6 text-muted">
            {summary || "摘要会显示在旅行卡片与总览中。停靠点、封面和参与者预览将在后续任务加入。"}
          </p>
          <div className="mt-4 flex items-center gap-2 border-t border-hairline pt-4 text-[10px] text-stone">
            <Sparkles aria-hidden="true" className="size-3.5" />
            创建后会自动进入旅行详情。
          </div>
        </aside>
      </div>
    </div>
  );
}
