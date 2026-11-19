/** Idempotency scope for `POST .../ai/runs/:runId/execute`. */
export function aiRunScope(userId: string, workspaceId: string): string {
  return `ai:run:execute:${userId}:${workspaceId}`;
}