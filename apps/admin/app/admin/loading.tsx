import { Skeleton } from "@roamlog/ui";

export default function AdminLoading() {
  return (
    <div className="space-y-6" aria-label="正在加载后台页面" aria-busy="true">
      <div className="border-b border-hairline pb-6">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-4 h-10 w-56" />
        <Skeleton className="mt-4 h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-36 rounded-card" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-card" />
    </div>
  );
}
