"use client";

import type { Trip } from "@roamlog/contracts";
import {
  AvatarGroup,
  Badge,
  Button,
  Input,
  PageHeader,
  Select,
} from "@roamlog/ui";
import {
  ArrowUpRight,
  Compass,
  Globe2,
  List,
  Map as MapIcon,
  MapPin,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useDemoStore } from "@/lib/demo-store";
import { shortDate } from "@/lib/demo-format";
import {
  formatDateRange,
  getTripStatusLabel,
  getTripStatusTone,
  tripDurationDays,
} from "@/lib/trip-presentation";
import { WorldMap } from "@/components/map/world-map";

const COUNTRY_NAMES: Record<string, string> = {
  KR: "韩国",
  JP: "日本",
  IS: "冰岛",
  PT: "葡萄牙",
  IT: "意大利",
  CL: "智利",
  AR: "阿根廷",
  GR: "希腊",
  MA: "摩洛哥",
};

export function AtlasWorkspace({ workspaceSlug }: { workspaceSlug: string }) {
  const { state } = useDemoStore();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [year, setYear] = useState("all");
  const [view, setView] = useState<"map" | "list">("map");
  const [selectedId, setSelectedId] = useState(state.trips[0]?.id ?? "");
  const years = useMemo(
    () =>
      [...new Set(state.trips.map((trip) => trip.startDate.slice(0, 4)))].sort((a, b) =>
        b.localeCompare(a),
      ),
    [state.trips],
  );
  const filtered = useMemo(
    () =>
      state.trips.filter((trip) => {
        const text = `${trip.title} ${trip.destinations.join(" ")} ${trip.tags.join(" ")} ${trip.countryCodes
          .map((code) => COUNTRY_NAMES[code] ?? code)
          .join(" ")}`.toLocaleLowerCase("zh-CN");
        return (
          (!query.trim() || text.includes(query.trim().toLocaleLowerCase("zh-CN"))) &&
          (status === "all" || trip.status === status) &&
          (year === "all" || trip.startDate.startsWith(year))
        );
      }),
    [query, state.trips, status, year],
  );
  const selected = filtered.find((trip) => trip.id === selectedId) ?? filtered[0];
  const groups = useMemo(() => {
    const map = new Map<string, Trip[]>();
    filtered.forEach((trip) =>
      map.set(trip.startDate.slice(0, 4), [
        ...(map.get(trip.startDate.slice(0, 4)) ?? []),
        trip,
      ]),
    );
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [filtered]);
  const countries = new Set(filtered.flatMap((trip) => trip.countryCodes));
  const cities = new Set(filtered.flatMap((trip) => trip.destinations));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`ATLAS / ${filtered.length} TRIPS · ${countries.size} COUNTRIES`}
        title="世界足迹"
        description="从上海出发，把每次出发和归来的坐标收进同一张地图。选择标记，回到那段旅程。"
        actions={
          <div className="flex items-center rounded-control border border-hairline-strong bg-surface-1 p-1">
            <Button
              type="button"
              variant={view === "map" ? "subtle" : "ghost"}
              size="sm"
              className="border-0"
              aria-pressed={view === "map"}
              onClick={() => setView("map")}
            >
              <MapIcon aria-hidden="true" />
              地图
            </Button>
            <Button
              type="button"
              variant={view === "list" ? "subtle" : "ghost"}
              size="sm"
              className="border-0"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              <List aria-hidden="true" />
              列表
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="surface-card overflow-hidden">
          <div className="flex h-14 items-center gap-3 border-b border-hairline px-4">
            <span className="size-1.5 rounded-pill bg-accent-orange" />
            <p className="type-eyebrow text-body">WORLD / FOOTPRINT</p>
            <span className="ml-auto hidden font-mono text-[8px] uppercase tracking-[0.08em] text-stone sm:inline">
              {filtered.length} MARKERS · FIXTURE COORDINATES
            </span>
          </div>

          {view === "map" ? (
            <div className="relative">
              <WorldMap
                trips={filtered}
                selectedTripId={selected?.id}
                onSelect={setSelectedId}
                className="h-auto min-h-80 w-full"
              />
              {!filtered.length ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/65 p-6 backdrop-blur-sm">
                  <div className="max-w-xs rounded-card border border-hairline-strong bg-surface-1 p-5 text-center">
                    <Globe2 aria-hidden="true" className="mx-auto size-5 text-stone" />
                    <p className="mt-3 font-serif text-2xl text-ink">这片地图还没有足迹</p>
                    <p className="mt-2 text-xs leading-5 text-muted">
                      放宽年份或状态筛选，再把散落的坐标找回来。
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="min-h-80 p-4">
              <div className="mb-3 flex items-center gap-1.5 rounded-control border border-accent-blue/20 bg-accent-blue/10 px-3 py-2 text-[11px] text-accent-blue">
                <List aria-hidden="true" className="size-3.5" />
                低带宽列表视图：地图不可用或不需要瓦片时，所有旅行仍可访问。
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {filtered.map((trip) => (
                  <button
                    key={trip.id}
                    type="button"
                    onClick={() => setSelectedId(trip.id)}
                    className={`rounded-card border p-3 text-left ${
                      selected?.id === trip.id
                        ? "border-hairline-strong bg-surface-2"
                        : "border-hairline bg-surface-1 hover:bg-surface-2"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-serif text-lg text-ink">{trip.title}</p>
                      <Badge tone={getTripStatusTone(trip.status)}>
                        {getTripStatusLabel(trip.status)}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-muted">
                      {trip.destinations.join(" · ")}
                    </p>
                    <p className="mt-2 font-mono text-[8px] uppercase tracking-[0.08em] text-stone">
                      {trip.countryCodes.map((code) => COUNTRY_NAMES[code] ?? code).join(" · ")}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex h-10 items-center justify-between gap-3 border-t border-hairline px-4">
            <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-muted">
              VISIBLE {filtered.length} / {state.trips.length} · {countries.size} COUNTRIES
            </p>
            <p className="truncate font-mono text-[8px] uppercase tracking-[0.1em] text-stone">
              {selected ? `SELECTED / ${selected.title}` : "NO SELECTION"}
            </p>
          </div>
        </section>

        <aside className="surface-card flex flex-col gap-3 p-3 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)]">
          {selected ? (
            <div className="overflow-hidden rounded-card border border-hairline-strong bg-surface-2">
              <div className="relative h-28 bg-[radial-gradient(circle_at_28%_22%,rgba(255,128,31,0.3),transparent_50%),linear-gradient(135deg,#20140c,#070708)]">
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
                <div className="absolute inset-x-3 bottom-3">
                  <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-white/55">
                    {selected.countryCodes
                      .map((code) => COUNTRY_NAMES[code] ?? code)
                      .join(" · ")}{" "}
                    / {getTripStatusLabel(selected.status)}
                  </p>
                  <h2 className="mt-1 truncate font-serif text-[23px] leading-none text-white">
                    {selected.title}
                  </h2>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[8px] uppercase text-muted">
                    {formatDateRange(selected.startDate, selected.endDate)}
                  </p>
                  <p className="mt-1 truncate text-[10px] text-muted">
                    {selected.destinations.join(" · ")}
                  </p>
                </div>
                <Link
                  href={`/w/${workspaceSlug}/trips/${selected.id}`}
                  className="inline-flex shrink-0 items-center gap-1 text-[10px] text-ink hover:text-accent-orange"
                >
                  打开旅行
                  <ArrowUpRight aria-hidden="true" className="size-3" />
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex min-h-36 flex-col items-center justify-center rounded-card border border-dashed border-hairline-strong text-center">
              <Compass aria-hidden="true" className="size-5 text-stone" />
              <p className="mt-2 font-serif text-lg text-body">选择一个目的地</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-control border border-hairline-strong bg-hairline">
            {[
              ["国家 / 地区", countries.size],
              ["城市", cities.size],
              ["旅行天数", filtered.reduce((sum, trip) => sum + tripDurationDays(trip.startDate, trip.endDate), 0)],
              ["旅行", filtered.length],
            ].map(([label, value]) => (
              <div key={label} className="bg-surface-1 px-3 py-2.5">
                <p className="type-eyebrow">{label}</p>
                <p className="mt-1 font-serif text-xl text-ink">{value}</p>
              </div>
            ))}
          </div>

          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-stone"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索旅行、目的地或标签"
              aria-label="搜索旅行足迹"
              className="h-10 pl-8 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              aria-label="按状态筛选"
              className="h-10 text-[11px]"
            >
              <option value="all">全部状态</option>
              <option value="completed">已归来</option>
              <option value="active">在途</option>
              <option value="upcoming">即将出发</option>
              <option value="planning">计划中</option>
              <option value="wishlist">愿望</option>
            </Select>
            <Select
              value={year}
              onChange={(event) => setYear(event.target.value)}
              aria-label="按年份筛选"
              className="h-10 text-[11px]"
            >
              <option value="all">全部年份</option>
              {years.map((item) => (
                <option key={item} value={item}>
                  {item} 年
                </option>
              ))}
            </Select>
          </div>

          <div className="min-h-52 flex-1 overflow-y-auto pr-1">
            {groups.map(([groupYear, trips]) => (
              <div key={groupYear}>
                <div className="sticky top-0 z-10 flex items-center gap-2 bg-surface-1 py-2">
                  <span className="font-mono text-[10px] text-ink">{groupYear}</span>
                  <span className="h-px flex-1 bg-hairline" />
                  <span className="font-mono text-[8px] text-stone">{trips.length}</span>
                </div>
                {trips.map((trip) => (
                  <button
                    key={trip.id}
                    type="button"
                    onClick={() => setSelectedId(trip.id)}
                    aria-pressed={trip.id === selected?.id}
                    className={`flex w-full items-start gap-2.5 rounded-control p-2 text-left ${
                      trip.id === selected?.id
                        ? "bg-surface-2"
                        : "hover:bg-white/[0.025]"
                    }`}
                  >
                    <span className="relative size-10 shrink-0 overflow-hidden rounded-control border border-hairline bg-[radial-gradient(circle_at_30%_20%,rgba(255,128,31,0.25),transparent_55%),#111]">
                      <MapPin className="absolute inset-0 m-auto size-3.5 text-white/60" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-body">
                        {trip.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[9px] text-muted">
                        {trip.destinations.join(" · ")}
                      </span>
                      <span className="mt-1 flex items-center justify-between font-mono text-[8px] uppercase text-stone">
                        <span>{shortDate(trip.startDate)}</span>
                        <span>{getTripStatusLabel(trip.status)}</span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          {selected ? (
            <div className="border-t border-hairline pt-2">
              <AvatarGroup
                members={selected.guestNames.map((name, index) => ({
                  id: `${selected.id}-${index}`,
                  name,
                  online: index === 0,
                }))}
                size={24}
              />
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
