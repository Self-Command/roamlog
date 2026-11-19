import { EmptyState } from "@roamlog/ui";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "旅行地图" };

export default async function TripMapPage() {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <EmptyState
        title="行程地图尚未接入"
        description="真实行程地图还在开发中。当前版本不会用演示数据伪造地图，接入后会显示停靠点、路线与照片位置。"
      />
    </div>
  );
}