"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import type { PhotoLightboxItem } from "@/components/media/photo-lightbox";

const PhotoLightbox = dynamic(
  () => import("@/components/media/photo-lightbox").then((module) => module.PhotoLightbox),
  { ssr: false },
);

const GALLERY_SELECTOR = 'div[data-type="gallery"]';
const GALLERY_ITEM_SELECTOR = 'figure[data-type="gallery-item"]';
const GALLERY_IMAGE_SELECTOR = `${GALLERY_ITEM_SELECTOR} img[src]`;

interface GalleryViewer {
  index: number;
  items: PhotoLightboxItem[];
}

function positiveDimension(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function imageDimension(value: string | null, fallback: number): number | null {
  if (value !== null) {
    const parsed = Number(value);
    const dimension = positiveDimension(parsed);
    if (dimension !== null) return dimension;
  }

  return positiveDimension(fallback);
}

function galleryItemCaption(image: HTMLImageElement): string {
  return (
    image.closest(GALLERY_ITEM_SELECTOR)?.querySelector("figcaption")?.textContent?.trim() ?? ""
  );
}

function galleryItemsFromImage(image: HTMLImageElement): {
  index: number;
  items: PhotoLightboxItem[];
} {
  const gallery = image.closest(GALLERY_SELECTOR);
  if (!gallery) return { index: -1, items: [] };

  const sourceImages = Array.from(
    gallery.querySelectorAll<HTMLImageElement>(GALLERY_IMAGE_SELECTOR),
  );
  const index = sourceImages.indexOf(image);

  return {
    index,
    items: sourceImages.map((item, itemIndex) => {
      const caption = galleryItemCaption(item);
      const alt = item.alt.trim() || caption || `图库第 ${itemIndex + 1} 张图片`;
      const src = item.currentSrc || item.src;

      return {
        id: `${gallery.getAttribute("data-columns") ?? "gallery"}-${itemIndex}-${src}`,
        src,
        alt,
        width: imageDimension(item.getAttribute("width"), item.naturalWidth),
        height: imageDimension(item.getAttribute("height"), item.naturalHeight),
      };
    }),
  };
}

function annotateGalleryImages(container: HTMLElement) {
  const images = Array.from(container.querySelectorAll<HTMLImageElement>(GALLERY_IMAGE_SELECTOR));

  images.forEach((image, index) => {
    const caption = galleryItemCaption(image);
    const label = image.alt.trim() || caption || `图库第 ${index + 1} 张图片`;

    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", `查看图片：${label}`);

    // Keep the annotation behavior idempotent when the lightbox returns focus
    // or the surrounding HTML re-renders after a client transition.
    image.dataset.galleryLightbox = "true";
  });
}

export interface ShareGalleryLightboxProps {
  html: string;
  className: string;
}

/**
 * Public journal body with gallery lightbox behavior.
 *
 * The body itself remains server-rendered sanitized HTML: this wrapper only
 * annotates gallery images after hydration and adds delegated interaction.
 * That keeps the no-JS reading path intact and keeps the public payload free
 * of any editor-only state.
 *
 * Ported from emdash-cms/emdash@732867e9836efbd9fa9cf01f4fd086949b1bb392
 * (MIT) Gallery.astro:177-240 for the gallery-item shape, and follows Roamlog's
 * existing PhotoLightbox integration pattern in photos-tab.tsx:264-275 and
 * trip-map-page.tsx:75-81.
 */
export function ShareGalleryLightbox({ html, className }: ShareGalleryLightboxProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLImageElement | null>(null);
  const [viewer, setViewer] = useState<GalleryViewer | null>(null);

  function openImage(image: HTMLImageElement) {
    if (!image.closest(GALLERY_SELECTOR)) return;

    const { index, items } = galleryItemsFromImage(image);
    if (items.length === 0 || index < 0) return;

    triggerRef.current = image;
    setViewer({ items, index });
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setViewer(null);
    triggerRef.current = null;
    annotateGalleryImages(container);
    return () => {
      triggerRef.current = null;
    };
    // The sanitized HTML is the only input that can change the gallery DOM.
  }, [html]);

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    if (!target.closest(GALLERY_SELECTOR)) return;

    event.preventDefault();
    openImage(target);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    if (!target.closest(GALLERY_SELECTOR)) return;
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    openImage(target);
  }

  function closeViewer() {
    setViewer(null);
    const trigger = triggerRef.current;
    triggerRef.current = null;
    queueMicrotask(() => trigger?.focus());
  }

  return (
    <>
      <div
        ref={containerRef}
        className={className}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {viewer ? (
        <PhotoLightbox
          open
          index={viewer.index}
          items={viewer.items}
          onClose={closeViewer}
        />
      ) : null}
    </>
  );
}
