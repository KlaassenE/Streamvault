"use client";
import { watchHref } from "@/lib/video-url";
import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Player } from "./player";
import { Button } from "./ui/button";
export function WatchPlayer({
  player,
  nextId,
  autoplay,
}: {
  player: React.ComponentProps<typeof Player>;
  nextId?: string;
  autoplay: boolean;
}) {
  const router = useRouter();
  const [recommended, setRecommended] = useState(nextId);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.videoId === player.videoId) setRecommended(detail.nextId);
    };
    window.addEventListener("streamvault:next", receive);
    return () => window.removeEventListener("streamvault:next", receive);
  }, [player.videoId]);
  const [count, setCount] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (count === null) return;
    timer.current = setInterval(() => {
      if (!document.hidden)
        setCount((value) => (value === null ? null : Math.max(0, value - 1)));
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [count === null]);
  useEffect(() => {
    if (count === 0 && recommended) {
      setCount(null);
      router.push(`${watchHref(recommended)}&autoplay=1`);
    }
  }, [count, recommended, router]);
  return (
    <>
      <Player
        {...player}
        onComplete={() => {
          if (autoplay && recommended && !document.hidden) setCount(8);
        }}
      />
      {count !== null && (
        <div className="list-row">
          <span>Next video in {count} seconds</span>
          <div className="inline-actions">
            <Button variant="ghost" onClick={() => setCount(null)}>
              Cancel
            </Button>
            <Button onClick={() => setCount(0)}>Play next</Button>
          </div>
        </div>
      )}
    </>
  );
}
