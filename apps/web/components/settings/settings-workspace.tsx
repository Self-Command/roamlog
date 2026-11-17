"use client";

import {
  Avatar,
  Badge,
  Button,
  FormField,
  Input,
  PageHeader,
  Progress,
  Select,
  Switch,
} from "@roamlog/ui";
import {
  ArrowUpRight,
  Check,
  Database,
  Download,
  HardDrive,
  Keyboard,
  Laptop,
  LogOut,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  User,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useDemoStore } from "@/lib/demo-store";
import { formatMinor } from "@/lib/demo-format";

const accents = [
  ["#ff801f", "橙"],
  ["#3b9eff", "蓝"],
  ["#11ff99", "绿"],
  ["#ff2047", "红"],
  ["#ffc53d", "黄"],
  ["#64748b", "石板"],
] as const;

function SettingsSection({
  eyebrow,
  title,
  description,
  badge,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="surface-card overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-hairline p-5">
        <div>
          <p className="type-eyebrow">{eyebrow}</p>
          <h2 className="mt-1.5 font-serif text-[25px] leading-none tracking-[-0.02em] text-ink">
            {title}
          </h2>
          {description ? (
            <p className="mt-2 max-w-xl text-[11px] leading-5 text-muted">{description}</p>
          ) : null}
        </div>
        {badge}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function SettingsWorkspace() {
  const {
    state,
    currentUser,
    updateSettings,
    updateNotificationPreference,
    resetDemo,
  } = useDemoStore();
  const [notice, setNotice] = useState<string | null>(null);
  const totalSpent = state.expenses.reduce((sum, expense) => sum + expense.amountMinor, 0);

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", state.settings.reduceMotion);
    return () => document.documentElement.classList.remove("reduce-motion");
  }, [state.settings.reduceMotion]);

  function exportData() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            boundary: "seed fixtures + local browser state; not a backend export",
            ...state,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "roamlog-demo-state.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("本地演示数据已导出为 JSON。");
  }

  function reset() {
    if (!window.confirm("重置会清空本地修改并恢复 fixtures。继续？")) return;
    resetDemo();
    setNotice("已恢复 seed fixtures。");
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="SETTINGS / WORKSPACE"
        title="设置"
        description="个人资料、工作区偏好、通知、设备会话与数据。所有修改只保存到当前浏览器的本地演示状态。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={exportData}>
              <Download aria-hidden="true" />
              导出数据
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={reset}>
              <RotateCcw aria-hidden="true" />
              重置演示
            </Button>
          </div>
        }
      />

      {notice ? (
        <p
          role="status"
          className="rounded-control border border-accent-green/20 bg-accent-green/5 px-3 py-2 text-xs text-accent-green"
        >
          {notice}
        </p>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,1fr)]">
        <div className="space-y-4">
          <SettingsSection
            eyebrow="PROFILE"
            title="个人资料"
            description="这些信息会显示在日志、评论和活动里。"
          >
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <div className="flex items-center gap-4">
                <Avatar name={state.settings.displayName} size={64} online />
                <div>
                  <p className="text-[13px] text-ink">{state.settings.displayName}</p>
                  <p className="mt-0.5 font-mono text-[9px] text-muted">{currentUser.email}</p>
                  <Badge tone="green" className="mt-2">
                    <ShieldCheck aria-hidden="true" className="size-3" />
                    OWNER
                  </Badge>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="sm:ml-auto"
                onClick={() => setNotice("头像上传在原型中未接入对象存储。")}
              >
                更换头像
              </Button>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <FormField label="显示名称">
                <Input
                  value={state.settings.displayName}
                  onChange={(event) => updateSettings({ displayName: event.target.value })}
                />
              </FormField>
              <FormField label="邮箱">
                <Input value={currentUser.email} readOnly className="text-muted" />
              </FormField>
              <FormField label="时区">
                <Select
                  value={state.settings.timezone}
                  onChange={(event) => updateSettings({ timezone: event.target.value })}
                >
                  <option value="Asia/Shanghai">Asia/Shanghai · UTC+8</option>
                  <option value="Asia/Tokyo">Asia/Tokyo · UTC+9</option>
                  <option value="Europe/Lisbon">Europe/Lisbon · UTC+0</option>
                </Select>
              </FormField>
              <FormField label="语言">
                <Select
                  value={state.settings.locale}
                  onChange={(event) => updateSettings({ locale: event.target.value })}
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="en-US">English</option>
                  <option value="ja-JP">日本語</option>
                </Select>
              </FormField>
            </div>
          </SettingsSection>

          <SettingsSection
            eyebrow="WORKSPACE"
            title="工作区"
            badge={<Badge tone="blue">TEAM</Badge>}
            description="名称、币种与周起始日。Owner 才能转移所有权或删除工作区。"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="工作区名称">
                <Input
                  value={state.settings.workspaceName}
                  onChange={(event) => updateSettings({ workspaceName: event.target.value })}
                />
              </FormField>
              <FormField label="工作区地址">
                <Input value="roamlog-crew" readOnly className="text-muted" />
              </FormField>
              <FormField label="默认币种">
                <Select
                  value={state.settings.currency}
                  onChange={(event) => updateSettings({ currency: event.target.value })}
                >
                  <option value="CNY">CNY — 人民币</option>
                  <option value="USD">USD — 美元</option>
                  <option value="EUR">EUR — 欧元</option>
                  <option value="JPY">JPY — 日元</option>
                </Select>
              </FormField>
              <FormField label="每周开始于">
                <Select
                  value={state.settings.weekStartsOn}
                  onChange={(event) =>
                    updateSettings({ weekStartsOn: Number(event.target.value) })
                  }
                >
                  <option value={1}>周一</option>
                  <option value={0}>周日</option>
                </Select>
              </FormField>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3 border-t border-hairline pt-4">
              {[
                ["MEMBERS", state.members.length],
                ["TRIPS", state.trips.length],
                ["ENTRIES", state.entries.length],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="type-eyebrow">{label}</p>
                  <p className="mt-1.5 font-serif text-2xl text-ink">{value}</p>
                </div>
              ))}
            </div>
          </SettingsSection>

          <SettingsSection
            eyebrow="PREFERENCES"
            title="界面与动效"
            description="密度、氛围光与 reduced motion。系统偏好始终优先。"
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                  界面密度
                </p>
                <div className="flex rounded-control border border-hairline-strong bg-surface-1 p-1">
                  {(["comfortable", "compact"] as const).map((density) => (
                    <button
                      key={density}
                      type="button"
                      onClick={() => updateSettings({ density })}
                      className={`h-9 flex-1 rounded-[6px] text-[11px] ${
                        state.settings.density === density
                          ? "bg-ink text-black"
                          : "text-muted hover:text-ink"
                      }`}
                    >
                      {density === "comfortable" ? "舒适" : "紧凑"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                  页面氛围光
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {accents.map(([color, label]) => (
                    <button
                      key={color}
                      type="button"
                      aria-pressed={state.settings.accentColor === color}
                      onClick={() => updateSettings({ accentColor: color })}
                      className={`flex h-9 items-center gap-1.5 rounded-control border px-2.5 text-[10px] ${
                        state.settings.accentColor === color
                          ? "border-white/30 bg-surface-2 text-ink"
                          : "border-hairline text-muted"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="size-2 rounded-pill"
                        style={{ background: color }}
                      />
                      {label}
                      {state.settings.accentColor === color ? (
                        <Check aria-hidden="true" className="size-2.5" />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between gap-4 border-t border-hairline pt-4">
              <div>
                <p className="text-[12px] text-ink">减少动效</p>
                <p className="mt-0.5 text-[10px] text-muted">
                  关闭页面过渡和悬停缩放；系统 prefers-reduced-motion 仍然生效。
                </p>
              </div>
              <Switch
                checked={state.settings.reduceMotion}
                aria-label="减少动效"
                onCheckedChange={(checked) => updateSettings({ reduceMotion: checked })}
              />
            </div>
          </SettingsSection>

          <SettingsSection
            eyebrow="NOTIFICATIONS"
            title="通知偏好"
            description="按类型控制站内与邮件通知。当前只保存本地偏好，不实际发送邮件。"
          >
            <div className="divide-y divide-hairline">
              {state.settings.notificationPreferences.map((preference) => (
                <div
                  key={preference.type}
                  className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-body">{preference.type.replaceAll("_", " ")}</p>
                    <p className="mt-0.5 text-[10px] text-stone">
                      In-app / Email 独立控制
                    </p>
                  </div>
                  <div className="flex items-center gap-5">
                    <label className="flex items-center gap-2 text-[10px] text-muted">
                      In-app
                      <Switch
                        checked={preference.inApp}
                        aria-label={`${preference.type} in-app`}
                        onCheckedChange={(checked) =>
                          updateNotificationPreference(preference.type, "inApp", checked)
                        }
                      />
                    </label>
                    <label className="flex items-center gap-2 text-[10px] text-muted">
                      Email
                      <Switch
                        checked={preference.email}
                        aria-label={`${preference.type} email`}
                        onCheckedChange={(checked) =>
                          updateNotificationPreference(preference.type, "email", checked)
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </SettingsSection>

          <SettingsSection
            eyebrow="SECURITY"
            title="安全与设备"
            description="密码、OAuth、2FA 与设备会话需要真实认证服务；当前仅提供静态预览。"
          >
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setNotice("密码修改需要 Better Auth 会话接入。")}
              >
                修改密码
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setNotice("2FA 尚未启用。")}
              >
                启用 2FA
              </Button>
              <Badge tone="green">SESSION COOKIE · MOCK</Badge>
            </div>
            <div className="mt-4 divide-y divide-hairline rounded-control border border-hairline">
              <div className="flex items-center gap-3 p-3">
                <Laptop aria-hidden="true" className="size-4 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-ink">MacBook Pro · Shanghai</p>
                  <p className="mt-0.5 font-mono text-[8px] text-stone">Chrome 142 · 当前设备</p>
                </div>
                <span className="size-1.5 rounded-pill bg-accent-green" />
              </div>
              <div className="flex items-center gap-3 p-3">
                <Smartphone aria-hidden="true" className="size-4 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-ink">iPhone 17 Pro</p>
                  <p className="mt-0.5 font-mono text-[8px] text-stone">Safari · 2 小时前</p>
                </div>
                <LogOut aria-hidden="true" className="size-3.5 text-stone" />
              </div>
            </div>
          </SettingsSection>

          <SettingsSection
            eyebrow="DATA"
            title="数据与原型边界"
            description="导出、重置并明确当前 localStorage 能做什么、不能做什么。"
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["ENTRIES", state.entries.length],
                ["EXPENSES", state.expenses.length],
                ["TOTAL SPENT", formatMinor(totalSpent)],
                ["PHOTOS", state.media.length],
              ].map(([label, value]) => (
                <div key={label} className="rounded-control border border-hairline p-3">
                  <p className="type-eyebrow">{label}</p>
                  <p className="mt-1.5 font-serif text-xl text-ink">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={exportData}>
                <Download aria-hidden="true" />
                导出 JSON
              </Button>
              <Button type="button" variant="danger" size="sm" onClick={reset}>
                <RotateCcw aria-hidden="true" />
                重置演示数据
              </Button>
            </div>
            <p className="mt-3 text-[10px] leading-5 text-muted">
              当前为 seed data + localStorage。没有真实认证、数据库、对象存储、邮件、实时协作或后台 worker。
            </p>
          </SettingsSection>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-20">
          <section className="surface-card overflow-hidden">
            <div className="relative h-24 border-b border-hairline bg-[radial-gradient(ellipse_at_30%_20%,rgba(255,128,31,0.24),transparent_62%)]">
              <div className="absolute -bottom-6 left-5 flex size-12 items-center justify-center rounded-card border border-hairline-strong bg-surface-2 font-serif text-xl text-ink">
                R
              </div>
              <Badge tone="blue" className="absolute right-4 top-4">
                TEAM
              </Badge>
            </div>
            <div className="p-5 pt-9">
              <p className="font-serif text-2xl text-ink">{state.settings.workspaceName}</p>
              <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                {state.members.length} MEMBERS · {state.trips.length} TRIPS
              </p>
              <div className="mt-4 space-y-3">
                <div>
                  <div className="mb-1.5 flex justify-between font-mono text-[8px] text-muted">
                    <span>TRIPS</span>
                    <span>{state.trips.length} / 25</span>
                  </div>
                  <Progress
                    value={(state.trips.length / 25) * 100}
                    aria-label="旅行数量配额"
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex justify-between font-mono text-[8px] text-muted">
                    <span>LOCAL STORAGE</span>
                    <span>DEMO ONLY</span>
                  </div>
                  <Progress
                    value={12}
                    indicatorClassName="bg-accent-blue"
                    aria-label="本地存储使用量（演示）"
                  />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-hairline pt-3">
                <HardDrive aria-hidden="true" className="size-3.5 text-muted" />
                <span className="text-[10px] text-muted">媒体在原型中仅为渐变占位</span>
              </div>
            </div>
          </section>

          <section className="surface-card p-4">
            <div className="flex items-center gap-2">
              <User aria-hidden="true" className="size-3.5 text-muted" />
              <p className="type-eyebrow">ACCOUNT</p>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted">
              会话、OAuth 绑定和账号删除需要真实认证。当前状态不会离开本浏览器。
            </p>
            <a
              href="#security"
              className="mt-3 inline-flex items-center gap-1 text-[11px] text-ink hover:text-accent-blue"
            >
              查看安全设置
              <ArrowUpRight aria-hidden="true" className="size-3" />
            </a>
          </section>

          <section className="surface-card p-4">
            <div className="flex items-center gap-2">
              <Keyboard aria-hidden="true" className="size-3.5 text-muted" />
              <p className="type-eyebrow">SHORTCUTS</p>
            </div>
            <div className="mt-3 space-y-2.5">
              {[
                ["命令面板", "⌘ K"],
                ["写日志", "N"],
                ["新旅行", "⇧ N"],
                ["关闭弹层", "ESC"],
              ].map(([label, key]) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-[11px] text-muted">{label}</span>
                  <span className="rounded border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] text-body">
                    {key}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="surface-card p-4">
            <div className="flex items-center gap-2">
              <Database aria-hidden="true" className="size-3.5 text-muted" />
              <p className="type-eyebrow">ABOUT THIS BUILD</p>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted">
              Roamlog Web Wave 2 · Next.js 16 / React 19 / Tailwind 4。使用 seed fixtures + localStorage，不是生产后端。
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Sparkles aria-hidden="true" className="size-3.5 text-accent-orange" />
              <span className="font-mono text-[8px] uppercase tracking-[0.08em] text-stone">
                MOCK BOUNDARY / 2026.11
              </span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
