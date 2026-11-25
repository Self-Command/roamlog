"use client";

import { useCreateExpense, useDeleteExpense } from "@roamlog/api-client";
import type { CreateExpenseRequest, ExpenseCategory, ExpenseWithSplits } from "@roamlog/contracts";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Label,
  Select,
  Textarea,
} from "@roamlog/ui";
import { Plus, Receipt, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { deniedReason } from "./capabilities";
import { ConfirmDialog } from "./dialogs";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  shortDateLabel,
  splitModeLabel,
} from "./format";
import { useMemberDirectory } from "./member-directory";
import {
  formatMinor,
  isValidCurrencyCode,
  parseAmountToMinor,
  sumByCurrency,
} from "./money";
import { EmptyBlock, QueryPanel } from "./panel";
import { assertMutationOk, useExpenses } from "./queries";
import { useTripWorkspace } from "./workspace-context";

interface ExpenseDraft {
  date: string;
  category: ExpenseCategory;
  note: string;
  amount: string;
  currency: string;
  paidById: string;
  participantIds: string[];
}

function ExpenseRow({
  expense,
  payerName,
  canDelete,
  deleteTitle,
  onDelete,
}: {
  expense: ExpenseWithSplits;
  payerName: string;
  canDelete: boolean;
  deleteTitle: string;
  onDelete: () => void;
}) {
  return (
    <li className="grid gap-3 px-4 py-3.5 sm:grid-cols-[92px_minmax(0,1fr)_auto_auto] sm:items-start">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
          {shortDateLabel(expense.date)}
        </p>
        <Badge tone="neutral">{EXPENSE_CATEGORY_LABELS[expense.category]}</Badge>
      </div>
      <div className="min-w-0">
        <p className="text-[13px] leading-5 text-ink">{expense.note || "没有备注"}</p>
        <p className="mt-1 text-[11px] leading-4 text-muted">
          付款人 {payerName} · {splitModeLabel(expense.splitMode)} · {expense.participants.length} 人分摊
        </p>
      </div>
      <div className="text-right">
        <p className="font-mono text-[13px] text-ink">
          {formatMinor(expense.amountMinor, expense.currency)}
        </p>
        <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
          版本 {expense.version}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onDelete}
        disabled={!canDelete}
        title={canDelete ? "删除这笔支出" : deleteTitle}
        aria-label={`删除支出 ${expense.note || shortDateLabel(expense.date)}`}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </li>
  );
}

export function ExpensesTab({ tripId }: { tripId: string }) {
  const { capabilities, mutate, pending, role, trip, workspace } = useTripWorkspace();
  const expenses = useExpenses(tripId);
  const createExpense = useCreateExpense();
  const deleteExpense = useDeleteExpense();
  const directory = useMemberDirectory();

  const defaultCurrency = trip.budgetCurrency ?? workspace.defaultCurrency;
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseWithSplits | null>(null);
  const [draft, setDraft] = useState<ExpenseDraft>(() => ({
    date: trip.startDate,
    category: "food",
    note: "",
    amount: "",
    currency: defaultCurrency,
    paidById: "",
    participantIds: [],
  }));

  const addTitle = capabilities.createExpense ? undefined : deniedReason(role, "记录支出");
  const deleteTitle = capabilities.deleteExpense ? undefined : deniedReason(role, "删除支出");

  function openForm() {
    setFormError(null);
    const firstMemberId = directory.members[0]?.id ?? "";
    setDraft({
      date: trip.startDate,
      category: "food",
      note: "",
      amount: "",
      currency: defaultCurrency,
      paidById: firstMemberId,
      participantIds: firstMemberId ? [firstMemberId] : [],
    });
    setFormOpen(true);
  }

  function toggleParticipant(userId: string, checked: boolean) {
    setDraft((current) => {
      const next = checked
        ? [...new Set([...current.participantIds, userId])]
        : current.participantIds.filter((id) => id !== userId);
      return { ...current, participantIds: next };
    });
  }

  async function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const currency = draft.currency.trim().toUpperCase();
    if (!isValidCurrencyCode(currency)) {
      setFormError("币种必须是三位大写字母，例如 CNY。");
      return;
    }
    const amountMinor = parseAmountToMinor(draft.amount, currency);
    if (amountMinor === null) {
      setFormError("金额必须是非负数字，最多 4 位小数。");
      return;
    }
    if (!draft.paidById) {
      setFormError("请选择付款人。");
      return;
    }
    if (!draft.participantIds.includes(draft.paidById)) {
      setFormError("付款人必须在分摊参与者里。");
      return;
    }
    if (draft.participantIds.length === 0) {
      setFormError("至少选择一个分摊参与者。");
      return;
    }
    if (!draft.date) {
      setFormError("请选择支出日期。");
      return;
    }

    const payload: CreateExpenseRequest = {
      date: draft.date,
      category: draft.category,
      note: draft.note.trim(),
      amountMinor,
      currency,
      paidById: draft.paidById,
      splitMode: "equal",
      participants: draft.participantIds.map((userId) => ({ userId })),
    };

    setFormError(null);
    const created = await mutate({
      label: "这笔支出",
      execute: async () => {
        const response = await createExpense.mutateAsync({ tripId, data: payload });
        assertMutationOk(response, `/v1/trips/${tripId}/expenses`);
        return response;
      },
      forbidden: "你没有记录支出的权限。请联系工作区所有者或管理员。",
      failure: "支出没有保存。",
    });
    if (created) setFormOpen(false);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const deleted = await mutate({
      label: "这笔支出",
      execute: async () => {
        const response = await deleteExpense.mutateAsync({ expenseId: target.id });
        assertMutationOk(response, `/v1/expenses/${target.id}`);
        return response;
      },
      forbidden: "你没有删除支出的权限。请联系工作区所有者或管理员。",
      failure: "支出没有删除。",
    });
    if (deleted) setDeleteTarget(null);
  }

  const totals = expenses.state === "ready" ? sumByCurrency(expenses.data.items) : [];

  return (
    <>
      <QueryPanel
        title="费用"
        meta={
          expenses.state === "ready"
            ? `${expenses.data.items.length} 笔${expenses.data.hasMore ? " · 有更多分页" : ""}`
            : "读取中"
        }
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openForm}
            disabled={!capabilities.createExpense}
            title={addTitle}
          >
            <Plus aria-hidden="true" />
            记一笔
          </Button>
        }
        result={expenses}
        errorTitle="费用读取失败"
        isEmpty={(data) => data.items.length === 0 && data.hasMore === false}
        empty={
          <EmptyBlock
            icon={Receipt}
            title="还没有记录支出"
            description="金额按币种分开展示，不做汇率折算。记账后预算摘要会立刻更新。"
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openForm}
                disabled={!capabilities.createExpense}
                title={addTitle}
              >
                <Plus aria-hidden="true" />
                记第一笔
              </Button>
            }
          />
        }
      >
        {() => (
          <div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-hairline bg-surface-2/40 px-4 py-3">
              <p className="type-eyebrow">按币种合计</p>
              {totals.length === 0 ? (
                <p className="font-mono text-[11px] text-stone">本页没有支出</p>
              ) : (
                <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {totals.map((total) => (
                    <li key={total.currency} className="font-mono text-[12px] text-ink">
                      {formatMinor(total.amountMinor, total.currency)}
                      <span className="ml-1 text-[10px] text-stone">
                        {total.currency} · {total.count} 笔
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <ul className="divide-y divide-hairline">
              {expenses.state === "ready"
                ? expenses.data.items.map((expense) => (
                    <ExpenseRow
                      key={expense.id}
                      expense={expense}
                      payerName={directory.nameOf(expense.paidById)}
                      canDelete={capabilities.deleteExpense}
                      deleteTitle={deleteTitle ?? ""}
                      onDelete={() => setDeleteTarget(expense)}
                    />
                  ))
                : null}
            </ul>
          </div>
        )}
      </QueryPanel>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl">
          <form onSubmit={(event) => void submitDraft(event)} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>记录一笔支出</DialogTitle>
              <DialogDescription>
                记录这笔支出的日期、分类、金额与付款人；费用由选中的参与者平分。
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="日期" id="expense-date">
                <Input
                  id="expense-date"
                  type="date"
                  value={draft.date}
                  onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                />
              </FormField>
              <FormField label="分类" id="expense-category">
                <Select
                  id="expense-category"
                  value={draft.category}
                  onChange={(event) =>
                    setDraft({ ...draft, category: event.target.value as ExpenseCategory })
                  }
                >
                  {EXPENSE_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {EXPENSE_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="金额" hint="按原币种输入金额" id="expense-amount">
                <Input
                  id="expense-amount"
                  value={draft.amount}
                  inputMode="decimal"
                  placeholder="0.00"
                  onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
                />
              </FormField>
              <FormField label="币种" hint="ISO 4217，三位大写字母" id="expense-currency">
                <Input
                  id="expense-currency"
                  value={draft.currency}
                  maxLength={3}
                  onChange={(event) =>
                    setDraft({ ...draft, currency: event.target.value.toUpperCase() })
                  }
                />
              </FormField>
              <FormField label="付款人" id="expense-payer">
                <Select
                  id="expense-payer"
                  value={draft.paidById}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      paidById: event.target.value,
                      participantIds: [...new Set([...draft.participantIds, event.target.value])],
                    })
                  }
                >
                  <option value="">选择付款人</option>
                  {directory.members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>

            <fieldset className="rounded-control border border-hairline bg-surface-2/40 p-3">
              <legend className="px-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                分摊参与者（平分）
              </legend>
              {directory.members.length === 0 ? (
                <p className="text-[11px] leading-5 text-stone">工作区还没有可分摊的成员。</p>
              ) : (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {directory.members.map((member) => (
                    <div key={member.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`expense-participant-${member.id}`}
                        checked={draft.participantIds.includes(member.id)}
                        onCheckedChange={(checked) =>
                          toggleParticipant(member.id, checked === true)
                        }
                      />
                      <Label
                        htmlFor={`expense-participant-${member.id}`}
                        className="mb-0 normal-case tracking-normal"
                      >
                        {member.name}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
            </fieldset>

            <FormField label="备注" error={formError} id="expense-note">
              <Textarea
                id="expense-note"
                rows={2}
                maxLength={1000}
                value={draft.note}
                onChange={(event) => setDraft({ ...draft, note: event.target.value })}
              />
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "保存中…" : "记录支出"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除这笔支出？"
        description={
          deleteTarget
            ? `${formatMinor(deleteTarget.amountMinor, deleteTarget.currency)} 会从费用记录中移除，预算摘要随之减少。`
            : ""
        }
        pending={pending}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
