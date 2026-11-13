import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { LibraryFile } from "./library";

/** Both local and shared cards display the same full raster renderer, never a miniature node tree. */
export function Thumbnail({
  file,
  className,
  compact = false,
}: {
  file: LibraryFile;
  className?: string;
  compact?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const covers = window.fileThumbnails;
    let disposed = false,
      serial = 0,
      shown = "";
    const show = (cover: FileCover | null) => {
      if (disposed) return;
      // Every card repaints on each `file-thumbnail-changed`: keep an image that is already
      // shown or loading, and never blank a painted card because a cache entry was evicted.
      if (!cover) {
        if (shown) return;
        ++serial;
        box.replaceChildren();
        setEmpty(true);
        return;
      }
      const key = `${cover.url}|${cover.nodeId || ""}`;
      if (key === shown) return;
      shown = key;
      const version = ++serial;
      const image = new Image();
      image.dataset.fileThumbnailImage = "";
      image.alt = "";
      image.className = cn("size-full", cover.nodeId ? "object-cover" : "object-contain");
      image.onload = () => {
        if (disposed || serial !== version) return;
        if (cover.nodeId) box.dataset.thumbnailNode = cover.nodeId;
        else delete box.dataset.thumbnailNode;
        if (cover.pageId) box.dataset.thumbnailPage = cover.pageId;
        box.replaceChildren(image);
        setEmpty(false);
      };
      image.onerror = () => {
        if (disposed || serial !== version) return;
        shown = "";
        box.replaceChildren();
        setEmpty(true);
        if (!cover.url.startsWith("data:"))
          void covers.local(file).then((fallback) => {
            if (!disposed && serial === version) show(fallback);
          });
      };
      image.src = cover.url;
    };
    const paint = () => {
      const cover = covers.cached(file);
      show(cover);
      // Only an unpainted card asks for a local render, so more than 64 local files (the
      // local cache size) cannot evict each other into an endless re-render loop.
      if (!cover && !shown)
        void covers.local(file).then((fallback) => {
          if (!disposed) show(fallback);
        });
    };
    window.addEventListener("file-thumbnail-changed", paint);
    paint();
    void covers.load(file).then((cover) => {
      if (!disposed) show(cover);
    });
    return () => {
      disposed = true;
      window.removeEventListener("file-thumbnail-changed", paint);
    };
  }, [file]);
  return (
    <div className={cn("relative overflow-hidden bg-background", className)}>
      <div ref={ref} className="absolute inset-0" aria-hidden="true" />
      {empty && <EmptyMark compact={compact} />}
    </div>
  );
}

/* Faint outlined app mark, like Wonder's empty file thumbnail. */
function EmptyMark({ compact }: { compact: boolean }) {
  return (
    <svg
      viewBox="0 0 120 84"
      aria-hidden="true"
      className={cn(
        "absolute left-1/2 -translate-x-1/2 fill-none stroke-edge",
        compact ? "bottom-0 h-6 w-9 stroke-2" : "bottom-0 h-36 w-52",
      )}
    >
      <path d="M8 84C3 66 2 44 6 30 10 14 24 4 38 8c8 2 14 8 16 14 4-8 10-14 18-14 8 0 14 6 18 14 2-6 8-12 16-14 14-4 28 6 32 22 4 14 3 36-2 54" />
      <ellipse cx="44" cy="66" rx="8" ry="16" />
      <ellipse cx="76" cy="66" rx="8" ry="16" />
    </svg>
  );
}

type FileCover = { url: string; nodeId: string | null; pageId?: string | null };

declare global {
  interface Window {
    fileThumbnails: {
      cached(file: LibraryFile): FileCover | null;
      load(file: LibraryFile): Promise<FileCover | null>;
      local(file: LibraryFile): Promise<FileCover | null>;
      refresh(): Promise<void>;
      status(): { uploading: boolean; lastError: string };
    };
  }
}
