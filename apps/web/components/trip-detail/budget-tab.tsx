"use client";

import type { ExpenseCategory, WorkspaceRole } from "@roamlog/contracts";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Progress,
  Select,
} from "@roamlog/ui";
import { ArrowRight, Plus, ReceiptText, Scale, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";

import { canEdit, useDemoStore } from "@/lib/demo-store";
import { formatMinor, shortDate } from "@/lib/demo-format";

const categoryLabels: Record<ExpenseCategory, string> = {
  transport: "交通",
  stay: "住宿",
  food: "餐饮",
  activity: "活动",
  shopping: "购物",
  other: "其他",
};

const categoryColors: Record<ExpenseCategory, string> = {
  transport: "bg-accent-blue",
  stay: "bg-accent-orange",
  food: "bg-accent-yellow",
  activity: "bg-accent-green",
  shopping: "bg-accent-red",
  other: "bg-accent-slate",
};

export function BudgetTab({
  tripId,
  currency,
  role,
}: {
  tripId: string;
  currency: string;
  role: WorkspaceRole;
}) {
  const { state, addExpense } = useDemoStore();
  const trip = state.trips.find((candidate) => candidate.id === tripId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("food");
  const [date, setDate] = useState(trip?.startDate ?? new Date().toISOString().slice(0, 10));

  const expenses = useMemo(
    () =>
      state.expenses
        .filter((expense) => expense.tripId === tripId)
        .sort((left, right) => right.date.localeCompare(left.date)),
    [state.expenses, tripId],
  );
  const spent = expenses.reduce((sum, expense) => sum + expense.amountMinor, 0);
  const budget = trip?.budgetAmountMinor ?? 0;
  const remaining = budget - spent;
  const categoryTotals = useMemo(
    () =>
      (Object.keys(categoryLabels) as ExpenseCategory[])
        .map((key) => ({
          key,
          total: expenses
            .filter((expense) => expense.category === key)
            .reduce((sum, expense) => sum + expense.amountMinor, 0),
        }))
        .filter((item) => item.total > 0)
        .sort((left, right) => right.total - left.total),
    [expenses],
  );
  const editable = canEdit(role);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Math.round(Number(amount) * 100);
    if (!Number.isFinite(value) || value <= 0 || !note.trim()) return;
    addExpense(tripId, { note: note.trim(), amountMinor: value, category, date }, role);
    setAmount("");
    setNote("");
    setDialogOpen(false);
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-px overflow-hidden rounded-card border border-hairline-strong bg-hairline sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "旅行预算", value: formatMinor(budget, currency), hint: "按旅行设置币种" },
          { label: "已支出", value: formatMinor(spent, currency), hint: `${expenses.length} 笔明细`, testId: "spent-total" },
          {
            label: "剩余",
            value: formatMinor(Math.abs(remaining), currency),
            hint: remaining < 0 ? "已超出预算" : "可用于后续行程",
          },
          {
            label: "日均",
            value: formatMinor(
              expenses.length
                ? Math.round(spent / Math.max(1, new Set(expenses.map((item) => item.date)).size))
                : 0,
              currency,
            ),
            hint: "按有支出的日期计算",
          },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-1 p-4">
            <p className="type-eyebrow">{stat.label}</p>
            <p
              className="mt-2 font-serif text-3xl tracking-[-0.03em] text-ink"
              data-testid={stat.testId}
            >
              {stat.value}
            </p>
            <p className="mt-1.5 text-[10px] text-muted">{stat.hint}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,1fr)]">
        <section className="surface-card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-hairline p-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="type-eyebrow">EXPENSES / {expenses.length} RECORDS</p>
              <h2 className="mt-1.5 font-serif text-2xl tracking-[-0.025em] text-ink">花费明细</h2>
            </div>
            {editable ? (
              <Button type="button" variant="outline" onClick={() => setDialogOpen(true)}>
                <Plus aria-hidden="true" />
                记一笔
              </Button>
            ) : (
              <Badge tone="slate">VIEWER · 只读</Badge>
            )}
          </div>

          {expenses.length ? (
            <div>
              <div className="hidden grid-cols-[90px_minmax(0,1fr)_100px_110px] gap-3 border-b border-hairline px-4 py-2.5 md:grid">
                {["日期", "说明", "分类", "金额"].map((label) => (
                  <span key={label} className="type-eyebrow">
                    {label}
                  </span>
                ))}
              </div>
              {expenses.map((expense) => {
                const payer = state.members.find(
                  (member) => member.userId === expense.paidById,
                )?.user;
                return (
                  <div
                    key={expense.id}
                    className="grid gap-2 border-b border-hairline px-4 py-3.5 last:border-b-0 md:grid-cols-[90px_minmax(0,1fr)_100px_110px] md:items-center md:gap-3"
                  >
                    <span className="font-mono text-[10px] text-muted">
                      {shortDate(expense.date)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] text-ink">{expense.note}</p>
                      <p className="mt-0.5 text-[10px] text-muted">
                        {payer?.name ?? "同行者"} 垫付 · 4 人均分
                      </p>
                    </div>
                    <Badge tone="neutral" className="w-fit">
                      {categoryLabels[expense.category]}
                    </Badge>
                    <span className="font-mono text-[12px] text-ink md:text-right">
                      {formatMinor(expense.amountMinor, expense.currency)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-6 py-14 text-center">
              <ReceiptText aria-hidden="true" className="mx-auto size-5 text-stone" />
              <h3 className="mt-3 font-serif text-2xl text-ink">还没有花费</h3>
              <p className="mt-2 text-sm text-muted">记下第一笔交通、住宿或晚餐。</p>
            </div>
          )}
        </section>

        <div className="space-y-4">
          <section className="surface-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="type-eyebrow">CATEGORY MIX</p>
                <h2 className="mt-1.5 font-serif text-2xl text-ink">分类支出</h2>
              </div>
              <WalletCards aria-hidden="true" className="size-4 text-accent-orange" />
            </div>
            <div className="mt-4 space-y-3">
              {categoryTotals.map((item) => (
                <div key={item.key}>
                  <div className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="text-body">{categoryLabels[item.key]}</span>
                    <span className="font-mono text-muted">
                      {formatMinor(item.total, currency)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-white/5">
                    <div
                      className={`h-full rounded-pill ${categoryColors[item.key]}`}
                      style={{ width: `${Math.max(3, (item.total / Math.max(spent, 1)) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="surface-card p-5">
            <div className="flex items-center gap-2">
              <Scale aria-hidden="true" className="size-4 text-accent-green" />
              <p className="type-eyebrow">SETTLE UP</p>
            </div>
            <h2 className="mt-1.5 font-serif text-2xl text-ink">建议结算</h2>
            <div className="mt-4 space-y-2">
              {state.members
                .filter((member) => member.userId !== state.members[0]?.userId)
                .slice(0, 2)
                .map((member) => (
                  <div
                    key={member.userId}
                    className="flex items-center gap-2 rounded-control border border-hairline bg-surface-2 p-2.5 text-[11px]"
                  >
                    <span className="truncate text-body">{member.user.name}</span>
                    <ArrowRight aria-hidden="true" className="size-3 text-stone" />
                    <span className="truncate text-body">{state.members[0]?.user.name}</span>
                    <span className="ml-auto shrink-0 font-mono text-ink">
                      {formatMinor(Math.round(spent / state.members.length / 100) * 100, currency)}
                    </span>
                  </div>
                ))}
            </div>
            <p className="mt-3 text-[10px] leading-5 text-muted">
              等额分账下，余数由垫付人承担。真实 settle-up 由 API 计算，不在前端重算货币。
            </p>
          </section>
        </div>
      </div>

      {budget > 0 ? (
        <section className="surface-card p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="type-eyebrow">BUDGET ENVELOPE</p>
              <p className="mt-1.5 text-sm text-body">
                已使用 {Math.round((spent / budget) * 100)}% · 剩余{" "}
                {formatMinor(Math.max(0, remaining), currency)}
              </p>
            </div>
            <Badge tone={remaining < 0 ? "red" : "green"}>
              {remaining < 0 ? "OVER BUDGET" : "ON TRACK"}
            </Badge>
          </div>
          <Progress
            value={Math.min(100, (spent / budget) * 100)}
            className="mt-4 h-2"
            indicatorClassName={remaining < 0 ? "bg-accent-red" : "bg-accent-green"}
          />
        </section>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <p className="type-eyebrow">NEW EXPENSE</p>
            <DialogTitle>记一笔花费</DialogTitle>
            <DialogDescription>默认由你垫付，并在四位成员之间等额分账。</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="金额（元）">
                <Input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                />
              </FormField>
              <FormField label="分类">
                <Select
                  value={category}
                  onChange={(event) => setCategory(event.target.value as ExpenseCategory)}
                >
                  {Object.entries(categoryLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            <FormField label="备注">
              <Input
                required
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="例如：汉江拉面与便利店"
              />
            </FormField>
            <FormField label="日期">
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" variant="outline">
                保存花费
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
