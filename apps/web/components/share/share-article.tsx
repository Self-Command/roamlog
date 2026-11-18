"use client";

import { Badge } from "@roamlog/ui";
import {
  ArrowUpRight,
  CalendarDays,
  Camera,
  MapPin,
  Route,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { formatMinor, moodLabels, weatherLabels } from "@/lib/demo-format";
import {
  coverClassForTrip,
  formatDateRange,
  formatLongDate,
  getTripStatusLabel,
  tripDurationDays,
} from "@/lib/trip-presentation";
import type { PublicMedia, PublicTrip, PublicTripResponse } from "@roamlog/contracts";

import { sanitizePublicHtml } from "./html";

export function ShareArticle({ data }: { data: PublicTripResponse }) {
  const { trip, stops, entries, media, budget } = data;
  const tripIndex =
    [...trip.id].reduce((total, character) => total + character.charCodeAt(0), 0) % 5;
  const [coverFailed, setCoverFailed] = useState(false);
  // The public payload carries a signed cover URL only once the poster is
  // `ready`; anything else keeps the generated gradient so the hero never
  // renders an empty or broken `<img>`.
  const coverUrl = coverFailed ? null : coverImageUrl(trip.cover);
  const hasCover = coverUrl !== null;

  return (
    <main className="mx-auto w-full max-w-[880px] px-5 pb-24 sm:px-8">
      <header className="border-b border-hairline py-8 sm:py-12">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted transition-colors hover:text-ink"
          >
            Shared from Roamlog
          </Link>
          <Badge tone="neutral">{getTripStatusLabel(trip.status)}</Badge>
        </div>

        <div
          className={
            hasCover
              ? "relative mt-6 min-h-48 overflow-hidden rounded-card border border-hairline-strong bg-surface-1 sm:min-h-64"
              : `trip-cover ${coverClassForTrip(tripIndex)} mt-6 min-h-48 overflow-hidden rounded-card border border-hairline-strong sm:min-h-64`
          }
          aria-hidden={hasCover ? undefined : true}
        >
          {coverUrl ? (
            <img
              src={coverUrl}
              alt=""
              loading="eager"
              decoding="async"
              onError={() => setCoverFailed(true)}
              className="absolute inset-0 size-full object-cover"
            />
          ) : null}
          {hasCover ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent"
            />
          ) : null}
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/60">
              {trip.countryCodes.join(" · ")} / {tripDurationDays(trip.startDate, trip.endDate)}{" "}
              DAYS
            </p>
          </div>
        </div>

        <h1 className="mt-7 max-w-3xl font-serif text-[clamp(2.2rem,5vw,3rem)] leading-[1.06] tracking-[-0.04em] text-ink">
          {trip.title}
        </h1>
        {trip.summary ? (
          <p className="mt-4 max-w-2xl text-sm leading-7 text-muted">{trip.summary}</p>
        ) : null}

        <dl className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-hairline pt-4 text-[11px] text-muted">
          <div className="inline-flex items-center gap-1.5">
            <CalendarDays aria-hidden="true" className="size-3.5 text-stone" />
            <dt className="sr-only">日期</dt>
            <dd>{formatDateRange(trip.startDate, trip.endDate)}</dd>
          </div>
          <div className="inline-flex items-center gap-1.5">
            <Route aria-hidden="true" className="size-3.5 text-stone" />
            <dt className="sr-only">路线</dt>
            <dd className="max-w-full truncate">
              {trip.origin} → {trip.destinations.join(" → ")}
            </dd>
          </div>
        </dl>
      </header>

      {stops.length ? (
        <section aria-labelledby="share-route" className="border-b border-hairline py-9">
          <p className="type-eyebrow">ROUTE / {stops.length} STOPS</p>
          <h2
            id="share-route"
            className="mt-1.5 font-serif text-2xl tracking-[-0.025em] text-ink"
          >
            路线与停靠点
          </h2>
          <ol className="mt-5 grid gap-2 sm:grid-cols-2">
            {stops.map((stop, index) => (
              <li
                key={stop.id}
                className="flex items-start gap-3 rounded-card border border-hairline bg-surface-1 p-3"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-pill border border-hairline-strong font-mono text-[9px] text-muted">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-ink">
                    {stop.city} · {stop.country}
                  </span>
                  <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
                    {formatDateRange(stop.startDate, stop.endDate)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {budget ? (
        <section aria-labelledby="share-budget" className="border-b border-hairline py-9">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="type-eyebrow">BUDGET / OPTIONAL SUMMARY</p>
              <h2
                id="share-budget"
                className="mt-1.5 font-serif text-2xl tracking-[-0.025em] text-ink"
              >
                旅行预算
              </h2>
            </div>
            <p className="font-serif text-3xl text-ink">
              {formatMinor(budget.displayTotal.amountMinor, budget.displayTotal.currency)}
              <span className="ml-1 align-middle font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
                APPROX
              </span>
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Wallet aria-hidden="true" className="size-3.5 text-stone" />
              {budget.expenseCount} 笔记录
            </span>
            {budget.categories.slice(0, 4).map((category) => (
              <span key={category.category} className="font-mono text-[9px] uppercase text-stone">
                {category.category} ·{" "}
                {formatMinor(
                  category.totals[0]?.amountMinor ?? 0,
                  category.totals[0]?.currency ?? budget.displayCurrency,
                )}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="share-journal" className="py-9">
        <p className="type-eyebrow">JOURNAL / {entries.length} ENTRIES</p>
        <h2
          id="share-journal"
          className="mt-1.5 font-serif text-2xl tracking-[-0.025em] text-ink"
        >
          旅行日志
        </h2>
        <div className="mt-6 space-y-10">
          {entries.map((entry) => (
            <article key={entry.id} className="border-t border-hairline pt-7">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
                <time dateTime={entry.date}>{formatLongDate(entry.date)}</time>
                {entry.location ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin aria-hidden="true" className="size-3" />
                    {entry.location}
                  </span>
                ) : null}
                {entry.mood ? <span>{moodLabels[entry.mood]}</span> : null}
                {entry.weather ? <span>{weatherLabels[entry.weather]}</span> : null}
              </div>
              <h3 className="mt-3 max-w-2xl font-serif text-[clamp(1.65rem,3.5vw,2.2rem)] leading-[1.12] tracking-[-0.03em] text-ink">
                {entry.title}
              </h3>
              {entry.excerpt ? (
                <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">{entry.excerpt}</p>
              ) : null}
              <div
                className="share-prose mt-4 max-w-2xl text-[15px] leading-7 text-body"
                dangerouslySetInnerHTML={{ __html: sanitizePublicHtml(entry.contentHtml) }}
              />
              {entry.media.length ? (
                <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {entry.media.map((item, index) => (
                    <SharePhoto key={item.id} media={item} index={index} />
                  ))}
                </div>
              ) : null}
            </article>
          ))}
          {!entries.length ? (
            <p className="rounded-card border border-dashed border-hairline-strong p-8 text-center text-sm text-muted">
              这趟旅行还没有公开日志。
            </p>
          ) : null}
        </div>
      </section>

      {media.length ? (
        <section aria-labelledby="share-photos" className="border-t border-hairline py-9">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="type-eyebrow">PHOTOS / {media.length}</p>
              <h2
                id="share-photos"
                className="mt-1.5 font-serif text-2xl tracking-[-0.025em] text-ink"
              >
                照片
              </h2>
            </div>
            <Camera aria-hidden="true" className="size-4 text-stone" />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {media.map((item, index) => (
              <SharePhoto key={item.id} media={item} index={index} />
            ))}
          </div>
        </section>
      ) : null}

      <footer className="border-t border-hairline py-10">
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-stone">
          END OF SHARED ARCHIVE
        </p>
        <div className="mt-4 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <p className="font-serif text-xl text-ink">把共同记忆留在同一个地方。</p>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-control border border-hairline-strong px-3 py-2 text-[11px] text-body transition-colors hover:border-white/25 hover:text-ink"
          >
            Create your own travel archive
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </Link>
        </div>
      </footer>
    </main>
  );
}

/**
 * The public projection only exposes usable signed URLs on a `ready` cover.
 * `/` and `/atlas` already prefer the large variant and fall back to the
 * thumbnail; the share hero follows the same rule so every surface agrees.
 */
function coverImageUrl(cover: PublicTrip["cover"]): string | null {
  if (!cover || cover.status !== "ready") return null;
  return cover.url ?? cover.thumbUrl;
}

/**
 * Photo tiles are grid cells, so the signed variant is the right bytes for
 * small viewports; the display URL stays in `src` for the widest layout. Both
 * come from the public payload — the client never assembles a bucket origin,
 * key, or signature.
 */
function SharePhoto({ media, index }: { media: PublicMedia; index: number }) {
  const [failed, setFailed] = useState(false);
  const gradients = [
    "from-[#25160d] via-[#11100d] to-[#070708]",
    "from-[#0c1822] via-[#0b1117] to-[#070708]",
    "from-[#122019] via-[#0b1210] to-[#070708]",
    "from-[#211015] via-[#121012] to-[#070708]",
  ];
  const score = [...media.id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const caption = media.caption?.trim() ? media.caption : null;
  const location = media.location;
  // Same rule as the hero: a missing or failing signed URL keeps the generated
  // gradient instead of leaving a blank or broken frame in the wall.
  const photoUrl = failed ? null : (media.url ?? media.thumbUrl);
  const thumbUrl = failed ? null : media.thumbUrl;

  return (
    <figure className="overflow-hidden rounded-control border border-hairline bg-surface-1">
      {photoUrl ? (
        <img
          src={photoUrl}
          srcSet={
            thumbUrl && media.url ? `${thumbUrl} 320w, ${media.url} 960w` : undefined
          }
          sizes="(min-width: 1024px) 200px, (min-width: 640px) 30vw, 45vw"
          alt={caption ?? ""}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="aspect-[4/3] w-full object-cover"
        />
      ) : (
        <div
          className={`aspect-[4/3] bg-gradient-to-br ${gradients[(score + index) % gradients.length]}`}
          aria-hidden="true"
        />
      )}
      {caption || location ? (
        <figcaption className="px-2.5 py-2 text-[9px] leading-4 text-muted">
          {caption ?? location}
        </figcaption>
      ) : null}
    </figure>
  );
}
