import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import * as c from "../../src/index";
import { registerOperation } from "./helpers";

export function registerInsightsPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: "get",
    path: "/v1/workspaces/{workspaceId}/insights",
    operationId: "getWorkspaceInsights",
    tag: "Insights",
    summary: "Get workspace travel insights",
    description:
      "Returns the aggregated travel, spending, budget, heatmap, and record data for a Workspace.",
    params: c.WorkspaceParamsSchema,
    query: c.InsightsQuerySchema,
    response: c.WorkspaceInsightsSchema,
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/workspaces/{workspaceId}/insights/expenses.csv",
    operationId: "exportWorkspaceInsightsExpenses",
    tag: "Insights",
    summary: "Export workspace expenses as CSV",
    description: "Returns a UTF-8 CSV attachment with columns: 日期,旅行,分类,备注,金额,币种.",
    params: c.WorkspaceParamsSchema,
    response: z.string(),
    responseDescription: "UTF-8 CSV attachment. Columns: 日期,旅行,分类,备注,金额,币种.",
    responseContentType: "text/csv",
  });
}
