import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import * as c from "../../src/index";
import { registerOperation } from "./helpers";

export function registerMoneyPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: "get",
    path: "/v1/trips/{tripId}/expenses",
    operationId: "listExpenses",
    tag: "Expenses",
    summary: "List trip expenses",
    params: c.TripParamsSchema,
    query: c.ExpenseListQuerySchema,
    response: c.ExpensePageSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/trips/{tripId}/expenses",
    operationId: "createExpense",
    tag: "Expenses",
    summary: "Create an expense with participant shares",
    params: c.TripParamsSchema,
    body: c.CreateExpenseRequestSchema,
    response: c.ExpenseWithSplitsSchema,
  });
  registerOperation(registry, {
    method: "patch",
    path: "/v1/expenses/{expenseId}",
    operationId: "updateExpense",
    tag: "Expenses",
    summary: "Update an expense with optimistic concurrency",
    params: c.ExpenseParamsSchema,
    body: c.UpdateExpenseRequestSchema,
    response: c.ExpenseWithSplitsSchema,
    versioned: true,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/expenses/{expenseId}",
    operationId: "deleteExpense",
    tag: "Expenses",
    summary: "Soft-delete an expense",
    params: c.ExpenseParamsSchema,
    status: 200,
    response: c.DeleteExpenseResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/trips/{tripId}/budget/summary",
    operationId: "getBudgetSummary",
    tag: "Budget",
    summary: "Get multi-currency budget totals and category splits",
    params: c.TripParamsSchema,
    response: c.BudgetSummarySchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/trips/{tripId}/budget/settle-up",
    operationId: "getSettleUp",
    tag: "Budget",
    summary: "Get non-binding per-currency settle-up suggestions",
    params: c.TripParamsSchema,
    response: c.SettleUpResponseSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/trips/{tripId}/packing",
    operationId: "listPacking",
    tag: "Packing",
    summary: "List packing items",
    params: c.TripParamsSchema,
    query: c.PackingListQuerySchema,
    response: c.PackingPageSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/trips/{tripId}/packing",
    operationId: "createPackingItem",
    tag: "Packing",
    summary: "Create a packing item",
    params: c.TripParamsSchema,
    body: c.CreatePackingItemRequestSchema,
    response: c.PackingItemSchema,
  });
  registerOperation(registry, {
    method: "patch",
    path: "/v1/packing/{itemId}",
    operationId: "updatePackingItem",
    tag: "Packing",
    summary: "Update a packing item with optimistic concurrency",
    params: c.PackingItemParamsSchema,
    body: c.UpdatePackingItemRequestSchema,
    response: c.PackingItemSchema,
    versioned: true,
  });
  registerOperation(registry, {
    method: "delete",
    path: "/v1/packing/{itemId}",
    operationId: "deletePackingItem",
    tag: "Packing",
    summary: "Soft-delete a packing item",
    params: c.PackingItemParamsSchema,
    status: 200,
    response: c.DeletePackingItemResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/trips/{tripId}/packing/reorder",
    operationId: "reorderPacking",
    tag: "Packing",
    summary: "Reorder packing items",
    params: c.TripParamsSchema,
    body: c.ReorderPackingRequestSchema,
    status: 200,
    response: c.ReorderPackingResponseSchema,
  });
  registerOperation(registry, {
    method: "post",
    path: "/v1/trips/{tripId}/packing/bulk",
    operationId: "bulkUpdatePacking",
    tag: "Packing",
    summary: "Create, update, or delete packing items in bulk",
    params: c.TripParamsSchema,
    body: c.BulkPackingRequestSchema,
    status: 200,
    response: c.BulkPackingResponseSchema,
  });
}
