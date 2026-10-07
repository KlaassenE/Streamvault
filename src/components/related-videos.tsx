"use client";
import { useEffect, useRef, useState } from "react";
import type { VideoCard } from "@/lib/types";
import { VideoGrid } from "./video-grid";
export function RelatedVideos({ videoId }: { videoId: string }) {
  const ref = useRef<HTMLElement>(null);
  const [items, setItems] = useState<VideoCard[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let started = false;
    let near = false;
    const load = () => {
      if (started || !near || document.hidden) return;
      started = true;
      fetch(
        `/api/feed?seed=${new Date().toISOString().slice(0, 10)}&current=${encodeURIComponent(videoId)}`,
        { signal: controller.signal },
      )
        .then(async (response) => {
          if (!response.ok) throw new Error("Recommendations could not load.");
          const data = await response.json();
          let items = data.items;
          if (data.next !== null && items.length < 30) {
            const more = await fetch(
              `/api/feed?seed=${new Date().toISOString().slice(0, 10)}&current=${encodeURIComponent(videoId)}&offset=${data.next}`,
              { signal: controller.signal },
            );
            if (more.ok) items = [...items, ...(await more.json()).items];
          }
          setItems(items.slice(0, 30));
          window.dispatchEvent(
            new CustomEvent("streamvault:next", {
              detail: { videoId, nextId: data.items[0]?.id },
            }),
          );
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(error.message);
        });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        near = entries[0].isIntersecting;
        load();
      },
      { rootMargin: "400px" },
    );
    if (ref.current) observer.observe(ref.current);
    document.addEventListener("visibilitychange", load);
    return () => {
      controller.abort();
      observer.disconnect();
      document.removeEventListener("visibilitychange", load);
    };
  }, [videoId]);
  return (
    <aside className="up-next" ref={ref}>
      <h2>Up next</h2>
      {error ? (
        <p className="muted small">{error}</p>
      ) : items ? (
        <VideoGrid
          initial={items}
          initialNext={null}
          endpoint="/api/feed"
          compact
        />
      ) : (
        <p className="muted small">Finding your next watch…</p>
      )}
    </aside>
  );
}
