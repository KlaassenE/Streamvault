"use client";
import { watchHref } from "@/lib/video-url";
import Link from "next/link";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { EllipsisVertical, Film } from "lucide-react";
import { duration, relativeDate } from "@/lib/utils";
import type { VideoCard } from "@/lib/types";
import { Button } from "./ui/button";
export function Thumbnail({
  video,
  priority = false,
}: {
  video: VideoCard;
  priority?: boolean;
}) {
  return (
    <span className="video-thumbnail">
      <span className="thumbnail-fallback">
        <Film size={42} />
      </span>
      {!!video.thumbnail && (
        <img
          src={`/media/thumbnail/${encodeURIComponent(video.id)}`}
          alt=""
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      )}
      <span className="duration">{duration(video.duration)}</span>
      {video.seconds > 0 && video.duration > 0 && (
        <span className="card-progress">
          <span
            style={{
              width: `${Math.min(100, (video.seconds / video.duration) * 100)}%`,
            }}
          />
        </span>
      )}
    </span>
  );
}
function Card({
  video,
  onDismiss,
}: {
  video: VideoCard;
  onDismiss?: (id: string) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let near = false;
    let recorded = false;
    const check = () => {
      if (timer) clearTimeout(timer);
      if (near && !document.hidden && !recorded)
        timer = setTimeout(() => {
          if (document.hidden) return;
          recorded = true;
          fetch("/api/impressions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [video.id] }),
          }).catch(() => {});
          observer.disconnect();
        }, 1000);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        near = entries[0]?.isIntersecting;
        check();
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    document.addEventListener("visibilitychange", check);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [video.id]);
  async function act(kind: string) {
    try {
      const response = await fetch(
        kind === "video" || kind === "channel"
          ? "/api/feedback"
          : kind === "complete"
            ? "/api/progress/complete"
            : "/api/progress/reset",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            id: kind === "channel" ? video.channel_id : video.id,
            videoId: video.id,
          }),
        },
      );
      if (!response.ok) throw new Error((await response.json()).error);
      if (
        kind === "video" ||
        kind === "channel" ||
        kind === "complete" ||
        kind === "reset"
      )
        onDismiss?.(video.id);
      ref.current?.querySelector("details")?.removeAttribute("open");
    } catch (error) {
      setError(error instanceof Error ? error.message : "This action failed.");
    }
  }
  return (
    <article className="video-card" ref={ref}>
      <Link
        href={watchHref(video.id)}
        prefetch={false}
        aria-label={`Watch ${video.title}`}
      >
        <Thumbnail video={video} />
      </Link>
      <div>
        <h3>
          <Link href={watchHref(video.id)} prefetch={false}>
            {video.title}
          </Link>
        </h3>
        <div className="card-meta">
          <Link
            href={`/channel/${encodeURIComponent(video.channel_id)}`}
            prefetch={false}
          >
            {video.channel}
          </Link>
          <br />
          {relativeDate(video.published_at)}
          {!!video.completed && " · Watched"}
          {!video.available && " · File unavailable"}
        </div>
      </div>
      <details className="card-menu">
        <summary aria-label={`Options for ${video.title}`}>
          <EllipsisVertical size={17} />
        </summary>
        <div className="menu-popover">
          <button onClick={() => act("video")}>Not interested</button>
          <button onClick={() => act("channel")}>Less from this channel</button>
          <button onClick={() => act("complete")}>Mark watched</button>
          {video.seconds > 0 && (
            <button onClick={() => act("reset")}>Reset progress</button>
          )}
        </div>
      </details>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
function VirtualChunk({
  items,
  onDismiss,
  virtual,
}: {
  items: VideoCard[];
  onDismiss: (id: string) => void;
  virtual: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const height = useRef(0);
  const [active, setActive] = useState(true);
  useLayoutEffect(() => {
    if (ref.current && active)
      height.current = ref.current.getBoundingClientRect().height;
  }, [active, items]);
  useEffect(() => {
    if (!virtual || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries[0].isIntersecting;
        if (!visible && ref.current && active)
          height.current = ref.current.getBoundingClientRect().height;
        setActive(visible);
      },
      { rootMargin: "1500px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [virtual, active]);
  return (
    <div ref={ref} style={!active ? { height: height.current } : undefined}>
      {active ? (
        <div className="video-grid">
          {items.map((v) => (
            <Card key={v.id} video={v} onDismiss={onDismiss} />
          ))}
        </div>
      ) : (
        <span className="sr-only">
          More videos appear when you scroll here.
        </span>
      )}
    </div>
  );
}
const noExclusions: string[] = [];
export function VideoGrid({
  initial,
  initialNext,
  endpoint,
  compact = false,
  exclude = noExclusions,
}: {
  initial: VideoCard[];
  initialNext: number | null;
  endpoint: string;
  compact?: boolean;
  exclude?: string[];
}) {
  const [items, setItems] = useState(initial);
  const firstPageSignature = initial.map((v) => v.id).join(",");
  const [next, setNext] = useState(initialNext);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const latest = useRef({ items, next });
  latest.current = { items, next };
  useEffect(() => {
    let restored = false;
    if (!compact) {
      try {
        const saved = JSON.parse(
          sessionStorage.getItem(
            `streamvault-grid:${document.querySelector(".app-shell")?.getAttribute("data-user")}:${endpoint}:${exclude.join(",")}`,
          ) || "null",
        );
        if (
          saved &&
          saved.at > Date.now() - 4 * 3600000 &&
          Array.isArray(saved.items) &&
          saved.revision ===
            document
              .querySelector(".app-shell")
              ?.getAttribute("data-revision") &&
          saved.firstPageSignature === firstPageSignature
        ) {
          setItems(
            saved.items
              .filter((v: VideoCard) => !exclude.includes(v.id))
              .map(
                (v: VideoCard) =>
                  initial.find((fresh) => fresh.id === v.id) || v,
              ),
          );
          setNext(saved.next);
          restored = true;
        }
      } catch {}
    }
    if (!restored) {
      setItems(initial);
      setNext(initialNext);
    }
    setLoading(false);
    setError("");
    busy.current = false;
    abort.current?.abort();
  }, [initial, initialNext, endpoint, compact, exclude]);
  useEffect(() => {
    if (compact) return;
    const persist = () => {
      try {
        sessionStorage.setItem(
          `streamvault-grid:${document.querySelector(".app-shell")?.getAttribute("data-user")}:${endpoint}:${exclude.join(",")}`,
          JSON.stringify({
            ...latest.current,
            at: Date.now(),
            firstPageSignature,
            revision: document
              .querySelector(".app-shell")
              ?.getAttribute("data-revision"),
          }),
        );
      } catch {}
    };
    window.addEventListener("pagehide", persist);
    return () => {
      persist();
      window.removeEventListener("pagehide", persist);
    };
  }, [endpoint, compact, exclude, firstPageSignature]);
  useEffect(() => () => abort.current?.abort(), []);
  const load = useCallback(async () => {
    if (busy.current || next === null || document.hidden) return;
    busy.current = true;
    setLoading(true);
    setError("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const response = await fetch(
        `${endpoint}${endpoint.includes("?") ? "&" : "?"}offset=${next}`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error("Could not load more videos.");
      const data = await response.json();
      setItems((previous) => [
        ...new Map(
          [
            ...previous,
            ...data.items.filter((v: VideoCard) => !exclude.includes(v.id)),
          ].map((v: VideoCard) => [v.id, v]),
        ).values(),
      ]);
      setNext(data.next);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : "Could not load more videos.",
        );
    } finally {
      if (!controller.signal.aborted) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [endpoint, next, exclude]);
  useEffect(() => {
    if (compact || next === null || error || !sentinel.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) void load();
      },
      { rootMargin: "500px" },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [compact, next, error, load]);
  const dismiss = (id: string) =>
    setItems((previous) => previous.filter((v) => v.id !== id));
  const chunks = Array.from(
    { length: Math.ceil(items.length / 24) },
    (_, index) => items.slice(index * 24, index * 24 + 24),
  );
  return (
    <>
      <div className="stack-gap">
        {chunks.map((chunk, index) => (
          <VirtualChunk
            key={index}
            items={chunk}
            onDismiss={dismiss}
            virtual={!compact && chunks.length > 2}
          />
        ))}
      </div>
      {!items.length && <p className="muted">No videos here yet.</p>}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {!compact && next !== null && (
        <div ref={sentinel} className="feed-end">
          <Button variant="ghost" disabled={loading} onClick={load}>
            {loading ? "Loading…" : "Load more videos"}
          </Button>
        </div>
      )}
    </>
  );
}
