"use client";
import { clientId } from "@/lib/client-id";
import { watchHref } from "@/lib/video-url";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Shuffle } from "lucide-react";
import type { VideoCard } from "@/lib/types";
import { duration } from "@/lib/utils";
import { Button } from "./ui/button";
import { Thumbnail, VideoGrid } from "./video-grid";
export function HomeFeed({
  initial,
  resume,
  seed: initialSeed,
  resumeEnabled = true,
}: {
  initial: { items: VideoCard[]; next: number | null };
  resume: VideoCard[];
  seed: string;
  resumeEnabled?: boolean;
}) {
  const [filter, setFilter] = useState("For you");
  const [seed, setSeed] = useState(initialSeed);
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [visit, setVisit] = useState(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    try {
      const key = "streamvault-home-visits";
      const visits = (Number(sessionStorage.getItem(key)) || 0) + 1;
      sessionStorage.setItem(key, String(visits));
      setVisit(visits - 1);
    } catch {}
    return () => request.current?.abort();
  }, []);
  async function refresh(nextFilter = filter, newSeed = seed) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/feed?seed=${encodeURIComponent(newSeed)}&filter=${encodeURIComponent(nextFilter)}`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error("Could not refresh your mix.");
      setData(await response.json());
      setFilter(nextFilter);
      setSeed(newSeed);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : "Could not refresh your mix.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  const showResume =
    resumeEnabled &&
    resume.length >= 4 &&
    filter === "For you" &&
    visit % 3 === 0;
  const featured = resume[0];
  const excluded = useMemo(
    () => (showResume ? resume.map((r) => r.id) : []),
    [showResume, resume],
  );
  const filteredInitial = useMemo(
    () => data.items.filter((v) => !excluded.includes(v.id)),
    [data.items, excluded],
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Your next good watch.</h1>
          <p>A little familiar. A little unexpected.</p>
        </div>
        <Button
          variant="ghost"
          disabled={loading}
          onClick={() => {
            setVisit((v) => v + 1);
            void refresh(filter, clientId());
          }}
          aria-label="Refresh your mix"
        >
          <Shuffle size={17} />
          <span className="refresh-label">Refresh your mix</span>
        </Button>
      </div>
      {showResume && (
        <section className="resume-layout" aria-label="Continue watching">
          <Link
            href={watchHref(featured.id)}
            prefetch={false}
            className="resume-feature"
          >
            <Thumbnail video={featured} priority />
            <div className="resume-feature-copy">
              <div className="eyebrow">Pick up where you left off</div>
              <h2>{featured.title}</h2>
              <p className="small">
                {featured.channel} · Continue from {duration(featured.seconds)}
              </p>
            </div>
          </Link>
          <div className="resume-side">
            <div className="section-heading">
              <h2>Keep watching</h2>
              <span className="muted small">3 videos</span>
            </div>
            <div className="resume-items">
              {resume.slice(1, 4).map((video) => (
                <Link
                  href={watchHref(video.id)}
                  prefetch={false}
                  className="resume-card"
                  key={video.id}
                >
                  <Thumbnail video={video} />
                  <div>
                    <h3>{video.title}</h3>
                    <p>{video.channel}</p>
                    <p>
                      {duration(video.seconds)} ·{" "}
                      {Math.ceil((video.duration - video.seconds) / 60)} min
                      left
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
      <nav className="feed-tabs" aria-label="Feed filters">
        {["For you", "New to you", "Continue watching", "Recently added"].map(
          (label) => (
            <button
              key={label}
              aria-pressed={filter === label}
              onClick={() => void refresh(label)}
              disabled={loading}
            >
              {label}
            </button>
          ),
        )}
      </nav>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <VideoGrid
        exclude={excluded}
        initial={filteredInitial}
        initialNext={data.next}
        endpoint={`/api/feed?seed=${encodeURIComponent(seed)}&filter=${encodeURIComponent(filter)}`}
      />
    </>
  );
}
