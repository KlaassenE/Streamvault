"use client";
import { useEffect, useRef, useState, lazy, Suspense } from "react";
const Comments = lazy(() => import("./comments"));
export function LazyComments({ videoId }: { videoId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let visible = false;
    const activate = () => {
      if (visible && !document.hidden) {
        setReady(true);
        observer.disconnect();
        document.removeEventListener("visibilitychange", activate);
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries[0].isIntersecting;
        activate();
      },
      { rootMargin: "200px" },
    );
    if (ref.current) observer.observe(ref.current);
    document.addEventListener("visibilitychange", activate);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", activate);
    };
  }, []);
  return (
    <div ref={ref} className="watch-comments">
      {ready ? (
        <Suspense fallback={<p className="muted small">Loading comments…</p>}>
          <Comments videoId={videoId} />
        </Suspense>
      ) : (
        <div className="comments-section">
          <h2>Comments</h2>
          <p className="muted small">Comments load when you scroll here.</p>
        </div>
      )}
    </div>
  );
}
