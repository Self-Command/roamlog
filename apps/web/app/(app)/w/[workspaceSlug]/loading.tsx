import { Skeleton } from "@roamlog/ui";

export default function WorkspaceLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-12 w-64 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-48 rounded-card lg:col-span-2" />
        <Skeleton className="h-48 rounded-card" />
        <Skeleton className="h-64 rounded-card lg:col-span-3" />
      </div>
    </div>
  );
}
